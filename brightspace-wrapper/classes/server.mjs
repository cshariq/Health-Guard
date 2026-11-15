#!/usr/bin/env node
/*
 * Lumen Classes — a small, self-hosted learning platform (no dependencies, Node 22+).
 *
 *   node classes/server.mjs      → http://localhost:8200
 *
 * Teachers create classes and share a join code; students join, read announcements and
 * materials, hand in assignments, take quizzes and see their grades.
 *
 * Two APIs:
 *   /api/...       the native read/write API the Lumen Classes web UI uses
 *   /d2l/api/...   a READ-ONLY, Brightspace-(Valence)-shaped view of the same data, so the
 *                  existing Lumen UI and the native apps work against this server unchanged
 *
 * Data lives in SQLite (classes/data/lumen.db) and uploaded files in classes/data/files/.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { smtpSend } from './mail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8200);
const DATA = path.resolve(process.env.LUMEN_DATA || path.join(ROOT, 'classes', 'data'));
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECURE = PUBLIC_URL.startsWith('https://');
const ALLOW_SIGNUP = process.env.LUMEN_ALLOW_SIGNUP !== 'false';
const ADMIN_EMAILS = (process.env.LUMEN_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const SMTP_URL = process.env.SMTP_URL || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Lumen Classes <no-reply@localhost>';
// Single sign-on with any OpenID Connect provider (Google, Microsoft Entra, a school IdP…).
const OIDC = process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID
  ? { issuer: process.env.OIDC_ISSUER.replace(/\/+$/, ''), clientId: process.env.OIDC_CLIENT_ID, clientSecret: process.env.OIDC_CLIENT_SECRET || '', name: process.env.OIDC_NAME || 'your school account' }
  : null;
const QUIZ_GRACE_MS = 60e3; // slack after a quiz timer ends, for slow networks
const MAX_UPLOAD = Number(process.env.LUMEN_MAX_UPLOAD_MB || 25) * 1024 * 1024;
const SESSION_DAYS = 30;
// Named like Brightspace's session cookie so the native apps' login detection works as-is.
const COOKIE = 'd2lSessionVal';

fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'lumen.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS classes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', join_code TEXT UNIQUE NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), created TEXT NOT NULL, archived TEXT);
  CREATE TABLE IF NOT EXISTS members (class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, joined TEXT NOT NULL, PRIMARY KEY (class_id, user_id));
  CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, author_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS modules (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, owner_id INTEGER NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, disk TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', due TEXT, points REAL NOT NULL DEFAULT 100, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL DEFAULT '', file_id INTEGER, submitted TEXT NOT NULL, grade REAL, feedback TEXT, graded TEXT, UNIQUE (assignment_id, user_id));
  CREATE TABLE IF NOT EXISTS quizzes (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due TEXT, questions TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, answers TEXT NOT NULL, score REAL NOT NULL, submitted TEXT NOT NULL, UNIQUE (quiz_id, user_id));
  -- A topic is one row in Classwork: a note, a link, a file, or a pointer to an assignment/quiz.
  CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', url TEXT, file_id INTEGER, ref_id INTEGER, created TEXT NOT NULL);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS resets (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS discussions (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY, discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
`);
// Migrations: add columns to databases created by earlier versions.
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
const addColumn = (table, col, def) => { if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
addColumn('users', 'admin', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'can_teach', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'notify', 'INTEGER NOT NULL DEFAULT 1');
addColumn('assignments', 'rubric', 'TEXT');
addColumn('submissions', 'rubric_scores', 'TEXT');
addColumn('quizzes', 'time_limit', 'INTEGER');
addColumn('quizzes', 'max_attempts', 'INTEGER NOT NULL DEFAULT 1');
if (!hasColumn('attempts', 'started')) {
  // Retakes need several attempts per student, so drop the old UNIQUE(quiz_id, user_id).
  db.exec(`
    ALTER TABLE attempts RENAME TO attempts_old;
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, answers TEXT NOT NULL DEFAULT '[]', score REAL NOT NULL DEFAULT 0, manual TEXT NOT NULL DEFAULT '{}', started TEXT NOT NULL, submitted TEXT);
    INSERT INTO attempts (id, quiz_id, user_id, answers, score, started, submitted) SELECT id, quiz_id, user_id, answers, score, submitted, submitted FROM attempts_old;
    DROP TABLE attempts_old;
  `);
}

const stmts = new Map();
const sql = (text) => { let s = stmts.get(text); if (!s) { s = db.prepare(text); stmts.set(text, s); } return s; };
const one = (text, ...p) => sql(text).get(...p);
const all = (text, ...p) => sql(text).all(...p);
const run = (text, ...p) => sql(text).run(...p);
const now = () => new Date().toISOString();

/* ---------------- helpers ---------------- */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'You don’t have access to that.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function joinCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => abc[b % abc.length]).join('');
  for (;;) { const c = `${pick(3)}-${pick(4)}`; if (!one('SELECT 1 FROM classes WHERE join_code = ?', c)) return c; }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Users write plain text; we store that and render safe HTML (paragraphs, line breaks, links). */
function textToHtml(text) {
  return String(text || '').trim().split(/\n{2,}/).filter(Boolean).map((p) =>
    `<p>${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>')}</p>`).join('');
}
const str = (v, name, { max = 200, required = true } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return s;
};
const dateOrNull = (v) => { if (v == null || v === '') return null; const d = new Date(v); if (isNaN(d)) throw bad('That date isn’t valid.'); return d.toISOString(); };

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const setCookie = (value, maxAge) => `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = one('SELECT user_id, expires FROM sessions WHERE token = ?', sha(token));
  if (!s || s.expires < Date.now()) return null;
  const u = one('SELECT id, email, name, admin, disabled, can_teach, notify FROM users WHERE id = ?', s.user_id);
  if (!u || u.disabled) return null;
  return { id: u.id, email: u.email, name: u.name, admin: !!u.admin || ADMIN_EMAILS.includes(u.email), notify: !!u.notify, canTeach: !!u.can_teach };
}
const publicMe = (u) => ({ id: u.id, email: u.email, name: u.name, admin: u.admin, notify: u.notify, canCreateClasses: canCreateClasses(u) });

/* ---------------- settings (admin-editable, stored in the database) ---------------- */
const setting = (key, fallback) => one('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
const setSetting = (key, value) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, String(value));
const signupOpen = () => setting('signup', ALLOW_SIGNUP ? 'true' : 'false') === 'true';
const classCreation = () => setting('classCreation', 'anyone'); // 'anyone' | 'approved'
const canCreateClasses = (u) => u.admin || classCreation() === 'anyone' || u.canTeach;
function requireAdmin(user) { if (!user || !user.admin) throw forbidden('Administrators only.'); }

/* ---------------- email ---------------- */
// Every message is recorded in the outbox; with SMTP_URL set it is also sent.
let mailChain = Promise.resolve();
function sendMail(to, subject, text) {
  const id = run('INSERT INTO outbox (to_email, subject, body, created, status) VALUES (?, ?, ?, ?, ?)', to, subject, text, now(), SMTP_URL ? 'queued' : 'not sent (no SMTP configured)').lastInsertRowid;
  if (!SMTP_URL) return;
  mailChain = mailChain.then(() => smtpSend(SMTP_URL, { from: SMTP_FROM, to, subject, text }))
    .then(() => run('UPDATE outbox SET status = ? WHERE id = ?', 'sent', id))
    .catch((e) => run('UPDATE outbox SET status = ?, error = ? WHERE id = ?', 'failed', String(e.message).slice(0, 500), id));
}
/** Email every student in a class who hasn't turned notifications off. */
function notifyStudents(classId, subject, lines) {
  const cls = one('SELECT name FROM classes WHERE id = ?', classId);
  const people = all(`SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND m.role = 'student' AND u.notify = 1 AND u.disabled = 0`, classId);
  for (const p of people) sendMail(p.email, `[${cls.name}] ${subject}`, `${lines.join('\n')}\n\nOpen the class: ${PUBLIC_URL}/#/c/${classId}\n\nYou can turn these emails off under your account in Lumen Classes.`);
}
function startSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)', sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return setCookie(token, SESSION_DAYS * 86400);
}
const roleIn = (classId, userId) => one('SELECT role FROM members WHERE class_id = ? AND user_id = ?', classId, userId)?.role || null;
function requireMember(classId, user) { const r = roleIn(classId, user.id); if (!r) throw forbidden('You’re not in that class.'); return r; }
function requireTeacher(classId, user) { if (roleIn(classId, user.id) !== 'teacher') throw forbidden('Only the teacher can do that.'); }

async function readBody(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'That’s too large.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('Invalid JSON.'); }
}

const attempts = new Map(); // login throttle: key → [timestamps]
function throttle(key, max = 10, windowMs = 10 * 60e3) {
  const t = Date.now(); const list = (attempts.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  list.push(t); attempts.set(key, list);
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function send(res, status, body, headers = {}) { res.writeHead(status, { ...SECURITY, ...headers }); res.end(body); }
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });

