// Browser test for the fuller feature set. Run right after classes/e2e.cjs on the same server
// (it continues with the class and accounts that test created).
//   node classes/e2e-features.cjs [baseUrl] [screenshotDir]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.argv[2] || 'http://localhost:8200';
const SHOTS = process.argv[3] || null;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const signIn = async (email, password) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/40[0-9]|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE); await page.waitForSelector('.auth-card');
    await page.fill('input[type=email]', email); await page.fill('input[type=password]', password); await page.click('button[type=submit]');
    await page.waitForSelector('.course-card');
    return page;
  };
  const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
  const fill = (page, label, value) => page.locator(`.dialog .form-field:has(.form-label:text-is("${label}")) .form-input`).last().fill(value);
  const dialogSubmit = async (page, label) => {
    await page.locator(`.dialog-actions button:text-is("${label}")`).click();
    await page.waitForSelector('.dialog', { state: 'detached', timeout: 8000 }).catch(async () => { throw new Error(`dialog "${label}" stayed open: ${await page.locator('.dialog .form-error').textContent()}`); });
  };
  const step = (s) => console.log('  ✓', s);
  const go = async (page, hash, sel) => { await page.goto(`${BASE}/${hash}`); await page.waitForSelector(sel); };

  const t = await signIn('tess@example.com', 'correct horse');
  const s = await signIn('sam@example.com', 'battery staple');

  /* ---- edit an announcement ---- */
  await go(t, '#/c/1', '.post');
  await t.click('.post button[title="Edit announcement"]');
  await fill(t, 'Title', 'Welcome to Biology 11 (updated)'); await dialogSubmit(t, 'Save');
  await t.waitForSelector('.post-title:has-text("(updated)")');
  step('announcement edited');

  /* ---- assignment with a rubric ---- */
  await go(t, '#/c/1/work', '.work-row');
  await t.click('.toolbar button:has-text("Assignment")');
  await fill(t, 'Title', 'Ecosystem poster'); await fill(t, 'Instructions', 'Make a poster about a local ecosystem.');
  await t.locator('.dialog .switch-row:has-text("rubric") input').check();
  await t.locator('.rubric-row >> nth=0 >> input[type=text]').fill('Research'); await t.locator('.rubric-row >> nth=0 >> input[type=number]').fill('10');
  await t.locator('.rubric-row >> nth=1 >> input[type=text]').fill('Design'); await t.locator('.rubric-row >> nth=1 >> input[type=number]').fill('5');
  assert.ok((await t.locator('.rubric-box .form-hint').last().textContent()).includes('15 points'));
  await shot(t, '11-rubric-builder');
  await dialogSubmit(t, 'Assign');
  await t.waitForSelector('.work-row:has-text("Ecosystem poster")');
  assert.ok((await t.locator('.work-row:has-text("Ecosystem poster")').textContent()).includes('15 points'));
  step('rubric assignment created, worth the rubric total (15)');

  /* ---- timed quiz with three question types and two attempts ---- */
  await t.click('.toolbar button:has-text("Quiz")');
  await fill(t, 'Title', 'Mixed quiz'); await fill(t, 'Time limit (minutes)', '5'); await fill(t, 'Attempts allowed', '2');
  const q = (n) => t.locator(`.quiz-q >> nth=${n}`);
  await q(0).locator('select').selectOption('short');
  await q(0).locator('input[placeholder="Question"]').fill('What is the capital of Canada?');
  await q(0).locator('input[placeholder^="Accepted"]').fill('Ottawa');
  await t.click('.dialog button:has-text("Add question")');
  await q(1).locator('select').selectOption('multi');
  await q(1).locator('input[placeholder="Question"]').fill('Which are prime?');
  for (const [i, v] of ['2', '3', '4'].entries()) await q(1).locator('.quiz-choice').nth(i).locator('input[type=text]').fill(v);
  await q(1).locator('.quiz-choice').nth(1).locator('input[type=checkbox]').check(); // 2 is ticked by default; add 3
  await t.click('.dialog button:has-text("Add question")');
  await q(2).locator('select').selectOption('paragraph');
  await q(2).locator('input[placeholder="Question"]').fill('Explain photosynthesis in two sentences.');
  await q(2).locator('input[type=number]').fill('3');
  await shot(t, '12-quiz-builder-types');
  await dialogSubmit(t, 'Assign');
  await t.waitForSelector('.work-row:has-text("Mixed quiz")');
  step('timed quiz created: short answer, checkboxes, written answer');

  /* ---- discussion ---- */
  await t.click('.tabs >> text=Discussions');
  await t.click('button:has-text("Start a discussion")');
  await fill(t, 'Title', 'Questions about the poster'); await fill(t, 'Message', 'Ask anything about the ecosystem poster here.');
  await t.locator('.dialog-actions button:text-is("Post")').click();
  await t.waitForSelector('.detail-title:has-text("Questions about the poster")');
  step('discussion started');

  /* ---- student: hand in the poster ---- */
  await go(s, '#/c/1/work', '.work-row:has-text("Ecosystem poster")');
  await s.click('.work-row:has-text("Ecosystem poster")');
  await s.waitForSelector('table.rubric');
  assert.equal(await s.locator('table.rubric tbody tr').count(), 2, 'student sees the rubric before handing in');
  await s.fill('.side-card textarea', 'My poster is about the Ottawa River wetlands.');
  await s.click('button:has-text("Hand in")'); await s.waitForSelector('.notice:has-text("Handed in")');

  /* ---- student: take the timed quiz ---- */
  await go(s, '#/c/1/work', '.work-row:has-text("Mixed quiz")');
  await s.click('.work-row:has-text("Mixed quiz")');
  await s.waitForSelector('button:has-text("Start quiz")');
  assert.ok((await s.locator('.side-card').last().textContent()).includes('5 minutes'));
  await s.click('button:has-text("Start quiz")');
  await s.waitForSelector('.quiz-clock');
  assert.match((await s.locator('.quiz-clock').textContent()).trim(), /^[45]:\d\d left$/);
  await s.fill('.quiz-card >> nth=0 >> input', '  ottawa ');
  await s.locator('.quiz-card >> nth=1 >> label:has-text("2")').click();
  await s.locator('.quiz-card >> nth=1 >> label:has-text("3")').click();
  await s.fill('.quiz-card >> nth=2 >> textarea', 'Plants use light to turn water and carbon dioxide into sugar. Oxygen is released.');
  await s.waitForSelector('.form-actions .form-hint:has-text("Saved")');
  await shot(s, '13-timed-quiz');
  await s.reload(); await s.waitForSelector('.quiz-clock');
  assert.equal(await s.inputValue('.quiz-card >> nth=0 >> input'), 'ottawa', 'answers survive a reload mid-quiz');
  await s.click('button:has-text("Hand in quiz")');
  await s.waitForSelector('.grade-big:has-text("Being marked")');
  assert.equal(await s.locator('.quiz-option.correct').count(), 0, 'no answer key while an attempt remains');
  assert.equal(await s.locator('button:has-text("Start another attempt")').count(), 1);
  step('student took the timed quiz (autosaved, survived reload); written answer awaits marking');

  /* ---- student: reply in the discussion ---- */
  await s.click('.tabs >> text=Discussions');
  await s.click('.work-row:has-text("Questions about the poster")');
  await s.fill('textarea[aria-label="Reply"]', 'Can we work in pairs?');
  await s.click('button:has-text("Reply")');
  await s.waitForSelector('.reply:has-text("Can we work in pairs?")');
  step('student replied in the discussion');

  /* ---- teacher: grade with the rubric ---- */
  await go(t, '#/c/1/work', '.work-row:has-text("Ecosystem poster")');
  await t.click('.work-row:has-text("Ecosystem poster")');
  await t.waitForSelector('.rubric-grade');
  await t.locator('.rubric-grade input >> nth=0').fill('9'); await t.locator('.rubric-grade input >> nth=1').fill('4');
  assert.equal((await t.locator('.rubric-grade .score').textContent()).trim(), '13 / 15');
  await t.fill('.grade-entry input[placeholder^="Feedback"]', 'Lovely layout.');
  await shot(t, '14-rubric-grading');
  await t.click('.grade-entry button:has-text("Save")');
  await t.waitForSelector('.grade-entry .form-hint:has-text("Saved")');
  step('teacher graded with the rubric: 13 / 15');

  /* ---- teacher: mark the written answer ---- */
  await go(t, '#/c/1/work', '.work-row:has-text("Mixed quiz")');
  assert.ok((await t.locator('.work-row:has-text("Mixed quiz")').textContent()).includes('1 to mark'));
  await t.click('.work-row:has-text("Mixed quiz")');
  await t.waitForSelector('.marking');
  assert.ok((await t.locator('.marking .answer-box').textContent()).includes('Oxygen is released'));
  await t.fill('.marking input[type=number]', '2');
  await t.click('.marking button:has-text("Save")');
  await t.waitForSelector('.marking .form-hint:has-text("attempt total 4 / 5")');
  step('teacher marked the written answer; attempt total 4 / 5');

  /* ---- teacher: reply shows a Teacher badge; co-teacher round trip ---- */
  await go(t, '#/c/1/people', '.code-value');
  await t.click('button[title="Make Sam Student a co-teacher"]');
  await t.locator('.dialog-actions button:text-is("Make co-teacher")').click();
  await t.waitForSelector('.group-title:has-text("Teachers")');
  await s.reload(); await go(s, '#/c/1', '.composer');
  step('student promoted to co-teacher and gets the composer');
  await t.click('button[title="Make Sam Student a student"]');
  await t.locator('.dialog-actions button:text-is("Make student")').click();
  await t.waitForSelector('button[title="Make Sam Student a co-teacher"]');

  /* ---- gradebook export ---- */
  await t.click('.tabs >> text=Grades');
  await t.waitForSelector('a:has-text("Export CSV")');
  const csv = await t.evaluate(() => fetch('/api/classes/1/gradebook.csv').then((r) => r.text()));
  assert.ok(csv.includes('"Sam Student"') && csv.includes('"Ecosystem poster (15)"') && csv.includes('"13"'), csv);
  step('gradebook exports to CSV');

  /* ---- admin console (the first account is the administrator) ---- */
  await t.click('.nav-item[title="Admin"]');
  await t.waitForSelector('.stats');
  assert.equal((await t.locator('.stat-n').first().textContent()).trim(), '2');
  await shot(t, '15-admin');
  await t.click('.tabs >> text=People');
  await t.waitForSelector('.admin-row');
  assert.equal(await t.locator('.admin-row').count(), 2);
  await t.locator('.admin-row:has-text("Sam Student") button:has-text("Reset link")').click();
  await t.waitForSelector('.reset-link');
  assert.match(await t.locator('.reset-link').textContent(), /#\/reset\/[\w-]+$/);
  await t.locator('.dialog-actions button:text-is("Close")').click();
  assert.equal(await s.locator('.nav-item[title="Admin"]').count(), 0, 'students have no Admin entry');
  assert.equal(await s.evaluate(() => fetch('/api/admin/overview').then((r) => r.status)), 403);
  step('admin console: stats, people, reset link; hidden from students');

  /* ---- student: sees rubric scores, quiz result, can retake ---- */
  await go(s, '#/c/1/work', '.work-row:has-text("Ecosystem poster")');
  await s.click('.work-row:has-text("Ecosystem poster")');
  await s.waitForSelector('.grade-big');
  assert.equal((await s.locator('.grade-big').textContent()).trim(), '13 / 15');
  assert.deepEqual(await s.locator('table.rubric td.num').allTextContents(), ['9 / 10', '4 / 5']);
  await go(s, '#/c/1/work', '.work-row:has-text("Mixed quiz")');
  await s.click('.work-row:has-text("Mixed quiz")');
  await s.waitForSelector('.grade-big:has-text("4 / 5")');
  step('student sees rubric breakdown (9/10, 4/5) and the marked quiz (4/5)');

  /* ---- account: change password, then the forgot-password screen ---- */
  await s.click('.avatar-btn'); await s.click('text=Change password');
  await fill(s, 'Current password', 'battery staple'); await fill(s, 'New password', 'new battery staple');
  await dialogSubmit(s, 'Change');
  await s.click('.avatar-btn'); await s.click('text=Sign out');
  await s.waitForSelector('.auth-card');
  await s.fill('input[type=email]', 'sam@example.com'); await s.fill('input[type=password]', 'battery staple'); await s.click('button[type=submit]');
  await s.waitForSelector('.form-error:has-text("Wrong email or password")');
  await s.click('text=Forgot your password?');
  await s.fill('input[type=email]', 'sam@example.com'); await s.click('button[type=submit]');
  await s.waitForSelector('.notice:has-text("administrator")');
  step('password changed; old one refused; forgot-password explains what to do without email');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS — new features, teacher + student');
  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
