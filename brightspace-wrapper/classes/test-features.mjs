// Tests for the fuller feature set.   node --test classes/test-features.mjs
// Runs the real server with a fake SMTP server and a fake OpenID Connect provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net'; import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PORT = 8232, SMTP_PORT = 8233, OIDC_PORT = 8234, BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-classes-'));
let proc, smtp, idp;
const mails = []; // { to, subject, text }

before(async () => {
  // --- fake SMTP: accepts anything, records messages ---
  smtp = net.createServer((sock) => {
    let data = '', inData = false, to = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      data += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = data.indexOf('\r\n.\r\n'); if (end < 0) return;
          const raw = data.slice(0, end); data = data.slice(end + 5); inData = false;
          const [head, body] = raw.split('\r\n\r\n');
          const subj = /^Subject: (.*)$/m.exec(head)[1].replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
          mails.push({ to, subject: subj, text: Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') });
          sock.write('250 queued\r\n'); continue;
        }
        const nl = data.indexOf('\r\n'); if (nl < 0) return;
        const line = data.slice(0, nl); data = data.slice(nl + 2);
        if (/^EHLO/i.test(line)) sock.write('250-fake\r\n250 OK\r\n');
        else if (/^RCPT TO:<(.+)>/i.test(line)) { to = /<(.+)>/.exec(line)[1]; sock.write('250 OK\r\n'); }
        else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  }).listen(SMTP_PORT, '127.0.0.1');
  // --- fake OpenID Connect provider ---
  const issuer = `http://127.0.0.1:${OIDC_PORT}`;
  idp = http.createServer(async (req, res) => {
    const u = new URL(req.url, issuer);
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/.well-known/openid-configuration') return send({ authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo` });
    if (u.pathname === '/authorize') { res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${u.searchParams.get('login_hint') || 'c1'}&state=${u.searchParams.get('state')}` }); return res.end(); }
    if (u.pathname === '/token') { let b = ''; for await (const c of req) b += c; const f = new URLSearchParams(b); idp.lastToken = Object.fromEntries(f); return send({ access_token: 'tok-' + f.get('code'), token_type: 'Bearer' }); }
    if (u.pathname === '/userinfo') return send(req.headers.authorization === 'Bearer tok-c1' ? { email: 'Dana@School.ca', name: 'Dana Districtuser', email_verified: true } : { email: 'x@school.ca', email_verified: false });
    res.writeHead(404); res.end();
  }).listen(OIDC_PORT, '127.0.0.1');

  proc = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT), LUMEN_DATA: dir, PUBLIC_URL: BASE,
    SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`, SMTP_FROM: 'Lumen <classes@example.com>', OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'lumen', OIDC_CLIENT_SECRET: 'shh', OIDC_NAME: 'District login' } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); smtp.close(); idp.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, { method, redirect: 'manual', headers: { ...(method !== 'GET' ? { 'X-Lumen': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k] = kv.split('='); cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv.endsWith('=') ? [] : [kv]).join('; '); }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), cookie: () => cookie };
}
const settle = () => new Promise((r) => setTimeout(r, 250)); // let queued mail go out
const admin = client(), teacher = client(), sam = client(), pat = client();
let cid, samId, patId, teacherId;

test('first account is the administrator; sign-up and class-creation policy', async () => {
  await admin.post('/api/auth/register', { name: 'Ada Admin', email: 'ada@example.com', password: 'adminpass1' });
  await teacher.post('/api/auth/register', { name: 'Tess Teacher', email: 'tess@example.com', password: 'teachpass1' });
  assert.equal((await admin.get('/api/me')).body.admin, true);
  assert.equal((await teacher.get('/api/me')).body.admin, false);
  assert.equal((await teacher.get('/api/admin/overview')).status, 403);
  assert.equal((await admin.patch('/api/admin/settings', { classCreation: 'approved' })).status, 200);
  assert.equal((await teacher.get('/api/me')).body.canCreateClasses, false);
  assert.equal((await teacher.post('/api/classes', { name: 'Nope' })).status, 403, 'unapproved accounts cannot create classes');
  const users = (await admin.get('/api/admin/users')).body;
  teacherId = users.find((u) => u.email === 'tess@example.com').id;
  await admin.patch(`/api/admin/users/${teacherId}`, { canTeach: true });
  cid = (await teacher.post('/api/classes', { name: 'History 10', code: 'P2' })).body.id;
  assert.ok(cid);
  await admin.patch('/api/admin/settings', { signup: false });
  assert.equal((await client().post('/api/auth/register', { name: 'Late', email: 'late@example.com', password: 'whatever12' })).status, 403);
  await admin.patch('/api/admin/settings', { signup: true });
  const code = (await teacher.get(`/api/classes/${cid}`)).body.joinCode;
  await sam.post('/api/auth/register', { name: 'Sam Student', email: 'sam@example.com', password: 'studpass12' });
  await pat.post('/api/auth/register', { name: 'Pat Peer', email: 'pat@example.com', password: 'studpass34' });
  await sam.post('/api/classes/join', { joinCode: code }); await pat.post('/api/classes/join', { joinCode: code });
  const people = (await teacher.get(`/api/classes/${cid}`)).body.people;
  samId = people.find((p) => p.name === 'Sam Student').id; patId = people.find((p) => p.name === 'Pat Peer').id;
});

test('email: announcements notify students, opt-out is respected, the outbox records it', async () => {
  await pat.patch('/api/me', { notify: false });
  await teacher.post(`/api/classes/${cid}/announcements`, { title: 'Field trip Friday — bring lunch', body: 'Permission forms are due Wednesday.' });
  await settle();
  const got = mails.filter((m) => m.subject.includes('Field trip'));
  assert.deepEqual(got.map((m) => m.to), ['sam@example.com'], 'only the student who kept notifications on');
  assert.ok(got[0].subject.startsWith('[History 10]') && got[0].subject.includes('—'), 'UTF-8 subject survives');
  assert.ok(got[0].text.includes('Permission forms are due Wednesday.') && got[0].text.includes(`${BASE}/#/c/${cid}`));
  const outbox = (await admin.get('/api/admin/outbox')).body;
  assert.equal(outbox[0].status, 'sent');
});

test('password reset: emailed one-time link, old sessions end, no account probing', async () => {
  assert.deepEqual((await client().post('/api/auth/forgot', { email: 'nobody@example.com' })).body.ok, true, 'same answer for unknown emails');
  await client().post('/api/auth/forgot', { email: 'sam@example.com' });
  await settle();
  const mail = mails.filter((m) => m.subject.includes('Reset your')).pop();
  assert.equal(mail.to, 'sam@example.com');
  const token = /#\/reset\/([\w-]+)/.exec(mail.text)[1];
  assert.equal((await client().post('/api/auth/reset', { token: 'wrong', password: 'newpassword1' })).status, 400);
  assert.equal((await client().post('/api/auth/reset', { token, password: 'newpassword1' })).status, 200);
  assert.equal((await client().post('/api/auth/reset', { token, password: 'again12345' })).status, 400, 'link works once');
  assert.equal((await sam.get('/api/me')).status, 401, 'existing sessions are signed out');
  assert.equal((await sam.post('/api/auth/login', { email: 'sam@example.com', password: 'studpass12' })).status, 401);
  assert.equal((await sam.post('/api/auth/login', { email: 'sam@example.com', password: 'newpassword1' })).status, 200);
  assert.equal((await sam.post('/api/me/password', { current: 'nope', password: 'another123' })).status, 400);
  assert.equal((await sam.post('/api/me/password', { current: 'newpassword1', password: 'another123' })).status, 200);
});

test('editing: announcement, module, note, assignment', async () => {
  const aId = (await teacher.post(`/api/classes/${cid}/announcements`, { title: 'Tpyo', body: 'x' })).body.id;
  assert.equal((await sam.patch(`/api/classes/${cid}/announcements/${aId}`, { title: 'Hacked', body: 'x' })).status, 403);
  await teacher.patch(`/api/classes/${cid}/announcements/${aId}`, { title: 'Typo fixed', body: 'Better.' });
  const news = (await sam.get(`/d2l/api/le/1.79/${cid}/news/`)).body;
  assert.ok(news.some((n) => n.Title === 'Typo fixed' && n.Body.Text === 'Better.'));
  const mod = (await teacher.post(`/api/classes/${cid}/modules`, { title: 'Unit 1' })).body.id;
  await teacher.patch(`/api/classes/${cid}/modules/${mod}`, { title: 'Unit 1: Confederation', description: 'Weeks 1-4' });
  const note = (await teacher.post(`/api/classes/${cid}/topics`, { kind: 'text', title: 'Notes', body: 'old' })).body.id;
  await teacher.patch(`/api/classes/${cid}/topics/${note}`, { title: 'Reading notes', body: 'new text', moduleId: mod });
  const toc = (await sam.get(`/d2l/api/le/1.79/${cid}/content/toc`)).body.Modules;
  assert.equal(toc.length, 1); assert.equal(toc[0].Title, 'Unit 1: Confederation'); assert.equal(toc[0].Topics[0].Title, 'Reading notes');
  const asg = (await teacher.post(`/api/classes/${cid}/assignments`, { title: 'Essay', points: 10 })).body.id;
  await teacher.patch(`/api/classes/${cid}/assignments/${asg}`, { title: 'Essay draft', instructions: '500 words', points: 30, moduleId: mod });
  const a = (await sam.get(`/api/classes/${cid}/assignments/${asg}`)).body;
  assert.equal(a.title, 'Essay draft'); assert.equal(a.points, 30);
  await teacher.post(`/api/classes/${cid}/assignments/${asg}/grade`, { studentId: samId, grade: 25 });
  assert.equal((await teacher.patch(`/api/classes/${cid}/assignments/${asg}`, { title: 'Essay draft', points: 20 })).status, 400, 'total can’t drop below an awarded grade');
  await settle();
  assert.ok(mails.some((m) => m.to === 'sam@example.com' && m.subject.includes('Graded: Essay draft') && m.text.includes('25 out of 30')), 'student is emailed their grade');
});

test('rubric: per-criterion scores add up to the grade', async () => {
  const id = (await teacher.post(`/api/classes/${cid}/assignments`, { title: 'Poster', rubric: [{ title: 'Research', points: 10 }, { title: 'Design', points: 5 }, { title: 'Sources', points: 5 }] })).body.id;
  assert.equal((await sam.get(`/api/classes/${cid}/assignments/${id}`)).body.points, 20, 'worth the rubric total');
  await sam.post(`/api/classes/${cid}/assignments/${id}/submit`, { text: 'My poster' });
  assert.equal((await teacher.post(`/api/classes/${cid}/assignments/${id}/grade`, { studentId: samId, rubricScores: [11, 5, 5] })).status, 400, 'over a criterion’s maximum');
  assert.equal((await teacher.post(`/api/classes/${cid}/assignments/${id}/grade`, { studentId: samId, rubricScores: [9, 4] })).status, 400, 'every row needs a score');
  assert.equal((await teacher.post(`/api/classes/${cid}/assignments/${id}/grade`, { studentId: samId, rubricScores: [9, 4, 5], feedback: 'Strong research.' })).body.grade, 18);
  const mine = (await sam.get(`/api/classes/${cid}/assignments/${id}`)).body;
  assert.equal(mine.submission.grade, 18); assert.deepEqual(mine.submission.rubricScores, [9, 4, 5]); assert.equal(mine.rubric[0].title, 'Research');
});

test('co-teachers: promote, their powers, only the owner demotes', async () => {
  assert.equal((await sam.patch(`/api/classes/${cid}/members/${patId}`, { role: 'teacher' })).status, 403);
  await teacher.patch(`/api/classes/${cid}/members/${patId}`, { role: 'teacher' });
  assert.equal((await pat.post(`/api/classes/${cid}/announcements`, { title: 'From the co-teacher', body: 'Hi' })).status, 201);
  assert.equal((await pat.patch(`/api/classes/${cid}/members/${teacherId}`, { role: 'student' })).status, 400, 'the owner stays a teacher');
  assert.equal((await pat.del(`/api/classes/${cid}/members/${teacherId}`)).status, 400);
  await teacher.patch(`/api/classes/${cid}/members/${patId}`, { role: 'student' });
  assert.equal((await pat.post(`/api/classes/${cid}/announcements`, { title: 'x', body: 'y' })).status, 403);
});

test('discussions: anyone in class posts and replies; authors and teachers delete', async () => {
  const d = (await sam.post(`/api/classes/${cid}/discussions`, { title: 'Question about the essay', body: 'Is 500 words a minimum?\n\n<b>thanks</b>' })).body.id;
  await pat.post(`/api/classes/${cid}/discussions/${d}/replies`, { body: 'I think so.' });
  const r2 = (await teacher.post(`/api/classes/${cid}/discussions/${d}/replies`, { body: 'Yes — a minimum.' })).body.id;
  const list = (await pat.get(`/api/classes/${cid}/discussions`)).body;
  assert.equal(list[0].replies, 2); assert.equal(list[0].author, 'Sam Student');
  const thread = (await pat.get(`/api/classes/${cid}/discussions/${d}`)).body;
  assert.ok(thread.html.includes('&lt;b&gt;thanks') , 'HTML is escaped');
  assert.deepEqual(thread.replies.map((r) => [r.author, r.teacher, r.canDelete]), [['Pat Peer', false, true], ['Tess Teacher', true, false]]);
  assert.equal((await pat.del(`/api/classes/${cid}/discussions/${d}/replies/${r2}`)).status, 403, 'can’t delete someone else’s reply');
  assert.equal((await pat.del(`/api/classes/${cid}/discussions/${d}`)).status, 403);
  assert.equal((await admin.get(`/api/classes/${cid}/discussions`)).status, 403, 'non-members (even admins) aren’t in the class');
  assert.equal((await teacher.del(`/api/classes/${cid}/discussions/${d}`)).status, 200);
  assert.equal((await pat.get(`/api/classes/${cid}/discussions`)).body.length, 0);
});

let quiz;
test('question types: multi-select, short answer and written answers marked by the teacher', async () => {
  quiz = (await teacher.post(`/api/classes/${cid}/quizzes`, { title: 'Confederation quiz', maxAttempts: 2, questions: [
    { type: 'choice', prompt: 'Year?', choices: ['1867', '1982'], answer: 0, points: 1 },
    { type: 'multi', prompt: 'Original provinces?', choices: ['Ontario', 'Alberta', 'Quebec', 'Nova Scotia'], answers: [0, 2, 3], points: 3 },
    { type: 'short', prompt: 'First PM (surname)?', answers: ['Macdonald', 'MacDonald', 'John A. Macdonald'], points: 2 },
    { type: 'paragraph', prompt: 'Why did the colonies unite?', points: 4 }] })).body.id;
  assert.equal((await teacher.post(`/api/classes/${cid}/quizzes`, { title: 'Bad', questions: [{ type: 'multi', prompt: 'p', choices: ['a', 'b'], answers: [] }] })).status, 400);
  const view = (await sam.get(`/api/classes/${cid}/quizzes/${quiz}`)).body;
  assert.ok(view.questions.every((q) => q.answer === undefined && q.answers === undefined), 'no keys before finishing');
  assert.equal(view.attemptsLeft, 2);
  const r = (await sam.post(`/api/classes/${cid}/quizzes/${quiz}/attempt`, { answers: [0, [3, 0, 2], '  macdonald ', 'Defence, railways and trade.'] })).body;
  assert.deepEqual(r, { score: 6, points: 10, pending: true }, 'auto parts marked; order/case/spacing don’t matter; written answer pending');
  const book = (await teacher.get(`/api/classes/${cid}/gradebook`)).body;
  const col = book.items.findIndex((i) => i.title === 'Confederation quiz');
  assert.deepEqual(book.students.find((s) => s.name === 'Sam Student').cells[col], { done: true, score: null }, 'shows as “to grade” until marked');
  const t = (await teacher.get(`/api/classes/${cid}/quizzes/${quiz}`)).body;
  const att = t.students.find((s) => s.name === 'Sam Student').attempts[0];
  assert.equal(att.answers[3], 'Defence, railways and trade.');
  assert.equal((await sam.post(`/api/classes/${cid}/quizzes/${quiz}/grade`, { attemptId: att.id, scores: { 3: 4 } })).status, 403);
  assert.equal((await teacher.post(`/api/classes/${cid}/quizzes/${quiz}/grade`, { attemptId: att.id, scores: { 3: 5 } })).status, 400, 'over the question’s points');
  assert.equal((await teacher.post(`/api/classes/${cid}/quizzes/${quiz}/grade`, { attemptId: att.id, scores: { 0: 1 } })).status, 400, 'auto-marked questions can’t be overridden');
  assert.deepEqual((await teacher.post(`/api/classes/${cid}/quizzes/${quiz}/grade`, { attemptId: att.id, scores: { 3: 3 } })).body, { score: 9, pending: false });
});

test('retakes: best attempt counts; the key appears only when no attempts are left', async () => {
  let v = (await sam.get(`/api/classes/${cid}/quizzes/${quiz}`)).body;
  assert.equal(v.attemptsLeft, 1); assert.equal(v.revealed, false); assert.equal(v.best, 9);
  await sam.post(`/api/classes/${cid}/quizzes/${quiz}/attempt`, { answers: [1, [0], 'nobody', null] });
  v = (await sam.get(`/api/classes/${cid}/quizzes/${quiz}`)).body;
  assert.equal(v.attemptsLeft, 0); assert.equal(v.revealed, true); assert.equal(v.questions[0].answer, 0);
  assert.equal(v.best, 9, 'the better (first) attempt counts, not the latest');
  assert.equal((await sam.post(`/api/classes/${cid}/quizzes/${quiz}/attempt`, { answers: [0, [0, 2, 3], 'macdonald', 'x'] })).status, 400, 'no attempts left');
  assert.equal((await teacher.patch(`/api/classes/${cid}/quizzes/${quiz}`, { title: 'Confederation quiz', maxAttempts: 2, questions: [{ type: 'choice', prompt: 'New', choices: ['a', 'b'], answer: 0 }] })).status, 400, 'questions lock once students start');
  assert.equal((await teacher.patch(`/api/classes/${cid}/quizzes/${quiz}`, { title: 'Confederation quiz (v2)', maxAttempts: 3 })).status, 200, 'settings can still change');
});

test('timed quiz: start, autosave, and an abandoned attempt closes itself with the saved answers', async () => {
  const id = (await teacher.post(`/api/classes/${cid}/quizzes`, { title: 'Timed', timeLimit: 5, questions: [{ prompt: '2+2?', choices: ['3', '4'], answer: 1, points: 5 }] })).body.id;
  const start = (await pat.post(`/api/classes/${cid}/quizzes/${id}/start`)).body;
  assert.ok(Math.abs(new Date(start.deadline) - new Date(start.started) - 5 * 60e3) < 1000, 'deadline is start + limit');
  assert.equal((await pat.post(`/api/classes/${cid}/quizzes/${id}/start`)).body.id, start.id, 'starting again resumes the same attempt');
  assert.equal((await pat.put(`/api/classes/${cid}/quizzes/${id}/attempt`, { answers: [1] })).body.saved, true);
  assert.deepEqual((await pat.get(`/api/classes/${cid}/quizzes/${id}`)).body.inProgress.answers, [1], 'saved answers come back after a reload');
  // Pretend ten minutes passed (the student closed the tab).
  const db = new DatabaseSync(path.join(dir, 'lumen.db'));
  db.prepare('UPDATE attempts SET started = ? WHERE id = ?').run(new Date(Date.now() - 10 * 60e3).toISOString(), start.id); db.close();
  const late = (await pat.post(`/api/classes/${cid}/quizzes/${id}/attempt`, { attemptId: start.id, answers: [0] })).body;
  assert.deepEqual(late, { score: 5, points: 5, pending: false, timedOut: true }, 'late hand-in is ignored; the saved answer is what counts');
  const v = (await pat.get(`/api/classes/${cid}/quizzes/${id}`)).body;
  assert.equal(v.inProgress, null); assert.equal(v.best, 5); assert.equal(v.attemptsLeft, 0);
});

test('grade export: CSV with every student, safe against spreadsheet formulas', async () => {
  await client().post('/api/auth/register', { name: '=HYPERLINK("http://evil")', email: 'eve@example.com', password: 'evilpass12' }).then(async () => {
    const eve = client(); await eve.post('/api/auth/login', { email: 'eve@example.com', password: 'evilpass12' });
    await eve.post('/api/classes/join', { joinCode: (await teacher.get(`/api/classes/${cid}`)).body.joinCode });
  });
  assert.equal((await sam.get(`/api/classes/${cid}/gradebook.csv`)).status, 403);
  const r = await teacher.get(`/api/classes/${cid}/gradebook.csv`);
  assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /History%2010-grades\.csv/);
  const lines = r.body.replace(/^﻿/, '').trim().split('\r\n');
  assert.ok(lines[0].startsWith('"Student","Email","Essay draft (30)","Poster (20)"'));
  const samRow = lines.find((l) => l.startsWith('"Sam Student"'));
  assert.ok(samRow.includes('"25","18","9"'), samRow);
  assert.ok(lines.some((l) => l.startsWith(`"'=HYPERLINK(""http://evil"")"`)), 'formula-looking names are neutralised and quoted');
});

test('single sign-on: creates the account, signs in, PKCE + state are enforced', async () => {
  assert.equal((await client().get('/api/config')).body.sso, 'District login');
  const c = client();
  const start = await c.get('/auth/sso/start');
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const back = await fetch(auth, { redirect: 'manual' });
  const cb = new URL(back.headers.get('location'));
  assert.equal((await client().get(cb.pathname + cb.search)).headers.get('location').startsWith('/#/login?error='), true, 'a callback without the matching browser cookie is refused');
  const c2 = client(); const s2 = await c2.get('/auth/sso/start');
  const cb2 = new URL((await fetch(s2.headers.get('location'), { redirect: 'manual' })).headers.get('location'));
  const done = await c2.get(cb2.pathname + cb2.search);
  assert.equal(done.headers.get('location'), '/');
  assert.ok(idp.lastToken.code_verifier && idp.lastToken.client_secret === 'shh');
  const me = (await c2.get('/api/me')).body;
  assert.equal(me.email, 'dana@school.ca'); assert.equal(me.name, 'Dana Districtuser');
});

test('admin: turn an account off (signs it out), reset link, class archive and delete', async () => {
  const users = (await admin.get('/api/admin/users?q=pat')).body;
  assert.equal(users.length, 1);
  await admin.patch(`/api/admin/users/${users[0].id}`, { disabled: true });
  assert.equal((await pat.get('/api/me')).status, 401, 'signed out immediately');
  assert.equal((await client().post('/api/auth/login', { email: 'pat@example.com', password: 'studpass34' })).status, 403);
  await admin.patch(`/api/admin/users/${users[0].id}`, { disabled: false });
  const link = (await admin.post(`/api/admin/users/${users[0].id}/reset-link`)).body.link;
  assert.equal((await client().post('/api/auth/reset', { token: link.split('/reset/')[1], password: 'fromadmin12' })).status, 200);
  const me = (await admin.get('/api/admin/users?q=ada')).body[0];
  assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { admin: false })).status, 400, 'can’t demote yourself');
  assert.equal((await admin.del(`/api/admin/users/${teacherId}`)).status, 400, 'owners of classes can’t be deleted');
  const ov = (await admin.get('/api/admin/overview')).body;
  assert.equal(ov.stats.classes, 1); assert.equal(ov.email.configured, true);
  await admin.patch(`/api/admin/classes/${cid}`, { archived: true });
  assert.equal((await admin.get('/api/admin/classes')).body[0].archived, true);
  assert.equal((await admin.del(`/api/admin/classes/${cid}`)).status, 200);
  assert.equal((await teacher.get(`/api/classes/${cid}`)).status, 403);
  assert.equal((await admin.del(`/api/admin/users/${teacherId}`)).status, 200);
});