/** The first account on a new server becomes its administrator. */
function createUser(email, name, passHash) {
  const first = !one('SELECT 1 FROM users LIMIT 1');
  return run('INSERT INTO users (email, name, pass, created, admin) VALUES (?, ?, ?, ?, ?)', email, name, passHash, now(), first ? 1 : 0).lastInsertRowid;
}
function resetLink(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO resets (token, user_id, expires) VALUES (?, ?, ?)', sha(token), userId, Date.now() + 60 * 60e3);
  return `${PUBLIC_URL}/#/reset/${token}`;
}

/* ---------------- shared queries ---------------- */
const splitName = (name) => { const i = name.trim().indexOf(' '); return i < 0 ? [name.trim(), ''] : [name.trim().slice(0, i), name.trim().slice(i + 1)]; };
const quizPoints = (quiz) => JSON.parse(quiz.questions).reduce((n, q) => n + (q.points || 1), 0);

/* Quiz questions: choice (one answer), multi (several), short (typed, auto-marked), paragraph (teacher-marked). */
function normalizeQuestions(list) {
  if (!Array.isArray(list) || !list.length || list.length > 100) throw bad('Add between 1 and 100 questions.');
  return list.map((q, i) => {
    const n = i + 1;
    const type = ['choice', 'multi', 'short', 'paragraph'].includes(q.type) ? q.type : 'choice';
    const prompt = str(q.prompt, `Question ${n}`, { max: 2000 });
    const points = Number(q.points ?? 1);
    if (!(points > 0 && points <= 1000)) throw bad(`Question ${n} needs a point value.`);
    const out = { type, prompt, points };
    if (type === 'choice' || type === 'multi') {
      out.choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => str(c, `A choice in question ${n}`, { max: 500 }));
      if (out.choices.length < 2 || out.choices.length > 8) throw bad(`Question ${n} needs 2 to 8 choices.`);
      const valid = (x) => Number.isInteger(x) && x >= 0 && x < out.choices.length;
      if (type === 'choice') { out.answer = Number(q.answer); if (!valid(out.answer)) throw bad(`Pick the correct answer for question ${n}.`); }
      else { out.answers = [...new Set((Array.isArray(q.answers) ? q.answers : []).map(Number))].sort((a, b) => a - b); if (!out.answers.length || !out.answers.every(valid)) throw bad(`Pick at least one correct answer for question ${n}.`); }
    }
    if (type === 'short') {
      out.answers = (Array.isArray(q.answers) ? q.answers : []).map((a) => str(a, `An accepted answer for question ${n}`, { max: 200 }));
      if (!out.answers.length || out.answers.length > 10) throw bad(`Question ${n} needs 1 to 10 accepted answers.`);
    }
    return out;
  });
}
const withoutKey = (q) => ({ type: q.type || 'choice', prompt: q.prompt, points: q.points, choices: q.choices });
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
function autoPoints(q, a) {
  const type = q.type || 'choice';
  if (a === null || a === undefined || a === '') return 0;
  if (type === 'choice') return Number(a) === q.answer ? q.points : 0;
  if (type === 'multi') return Array.isArray(a) && JSON.stringify([...new Set(a.map(Number))].sort((x, y) => x - y)) === JSON.stringify(q.answers) ? q.points : 0;
  if (type === 'short') return q.answers.some((x) => norm(x) === norm(a)) ? q.points : 0;
  return 0; // paragraph: marked by the teacher
}
function attemptTotals(questions, attempt) {
  const answers = JSON.parse(attempt.answers || '[]'); const manual = JSON.parse(attempt.manual || '{}');
  let score = 0, pending = false;
  questions.forEach((q, i) => {
    if ((q.type || 'choice') === 'paragraph') { if (manual[i] == null) pending = true; else score += Number(manual[i]); }
    else score += autoPoints(q, answers[i]);
  });
  return { score, pending, answers, manual };
}
/** Close timed attempts whose clock ran out (the student closed the tab, lost connection…). */
function finalizeExpired(quiz) {
  if (!quiz.time_limit) return;
  const questions = JSON.parse(quiz.questions);
  for (const a of all('SELECT * FROM attempts WHERE quiz_id = ? AND submitted IS NULL', quiz.id)) {
    const end = new Date(a.started).getTime() + quiz.time_limit * 60e3;
    if (Date.now() > end + QUIZ_GRACE_MS) run('UPDATE attempts SET submitted = ?, score = ? WHERE id = ?', new Date(end).toISOString(), attemptTotals(questions, a).score, a.id);
  }
}
/** Where one student stands on a quiz: attempts used/left, anything in progress, best result. */
function quizState(quiz, userId) {
  finalizeExpired(quiz);
  const questions = JSON.parse(quiz.questions);
  const rows = all('SELECT * FROM attempts WHERE quiz_id = ? AND user_id = ? ORDER BY id', quiz.id, userId);
  const inProgress = rows.find((r) => !r.submitted) || null;
  const done = rows.filter((r) => r.submitted).map((r) => ({ id: r.id, submitted: r.submitted, ...attemptTotals(questions, r) }));
  const marked = done.filter((d) => !d.pending);
  const best = marked.length ? marked.reduce((x, y) => (y.score > x.score ? y : x)) : null;
  const max = quiz.max_attempts || 0; // 0 = unlimited
  return { questions, inProgress, done, best, pending: done.some((d) => d.pending), left: max ? Math.max(0, max - rows.length) : Infinity, max };
}
/** Everything gradable in a class, oldest first. */
function gradables(classId) {
  const a = all('SELECT id, title, due, points, created FROM assignments WHERE class_id = ?', classId).map((x) => ({ ...x, type: 'assignment' }));
  const q = all('SELECT id, title, due, questions, created FROM quizzes WHERE class_id = ?', classId).map((x) => ({ id: x.id, title: x.title, due: x.due, created: x.created, points: quizPoints(x), type: 'quiz' }));
  return [...a, ...q].sort((x, y) => x.created.localeCompare(y.created));
}
function studentScore(item, userId) {
  if (item.type === 'assignment') {
    const s = one('SELECT grade, feedback, submitted FROM submissions WHERE assignment_id = ? AND user_id = ?', item.id, userId);
    return { done: !!s, doneAt: s?.submitted || null, score: s?.grade ?? null, feedback: s?.feedback || null };
  }
  const st = quizState(one('SELECT * FROM quizzes WHERE id = ?', item.id), userId);
  // Done once nothing is in progress and at least one attempt was handed in; the best marked attempt counts.
  const last = st.done[st.done.length - 1];
  return { done: !!last && !st.inProgress, doneAt: last?.submitted || null, score: st.best ? st.best.score : null, feedback: null, pending: !st.best && st.pending };
}
const itemUrl = (classId, item) => `/#/c/${classId}/${item.type}/${item.id}`;

/* =====================================================================================
 * Brightspace-shaped, read-only API (what the Lumen UI and the native apps consume)
 * ===================================================================================== */
