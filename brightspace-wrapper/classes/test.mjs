// API tests for Lumen Classes.   node --test classes/test.mjs
// Starts the real server on a temporary data folder and drives it over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8231, BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-classes-'));
let proc;

before(async () => {
  proc = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { env: { ...process.env, PORT: String(PORT), LUMEN_DATA: dir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

/** A tiny client that keeps one user's session cookie. */
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, { method, redirect: 'manual',
      headers: { ...(method !== 'GET' ? { 'X-Lumen': '1' } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b, h) => call('POST', u, b, h), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u), raw: call };
}
const teacher = client(), student = client(), outsider = client();
let classId, joinCode, moduleId, assignmentId, quizId, fileTopicFile, handInFile;

test('accounts: register, duplicate, bad password, login, me', async () => {
  assert.equal((await teacher.post('/api/auth/register', { name: 'Tess Teacher', email: 'tess@example.com', password: 'correct horse' })).status, 201);
  assert.equal((await student.post('/api/auth/register', { name: 'Sam Student', email: 'sam@example.com', password: 'battery staple' })).status, 201);
  assert.equal((await outsider.post('/api/auth/register', { name: 'Olive Outsider', email: 'olive@example.com', password: 'password123' })).status, 201);
  assert.equal((await client().post('/api/auth/register', { name: 'X', email: 'tess@example.com', password: 'whatever1' })).status, 409);
  assert.equal((await client().post('/api/auth/register', { name: 'X', email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await client().post('/api/auth/login', { email: 'tess@example.com', password: 'wrong' })).status, 401);
  const again = client();
  assert.equal((await again.post('/api/auth/login', { email: 'TESS@example.com', password: 'correct horse' })).status, 200);
  assert.equal((await again.get('/api/me')).body.name, 'Tess Teacher');
  assert.equal((await client().get('/api/me')).status, 401);
});

test('CSRF: writes without the X-Lumen header are refused', async () => {
  const r = await teacher.raw('POST', '/api/classes', { name: 'Sneaky' }, { 'X-Lumen': '' });
  assert.equal(r.status, 403);
});

test('classes: create, join by code, roles and roster', async () => {
  classId = (await teacher.post('/api/classes', { name: 'Biology 11', code: 'Block C' })).body.id;
  const info = (await teacher.get(`/api/classes/${classId}`)).body;
  assert.equal(info.role, 'teacher'); assert.match(info.joinCode, /^[a-z0-9]{3}-[a-z0-9]{4}$/);
  joinCode = info.joinCode;
  assert.equal((await student.post('/api/classes/join', { joinCode: 'zzz-zzzz' })).status, 404);
  assert.equal((await student.post('/api/classes/join', { joinCode: joinCode.toUpperCase() })).body.id, classId);
  const asStudent = (await student.get(`/api/classes/${classId}`)).body;
  assert.equal(asStudent.role, 'student');
  assert.equal(asStudent.joinCode, undefined, 'students never see the join code');
  assert.equal(asStudent.people.find((p) => p.role === 'teacher').email, undefined, 'students never see emails');
  assert.equal((await outsider.get(`/api/classes/${classId}`)).status, 403);
});

test('only the teacher can author', async () => {
  for (const [url, body] of [[`/api/classes/${classId}/announcements`, { title: 'Hi', body: 'x' }], [`/api/classes/${classId}/modules`, { title: 'M' }],
    [`/api/classes/${classId}/assignments`, { title: 'A' }], [`/api/classes/${classId}/quizzes`, { title: 'Q', questions: [{ prompt: 'p', choices: ['a', 'b'], answer: 0 }] }]]) {
    assert.equal((await student.post(url, body)).status, 403, url);
    assert.equal((await outsider.post(url, body)).status, 403, url);
  }
  assert.equal((await student.get(`/api/classes/${classId}/gradebook`)).status, 403);
  assert.equal((await student.patch(`/api/classes/${classId}`, { name: 'Hacked' })).status, 403);
});

test('teacher builds the class: announcement, module, materials, assignment, quiz', async () => {
  assert.equal((await teacher.post(`/api/classes/${classId}/announcements`, { title: 'Welcome!', body: 'Read the outline at https://example.com/outline.\n\n<script>alert(1)</script>' })).status, 201);
  moduleId = (await teacher.post(`/api/classes/${classId}/modules`, { title: 'Unit 1: Cells', description: 'Weeks 1–3' })).body.id;
  assert.equal((await teacher.post(`/api/classes/${classId}/topics`, { kind: 'text', title: 'Lab safety', body: 'Wear goggles.', moduleId })).status, 201);
  assert.equal((await teacher.post(`/api/classes/${classId}/topics`, { kind: 'link', title: 'Cell video', url: 'https://youtube.com/watch?v=abc', moduleId })).status, 201);
  assert.equal((await teacher.post(`/api/classes/${classId}/topics`, { kind: 'link', title: 'Bad', url: 'javascript:alert(1)' })).status, 400);
  const up = await teacher.post(`/api/classes/${classId}/files`, new TextEncoder().encode('%PDF-1.4 notes'), { 'X-Filename': encodeURIComponent('Unit 1 notes.pdf'), 'Content-Type': 'application/pdf' });
  assert.equal(up.status, 201); fileTopicFile = up.body.id;
  assert.equal((await teacher.post(`/api/classes/${classId}/topics`, { kind: 'file', title: 'Unit 1 notes', fileId: fileTopicFile, moduleId })).status, 201);
  const due = new Date(Date.now() + 3 * 864e5).toISOString();
  assignmentId = (await teacher.post(`/api/classes/${classId}/assignments`, { title: 'Cell diagram', instructions: 'Draw and label a plant cell.', due, points: 20, moduleId })).body.id;
  quizId = (await teacher.post(`/api/classes/${classId}/quizzes`, { title: 'Cells quiz', due, moduleId, questions: [
    { prompt: 'Powerhouse of the cell?', choices: ['Nucleus', 'Mitochondria', 'Ribosome'], answer: 1, points: 2 },
    { prompt: 'Plant cells have a cell wall.', choices: ['True', 'False'], answer: 0, points: 1 }] })).body.id;
  assert.equal((await teacher.post(`/api/classes/${classId}/quizzes`, { title: 'Bad', questions: [{ prompt: 'p', choices: ['only one'], answer: 0 }] })).status, 400);
});

test('Brightspace-shaped read API serves the same class to the Lumen UI', async () => {
  assert.equal((await client().get('/d2l/api/lp/1.47/users/whoami')).status, 403, 'signed out → 403, like Brightspace');
  assert.deepEqual((await student.get('/d2l/api/lp/1.47/users/whoami')).body.FirstName, 'Sam');
  const enr = (await student.get('/d2l/api/lp/1.47/enrollments/myenrollments/?orgUnitTypeId=3')).body;
  assert.equal(enr.Items[0].OrgUnit.Name, 'Biology 11'); assert.equal(enr.Items[0].OrgUnit.Code, 'Block C');
  const news = (await student.get(`/d2l/api/le/1.79/${classId}/news/`)).body;
  assert.equal(news[0].Title, 'Welcome!');
  assert.ok(news[0].Body.Html.includes('<a href="https://example.com/outline">'), 'links become anchors');
  assert.ok(!news[0].Body.Html.includes('<script>') && news[0].Body.Html.includes('&lt;script&gt;'), 'user HTML is escaped');
  const toc = (await student.get(`/d2l/api/le/1.79/${classId}/content/toc`)).body;
  assert.equal(toc.Modules.length, 1); assert.equal(toc.Modules[0].Title, 'Unit 1: Cells');
  assert.deepEqual(toc.Modules[0].Topics.map((t) => t.Title), ['Lab safety', 'Cell video', 'Unit 1 notes', 'Cell diagram', 'Cells quiz']);
  assert.match(toc.Modules[0].Topics[2].Url, /\.pdf$/); assert.match(toc.Modules[0].Topics[4].Url, /quiz/);
  const items = (await student.get(`/d2l/api/le/1.79/content/myItems/?orgUnitIdsCSV=${classId}`)).body.Objects;
  assert.equal(items.length, 2); assert.ok(items.every((i) => i.DateCompleted === null));
  assert.equal((await outsider.get(`/d2l/api/le/1.79/${classId}/news/`)).status, 403);
  assert.equal((await student.raw('POST', '/d2l/api/lp/1.47/users/whoami')).status, 405, 'the Brightspace-shaped API is read-only');
});

test('student hands in an assignment; teacher grades it; student sees the grade', async () => {
  assert.equal((await student.post(`/api/classes/${classId}/assignments/${assignmentId}/submit`, {})).status, 400, 'empty hand-in refused');
  const up = await student.post(`/api/classes/${classId}/files`, new TextEncoder().encode('my diagram'), { 'X-Filename': 'diagram.txt', 'Content-Type': 'text/plain' });
  handInFile = up.body.id;
  assert.equal((await student.post(`/api/classes/${classId}/assignments/${assignmentId}/submit`, { text: 'Here is my diagram.', fileId: handInFile })).status, 200);
  assert.equal((await teacher.post(`/api/classes/${classId}/assignments/${assignmentId}/submit`, { text: 'x' })).status, 403);
  const view = (await teacher.get(`/api/classes/${classId}/assignments/${assignmentId}`)).body;
  assert.equal(view.students.length, 1); assert.equal(view.students[0].text, 'Here is my diagram.'); assert.equal(view.students[0].file.name, 'diagram.txt');
  assert.equal((await student.post(`/api/classes/${classId}/assignments/${assignmentId}/grade`, { studentId: view.students[0].id, grade: 20 })).status, 403, 'students cannot grade');
  assert.equal((await teacher.post(`/api/classes/${classId}/assignments/${assignmentId}/grade`, { studentId: view.students[0].id, grade: 25 })).status, 400, 'over the maximum');
  assert.equal((await teacher.post(`/api/classes/${classId}/assignments/${assignmentId}/grade`, { studentId: view.students[0].id, grade: 17, feedback: 'Nice labels.' })).status, 200);
  const mine = (await student.get(`/api/classes/${classId}/assignments/${assignmentId}`)).body;
  assert.equal(mine.submission.grade, 17); assert.equal(mine.submission.feedback, 'Nice labels.'); assert.equal(mine.students, undefined);
  assert.equal((await student.post(`/api/classes/${classId}/assignments/${assignmentId}/submit`, { text: 'changed' })).status, 400, 'graded work is locked');
});

test('quiz: answer key hidden until handed in, auto-graded, one attempt', async () => {
  const before = (await student.get(`/api/classes/${classId}/quizzes/${quizId}`)).body;
  assert.ok(before.questions.every((q) => q.answer === undefined), 'no answer key before the attempt');
  assert.equal((await student.post(`/api/classes/${classId}/quizzes/${quizId}/attempt`, { answers: [1] })).status, 400);
  const r = await student.post(`/api/classes/${classId}/quizzes/${quizId}/attempt`, { answers: [1, 1] });
  assert.deepEqual(r.body, { score: 2, points: 3 });
  assert.equal((await student.post(`/api/classes/${classId}/quizzes/${quizId}/attempt`, { answers: [1, 0] })).status, 400, 'one attempt only');
  const after = (await student.get(`/api/classes/${classId}/quizzes/${quizId}`)).body;
  assert.equal(after.questions[0].answer, 1); assert.deepEqual(after.attempt.answers, [1, 1]);
});

test('grades: student view (Brightspace-shaped) and teacher gradebook agree', async () => {
  const g = (await student.get(`/d2l/api/le/1.79/${classId}/grades/values/myGradeValues/`)).body;
  assert.deepEqual(g.map((x) => [x.GradeObjectName, x.PointsNumerator, x.PointsDenominator]), [['Cell diagram', 17, 20], ['Cells quiz', 2, 3]]);
  assert.equal(g[0].Comments.Text, 'Nice labels.');
  const earned = g.reduce((n, x) => n + x.WeightedNumerator, 0), possible = g.reduce((n, x) => n + x.WeightedDenominator, 0);
  assert.ok(Math.abs((earned / possible) * 100 - (19 / 23) * 100) < 0.05, 'weights reduce to points earned / points possible');
  const book = (await teacher.get(`/api/classes/${classId}/gradebook`)).body;
  assert.equal(book.students[0].name, 'Sam Student');
  assert.deepEqual(book.students[0].cells.map((c) => c.score), [17, 2]);
  assert.ok(Math.abs(book.students[0].percent - (19 / 23) * 100) < 0.001);
  const done = (await student.get(`/d2l/api/le/1.79/content/myItems/?orgUnitIdsCSV=${classId}`)).body.Objects;
  assert.ok(done.every((i) => i.DateCompleted), 'both items now count as done');
});

test('files: materials for members, hand-ins only for their owner and the teacher', async () => {
  const other = client();
  await other.post('/api/auth/register', { name: 'Pat Peer', email: 'pat@example.com', password: 'longenough1' });
  await other.post('/api/classes/join', { joinCode });
  assert.equal((await other.get(`/files/${fileTopicFile}`)).status, 200, 'classmate can open a material');
  assert.equal((await other.get(`/files/${handInFile}`)).status, 403, 'classmate cannot open someone else’s hand-in');
  assert.equal((await student.get(`/files/${handInFile}`)).status, 200);
  const t = await teacher.get(`/files/${handInFile}`);
  assert.equal(t.status, 200); assert.match(t.headers.get('content-disposition'), /^attachment/, 'non-PDF/image files download rather than render');
  assert.equal((await outsider.get(`/files/${fileTopicFile}`)).status, 403);
  assert.equal((await client().get(`/files/${fileTopicFile}`)).status, 401);
});

test('Brightspace-style links redirect into the app', async () => {
  const r = await student.get(`/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${assignmentId}&ou=${classId}`);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/#/c/${classId}/assignment/${assignmentId}`);
  assert.equal((await client().get('/d2l/login')).headers.get('location'), '/#/login');
});

test('membership: remove a student, archive, logout', async () => {
  const people = (await teacher.get(`/api/classes/${classId}`)).body.people;
  const pat = people.find((p) => p.name === 'Pat Peer');
  assert.equal((await teacher.del(`/api/classes/${classId}/members/${pat.id}`)).status, 200);
  assert.equal((await teacher.patch(`/api/classes/${classId}`, { archived: true })).status, 200);
  assert.equal((await outsider.post('/api/classes/join', { joinCode })).status, 400, 'archived classes can’t be joined');
  assert.equal((await student.post('/api/auth/logout')).status, 200);
  assert.equal((await student.get('/api/me')).status, 401);
});
