// End-to-end browser test for Lumen Classes (needs Playwright).
//   node classes/server.mjs   (fresh LUMEN_DATA folder)   then   node classes/e2e.cjs [baseUrl] [screenshotDir]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.argv[2] || 'http://localhost:8200';
const SHOTS = process.argv[3] || null;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newUser = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/40[13]|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return page;
  };
  const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
  const fill = (page, label, value) => page.locator(`.form-field:has(.form-label:text-is("${label}")) .form-input`).last().fill(value);
  const dialogSubmit = (page, label) => page.locator(`.dialog-actions button:text-is("${label}")`).click();
  const step = (s) => console.log('  ✓', s);

  /* ---- teacher signs up and creates a class ---- */
  const t = await newUser();
  await t.goto(BASE);
  await t.waitForSelector('.auth-card');
  await shot(t, '01-sign-in');
  await t.click('text=New here? Create an account');
  await fill(t, 'Your name', 'Tess Teacher'); await fill(t, 'Email', 'tess@example.com'); await fill(t, 'Password', 'correct horse');
  await t.click('button[type=submit]');
  await t.waitForSelector('text=Welcome to Lumen Classes');
  step('teacher registered and sees the empty home');
  await t.click('.empty button:has-text("Create a class")');
  await fill(t, 'Class name', 'Biology 11'); await fill(t, 'Section', 'Block C');
  await dialogSubmit(t, 'Create');
  await t.waitForSelector('.code-value');
  const code = (await t.locator('.code-value').textContent()).trim();
  assert.match(code, /^[a-z0-9]{3}-[a-z0-9]{4}$/);
  step(`class created, join code ${code}`);
  await shot(t, '02-people-class-code');

  /* ---- teacher: announcement ---- */
  await t.click('.tabs >> text=Stream');
  await t.click('.composer-open');
  await t.fill('.composer input', 'Welcome to Biology 11');
  await t.fill('.composer textarea', 'We start with cells. Bring your lab notebook on Monday.\n\nCourse outline: https://example.com/outline');
  await t.click('.composer button:has-text("Post")');
  await t.waitForSelector('.post-title:has-text("Welcome to Biology 11")');
  assert.equal(await t.locator('.post .prose a[href="https://example.com/outline"]').count(), 1, 'link in announcement is clickable');
  step('announcement posted');

  /* ---- teacher: module, note, assignment, quiz ---- */
  await t.click('.tabs >> text=Classwork');
  await t.click('.author button:has-text("Module")');
  await fill(t, 'Title', 'Unit 1: Cells'); await dialogSubmit(t, 'Add');
  await t.waitForSelector('.module-title:has-text("Unit 1: Cells")');
  await t.click('.author button:has-text("Material")');
  await fill(t, 'Title', 'Lab safety rules'); await fill(t, 'Text', 'Goggles on. Hair tied back. No food in the lab.');
  await t.locator('.form-field:has(.form-label:text-is("Module")) select').selectOption({ label: 'Unit 1: Cells' });
  await dialogSubmit(t, 'Add');
  await t.waitForSelector('.dialog', { state: 'detached' });
  await t.click('.author button:has-text("Assignment")');
  await fill(t, 'Title', 'Label a plant cell'); await fill(t, 'Instructions', 'Draw a plant cell and label at least six parts.');
  const due = new Date(Date.now() + 2 * 864e5); due.setHours(23, 59, 0, 0);
  const local = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await fill(t, 'Due', local); await fill(t, 'Points', '20');
  await t.locator('.form-field:has(.form-label:text-is("Module")) select').selectOption({ label: 'Unit 1: Cells' });
  await dialogSubmit(t, 'Assign');
  await t.waitForSelector('.dialog', { state: 'detached' });
  await t.click('.author button:has-text("Quiz")');
  await fill(t, 'Title', 'Cells check-in'); await fill(t, 'Due', local);
  await t.locator('.form-field:has(.form-label:text-is("Module")) select').selectOption({ label: 'Unit 1: Cells' });
  await t.fill('.quiz-q >> nth=0 >> input[placeholder="Question"]', 'What is the powerhouse of the cell?');
  const choices = t.locator('.quiz-q >> nth=0 >> .quiz-choice');
  await choices.nth(0).locator('input[type=text]').fill('Nucleus');
  await choices.nth(1).locator('input[type=text]').fill('Mitochondria');
  await choices.nth(2).locator('input[type=text]').fill('Ribosome');
  await choices.nth(1).locator('input[type=radio]').check();
  await t.click('.dialog button:has-text("Add question")');
  await t.fill('.quiz-q >> nth=1 >> input[placeholder="Question"]', 'Plant cells have a cell wall.');
  const c2 = t.locator('.quiz-q >> nth=1 >> .quiz-choice');
  await c2.nth(0).locator('input[type=text]').fill('True'); await c2.nth(1).locator('input[type=text]').fill('False');
  await shot(t, '03-quiz-builder');
  await dialogSubmit(t, 'Assign');
  await t.waitForSelector('.dialog', { state: 'detached' });
  await t.waitForSelector('.topic-title:has-text("Cells check-in")');
  assert.deepEqual(await t.locator('.topic-title').allTextContents(), ['Lab safety rules', 'Label a plant cell', 'Cells check-in']);
  step('module, note, assignment and quiz created (shown in Classwork)');
  await shot(t, '04-classwork-teacher');

  /* ---- student joins ---- */
  const s = await newUser();
  await s.goto(BASE);
  await s.click('text=New here? Create an account');
  await fill(s, 'Your name', 'Sam Student'); await fill(s, 'Email', 'sam@example.com'); await fill(s, 'Password', 'battery staple');
  await s.click('button[type=submit]');
  await s.click('.empty button:has-text("Join a class")');
  await fill(s, 'Class code', code); await dialogSubmit(s, 'Join');
  await s.waitForSelector('.course-title:has-text("Biology 11")');
  await s.waitForSelector('.post-title:has-text("Welcome to Biology 11")');
  assert.equal(await s.locator('.composer').count(), 0, 'students get no announcement composer');
  assert.equal(await s.locator('.course-links:has-text("Class code")').count(), 0, 'students never see the class code');
  step('student joined with the code and sees the stream');

  /* ---- student home + to-do come from the shared Lumen UI ---- */
  await s.goto(BASE + '/#/'); await s.waitForSelector('.course-card');
  await s.waitForSelector('.due-card');
  assert.equal(await s.locator('.due-card').count(), 2, 'both items show under Due soon');
  await shot(s, '05-student-home');
  await s.goto(BASE + '/#/todo'); await s.waitForSelector('.work-row');
  assert.equal(await s.locator('.work-row').count(), 2);

  /* ---- student opens the assignment from Classwork and hands in ---- */
  await s.goto(BASE + `/#/c/1/classwork`);
  await s.click('.topic:has-text("Lab safety rules")');
  await s.waitForSelector('.detail-title:has-text("Lab safety rules")');
  assert.ok((await s.locator('.prose').textContent()).includes('Goggles on'));
  await s.goBack();
  await s.click('.topic:has-text("Label a plant cell")');
  await s.waitForSelector('.detail-title:has-text("Label a plant cell")');
  await s.fill('.side-card textarea', 'Cell wall, chloroplast, vacuole, nucleus, mitochondria, cytoplasm.');
  await s.setInputFiles('.side-card input[type=file]', { name: 'plant-cell.txt', mimeType: 'text/plain', buffer: Buffer.from('diagram') });
  await shot(s, '06-student-hand-in');
  await s.click('button:has-text("Hand in")');
  await s.waitForSelector('.notice:has-text("Handed in")');
  step('student handed in text + a file');

  /* ---- student takes the quiz ---- */
  await s.goto(BASE + '/#/c/1/work'); await s.waitForSelector('.work-row');
  await s.click('.work-row:has-text("Cells check-in")');
  await s.waitForSelector('.quiz-card');
  assert.equal(await s.locator('.quiz-option.correct').count(), 0, 'answer key hidden before the attempt');
  await s.click('button:has-text("Hand in quiz")');
  await s.waitForSelector('.form-error:has-text("Answer question 1")');
  await s.locator('.quiz-card >> nth=0 >> label:has-text("Mitochondria")').click();
  await s.locator('.quiz-card >> nth=1 >> label:has-text("False")').click();
  await s.click('button:has-text("Hand in quiz")');
  await s.waitForSelector('.grade-big');
  assert.equal((await s.locator('.grade-big').textContent()).trim(), '1 / 2');
  assert.equal(await s.locator('.quiz-option.wrong').count(), 1, 'the wrong answer is marked');
  step('quiz auto-graded 1/2 and reviewed');
  await shot(s, '07-student-quiz-result');

  /* ---- teacher grades the hand-in ---- */
  await t.goto(BASE + '/#/c/1/work'); await t.waitForSelector('.work-row');
  assert.ok((await t.locator('.work-row:has-text("Label a plant cell")').textContent()).includes('1 of 1 handed in'));
  await t.click('.work-row:has-text("Label a plant cell")');
  await t.waitForSelector('.grade-entry');
  assert.ok((await t.locator('.answer-box').textContent()).includes('chloroplast'));
  assert.ok((await t.locator('.answer-box .attach-chip').textContent()).includes('plant-cell.txt'));
  await t.fill('.grade-entry input[type=number]', '18');
  await t.fill('.grade-entry input[placeholder^="Feedback"]', 'Great labels — add the cell membrane next time.');
  await shot(t, '08-teacher-grading');
  await t.click('.grade-entry button:has-text("Save")');
  await t.waitForSelector('.grade-entry .form-hint:has-text("Saved")');
  step('teacher graded 18/20 with feedback');

  /* ---- gradebook ---- */
  await t.click('.tabs >> text=Grades');
  await t.waitForSelector('table.gradebook');
  const row = await t.locator('table.gradebook tbody tr').first().locator('th,td').allTextContents();
  assert.deepEqual(row, ['Sam Student', '18', '1', '86.4%']);
  step('gradebook shows 18, 1 and 86.4% overall');
  await shot(t, '09-gradebook');

  /* ---- student sees grade + feedback, in the item and in the shared Grades tab ---- */
  await s.goto(BASE + '/#/c/1/assignment/1');
  await s.waitForSelector('.grade-big');
  assert.equal((await s.locator('.grade-big').textContent()).trim(), '18 / 20');
  assert.ok((await s.locator('.result').textContent()).includes('cell membrane'));
  await s.reload(); await s.goto(BASE + '/#/c/1/grades');
  await s.waitForSelector('.grade-summary');
  assert.equal((await s.locator('.summary-value').textContent()).trim(), '86.4%');
  assert.equal(await s.locator('.grade-row').count(), 2);
  step('student sees 18/20, the feedback, and 86.4% in Grades');
  await shot(s, '10-student-grades');

  /* ---- student cannot reach teacher tools; sign out works ---- */
  assert.equal(await s.evaluate(() => fetch('/api/classes/1/gradebook').then((r) => r.status)), 403);
  await s.click('.avatar-btn'); await s.click('text=Sign out');
  await s.waitForSelector('.auth-card');
  step('student blocked from the gradebook; sign-out returns to the sign-in page');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS — full teacher/student flow');
  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