function valence(req, res, url, user) {
  const p = url.pathname;
  let m;
  if (p === '/d2l/api/versions/') return json(res, 200, [{ ProductCode: 'lp', LatestVersion: '1.47' }, { ProductCode: 'le', LatestVersion: '1.79' }]);
  if (!user) return json(res, 403, { Message: 'Not signed in' });

  if (/^\/d2l\/api\/lp\/[\d.]+\/users\/whoami$/.test(p)) {
    const [first, last] = splitName(user.name);
    return json(res, 200, { Identifier: String(user.id), FirstName: first, LastName: last, UniqueName: user.email, ProfileIdentifier: String(user.id) });
  }
  if (/^\/d2l\/api\/lp\/[\d.]+\/enrollments\/myenrollments\/$/.test(p)) {
    const rows = all('SELECT c.*, m.role FROM classes c JOIN members m ON m.class_id = c.id WHERE m.user_id = ? ORDER BY c.created DESC', user.id);
    return json(res, 200, { PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: rows.map((c) => ({
      OrgUnit: { Id: c.id, Type: { Id: 3, Code: 'Course Offering', Name: 'Course Offering' }, Name: c.name, Code: c.code, HomeUrl: `/#/c/${c.id}`, ImageUrl: null },
      Access: { IsActive: !c.archived, CanAccess: true, StartDate: c.created, EndDate: c.archived ? new Date(new Date(c.archived).getTime() - 30 * 864e5).toISOString() : null, LastAccessed: null },
      PinSettings: { IsPinned: false },
    })) });
  }
  if (/^\/d2l\/api\/le\/[\d.]+\/content\/myItems\/$/.test(p)) {
    const ids = (url.searchParams.get('orgUnitIdsCSV') || '').split(',').map(Number).filter(Boolean);
    const out = [];
    for (const classId of ids) {
      const role = roleIn(classId, user.id);
      if (!role) continue;
      for (const item of gradables(classId)) {
        const base = { OrgUnitId: classId, ItemId: item.id, ItemName: item.title, ItemUrl: itemUrl(classId, item), StartDate: null, EndDate: null, DueDate: item.due, IsExempt: false };
        if (role === 'teacher') {
          // Teachers see upcoming deadlines for classes they teach, never "missing" work.
          if (!item.due || new Date(item.due) > new Date()) out.push({ ...base, DateCompleted: null });
        } else {
          out.push({ ...base, DateCompleted: studentScore(item, user.id).doneAt });
        }
      }
    }
    return json(res, 200, { Next: null, Objects: out });
  }

  if ((m = p.match(/^\/d2l\/api\/le\/[\d.]+\/(\d+)\/(.+)$/))) {
    const classId = Number(m[1]); const rest = m[2];
    const role = roleIn(classId, user.id);
    if (!role) return json(res, 403, { Message: 'Not enrolled' });

    if (rest === 'news/') {
      return json(res, 200, all('SELECT * FROM announcements WHERE class_id = ? ORDER BY created DESC', classId).map((n) => ({
        Id: n.id, Title: n.title, Body: { Text: n.body, Html: textToHtml(n.body) }, StartDate: n.created, CreatedDate: n.created, IsHidden: false, Attachments: [],
      })));
    }
    if (rest === 'content/toc') {
      const topicRow = (t) => {
        let link = `/topic/${t.id}`, due = null;
        if (t.kind === 'link') link = t.url;
        if (t.kind === 'file') { const f = one('SELECT name FROM files WHERE id = ?', t.file_id); link = `/files/${t.file_id}/${encodeURIComponent(f?.name || 'file')}`; }
        if (t.kind === 'assignment') { link = `/dropbox/assignment/${t.ref_id}`; due = one('SELECT due FROM assignments WHERE id = ?', t.ref_id)?.due || null; }
        if (t.kind === 'quiz') { link = `/quiz/${t.ref_id}`; due = one('SELECT due FROM quizzes WHERE id = ?', t.ref_id)?.due || null; }
        return { TopicId: t.id, Identifier: String(t.id), TypeIdentifier: t.kind === 'link' ? 'Link' : 'File', Title: t.title, Url: link, Unread: false, IsHidden: false, IsLocked: false, DueDateTime: due };
      };
      const modules = all('SELECT * FROM modules WHERE class_id = ? ORDER BY position, id', classId).map((mod) => ({
        ModuleId: mod.id, Title: mod.title, Description: { Html: textToHtml(mod.description) }, IsHidden: false, Modules: [],
        Topics: all('SELECT * FROM topics WHERE module_id = ? ORDER BY id', mod.id).map(topicRow),
      }));
      const loose = all('SELECT * FROM topics WHERE class_id = ? AND module_id IS NULL ORDER BY id', classId);
      if (loose.length) modules.unshift({ ModuleId: 0, Title: 'General', Description: { Html: '' }, IsHidden: false, Modules: [], Topics: loose.map(topicRow) });
      return json(res, 200, { Modules: modules });
    }
    if (rest === 'dropbox/folders/') {
      return json(res, 200, all('SELECT * FROM assignments WHERE class_id = ? ORDER BY created', classId).map((a) => ({
        Id: a.id, Name: a.title, DueDate: a.due, CustomInstructions: { Text: a.instructions, Html: textToHtml(a.instructions) }, Assessment: { ScoreDenominator: a.points }, IsHidden: false,
      })));
    }
    if (rest === 'quizzes/') {
      return json(res, 200, { Next: null, Objects: all('SELECT * FROM quizzes WHERE class_id = ? ORDER BY created', classId).map((q) => ({ QuizId: q.id, Name: q.title, DueDate: q.due, IsActive: true })) });
    }
    if (rest === 'grades/values/myGradeValues/') {
      if (role === 'teacher') return json(res, 200, []);
      const items = gradables(classId);
      const total = items.reduce((n, i) => n + i.points, 0) || 1;
      const out = [];
      for (const item of items) {
        const s = studentScore(item, user.id);
        if (s.score == null) continue;
        const weight = (item.points / total) * 100;
        out.push({
          GradeObjectIdentifier: `${item.type[0]}${item.id}`, GradeObjectName: item.title, PointsNumerator: s.score, PointsDenominator: item.points,
          DisplayedGrade: `${((s.score / item.points) * 100).toFixed(1)} %`, WeightedDenominator: +weight.toFixed(2), WeightedNumerator: +((s.score / item.points) * weight).toFixed(2),
          Comments: s.feedback ? { Text: s.feedback, Html: textToHtml(s.feedback) } : null,
        });
      }
      return json(res, 200, out);
    }
  }
  return json(res, 404, { Message: 'Not found' });
}

/* =====================================================================================
 * Native API (accounts, classes, authoring, submissions, grading)
 * ===================================================================================== */
