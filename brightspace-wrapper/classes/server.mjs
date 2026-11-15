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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8200);
const DATA = path.resolve(process.env.LUMEN_DATA || path.join(ROOT, 'classes', 'data'));
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECURE = PUBLIC_URL.startsWith('https://');
const ALLOW_SIGNUP = process.env.LUMEN_ALLOW_SIGNUP !== 'false';
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
  return one('SELECT id, email, name FROM users WHERE id = ?', s.user_id) || null;
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

/* ---------------- shared queries ---------------- */
const splitName = (name) => { const i = name.trim().indexOf(' '); return i < 0 ? [name.trim(), ''] : [name.trim().slice(0, i), name.trim().slice(i + 1)]; };
const quizPoints = (quiz) => JSON.parse(quiz.questions).reduce((n, q) => n + (q.points || 1), 0);
function scoreQuiz(questions, answers) {
  return questions.reduce((n, q, i) => n + (Number(answers[i]) === q.answer ? (q.points || 1) : 0), 0);
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
  const t = one('SELECT score, submitted FROM attempts WHERE quiz_id = ? AND user_id = ?', item.id, userId);
  return { done: !!t, doneAt: t?.submitted || null, score: t?.score ?? null, feedback: null };
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
  if (p === '/api/config') return json(res, 200, { signup: ALLOW_SIGNUP, maxUploadMb: MAX_UPLOAD / 1048576 });
  if (p === '/api/auth/register' && method === 'POST') {
    if (!ALLOW_SIGNUP) throw forbidden('Sign-ups are turned off on this server.');
    const b = await readJson(req);
    const name = str(b.name, 'Your name', { max: 80 });
    const email = str(b.email, 'Email', { max: 200 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
    if (typeof b.password !== 'string' || b.password.length < 8) throw bad('Use a password of at least 8 characters.');
    throttle(`reg:${req.socket.remoteAddress}`, 20);
    if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with that email already exists.');
    const id = run('INSERT INTO users (email, name, pass, created) VALUES (?, ?, ?, ?)', email, name, hashPassword(b.password), now()).lastInsertRowid;
    return json(res, 201, { id, name, email }, { 'Set-Cookie': startSession(id) });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const b = await readJson(req);
    const email = str(b.email, 'Email').toLowerCase();
    throttle(`login:${req.socket.remoteAddress}:${email}`);
    const u = one('SELECT * FROM users WHERE email = ?', email);
    if (!u || typeof b.password !== 'string' || !checkPassword(b.password, u.pass)) throw new HttpError(401, 'Wrong email or password.');
    return json(res, 200, { id: u.id, name: u.name, email: u.email }, { 'Set-Cookie': startSession(u.id) });
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req)[COOKIE];
    if (token) run('DELETE FROM sessions WHERE token = ?', sha(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
  }
  if (p === '/api/me') return user ? json(res, 200, user) : json(res, 401, { error: 'Not signed in.' });
  if (!user) throw new HttpError(401, 'Sign in first.');

  /* ----- classes ----- */
  if (p === '/api/classes' && method === 'GET') {
    return json(res, 200, all('SELECT c.id, c.name, c.code, c.archived, m.role, c.join_code FROM classes c JOIN members m ON m.class_id = c.id WHERE m.user_id = ?', user.id)
      .map((c) => ({ id: c.id, name: c.name, code: c.code, archived: !!c.archived, role: c.role, joinCode: c.role === 'teacher' ? c.join_code : undefined })));
  }
  if (p === '/api/classes' && method === 'POST') {
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
        .map((x) => ({ id: x.id, name: x.name, role: x.role, email: role === 'teacher' ? x.email : undefined }));
      return json(res, 200, { id: cls.id, name: cls.name, code: cls.code, archived: !!cls.archived, role, joinCode: role === 'teacher' ? cls.join_code : undefined, people,
        modules: all('SELECT id, title FROM modules WHERE class_id = ? ORDER BY position, id', classId) });
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
    if ((m = rest.match(/^\/members\/(\d+)$/)) && method === 'DELETE') {
      requireTeacher(classId, user);
      if (Number(m[1]) === cls.owner_id) throw bad('The class owner can’t be removed.');
      run('DELETE FROM members WHERE class_id = ? AND user_id = ?', classId, Number(m[1]));
      return json(res, 200, { ok: true });
    }

    /* ----- stream ----- */
    if (rest === '/announcements' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const id = run('INSERT INTO announcements (class_id, author_id, title, body, created) VALUES (?, ?, ?, ?, ?)', classId, user.id, str(b.title, 'Title', { max: 160 }), str(b.body, 'Message', { max: 20000 }), now()).lastInsertRowid;
      return json(res, 201, { id });
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
        return json(res, 200, { id: t.id, kind: t.kind, title: t.title, html: textToHtml(t.body), url: t.url, file: f, refId: t.ref_id, created: t.created });
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
    if (rest === '/assignments' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const points = Number(b.points ?? 100);
      if (!(points > 0 && points <= 10000)) throw bad('Points must be between 1 and 10,000.');
      const title = str(b.title, 'Title', { max: 160 });
      const id = run('INSERT INTO assignments (class_id, title, instructions, due, points, created) VALUES (?, ?, ?, ?, ?, ?)', classId, title, str(b.instructions, 'Instructions', { max: 20000, required: false }), dateOrNull(b.due), points, now()).lastInsertRowid;
      run('INSERT INTO topics (class_id, module_id, kind, title, ref_id, created) VALUES (?, ?, ?, ?, ?, ?)', classId, moduleIdFrom(b), 'assignment', title, id, now());
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/assignments\/(\d+)(\/submit|\/grade)?$/))) {
      const a = one('SELECT * FROM assignments WHERE id = ? AND class_id = ?', Number(m[1]), classId);
      if (!a) throw notFound('That assignment was removed.');
      const fileInfo = (id) => (id ? one('SELECT id, name, size FROM files WHERE id = ?', id) : null);
      if (!m[2] && method === 'GET') {
        const out = { id: a.id, title: a.title, html: textToHtml(a.instructions), due: a.due, points: a.points, role };
        if (role === 'teacher') {
          out.students = all(`SELECT u.id, u.name, s.id AS sid, s.text, s.file_id, s.submitted, s.grade, s.feedback FROM members m JOIN users u ON u.id = m.user_id
            LEFT JOIN submissions s ON s.user_id = u.id AND s.assignment_id = ? WHERE m.class_id = ? AND m.role = 'student' ORDER BY u.name`, a.id, classId)
            .map((s) => ({ id: s.id, name: s.name, submitted: s.submitted, late: !!(s.submitted && a.due && s.submitted > a.due), text: s.text || '', file: fileInfo(s.file_id), grade: s.grade, feedback: s.feedback || '' }));
        } else {
          const s = one('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?', a.id, user.id);
          out.submission = s ? { text: s.text, file: fileInfo(s.file_id), submitted: s.submitted, late: !!(a.due && s.submitted > a.due), grade: s.grade, feedback: s.feedback } : null;
        }
        return json(res, 200, out);
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
        const grade = b.grade === null || b.grade === '' ? null : Number(b.grade);
        if (grade !== null && !(grade >= 0 && grade <= a.points)) throw bad(`Grade must be between 0 and ${a.points}.`);
        const feedback = str(b.feedback, 'Feedback', { max: 5000, required: false });
        // Grading someone who never handed in creates an empty submission holding the grade.
        run(`INSERT INTO submissions (assignment_id, user_id, text, submitted, grade, feedback, graded) VALUES (?, ?, '', ?, ?, ?, ?)
             ON CONFLICT (assignment_id, user_id) DO UPDATE SET grade = excluded.grade, feedback = excluded.feedback, graded = excluded.graded`, a.id, studentId, now(), grade, feedback, now());
        return json(res, 200, { ok: true });
      }
    }

    /* ----- quizzes ----- */
    if (rest === '/quizzes' && method === 'POST') {
      requireTeacher(classId, user);
      const b = await readJson(req);
      const title = str(b.title, 'Title', { max: 160 });
      if (!Array.isArray(b.questions) || !b.questions.length || b.questions.length > 100) throw bad('Add between 1 and 100 questions.');
      const questions = b.questions.map((q, i) => {
        const prompt = str(q.prompt, `Question ${i + 1}`, { max: 2000 });
        const choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => str(c, `A choice in question ${i + 1}`, { max: 500 }));
        if (choices.length < 2 || choices.length > 8) throw bad(`Question ${i + 1} needs 2 to 8 choices.`);
        const answer = Number(q.answer);
        if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) throw bad(`Pick the correct answer for question ${i + 1}.`);
        const points = Number(q.points ?? 1);
        if (!(points > 0 && points <= 1000)) throw bad(`Question ${i + 1} needs a point value.`);
        return { prompt, choices, answer, points };
      });
      const id = run('INSERT INTO quizzes (class_id, title, description, due, questions, created) VALUES (?, ?, ?, ?, ?, ?)', classId, title, str(b.description, 'Description', { max: 4000, required: false }), dateOrNull(b.due), JSON.stringify(questions), now()).lastInsertRowid;
      run('INSERT INTO topics (class_id, module_id, kind, title, ref_id, created) VALUES (?, ?, ?, ?, ?, ?)', classId, moduleIdFrom(b), 'quiz', title, id, now());
      return json(res, 201, { id });
    }
    if ((m = rest.match(/^\/quizzes\/(\d+)(\/attempt)?$/))) {
      const qz = one('SELECT * FROM quizzes WHERE id = ? AND class_id = ?', Number(m[1]), classId);
      if (!qz) throw notFound('That quiz was removed.');
      const questions = JSON.parse(qz.questions);
      const total = questions.reduce((n, q) => n + q.points, 0);
      if (!m[2] && method === 'GET') {
        const out = { id: qz.id, title: qz.title, html: textToHtml(qz.description), due: qz.due, points: total, role };
        if (role === 'teacher') {
          out.questions = questions;
          out.students = all(`SELECT u.id, u.name, t.score, t.submitted FROM members m JOIN users u ON u.id = m.user_id
            LEFT JOIN attempts t ON t.user_id = u.id AND t.quiz_id = ? WHERE m.class_id = ? AND m.role = 'student' ORDER BY u.name`, qz.id, classId);
        } else {
          const t = one('SELECT * FROM attempts WHERE quiz_id = ? AND user_id = ?', qz.id, user.id);
          // The answer key is only revealed once the student has handed the quiz in.
          out.attempt = t ? { score: t.score, submitted: t.submitted, answers: JSON.parse(t.answers) } : null;
          out.questions = questions.map((q) => (t ? q : { prompt: q.prompt, choices: q.choices, points: q.points }));
        }
        return json(res, 200, out);
      }
      if (!m[2] && method === 'DELETE') {
        requireTeacher(classId, user);
        run('DELETE FROM topics WHERE kind = ? AND ref_id = ?', 'quiz', qz.id);
        run('DELETE FROM quizzes WHERE id = ?', qz.id);
        return json(res, 200, { ok: true });
      }
      if (m[2] === '/attempt' && method === 'POST') {
        if (role !== 'student') throw forbidden('Only students take quizzes.');
        if (one('SELECT 1 FROM attempts WHERE quiz_id = ? AND user_id = ?', qz.id, user.id)) throw bad('You’ve already taken this quiz.');
        const b = await readJson(req);
        if (!Array.isArray(b.answers) || b.answers.length !== questions.length) throw bad('Answer every question before handing in.');
        const answers = b.answers.map((a) => (a === null || a === '' ? null : Number(a)));
        if (answers.some((a) => a === null)) throw bad('Answer every question before handing in.');
        const score = scoreQuiz(questions, answers);
        run('INSERT INTO attempts (quiz_id, user_id, answers, score, submitted) VALUES (?, ?, ?, ?, ?)', qz.id, user.id, JSON.stringify(answers), score, now());
        return json(res, 200, { score, points: total });
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
    if (rest === '/work' && method === 'GET') {
      const studentCount = one(`SELECT COUNT(*) AS n FROM members WHERE class_id = ? AND role = 'student'`, classId).n;
      return json(res, 200, { students: studentCount, items: gradables(classId).map((i) => {
        const base = { type: i.type, id: i.id, title: i.title, due: i.due, points: i.points };
        if (role !== 'teacher') return { ...base, ...studentScore(i, user.id) };
        const done = i.type === 'assignment'
          ? one(`SELECT COUNT(*) AS n, SUM(grade IS NOT NULL) AS g FROM submissions WHERE assignment_id = ? AND (text != '' OR file_id IS NOT NULL)`, i.id)
          : one('SELECT COUNT(*) AS n, COUNT(*) AS g FROM attempts WHERE quiz_id = ?', i.id);
        return { ...base, handedIn: done.n, graded: done.g || 0 };
      }) });
    }
  }
  throw notFound();
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