async function api(req, res, url, user) {
  const p = url.pathname; const method = req.method;
  let m;
  // CSRF: state-changing calls must be same-origin JSON/XHR (a cross-site form can't set this header).
  if (method !== 'GET' && req.headers['x-lumen'] !== '1') throw forbidden('Missing X-Lumen header.');

  /* ----- accounts ----- */
  if (p === '/api/config') return json(res, 200, { signup: signupOpen(), sso: OIDC ? OIDC.name : null, email: !!SMTP_URL, maxUploadMb: MAX_UPLOAD / 1048576 });
  if (p === '/api/auth/register' && method === 'POST') {
    if (!signupOpen()) throw forbidden('Sign-ups are turned off on this server.');
    const b = await readJson(req);
    const name = str(b.name, 'Your name', { max: 80 });
    const email = str(b.email, 'Email', { max: 200 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
    if (typeof b.password !== 'string' || b.password.length < 8) throw bad('Use a password of at least 8 characters.');
    throttle(`reg:${req.socket.remoteAddress}`, 20);
    if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with that email already exists.');
    const id = createUser(email, name, hashPassword(b.password));
    return json(res, 201, { id, name, email }, { 'Set-Cookie': startSession(id) });
  }
  if (p === '/api/auth/forgot' && method === 'POST') {
    const b = await readJson(req);
    const email = str(b.email, 'Email').toLowerCase();
    throttle(`forgot:${req.socket.remoteAddress}`, 10);
    const u = one('SELECT id, name, disabled FROM users WHERE email = ?', email);
    // Same answer whether or not the account exists, so this can't be used to find accounts.
    if (u && !u.disabled) sendMail(email, 'Reset your Lumen Classes password', `Hi ${u.name},\n\nUse this link to choose a new password. It works once, for the next hour:\n\n${resetLink(u.id)}\n\nIf you didn't ask for this, you can ignore this email.`);
    return json(res, 200, { ok: true, emailConfigured: !!SMTP_URL });
  }
  if (p === '/api/auth/reset' && method === 'POST') {
    const b = await readJson(req);
    if (typeof b.password !== 'string' || b.password.length < 8) throw bad('Use a password of at least 8 characters.');
    const r = one('SELECT user_id, expires FROM resets WHERE token = ?', sha(String(b.token || '')));
    if (!r || r.expires < Date.now()) throw bad('That reset link has expired or was already used. Ask for a new one.');
    run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(b.password), r.user_id);
    run('DELETE FROM resets WHERE user_id = ?', r.user_id);
    run('DELETE FROM sessions WHERE user_id = ?', r.user_id); // sign out everywhere
    return json(res, 200, { ok: true });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const b = await readJson(req);
    const email = str(b.email, 'Email').toLowerCase();
    throttle(`login:${req.socket.remoteAddress}:${email}`);
    const u = one('SELECT * FROM users WHERE email = ?', email);
    if (!u || typeof b.password !== 'string' || !checkPassword(b.password, u.pass)) throw new HttpError(401, 'Wrong email or password.');
    if (u.disabled) throw forbidden('This account has been turned off. Contact your administrator.');
    return json(res, 200, { id: u.id, name: u.name, email: u.email }, { 'Set-Cookie': startSession(u.id) });
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req)[COOKIE];
    if (token) run('DELETE FROM sessions WHERE token = ?', sha(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
  }
  if (p === '/api/me' && method === 'GET') return user ? json(res, 200, publicMe(user)) : json(res, 401, { error: 'Not signed in.' });
  if (!user) throw new HttpError(401, 'Sign in first.');
  if (p === '/api/me' && method === 'PATCH') {
    const b = await readJson(req);
    if (b.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', str(b.name, 'Your name', { max: 80 }), user.id);
    if (b.notify !== undefined) run('UPDATE users SET notify = ? WHERE id = ?', b.notify ? 1 : 0, user.id);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/me/password' && method === 'POST') {
    const b = await readJson(req);
    throttle(`pw:${user.id}`, 10);
    const u = one('SELECT pass FROM users WHERE id = ?', user.id);
    if (typeof b.current !== 'string' || !checkPassword(b.current, u.pass)) throw bad('Your current password isn’t right.');
    if (typeof b.password !== 'string' || b.password.length < 8) throw bad('Use a password of at least 8 characters.');
    run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(b.password), user.id);
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/admin/')) return await adminApi(req, res, url, user);

  /* ----- classes ----- */
  if (p === '/api/classes' && method === 'GET') {
    return json(res, 200, all('SELECT c.id, c.name, c.code, c.archived, m.role, c.join_code FROM classes c JOIN members m ON m.class_id = c.id WHERE m.user_id = ?', user.id)
      .map((c) => ({ id: c.id, name: c.name, code: c.code, archived: !!c.archived, role: c.role, joinCode: c.role === 'teacher' ? c.join_code : undefined })));
  }
  if (p === '/api/classes' && method === 'POST') {
    if (!canCreateClasses(user)) throw forbidden('Only approved teachers can create classes here. Ask your administrator.');
    const b = await readJson(req);
    const name = str(b.name, 'Class name', { max: 120 });
    const code = str(b.code, 'Section', { max: 40, required: false });
    const id = run('INSERT INTO classes (name, code, join_code, owner_id, created) VALUES (?, ?, ?, ?, ?)', name, code, joinCode(), user.id, now()).lastInsertRowid;
    run('INSERT INTO members (class_id, user_id, role, joined) VALUES (?, ?, ?, ?)', id, user.id, 'teacher', now());
    return json(res, 201, { id });
  }
  if (p === '/api/classes/join' && method === 'POST') {
    const b = await readJson(req);
    throttle(`join:${user.id}`, 30);
    const c = one('SELECT id, archived FROM classes WHERE join_code = ?', str(b.joinCode, 'Class code').toLowerCase());
    if (!c) throw notFound('No class has that code. Check it with your teacher.');
    if (c.archived) throw bad('That class has been archived.');
    if (!roleIn(c.id, user.id)) run('INSERT INTO members (class_id, user_id, role, joined) VALUES (?, ?, ?, ?)', c.id, user.id, 'student', now());
    return json(res, 200, { id: c.id });
  }

  if ((m = p.match(/^\/api\/classes\/(\d+)(\/.*)?$/))) {
    const classId = Number(m[1]); const rest = m[2] || '';
    const role = requireMember(classId, user);
    const cls = one('SELECT * FROM classes WHERE id = ?', classId);

    if (rest === '' && method === 'GET') {
      const people = all('SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? ORDER BY m.role DESC, u.name', classId)
        .map((x) => ({ id: x.id, name: x.name, role: x.role, owner: x.id === cls.owner_id, email: role === 'teacher' ? x.email : undefined }));
      return json(res, 200, { id: cls.id, name: cls.name, code: cls.code, archived: !!cls.archived, role, joinCode: role === 'teacher' ? cls.join_code : undefined, people, isOwner: cls.owner_id === user.id,
        modules: all('SELECT id, title, description FROM modules WHERE class_id = ? ORDER BY position, id', classId) });
    }
    if (rest === '' && method === 'PATCH') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      if (b.name !== undefined) run('UPDATE classes SET name = ? WHERE id = ?', str(b.name, 'Class name', { max: 120 }), classId);
      if (b.code !== undefined) run('UPDATE classes SET code = ? WHERE id = ?', str(b.code, 'Section', { max: 40, required: false }), classId);
      if (b.archived !== undefined) run('UPDATE classes SET archived = ? WHERE id = ?', b.archived ? now() : null, classId);
      if (b.resetJoinCode) run('UPDATE classes SET join_code = ? WHERE id = ?', joinCode(), classId);
      return json(res, 200, { ok: true });
    }
    if (rest === '/leave' && method === 'POST') {
      if (cls.owner_id === user.id) throw bad('You own this class. Archive it instead of leaving.');
      run('DELETE FROM members WHERE class_id = ? AND user_id = ?', classId, user.id);
      return json(res, 200, { ok: true });
    }
    if ((m = rest.match(/^\/members\/(\d+)$/)) && method === 'PATCH') {
      requireTeacher(classId, user);
      const target = Number(m[1]); const b = await readJson(req);
      if (!['teacher', 'student'].includes(b.role)) throw bad('Unknown role.');
      if (!roleIn(classId, target)) throw notFound('That person isn’t in this class.');
      if (target === cls.owner_id) throw bad('The class owner is always a teacher.');
      if (b.role === 'student' && cls.owner_id !== user.id) throw forbidden('Only the class owner can remove a co-teacher.');
      run('UPDATE members SET role = ? WHERE class_id = ? AND user_id = ?', b.role, classId, target);
      return json(res, 200, { ok: true });
    }
    if ((m = rest.match(/^\/members\/(\d+)$/)) && method === 'DELETE') {
      requireTeacher(classId, user);
      if (Number(m[1]) === cls.owner_id) throw bad('The class owner can’t be removed.');
      if (roleIn(classId, Number(m[1])) === 'teacher' && cls.owner_id !== user.id) throw forbidden('Only the class owner can remove a co-teacher.');
      run('DELETE FROM members WHERE class_id = ? AND user_id = ?', classId, Number(m[1]));
      return json(res, 200, { ok: true });
    }

    /* ----- stream ----- */
    if (rest === '/announcements' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const id = run('INSERT INTO announcements (class_id, author_id, title, body, created) VALUES (?, ?, ?, ?, ?)', classId, user.id, str(b.title, 'Title', { max: 160 }), str(b.body, 'Message', { max: 20000 }), now()).lastInsertRowid;
      notifyStudents(classId, `New announcement: ${str(b.title, 'Title', { max: 160 })}`, [str(b.body, 'Message', { max: 20000 })]);
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/announcements\/(\d+)$/)) && method === 'PATCH') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const r = run('UPDATE announcements SET title = ?, body = ? WHERE id = ? AND class_id = ?', str(b.title, 'Title', { max: 160 }), str(b.body, 'Message', { max: 20000 }), Number(m[1]), classId);
      if (!r.changes) throw notFound();
      return json(res, 200, { ok: true });
    }
    if ((m = rest.match(/^\/announcements\/(\d+)$/)) && method === 'DELETE') {
      requireTeacher(classId, user);
      run('DELETE FROM announcements WHERE id = ? AND class_id = ?', Number(m[1]), classId);
      return json(res, 200, { ok: true });
    }

    /* ----- classwork ----- */
    if (rest === '/modules' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const pos = (one('SELECT MAX(position) AS p FROM modules WHERE class_id = ?', classId).p ?? -1) + 1;
      const id = run('INSERT INTO modules (class_id, title, description, position) VALUES (?, ?, ?, ?)', classId, str(b.title, 'Title', { max: 160 }), str(b.description, 'Description', { max: 4000, required: false }), pos).lastInsertRowid;
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/modules\/(\d+)$/)) && method === 'PATCH') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const r = run('UPDATE modules SET title = ?, description = ? WHERE id = ? AND class_id = ?', str(b.title, 'Title', { max: 160 }), str(b.description, 'Description', { max: 4000, required: false }), Number(m[1]), classId);
      if (!r.changes) throw notFound();
      return json(res, 200, { ok: true });
    }
    if ((m = rest.match(/^\/modules\/(\d+)$/)) && method === 'DELETE') {
      requireTeacher(classId, user);
      run('DELETE FROM modules WHERE id = ? AND class_id = ?', Number(m[1]), classId); // its topics move to "General"
      return json(res, 200, { ok: true });
    }
    const moduleIdFrom = (b) => {
      if (b.moduleId == null || b.moduleId === '') return null;
      if (!one('SELECT 1 FROM modules WHERE id = ? AND class_id = ?', Number(b.moduleId), classId)) throw bad('That module isn’t in this class.');
      return Number(b.moduleId);
    };
    if (rest === '/files' && method === 'POST') {
      // Raw upload: the body is the file; the name comes in X-Filename (URL-encoded).
      const name = str(decodeURIComponent(req.headers['x-filename'] || ''), 'File name', { max: 200 }).replace(/[\\/\0]/g, '_');
      const buf = await readBody(req, MAX_UPLOAD);
      if (!buf.length) throw bad('That file is empty.');
      const disk = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(DATA, 'files', disk), buf);
      const id = run('INSERT INTO files (class_id, owner_id, name, mime, size, disk, created) VALUES (?, ?, ?, ?, ?, ?, ?)', classId, user.id, name, String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100), buf.length, disk, now()).lastInsertRowid;
      return json(res, 201, { id, name, size: buf.length });
    }
    if (rest === '/topics' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const kind = ['text', 'link', 'file'].includes(b.kind) ? b.kind : null;
      if (!kind) throw bad('Unknown material type.');
      const title = str(b.title, 'Title', { max: 160 });
      let link = null, fileId = null;
      if (kind === 'link') { link = str(b.url, 'Link', { max: 2000 }); if (!/^https?:\/\//i.test(link)) throw bad('Links must start with http:// or https://'); }
      if (kind === 'file') { fileId = Number(b.fileId); if (!one('SELECT 1 FROM files WHERE id = ? AND class_id = ?', fileId, classId)) throw bad('Upload the file first.'); }
      const id = run('INSERT INTO topics (class_id, module_id, kind, title, body, url, file_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', classId, moduleIdFrom(b), kind, title, str(b.body, 'Text', { max: 50000, required: kind === 'text' }), link, fileId, now()).lastInsertRowid;
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/topics\/(\d+)$/))) {
      const t = one('SELECT * FROM topics WHERE id = ? AND class_id = ?', Number(m[1]), classId);
      if (!t) throw notFound();
      if (method === 'GET') {
        const f = t.file_id ? one('SELECT id, name, size FROM files WHERE id = ?', t.file_id) : null;
        return json(res, 200, { id: t.id, kind: t.kind, title: t.title, html: textToHtml(t.body), body: t.body, url: t.url, file: f, refId: t.ref_id, moduleId: t.module_id, created: t.created });
      }
      if (method === 'PATCH') {
        requireTeacher(classId, user);
        if (t.kind === 'assignment' || t.kind === 'quiz') throw bad('Edit the assignment or quiz itself.');
        const b = await readJson(req);
        let link = t.url;
        if (t.kind === 'link') { link = str(b.url, 'Link', { max: 2000 }); if (!/^https?:\/\//i.test(link)) throw bad('Links must start with http:// or https://'); }
        run('UPDATE topics SET title = ?, body = ?, url = ?, module_id = ? WHERE id = ?', str(b.title, 'Title', { max: 160 }), str(b.body, 'Text', { max: 50000, required: t.kind === 'text' }), link, moduleIdFrom(b), t.id);
        return json(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        requireTeacher(classId, user);
        if (t.kind === 'assignment') run('DELETE FROM assignments WHERE id = ?', t.ref_id);
        if (t.kind === 'quiz') run('DELETE FROM quizzes WHERE id = ?', t.ref_id);
        run('DELETE FROM topics WHERE id = ?', t.id);
        return json(res, 200, { ok: true });
      }
    }

    /* ----- assignments ----- */
    // A rubric is a list of criteria with points; when present, the assignment is worth their total.
    const rubricFrom = (b) => {
      if (b.rubric == null || (Array.isArray(b.rubric) && !b.rubric.length)) return null;
      if (!Array.isArray(b.rubric) || b.rubric.length > 20) throw bad('A rubric can have up to 20 criteria.');
      return b.rubric.map((r, i) => {
        const points = Number(r.points);
        if (!(points > 0 && points <= 1000)) throw bad(`Rubric row ${i + 1} needs a point value.`);
        return { title: str(r.title, `Rubric row ${i + 1}`, { max: 200 }), points };
      });
    };
    const assignmentFields = (b) => {
      const rubric = rubricFrom(b);
      const points = rubric ? rubric.reduce((n, r) => n + r.points, 0) : Number(b.points ?? 100);
      if (!(points > 0 && points <= 10000)) throw bad('Points must be between 1 and 10,000.');
      return { title: str(b.title, 'Title', { max: 160 }), instructions: str(b.instructions, 'Instructions', { max: 20000, required: false }), due: dateOrNull(b.due), points, rubric: rubric ? JSON.stringify(rubric) : null };
    };
    if (rest === '/assignments' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req); const f = assignmentFields(b);
      const id = run('INSERT INTO assignments (class_id, title, instructions, due, points, rubric, created) VALUES (?, ?, ?, ?, ?, ?, ?)', classId, f.title, f.instructions, f.due, f.points, f.rubric, now()).lastInsertRowid;
      run('INSERT INTO topics (class_id, module_id, kind, title, ref_id, created) VALUES (?, ?, ?, ?, ?, ?)', classId, moduleIdFrom(b), 'assignment', f.title, id, now());
      notifyStudents(classId, `New assignment: ${f.title}`, [f.due ? `Due ${new Date(f.due).toUTCString()}` : 'No due date', '', f.instructions].filter((x) => x !== undefined));
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/assignments\/(\d+)(\/submit|\/grade)?$/))) {
      const a = one('SELECT * FROM assignments WHERE id = ? AND class_id = ?', Number(m[1]), classId);
      if (!a) throw notFound('That assignment was removed.');
      const rubric = a.rubric ? JSON.parse(a.rubric) : null;
      const fileInfo = (id) => (id ? one('SELECT id, name, size FROM files WHERE id = ?', id) : null);
      if (!m[2] && method === 'GET') {
        const out = { id: a.id, title: a.title, html: textToHtml(a.instructions), due: a.due, points: a.points, rubric, role };
        if (role === 'teacher') {
          out.instructions = a.instructions;
          out.moduleId = one('SELECT module_id FROM topics WHERE kind = ? AND ref_id = ?', 'assignment', a.id)?.module_id ?? null;
          out.students = all(`SELECT u.id, u.name, s.text, s.file_id, s.submitted, s.grade, s.feedback, s.rubric_scores FROM members m JOIN users u ON u.id = m.user_id
            LEFT JOIN submissions s ON s.user_id = u.id AND s.assignment_id = ? WHERE m.class_id = ? AND m.role = 'student' ORDER BY u.name`, a.id, classId)
            .map((s) => ({ id: s.id, name: s.name, submitted: s.submitted, late: !!(s.submitted && a.due && s.submitted > a.due), text: s.text || '', file: fileInfo(s.file_id), grade: s.grade, feedback: s.feedback || '', rubricScores: s.rubric_scores ? JSON.parse(s.rubric_scores) : null }));
        } else {
          const s = one('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?', a.id, user.id);
          out.submission = s ? { text: s.text, file: fileInfo(s.file_id), submitted: s.submitted, late: !!(a.due && s.submitted > a.due), grade: s.grade, feedback: s.feedback, rubricScores: s.rubric_scores ? JSON.parse(s.rubric_scores) : null } : null;
        }
        return json(res, 200, out);
      }
      if (!m[2] && method === 'PATCH') {
        requireTeacher(classId, user);
        const b = await readJson(req); const f = assignmentFields(b);
        const graded = one('SELECT COUNT(*) AS n, MAX(grade) AS top FROM submissions WHERE assignment_id = ? AND grade IS NOT NULL', a.id);
        if (graded.n && f.rubric !== a.rubric) throw bad('This has grades already, so its rubric can’t change. Clear the grades first.');
        if (graded.n && graded.top > f.points) throw bad(`A student already has ${graded.top} points, so the total can’t go below that.`);
        run('UPDATE assignments SET title = ?, instructions = ?, due = ?, points = ?, rubric = ? WHERE id = ?', f.title, f.instructions, f.due, f.points, f.rubric, a.id);
        run('UPDATE topics SET title = ?, module_id = ? WHERE kind = ? AND ref_id = ?', f.title, moduleIdFrom(b), 'assignment', a.id);
        return json(res, 200, { ok: true });
      }
      if (!m[2] && method === 'DELETE') {
        requireTeacher(classId, user);
        run('DELETE FROM topics WHERE kind = ? AND ref_id = ?', 'assignment', a.id);
        run('DELETE FROM assignments WHERE id = ?', a.id);
        return json(res, 200, { ok: true });
      }
      if (m[2] === '/submit' && method === 'POST') {
        if (role !== 'student') throw forbidden('Only students hand in work.');
        const b = await readJson(req);
        const text = str(b.text, 'Your answer', { max: 50000, required: false });
        const fileId = b.fileId ? Number(b.fileId) : null;
        if (fileId && !one('SELECT 1 FROM files WHERE id = ? AND class_id = ? AND owner_id = ?', fileId, classId, user.id)) throw bad('Upload the file first.');
        if (!text && !fileId) throw bad('Add some text or attach a file before handing in.');
        const prev = one('SELECT grade FROM submissions WHERE assignment_id = ? AND user_id = ?', a.id, user.id);
        if (prev && prev.grade != null) throw bad('This has already been graded, so it can’t be changed.');
        run(`INSERT INTO submissions (assignment_id, user_id, text, file_id, submitted) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (assignment_id, user_id) DO UPDATE SET text = excluded.text, file_id = excluded.file_id, submitted = excluded.submitted`, a.id, user.id, text, fileId, now());
        return json(res, 200, { ok: true });
      }
      if (m[2] === '/grade' && method === 'POST') {
        requireTeacher(classId, user);
        const b = await readJson(req);
        const studentId = Number(b.studentId);
        if (roleIn(classId, studentId) !== 'student') throw bad('That student isn’t in this class.');
        let grade = b.grade === null || b.grade === '' || b.grade === undefined ? null : Number(b.grade);
        let scores = null;
        if (rubric && Array.isArray(b.rubricScores)) {
          if (b.rubricScores.length !== rubric.length) throw bad('Score every rubric row.');
          scores = b.rubricScores.map((v, i) => { const n = Number(v); if (v === '' || v === null || !(n >= 0 && n <= rubric[i].points)) throw bad(`“${rubric[i].title}” must be between 0 and ${rubric[i].points}.`); return n; });
          grade = scores.reduce((x, y) => x + y, 0);
        }
        if (grade !== null && !(grade >= 0 && grade <= a.points)) throw bad(`Grade must be between 0 and ${a.points}.`);
        const feedback = str(b.feedback, 'Feedback', { max: 5000, required: false });
        // Grading someone who never handed in creates an empty submission holding the grade.
        run(`INSERT INTO submissions (assignment_id, user_id, text, submitted, grade, feedback, graded, rubric_scores) VALUES (?, ?, '', ?, ?, ?, ?, ?)
             ON CONFLICT (assignment_id, user_id) DO UPDATE SET grade = excluded.grade, feedback = excluded.feedback, graded = excluded.graded, rubric_scores = excluded.rubric_scores`, a.id, studentId, now(), grade, feedback, now(), scores ? JSON.stringify(scores) : null);
        if (grade !== null) {
          const st = one('SELECT email, notify, disabled FROM users WHERE id = ?', studentId);
          if (st.notify && !st.disabled) sendMail(st.email, `[${cls.name}] Graded: ${a.title}`, `You got ${grade} out of ${a.points} on “${a.title}”.${feedback ? `\n\nFeedback: ${feedback}` : ''}\n\nOpen it: ${PUBLIC_URL}/#/c/${classId}/assignment/${a.id}`);
        }
        return json(res, 200, { ok: true, grade });
      }
    }

    /* ----- quizzes ----- */
    const quizSettings = (b) => {
      const timeLimit = b.timeLimit == null || b.timeLimit === '' ? null : Number(b.timeLimit);
      if (timeLimit !== null && !(Number.isInteger(timeLimit) && timeLimit >= 1 && timeLimit <= 600)) throw bad('The time limit must be 1 to 600 minutes.');
      const maxAttempts = b.maxAttempts == null || b.maxAttempts === '' ? 1 : Number(b.maxAttempts);
      if (!(Number.isInteger(maxAttempts) && maxAttempts >= 0 && maxAttempts <= 50)) throw bad('Attempts must be 0 (unlimited) to 50.');
      return { title: str(b.title, 'Title', { max: 160 }), description: str(b.description, 'Description', { max: 4000, required: false }), due: dateOrNull(b.due), timeLimit, maxAttempts };
    };
    if (rest === '/quizzes' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req); const f = quizSettings(b);
      const questions = normalizeQuestions(b.questions);
      const id = run('INSERT INTO quizzes (class_id, title, description, due, questions, time_limit, max_attempts, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', classId, f.title, f.description, f.due, JSON.stringify(questions), f.timeLimit, f.maxAttempts, now()).lastInsertRowid;
      run('INSERT INTO topics (class_id, module_id, kind, title, ref_id, created) VALUES (?, ?, ?, ?, ?, ?)', classId, moduleIdFrom(b), 'quiz', f.title, id, now());
      notifyStudents(classId, `New quiz: ${f.title}`, [f.due ? `Due ${new Date(f.due).toUTCString()}` : 'No due date']);
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/quizzes\/(\d+)(\/start|\/attempt|\/grade)?$/))) {
      const qz = one('SELECT * FROM quizzes WHERE id = ? AND class_id = ?', Number(m[1]), classId);
      if (!qz) throw notFound('That quiz was removed.');
      const questions = JSON.parse(qz.questions);
      const total = questions.reduce((n, q) => n + q.points, 0);
      const deadlineOf = (attempt) => (qz.time_limit ? new Date(new Date(attempt.started).getTime() + qz.time_limit * 60e3).toISOString() : null);

      if (!m[2] && method === 'GET') {
        const out = { id: qz.id, title: qz.title, html: textToHtml(qz.description), due: qz.due, points: total, timeLimit: qz.time_limit, maxAttempts: qz.max_attempts, role };
        if (role === 'teacher') {
          finalizeExpired(qz);
          out.description = qz.description; out.questions = questions;
          out.moduleId = one('SELECT module_id FROM topics WHERE kind = ? AND ref_id = ?', 'quiz', qz.id)?.module_id ?? null;
          out.hasAttempts = !!one('SELECT 1 FROM attempts WHERE quiz_id = ?', qz.id);
          out.students = all(`SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND m.role = 'student' ORDER BY u.name`, classId).map((st) => {
            const state = quizState(qz, st.id);
            return { id: st.id, name: st.name, best: state.best ? state.best.score : null, pending: state.pending, inProgress: !!state.inProgress,
              attempts: state.done.map((d) => ({ id: d.id, submitted: d.submitted, score: d.score, pending: d.pending, answers: d.answers, manual: d.manual })) };
          });
        } else {
          const state = quizState(qz, user.id);
          const last = state.done[state.done.length - 1] || null;
          // The answer key is only revealed once the student has no attempts left.
          const reveal = !!last && !state.inProgress && state.left === 0;
          out.questions = questions.map((q) => (reveal ? q : withoutKey(q)));
          out.revealed = reveal;
          out.attemptsUsed = state.done.length + (state.inProgress ? 1 : 0);
          out.attemptsLeft = state.left === Infinity ? null : state.left;
          out.best = state.best ? state.best.score : null; out.pending = state.pending;
          out.attempt = last ? { id: last.id, score: last.score, pending: last.pending, submitted: last.submitted, answers: last.answers, manual: last.manual } : null;
          out.inProgress = state.inProgress ? { id: state.inProgress.id, started: state.inProgress.started, deadline: deadlineOf(state.inProgress), answers: JSON.parse(state.inProgress.answers || '[]') } : null;
        }
        return json(res, 200, out);
      }
      if (!m[2] && method === 'PATCH') {
        requireTeacher(classId, user);
        const b = await readJson(req); const f = quizSettings(b);
        if (b.questions !== undefined) {
          const next = JSON.stringify(normalizeQuestions(b.questions));
          if (next !== qz.questions && one('SELECT 1 FROM attempts WHERE quiz_id = ?', qz.id)) throw bad('Students have already started this quiz, so its questions can’t change. You can still edit the title, due date and settings.');
          run('UPDATE quizzes SET questions = ? WHERE id = ?', next, qz.id);
        }
        run('UPDATE quizzes SET title = ?, description = ?, due = ?, time_limit = ?, max_attempts = ? WHERE id = ?', f.title, f.description, f.due, f.timeLimit, f.maxAttempts, qz.id);
        run('UPDATE topics SET title = ?, module_id = ? WHERE kind = ? AND ref_id = ?', f.title, moduleIdFrom(b), 'quiz', qz.id);
        return json(res, 200, { ok: true });
      }
      if (!m[2] && method === 'DELETE') {
        requireTeacher(classId, user);
        run('DELETE FROM topics WHERE kind = ? AND ref_id = ?', 'quiz', qz.id);
        run('DELETE FROM quizzes WHERE id = ?', qz.id);
        return json(res, 200, { ok: true });
      }
      const begin = () => {
        const state = quizState(qz, user.id);
        if (state.inProgress) return state.inProgress;
        if (state.left === 0) throw bad(state.max === 1 ? 'You’ve already taken this quiz.' : 'You have no attempts left on this quiz.');
        const id = run('INSERT INTO attempts (quiz_id, user_id, answers, started) VALUES (?, ?, ?, ?)', qz.id, user.id, '[]', now()).lastInsertRowid;
        return one('SELECT * FROM attempts WHERE id = ?', id);
      };
      const cleanAnswers = (b) => {
        if (!Array.isArray(b.answers) || b.answers.length !== questions.length) throw bad('Answer every question before handing in.');
        return b.answers.map((a, i) => {
          const type = questions[i].type || 'choice';
          if (a === null || a === undefined || a === '') return null;
          if (type === 'choice') return Number(a);
          if (type === 'multi') return Array.isArray(a) ? a.map(Number) : null;
          return String(a).slice(0, type === 'short' ? 500 : 20000);
        });
      };
      if (m[2] === '/start' && method === 'POST') {
        if (role !== 'student') throw forbidden('Only students take quizzes.');
        const a = begin();
        return json(res, 200, { id: a.id, started: a.started, deadline: deadlineOf(a), answers: JSON.parse(a.answers || '[]') });
      }
      if (m[2] === '/attempt' && (method === 'PUT' || method === 'POST')) {
        if (role !== 'student') throw forbidden('Only students take quizzes.');
        const b = await readJson(req);
        finalizeExpired(qz);
        // Handing in after the clock ran out: the attempt was closed with what had been saved.
        if (b.attemptId) {
          const closed = one('SELECT * FROM attempts WHERE id = ? AND user_id = ? AND quiz_id = ? AND submitted IS NOT NULL', Number(b.attemptId), user.id, qz.id);
          if (closed) { const t = attemptTotals(questions, closed); return json(res, 200, { score: t.score, points: total, pending: t.pending, timedOut: true }); }
        }
        const answers = cleanAnswers(b);
        const a = begin();
        run('UPDATE attempts SET answers = ? WHERE id = ?', JSON.stringify(answers), a.id);
        if (method === 'PUT') return json(res, 200, { saved: true });   // autosave while the student works
        const t = attemptTotals(questions, { answers: JSON.stringify(answers), manual: '{}' });
        run('UPDATE attempts SET submitted = ?, score = ? WHERE id = ?', now(), t.score, a.id);
        return json(res, 200, { score: t.score, points: total, pending: t.pending });
      }
      if (m[2] === '/grade' && method === 'POST') {
        // Mark the written (paragraph) answers of one attempt.
        requireTeacher(classId, user);
        const b = await readJson(req);
        const a = one('SELECT * FROM attempts WHERE id = ? AND quiz_id = ? AND submitted IS NOT NULL', Number(b.attemptId), qz.id);
        if (!a) throw notFound('That attempt wasn’t found.');
        const manual = JSON.parse(a.manual || '{}');
        for (const [k, v] of Object.entries(b.scores || {})) {
          const i = Number(k); const q = questions[i];
          if (!q || (q.type || 'choice') !== 'paragraph') throw bad('Only written answers are marked by hand.');
          if (v === '' || v === null) { delete manual[i]; continue; }
          const n = Number(v);
          if (!(n >= 0 && n <= q.points)) throw bad(`Question ${i + 1} is worth ${q.points} point${q.points === 1 ? '' : 's'}.`);
          manual[i] = n;
        }
        const t = attemptTotals(questions, { answers: a.answers, manual: JSON.stringify(manual) });
        run('UPDATE attempts SET manual = ?, score = ? WHERE id = ?', JSON.stringify(manual), t.score, a.id);
        return json(res, 200, { score: t.score, pending: t.pending });
      }
    }

    /* ----- discussions ----- */
    if (rest === '/discussions' && method === 'GET') {
      return json(res, 200, all(`SELECT d.id, d.title, d.created, u.name AS author, (SELECT COUNT(*) FROM replies r WHERE r.discussion_id = d.id) AS replies,
        COALESCE((SELECT MAX(created) FROM replies r WHERE r.discussion_id = d.id), d.created) AS active
        FROM discussions d JOIN users u ON u.id = d.author_id WHERE d.class_id = ? ORDER BY active DESC`, classId));
    }
    if (rest === '/discussions' && method === 'POST') {
      const b = await readJson(req);
      throttle(`post:${user.id}`, 60);
      const id = run('INSERT INTO discussions (class_id, author_id, title, body, created) VALUES (?, ?, ?, ?, ?)', classId, user.id, str(b.title, 'Title', { max: 160 }), str(b.body, 'Message', { max: 20000 }), now()).lastInsertRowid;
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/discussions\/(\d+)(\/replies(?:\/(\d+))?)?$/))) {
      const d = one('SELECT d.*, u.name AS author FROM discussions d JOIN users u ON u.id = d.author_id WHERE d.id = ? AND d.class_id = ?', Number(m[1]), classId);
      if (!d) throw notFound('That discussion was removed.');
      const canRemove = (authorId) => role === 'teacher' || authorId === user.id;
      if (!m[2] && method === 'GET') {
        return json(res, 200, { id: d.id, title: d.title, html: textToHtml(d.body), author: d.author, created: d.created, canDelete: canRemove(d.author_id),
          replies: all('SELECT r.id, r.body, r.created, r.author_id, u.name AS author FROM replies r JOIN users u ON u.id = r.author_id WHERE r.discussion_id = ? ORDER BY r.id', d.id)
            .map((r) => ({ id: r.id, html: textToHtml(r.body), author: r.author, created: r.created, canDelete: canRemove(r.author_id), teacher: roleIn(classId, r.author_id) === 'teacher' })) });
      }
      if (!m[2] && method === 'DELETE') {
        if (!canRemove(d.author_id)) throw forbidden('Only the author or a teacher can delete this.');
        run('DELETE FROM discussions WHERE id = ?', d.id);
        return json(res, 200, { ok: true });
      }
      if (m[2] === '/replies' && method === 'POST') {
        const b = await readJson(req);
        throttle(`post:${user.id}`, 60);
        const id = run('INSERT INTO replies (discussion_id, author_id, body, created) VALUES (?, ?, ?, ?)', d.id, user.id, str(b.body, 'Reply', { max: 20000 }), now()).lastInsertRowid;
        return json(res, 201, { id });
      }
      if (m[3] && method === 'DELETE') {
        const r = one('SELECT * FROM replies WHERE id = ? AND discussion_id = ?', Number(m[3]), d.id);
        if (!r) throw notFound();
        if (!canRemove(r.author_id)) throw forbidden('Only the author or a teacher can delete this.');
        run('DELETE FROM replies WHERE id = ?', r.id);
        return json(res, 200, { ok: true });
      }
    }

    /* ----- teacher overviews ----- */
    if (rest === '/gradebook' && method === 'GET') {
      requireTeacher(classId, user);
      const items = gradables(classId);
      const students = all(`SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND m.role = 'student' ORDER BY u.name`, classId);
      return json(res, 200, {
        items: items.map((i) => ({ type: i.type, id: i.id, title: i.title, points: i.points, due: i.due })),
        students: students.map((s) => {
          const cells = items.map((i) => { const x = studentScore(i, s.id); return { done: x.done, score: x.score }; });
          const graded = cells.map((c, k) => [c, items[k]]).filter(([c]) => c.score != null);
          const possible = graded.reduce((n, [, i]) => n + i.points, 0);
          return { id: s.id, name: s.name, cells, percent: possible ? (graded.reduce((n, [c]) => n + c.score, 0) / possible) * 100 : null };
        }),
      });
    }
    if (rest === '/gradebook.csv' && method === 'GET') {
      requireTeacher(classId, user);
      const items = gradables(classId);
      // Quote every cell and neutralise leading = + - @ so a spreadsheet never runs a name as a formula.
      const cell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t) && isNaN(Number(t))) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
      const rows = [['Student', 'Email', ...items.map((i) => `${i.title} (${i.points})`), 'Overall %']];
      for (const st of all(`SELECT u.id, u.name, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND m.role = 'student' ORDER BY u.name`, classId)) {
        const scores = items.map((i) => studentScore(i, st.id).score);
        const graded = scores.map((v, k) => [v, items[k].points]).filter(([v]) => v != null);
        const possible = graded.reduce((n, [, pts]) => n + pts, 0);
        rows.push([st.name, st.email, ...scores.map((v) => (v == null ? '' : v)), possible ? ((graded.reduce((n, [v]) => n + v, 0) / possible) * 100).toFixed(1) : '']);
      }
      return send(res, 200, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', {
        'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(cls.name.replace(/[^\w\- ]+/g, '').trim() || 'class')}-grades.csv` });
    }
    if (rest === '/work' && method === 'GET') {
      const studentCount = one(`SELECT COUNT(*) AS n FROM members WHERE class_id = ? AND role = 'student'`, classId).n;
      return json(res, 200, { students: studentCount, items: gradables(classId).map((i) => {
        const base = { type: i.type, id: i.id, title: i.title, due: i.due, points: i.points };
        if (role !== 'teacher') return { ...base, ...studentScore(i, user.id) };
        const done = i.type === 'assignment'
          ? one(`SELECT COUNT(*) AS n, SUM(grade IS NOT NULL) AS g FROM submissions WHERE assignment_id = ? AND (text != '' OR file_id IS NOT NULL)`, i.id)
          : one('SELECT COUNT(DISTINCT user_id) AS n FROM attempts WHERE quiz_id = ? AND submitted IS NOT NULL', i.id);
        const toMark = i.type === 'quiz' ? all(`SELECT u.id FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? AND m.role = 'student'`, classId)
          .filter((st) => quizState(one('SELECT * FROM quizzes WHERE id = ?', i.id), st.id).pending).length : 0;
        return { ...base, handedIn: done.n, graded: i.type === 'quiz' ? done.n - toMark : done.g || 0, toMark };
      }) });
    }
  }
  throw notFound();
}

/* =====================================================================================
 * Admin console API
 * ===================================================================================== */
async function adminApi(req, res, url, user) {
  requireAdmin(user);
  const p = url.pathname; const method = req.method; let m;
  if (p === '/api/admin/overview' && method === 'GET') {
    const n = (q) => one(q).n;
    return json(res, 200, {
      stats: { users: n('SELECT COUNT(*) AS n FROM users'), classes: n('SELECT COUNT(*) AS n FROM classes WHERE archived IS NULL'), archived: n('SELECT COUNT(*) AS n FROM classes WHERE archived IS NOT NULL'),
        submissions: n('SELECT COUNT(*) AS n FROM submissions'), attempts: n('SELECT COUNT(*) AS n FROM attempts WHERE submitted IS NOT NULL'), storageBytes: n('SELECT COALESCE(SUM(size), 0) AS n FROM files') },
      settings: { signup: signupOpen(), classCreation: classCreation() },
      email: { configured: !!SMTP_URL, from: SMTP_FROM }, sso: OIDC ? { name: OIDC.name, issuer: OIDC.issuer } : null,
    });
  }
  if (p === '/api/admin/settings' && method === 'PATCH') {
    const b = await readJson(req);
    if (b.signup !== undefined) setSetting('signup', b.signup ? 'true' : 'false');
    if (b.classCreation !== undefined) { if (!['anyone', 'approved'].includes(b.classCreation)) throw bad('Unknown setting.'); setSetting('classCreation', b.classCreation); }
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/users' && method === 'GET') {
    const q = `%${(url.searchParams.get('q') || '').toLowerCase()}%`;
    return json(res, 200, all(`SELECT u.id, u.name, u.email, u.admin, u.disabled, u.can_teach, u.created,
      (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS classes FROM users u WHERE lower(u.name) LIKE ? OR u.email LIKE ? ORDER BY u.created DESC LIMIT 200`, q, q)
      .map((u) => ({ id: u.id, name: u.name, email: u.email, admin: !!u.admin, disabled: !!u.disabled, canTeach: !!u.can_teach, created: u.created, classes: u.classes, you: u.id === user.id })));
  }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)(\/reset-link)?$/))) {
    const id = Number(m[1]);
    const target = one('SELECT id, email FROM users WHERE id = ?', id);
    if (!target) throw notFound('That account no longer exists.');
    if (m[2] && method === 'POST') return json(res, 200, { link: resetLink(id) });
    if (!m[2] && method === 'PATCH') {
      const b = await readJson(req);
      if (id === user.id && (b.disabled || b.admin === false)) throw bad('You can’t turn off or demote your own account.');
      if (b.admin !== undefined) run('UPDATE users SET admin = ? WHERE id = ?', b.admin ? 1 : 0, id);
      if (b.canTeach !== undefined) run('UPDATE users SET can_teach = ? WHERE id = ?', b.canTeach ? 1 : 0, id);
      if (b.disabled !== undefined) { run('UPDATE users SET disabled = ? WHERE id = ?', b.disabled ? 1 : 0, id); if (b.disabled) run('DELETE FROM sessions WHERE user_id = ?', id); }
      return json(res, 200, { ok: true });
    }
    if (!m[2] && method === 'DELETE') {
      if (id === user.id) throw bad('You can’t delete your own account.');
      if (one('SELECT 1 FROM classes WHERE owner_id = ?', id)) throw bad('This person owns classes. Delete or archive those first, or turn the account off instead.');
      run('DELETE FROM users WHERE id = ?', id);
      return json(res, 200, { ok: true });
    }
  }
  if (p === '/api/admin/classes' && method === 'GET') {
    return json(res, 200, all(`SELECT c.id, c.name, c.code, c.archived, c.created, u.name AS owner,
      (SELECT COUNT(*) FROM members m WHERE m.class_id = c.id AND m.role = 'student') AS students FROM classes c JOIN users u ON u.id = c.owner_id ORDER BY c.created DESC LIMIT 500`)
      .map((c) => ({ ...c, archived: !!c.archived })));
  }
  if ((m = p.match(/^\/api\/admin\/classes\/(\d+)$/))) {
    const id = Number(m[1]);
    if (!one('SELECT 1 FROM classes WHERE id = ?', id)) throw notFound();
    if (method === 'PATCH') { const b = await readJson(req); run('UPDATE classes SET archived = ? WHERE id = ?', b.archived ? now() : null, id); return json(res, 200, { ok: true }); }
    if (method === 'DELETE') {
      for (const f of all('SELECT disk FROM files WHERE class_id = ?', id)) fs.rmSync(path.join(DATA, 'files', f.disk), { force: true });
      run('DELETE FROM classes WHERE id = ?', id); // members, content, work and grades go with it
      return json(res, 200, { ok: true });
    }
  }
  if (p === '/api/admin/outbox' && method === 'GET') return json(res, 200, all('SELECT id, to_email, subject, created, status, error FROM outbox ORDER BY id DESC LIMIT 100'));
  throw notFound();
}

/* =====================================================================================
 * Single sign-on (OpenID Connect, authorization-code flow with PKCE)
 * ===================================================================================== */
const ssoStates = new Map(); // state → { verifier, created }
let oidcConfig = null;
async function oidcDiscover() {
  if (!oidcConfig) {
    const r = await fetch(`${OIDC.issuer}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
    oidcConfig = await r.json();
  }
  return oidcConfig;
}
async function sso(req, res, url) {
  const fail = (msg) => send(res, 302, '', { Location: `/#/login?error=${encodeURIComponent(msg)}` });
  if (!OIDC) return fail('Single sign-on isn’t set up on this server.');
  const redirectUri = `${PUBLIC_URL}/auth/sso/callback`;
  try {
    const cfg = await oidcDiscover();
    if (url.pathname === '/auth/sso/start') {
      for (const [k, v] of ssoStates) if (Date.now() - v.created > 10 * 60e3) ssoStates.delete(k);
      const state = crypto.randomBytes(24).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
      ssoStates.set(state, { verifier, created: Date.now() });
      const q = new URLSearchParams({ response_type: 'code', client_id: OIDC.clientId, redirect_uri: redirectUri, scope: 'openid email profile', state,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return send(res, 302, '', { Location: `${cfg.authorization_endpoint}?${q}`, 'Set-Cookie': `lumen_sso=${state}; Path=/auth/sso; HttpOnly; SameSite=Lax; Max-Age=600${SECURE ? '; Secure' : ''}` });
    }
    const state = url.searchParams.get('state'); const saved = state && ssoStates.get(state);
    ssoStates.delete(state);
    if (!saved || parseCookies(req).lumen_sso !== state) return fail('Sign-in expired. Please try again.');
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || 'Sign-in was cancelled.');
    const tokenRes = await fetch(cfg.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirectUri, client_id: OIDC.clientId, client_secret: OIDC.clientSecret, code_verifier: saved.verifier }) });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.access_token) return fail('Your school’s sign-in didn’t complete.');
    // The profile comes straight from the provider over TLS using the token it just issued to us.
    const infoRes = await fetch(cfg.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const info = await infoRes.json().catch(() => ({}));
    const email = String(info.email || '').toLowerCase();
    if (!infoRes.ok || !/^[^@\s]+@[^@\s]+$/.test(email)) return fail('Your school account didn’t share an email address.');
    if (info.email_verified === false) return fail('Your school account’s email isn’t verified.');
    let u = one('SELECT id, disabled FROM users WHERE email = ?', email);
    if (u && u.disabled) return fail('This account has been turned off. Contact your administrator.');
    // New people get an account with an unusable random password (they sign in through SSO).
    const id = u ? u.id : createUser(email, String(info.name || email.split('@')[0]).slice(0, 80), hashPassword(crypto.randomBytes(32).toString('hex')));
    return send(res, 302, '', { Location: '/', 'Set-Cookie': [startSession(id), `lumen_sso=; Path=/auth/sso; Max-Age=0`] });
  } catch (e) {
    console.error('SSO error:', e.message);
    return fail('Single sign-on is unavailable right now.');
  }
}

/* ---------------- files, redirects for Brightspace-style links, static ---------------- */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
function serveFile(res, user, id) {
  const f = one('SELECT * FROM files WHERE id = ?', id);
  if (!f) throw notFound();
  if (!user) throw new HttpError(401, 'Sign in first.');
  const role = roleIn(f.class_id, user.id);
  // Class materials are for every member; a student's hand-in is only for them and the teacher.
  const isMaterial = !!one('SELECT 1 FROM topics WHERE file_id = ?', f.id);
  if (!role || !(isMaterial || role === 'teacher' || f.owner_id === user.id)) throw forbidden();
  const inline = INLINE.has(f.mime);
  send(res, 200, fs.readFileSync(path.join(DATA, 'files', f.disk)), {
    'Content-Type': inline ? f.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
  });
}

/** The Lumen UI and native apps build Brightspace-style URLs; send them to the right place. */
function legacyRedirect(url, user) {
  const p = url.pathname; let m;
  if (p === '/d2l/login') return user ? '/' : '/#/login';
  if (p === '/d2l/logout') return '/#/logout';
  if (p === '/d2l/home' || p === '/d2l/home/') return '/';
  if ((m = p.match(/^\/d2l\/home\/(\d+)$/))) return `/#/c/${m[1]}`;
  if ((m = p.match(/^\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)\/View$/))) {
    const t = one('SELECT * FROM topics WHERE id = ? AND class_id = ?', Number(m[2]), Number(m[1]));
    if (!t) return `/#/c/${m[1]}/classwork`;
    if (t.kind === 'link') return user && roleIn(t.class_id, user.id) ? t.url : '/#/login';
    if (t.kind === 'file') return `/files/${t.file_id}`;
    if (t.kind === 'assignment' || t.kind === 'quiz') return `/#/c/${m[1]}/${t.kind}/${t.ref_id}`;
    return `/#/c/${m[1]}/topic/${t.id}`;
  }
  if (p === '/d2l/lms/dropbox/user/folder_submit_files.d2l') return `/#/c/${url.searchParams.get('ou')}/assignment/${url.searchParams.get('db')}`;
  if (p === '/d2l/lms/quizzing/user/quiz_summary.d2l') return `/#/c/${url.searchParams.get('ou')}/quiz/${url.searchParams.get('qi')}`;
  if (/^\/d2l\/lms\/(dropbox|quizzing)\//.test(p)) return `/#/c/${url.searchParams.get('ou')}/work`;
  if (/^\/d2l\/lms\/classlist\//.test(p)) return `/#/c/${url.searchParams.get('ou')}/people`;
  if ((m = p.match(/^\/d2l\/le\/(\d+)\//))) return `/#/c/${m[1]}`;
  return '/';
}

function serveStatic(req, res, p) {
  if (p === '/') p = '/classes/public/index.html';
  const allowed = ['/classes/public/', '/src/', '/assets/'];
  if (!allowed.some((a) => p.startsWith(a))) return send(res, 404, 'Not found');
  const file = path.resolve(ROOT, '.' + decodeURIComponent(p));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, PUBLIC_URL);
    const p = url.pathname;
    const user = currentUser(req);
    let m;
    if (p === '/healthz') return json(res, 200, { ok: true });
    if (p.startsWith('/d2l/api/')) { if (req.method !== 'GET') return json(res, 405, { Message: 'Read-only' }); return valence(req, res, url, user); }
    if (p.startsWith('/api/')) return await api(req, res, url, user);
    if (p === '/auth/sso/start' || p === '/auth/sso/callback') return await sso(req, res, url);
    if ((m = p.match(/^\/files\/(\d+)(\/.*)?$/)) && req.method === 'GET') return serveFile(res, user, Number(m[1]));
    if (p.startsWith('/d2l/')) return send(res, 302, '', { Location: legacyRedirect(url, user) });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, p);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
  }
});
server.listen(PORT, () => console.log(`Lumen Classes on ${PUBLIC_URL} (listening on :${PORT}, data in ${DATA})`));
