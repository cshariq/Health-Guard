/*
 * Lumen Classes — front end.
 *
 * Reading (classes, stream, classwork, to-do, calendar, grades) is the stock Lumen UI running
 * against this server's Brightspace-shaped API. Everything that writes — accounts, creating and
 * joining classes, authoring, hand-ins, quizzes, grading — lives here and plugs in via L.ext.
 */
(function () {
  const L = window.Lumen;
  const { h, icon } = L;
  const root = document.getElementById('app');
  let ctx = null;                 // the mounted app (store, api, render)
  const roles = new Map();        // classId → { role, joinCode }

  /* ---------------- server calls ---------------- */
  async function req(method, url, body, headers = {}) {
    const isFile = body instanceof Blob;
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { ...(method !== 'GET' ? { 'X-Lumen': '1' } : {}), ...(body && !isFile ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: isFile ? body : body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Something went wrong (${res.status}).`); e.status = res.status; throw e; }
    return data;
  }
  const get = (u) => req('GET', u);
  const post = (u, b) => req('POST', u, b || {});
  const upload = (classId, file) => req('POST', `/api/classes/${classId}/files`, file, { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' });

  async function loadRoles() {
    roles.clear();
    (await get('/api/classes')).forEach((c) => roles.set(String(c.id), c));
  }
  const isTeacher = (c) => roles.get(String(c.id))?.role === 'teacher';

  /** After any change: drop caches, reload the shared store, redraw. */
  async function refresh() {
    ctx.api.clearCache();
    await loadRoles();
    await ctx.store.load();
    ctx.render();
  }

  /* ---------------- small form toolkit ---------------- */
  const field = (label, control, hint) => h('label.form-field', h('span.form-label', label), control, hint ? h('span.form-hint', hint) : null);
  const input = (props = {}) => h('input.form-input', { type: 'text', ...props });
  const textarea = (props = {}) => h('textarea.form-input', { rows: 4, ...props });
  const toIso = (v) => (v ? new Date(v).toISOString() : null);
  const errorLine = () => h('div.form-error', { role: 'alert' });
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const fileChip = (f) => h('a.attach-chip', { href: `/files/${f.id}`, target: '_blank', rel: 'noopener' }, icon('attach_file'), `${f.name} (${fmtSize(f.size)})`);

  /** A dialog with a form. `submit` may throw; its message is shown and the dialog stays open. */
  function formDialog({ title, body, submitLabel = 'Save', submit }) {
    const err = errorLine();
    let busy = false;
    const close = L.dialog({
      title, body: h('div.form', body, err),
      actions: [{ label: 'Cancel' }, { label: submitLabel, primary: true, keepOpen: true, run: async () => {
        if (busy) return; busy = true; err.textContent = '';
        try { await submit(); close(); } catch (e) { err.textContent = e.message; } finally { busy = false; }
      } }],
    });
    setTimeout(() => root.querySelector('.dialog .form-input')?.focus(), 50);
    return close;
  }
  function confirmDialog(title, message, label, action) {
    L.dialog({ title, body: h('p', message), actions: [{ label: 'Cancel' }, { label, primary: true, run: async () => { try { await action(); } catch (e) { L.toast(e.message); } } }] });
  }
  function moduleSelect(modules) {
    return h('select.form-input', h('option', { value: '' }, 'No module (General)'), modules.map((m) => h('option', { value: String(m.id) }, m.title)));
  }
  const pageError = (e) => L.errorState(e, () => ctx.render());
  /** Load something for a view, showing a skeleton meanwhile. */
  function loading(promise, render) {
    const box = h('div', L.skeleton(3));
    promise.then((d) => box.replaceChildren(render(d))).catch((e) => box.replaceChildren(pageError(e)));
    return box;
  }
  const backLink = (c, tab, label) => h('a.text-btn.back', { href: `#/c/${c.id}/${tab}` }, icon('arrow_back'), label);

  /* =========================== accounts =========================== */
  async function showAuth() {
    root.className = 'lumen-app auth-page';
    L.applyScheme(root, 270, L.settings.get().mode);
    const cfg = await get('/api/config').catch(() => ({ signup: true }));
    let mode = 'login';
    const card = h('section.auth-card');
    const draw = () => {
      const name = input({ autocomplete: 'name', placeholder: 'Ada Lovelace' });
      const email = input({ type: 'email', autocomplete: 'email', placeholder: 'you@school.ca' });
      const pass = input({ type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
      const err = errorLine();
      const go = async (e) => {
        e.preventDefault(); err.textContent = '';
        try {
          await post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { name: name.value, email: email.value, password: pass.value });
          location.href = '/'; // a real navigation, so the native apps' login web view notices too
        } catch (ex) { err.textContent = ex.message; }
      };
      card.replaceChildren(
        h('h2.auth-title', mode === 'login' ? 'Sign in' : 'Create your account'),
        h('form.form', { onsubmit: go },
          mode === 'register' ? field('Your name', name) : null,
          field('Email', email),
          field('Password', pass, mode === 'register' ? 'At least 8 characters.' : null),
          err,
          h('button.filled-btn.wide', { type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account')),
        cfg.signup ? h('button.text-btn.wide', { type: 'button', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); } },
          mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in') : null);
    };
    draw();
    root.replaceChildren(h('div.auth',
      h('section.auth-hero',
        h('div.brand-lg', h('span.brand-mark', icon('school', { fill: true })), 'Lumen Classes'),
        h('h1.auth-headline', 'A calm home for your class.'),
        h('p.auth-lede', 'Teachers create a class and share a code. Students join, hand in work, take quizzes and see their grades — all in one organized place.'),
        h('ul.auth-points',
          h('li', icon('campaign'), 'Announcements and course materials'),
          h('li', icon('assignment'), 'Assignments with hand-ins and feedback'),
          h('li', icon('quiz'), 'Quizzes that mark themselves'),
          h('li', icon('grading'), 'A gradebook for teachers, grades for students'))),
      card));
  }

  /* =========================== home: create / join =========================== */
  function createClass() {
    const name = input({ placeholder: 'Biology 11' }), code = input({ placeholder: 'Block C (optional)' });
    formDialog({ title: 'Create a class', submitLabel: 'Create', body: [field('Class name', name), field('Section', code)], submit: async () => {
      const { id } = await post('/api/classes', { name: name.value, code: code.value });
      await refresh(); location.hash = `#/c/${id}/people`;
      L.toast('Class created. Share the class code with your students.');
    } });
  }
  function joinClass() {
    const code = input({ placeholder: 'abc-defg', autocapitalize: 'none', spellcheck: false });
    formDialog({ title: 'Join a class', submitLabel: 'Join', body: field('Class code', code, 'Ask your teacher for the class code.'), submit: async () => {
      const { id } = await post('/api/classes/join', { joinCode: code.value });
      await refresh(); location.hash = `#/c/${id}`;
    } });
  }

  /* =========================== stream =========================== */
  function composer(c) {
    const box = h('div.composer');
    const closed = () => box.replaceChildren(h('button.composer-open', { type: 'button', onclick: open }, h('span.post-avatar', icon('campaign', { fill: true })), 'Announce something to your class'));
    const open = () => {
      const title = input({ placeholder: 'Title' }), body = textarea({ placeholder: 'Share an update, a reminder, a link…' }), err = errorLine();
      box.replaceChildren(h('div.form', title, body, err, h('div.form-actions',
        h('button.text-btn', { type: 'button', onclick: closed }, 'Cancel'),
        h('button.filled-btn', { type: 'button', onclick: async () => {
          try { await post(`/api/classes/${c.id}/announcements`, { title: title.value, body: body.value }); await refresh(); } catch (e) { err.textContent = e.message; }
        } }, icon('send'), 'Post'))));
      title.focus();
    };
    closed();
    return box;
  }

  /* =========================== classwork authoring =========================== */
  async function classModules(c) { return (await get(`/api/classes/${c.id}`)).modules; }

  function addModule(c) {
    const title = input({ placeholder: 'Unit 1: Cells' }), desc = textarea({ rows: 2 });
    formDialog({ title: 'New module', submitLabel: 'Add', body: [field('Title', title), field('Description (optional)', desc)], submit: async () => {
      await post(`/api/classes/${c.id}/modules`, { title: title.value, description: desc.value }); await refresh();
    } });
  }
  async function addMaterial(c) {
    const modules = await classModules(c);
    const kind = h('select.form-input', h('option', { value: 'text' }, 'Note'), h('option', { value: 'link' }, 'Link'), h('option', { value: 'file' }, 'File'));
    const title = input(), mod = moduleSelect(modules);
    const body = textarea({ rows: 6 }), link = input({ type: 'url', placeholder: 'https://…' }), file = h('input.form-input', { type: 'file' });
    const extra = h('div');
    const draw = () => extra.replaceChildren(kind.value === 'text' ? field('Text', body) : kind.value === 'link' ? field('Link', link) : field('File', file, 'Up to 25 MB.'));
    kind.addEventListener('change', draw); draw();
    formDialog({ title: 'Add material', submitLabel: 'Add', body: [field('Type', kind), field('Title', title), extra, field('Module', mod)], submit: async () => {
      const payload = { kind: kind.value, title: title.value, moduleId: mod.value, body: body.value, url: link.value };
      if (kind.value === 'file') { if (!file.files[0]) throw new Error('Choose a file.'); payload.fileId = (await upload(c.id, file.files[0])).id; }
      await post(`/api/classes/${c.id}/topics`, payload); await refresh();
    } });
  }
  async function addAssignment(c) {
    const modules = await classModules(c);
    const title = input(), instr = textarea({ rows: 5 }), due = input({ type: 'datetime-local' }), points = input({ type: 'number', min: '1', value: '100' }), mod = moduleSelect(modules);
    formDialog({ title: 'New assignment', submitLabel: 'Assign', body: [field('Title', title), field('Instructions', instr), h('div.form-row', field('Due', due), field('Points', points)), field('Module', mod)], submit: async () => {
      await post(`/api/classes/${c.id}/assignments`, { title: title.value, instructions: instr.value, due: toIso(due.value), points: Number(points.value), moduleId: mod.value }); await refresh();
    } });
  }
  async function addQuiz(c) {
    const modules = await classModules(c);
    const title = input(), due = input({ type: 'datetime-local' }), mod = moduleSelect(modules);
    const list = h('div.quiz-builder'); const blocks = [];
    const addQuestion = () => {
      const n = blocks.length;
      const prompt = input({ placeholder: 'Question' }), points = input({ type: 'number', min: '1', value: '1', class: 'narrow' });
      const choices = [0, 1, 2, 3].map((i) => ({ radio: h('input', { type: 'radio', name: `correct-${n}`, checked: i === 0, title: 'Correct answer' }), text: input({ placeholder: i < 2 ? `Choice ${i + 1}` : `Choice ${i + 1} (optional)` }) }));
      blocks.push({ prompt, points, choices });
      list.append(h('div.quiz-q', h('div.form-row', field(`Question ${n + 1}`, prompt), field('Points', points)),
        h('div.quiz-choices', choices.map((ch) => h('div.quiz-choice', ch.radio, ch.text))), h('span.form-hint', 'Select the circle next to the correct answer.')));
    };
    addQuestion();
    formDialog({ title: 'New quiz', submitLabel: 'Assign', body: [field('Title', title), h('div.form-row', field('Due', due), field('Module', mod)), list,
      h('button.tonal-btn', { type: 'button', onclick: addQuestion }, icon('add'), 'Add question')], submit: async () => {
      const questions = blocks.map((b, i) => {
        const filled = b.choices.filter((ch) => ch.text.value.trim());
        const answer = filled.findIndex((ch) => ch.radio.checked);
        if (answer < 0) throw new Error(`Question ${i + 1}: the correct answer is blank.`);
        return { prompt: b.prompt.value, choices: filled.map((ch) => ch.text.value), answer, points: Number(b.points.value) };
      });
      await post(`/api/classes/${c.id}/quizzes`, { title: title.value, due: toIso(due.value), moduleId: mod.value, questions }); await refresh();
    } });
  }
  async function manageContent(c) {
    const toc = await ctx.api.toc(c.id);
    const row = (label, sub, del) => h('div.manage-row', h('div', h('div.manage-title', label), h('div.form-hint', sub)), L.iconButton('delete', 'Delete', del));
    const closeAnd = (fn) => async () => { try { await fn(); close(); await refresh(); } catch (e) { L.toast(e.message); } };
    const body = h('div.manage', toc.length ? toc.map((m) => [
      m.id ? row(m.title, 'Module — deleting it keeps its items under General', closeAnd(() => req('DELETE', `/api/classes/${c.id}/modules/${m.id}`))) : h('div.manage-title', 'General'),
      m.topics.map((t) => h('div.manage-indent', row(t.title, L.TYPE_META[t.type]?.label || 'Material', closeAnd(() => req('DELETE', `/api/classes/${c.id}/topics/${t.id}`))))),
    ]) : h('p', 'Nothing to manage yet.'));
    const close = L.dialog({ title: 'Manage classwork', body, actions: [{ label: 'Done', primary: true }] });
  }

  /* =========================== work list (both roles) =========================== */
  function workView(c) {
    const teacher = isTeacher(c);
    return loading(get(`/api/classes/${c.id}/work`), (d) => h('div.work',
      teacher ? h('div.toolbar', h('button.filled-btn', { type: 'button', onclick: () => addAssignment(c) }, icon('add'), 'Assignment'), h('button.tonal-btn', { type: 'button', onclick: () => addQuiz(c) }, icon('add'), 'Quiz')) : null,
      !d.items.length ? L.empty('assignment', 'No assignments or quizzes yet', teacher ? 'Create one and it appears here and in Classwork.' : 'Anything your teacher assigns will be listed here.')
        : h('div.list-card', d.items.map((i) => {
          const past = i.due && new Date(i.due) < new Date();
          const state = teacher ? h('span.work-due', `${i.handedIn} of ${d.students} handed in${i.type === 'assignment' ? ` · ${i.graded} graded` : ''}`)
            : i.score != null ? h('span.chip-status.done', icon('check_circle', { fill: true }), `${fmt(i.score)}/${fmt(i.points)}`)
              : i.done ? h('span.chip-status.done', 'Handed in')
                : past ? h('span.chip-status.missing', L.dueLabel(i.due, 'Was due')) : h('span.work-due', L.dueLabel(i.due));
          return h('a.work-row', { href: `#/c/${c.id}/${i.type}/${i.id}` },
            h('span.work-icon', icon(i.type === 'quiz' ? 'quiz' : 'assignment')),
            h('span.work-main', h('span.work-title', i.title), h('span.work-sub', `${i.type === 'quiz' ? 'Quiz' : 'Assignment'} · ${fmt(i.points)} points${teacher && i.due ? ` · ${L.dueLabel(i.due)}` : ''}`)),
            state);
        }))));
  }
  const fmt = (n) => (Number.isInteger(+n) ? String(+n) : (+n).toFixed(1));

  /* =========================== assignment =========================== */
  function assignmentView(c, id) {
    return loading(get(`/api/classes/${c.id}/assignments/${id}`), (a) => h('div.detail',
      backLink(c, 'work', 'All work'),
      h('article.post',
        h('header.post-head', h('span.post-avatar', icon('assignment', { fill: true })),
          h('div', h('div.detail-title', a.title), h('div.post-date', `${fmt(a.points)} points · ${a.due ? L.dueLabel(a.due) : 'No due date'}`)),
          a.role === 'teacher' ? L.iconButton('delete', 'Delete assignment', () => confirmDialog('Delete this assignment?', 'Every hand-in and grade for it is deleted too.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/assignments/${id}`); await refresh(); location.hash = `#/c/${c.id}/work`; })) : null),
        a.html ? h('div.prose', { html: L.sanitize(a.html) }) : h('p.muted', 'No instructions.')),
      a.role === 'teacher' ? gradingTable(c, a) : handIn(c, a)));
  }

  function handIn(c, a) {
    const s = a.submission;
    if (s && s.grade != null) {
      return h('section.side-card.result',
        h('div.side-title', 'Your grade'),
        h('div.grade-big', `${fmt(s.grade)} / ${fmt(a.points)}`),
        s.feedback ? h('div.grade-comment', s.feedback) : null,
        h('div.form-hint', `Handed in ${L.fmtDay(s.submitted)}${s.late ? ' (late)' : ''}`),
        s.text ? h('div.prose.answer', s.text) : null, s.file ? fileChip(s.file) : null);
    }
    const text = textarea({ rows: 8, placeholder: 'Type your answer here…' }); text.value = s ? s.text : '';
    const file = h('input.form-input', { type: 'file' }), err = errorLine();
    return h('section.side-card',
      h('div.side-title', 'Your work'),
      s ? h('div.notice', icon('check_circle', { fill: true }), `Handed in ${L.fmtDay(s.submitted)}, ${L.fmtTime(s.submitted)}${s.late ? ' (late)' : ''}. You can change it until it’s graded.`) : null,
      h('div.form', field('Answer', text), field('Attach a file (optional)', file, s && s.file ? `Currently attached: ${s.file.name}. Choosing a new file replaces it.` : 'Up to 25 MB.'), err,
        h('div.form-actions', h('button.filled-btn', { type: 'button', onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true; err.textContent = '';
          try {
            const fileId = file.files[0] ? (await upload(c.id, file.files[0])).id : s && s.file ? s.file.id : null;
            await post(`/api/classes/${c.id}/assignments/${a.id}/submit`, { text: text.value, fileId });
            L.toast('Handed in.'); await refresh();
          } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
        } }, icon('send'), s ? 'Hand in again' : 'Hand in'))));
  }

  function gradingTable(c, a) {
    if (!a.students.length) return L.empty('groups', 'No students yet', 'Share the class code from the People tab.');
    const handed = a.students.filter((s) => s.submitted && (s.text || s.file)).length;
    return h('section',
      h('h3.group-title', icon('groups'), 'Student work', h('span.count', `${handed} of ${a.students.length} handed in`)),
      h('div.list-card', a.students.map((s) => {
        const has = s.submitted && (s.text || s.file);
        const grade = input({ type: 'number', min: '0', max: String(a.points), step: 'any', class: 'narrow', 'aria-label': `Grade for ${s.name}` }); grade.value = s.grade ?? '';
        const feedback = input({ placeholder: 'Feedback (optional)', 'aria-label': `Feedback for ${s.name}` }); feedback.value = s.feedback || '';
        const saved = h('span.form-hint');
        return h('div.grade-entry',
          h('div.grade-entry-head',
            h('span.row-avatar', s.name[0]),
            h('div.row-main', h('span.row-title', s.name), h('span.row-sub', has ? `Handed in ${L.fmtDay(s.submitted)}${s.late ? ' · late' : ''}` : 'Not handed in'))),
          has ? h('div.answer-box', s.text ? h('div.prose.answer', s.text) : null, s.file ? fileChip(s.file) : null) : null,
          h('div.grade-entry-form', grade, h('span.muted', `/ ${fmt(a.points)}`), feedback,
            h('button.tonal-btn', { type: 'button', onclick: async () => {
              try { await post(`/api/classes/${c.id}/assignments/${a.id}/grade`, { studentId: s.id, grade: grade.value === '' ? null : Number(grade.value), feedback: feedback.value }); saved.textContent = 'Saved'; ctx.api.clearCache(); }
              catch (e) { saved.textContent = e.message; }
            } }, 'Save'), saved));
      })));
  }

  /* =========================== quiz =========================== */
  function quizView(c, id) {
    return loading(get(`/api/classes/${c.id}/quizzes/${id}`), (q) => {
      const head = h('article.post',
        h('header.post-head', h('span.post-avatar', icon('quiz', { fill: true })),
          h('div', h('div.detail-title', q.title), h('div.post-date', `${q.questions.length} question${q.questions.length === 1 ? '' : 's'} · ${fmt(q.points)} points · ${q.due ? L.dueLabel(q.due) : 'No due date'}`)),
          q.role === 'teacher' ? L.iconButton('delete', 'Delete quiz', () => confirmDialog('Delete this quiz?', 'Every attempt and score for it is deleted too.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/quizzes/${id}`); await refresh(); location.hash = `#/c/${c.id}/work`; })) : null));
      const review = (answers) => h('div.quiz-list', q.questions.map((qu, i) => h('div.quiz-card',
        h('div.quiz-prompt', `${i + 1}. ${qu.prompt}`, h('span.form-hint', ` ${fmt(qu.points)} pt`)),
        qu.choices.map((ch, k) => h(`div.quiz-option${k === qu.answer ? '.correct' : answers && answers[i] === k ? '.wrong' : ''}`,
          icon(k === qu.answer ? 'check_circle' : answers && answers[i] === k ? 'close' : 'radio_button_unchecked'), ch,
          answers && answers[i] === k ? h('span.form-hint', ' — your answer') : null)))));

      if (q.role === 'teacher') {
        const done = q.students.filter((s) => s.submitted);
        return h('div.detail', backLink(c, 'work', 'All work'), head,
          h('h3.group-title', icon('groups'), 'Results', h('span.count', `${done.length} of ${q.students.length} taken`)),
          q.students.length ? h('div.list-card', q.students.map((s) => h('div.list-row', h('span.row-avatar', s.name[0]),
            h('div.row-main', h('span.row-title', s.name), h('span.row-sub', s.submitted ? `Taken ${L.fmtDay(s.submitted)}` : 'Not taken')),
            h('span.score', s.submitted ? `${fmt(s.score)} / ${fmt(q.points)}` : '—')))) : L.empty('groups', 'No students yet'),
          h('h3.group-title', icon('quiz'), 'Answer key'), review(null));
      }
      if (q.attempt) {
        return h('div.detail', backLink(c, 'work', 'All work'), head,
          h('section.side-card.result', h('div.side-title', 'Your score'), h('div.grade-big', `${fmt(q.attempt.score)} / ${fmt(q.points)}`), h('div.form-hint', `Taken ${L.fmtDay(q.attempt.submitted)}`)),
          review(q.attempt.answers));
      }
      const err = errorLine();
      const form = h('form.quiz-list', q.questions.map((qu, i) => h('fieldset.quiz-card',
        h('legend.quiz-prompt', `${i + 1}. ${qu.prompt}`, h('span.form-hint', ` ${fmt(qu.points)} pt`)),
        qu.choices.map((ch, k) => h('label.quiz-option.pick', h('input', { type: 'radio', name: `q${i}`, value: String(k) }), ch)))));
      return h('div.detail', backLink(c, 'work', 'All work'), head, form, err,
        h('div.form-actions', h('span.form-hint', 'You get one attempt.'), h('button.filled-btn', { type: 'button', onclick: async () => {
          const answers = q.questions.map((_, i) => { const p = form.querySelector(`input[name="q${i}"]:checked`); return p ? Number(p.value) : null; });
          const blank = answers.findIndex((x) => x === null);
          if (blank >= 0) { err.textContent = `Answer question ${blank + 1} before handing in.`; return; }
          try { const r = await post(`/api/classes/${c.id}/quizzes/${id}/attempt`, { answers }); L.toast(`You scored ${fmt(r.score)} out of ${fmt(r.points)}.`); await refresh(); }
          catch (e) { err.textContent = e.message; }
        } }, icon('send'), 'Hand in quiz')));
    });
  }

  /* =========================== note / material page =========================== */
  function topicView(c, id) {
    return loading(get(`/api/classes/${c.id}/topics/${id}`), (t) => h('div.detail',
      backLink(c, 'classwork', 'Classwork'),
      h('article.post', h('header.post-head', h('span.post-avatar', icon('article', { fill: true })), h('div', h('div.detail-title', t.title), h('div.post-date', `Posted ${L.fmtDay(t.created)}`))),
        t.html ? h('div.prose', { html: L.sanitize(t.html) }) : null,
        t.file ? fileChip(t.file) : null,
        t.url ? h('a.attach-chip', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), t.url) : null)));
  }

  /* =========================== gradebook (teacher) =========================== */
  function gradebookView(c) {
    return loading(get(`/api/classes/${c.id}/gradebook`), (g) => {
      if (!g.items.length) return L.empty('grading', 'Nothing to grade yet', 'Assignments and quizzes you create show up as columns here.');
      if (!g.students.length) return L.empty('groups', 'No students yet', 'Share the class code from the People tab.');
      return h('div.gradebook-wrap', h('table.gradebook',
        h('thead', h('tr', h('th.sticky', 'Student'), g.items.map((i) => h('th', h('a', { href: `#/c/${c.id}/${i.type}/${i.id}` }, i.title), h('div.form-hint', `${fmt(i.points)} pts`))), h('th', 'Overall'))),
        h('tbody', g.students.map((s) => h('tr', h('th.sticky', s.name),
          s.cells.map((cell) => h(`td${cell.score != null ? '' : cell.done ? '.pending' : '.none'}`, cell.score != null ? fmt(cell.score) : cell.done ? 'To grade' : '—')),
          h('td.overall', s.percent == null ? '—' : `${s.percent.toFixed(1)}%`))))));
    });
  }

  /* =========================== people =========================== */
  function peopleView(c) {
    return loading(get(`/api/classes/${c.id}`), (d) => {
      const teacher = d.role === 'teacher';
      const row = (p) => h('div.list-row', h('span.row-avatar', p.name[0]), h('div.row-main', h('span.row-title', p.name), p.email ? h('span.row-sub', p.email) : null),
        teacher && p.role === 'student' ? L.iconButton('close', `Remove ${p.name}`, () => confirmDialog(`Remove ${p.name}?`, 'They lose access to the class. Their past work is kept in case they rejoin.', 'Remove', async () => { await req('DELETE', `/api/classes/${c.id}/members/${p.id}`); ctx.render(); })) : null);
      const students = d.people.filter((p) => p.role === 'student');
      return h('div.people',
        teacher ? h('section.code-card',
          h('div', h('div.side-title', 'Class code'), h('div.form-hint', 'Students enter this under “Join class”.')),
          h('div.code-value', d.joinCode),
          h('button.tonal-btn', { type: 'button', onclick: () => navigator.clipboard?.writeText(d.joinCode).then(() => L.toast('Class code copied.')) }, icon('content_copy'), 'Copy')) : null,
        h('h3.group-title', icon('school'), 'Teacher'),
        h('div.list-card', d.people.filter((p) => p.role === 'teacher').map(row)),
        h('h3.group-title', icon('groups'), 'Students', h('span.count', students.length)),
        students.length ? h('div.list-card', students.map(row)) : h('p.muted', teacher ? 'No students yet. Share the class code above.' : 'No classmates yet.'),
        h('div.form-actions.start',
          teacher ? h('button.text-btn', { type: 'button', onclick: () => confirmDialog('Archive this class?', 'It moves to “Past & hidden classes” for everyone and no one new can join. Nothing is deleted.', 'Archive', async () => { await req('PATCH', `/api/classes/${c.id}`, { archived: true }); await refresh(); location.hash = '#/'; }) }, icon('archive'), 'Archive class')
            : h('button.text-btn', { type: 'button', onclick: () => confirmDialog('Leave this class?', 'You can rejoin later with the class code.', 'Leave', async () => { await post(`/api/classes/${c.id}/leave`); await refresh(); location.hash = '#/'; }) }, icon('logout'), 'Leave class')));
    });
  }

  /* =========================== plug into the Lumen UI =========================== */
  L.ext = {
    routes: ['assignment', 'quiz', 'topic'],
    extraTabs: () => [['people', 'People']],
    homeChips: () => [
      h('button.assist-chip', { type: 'button', onclick: joinClass }, icon('add'), 'Join class'),
      h('button.assist-chip', { type: 'button', onclick: createClass }, icon('school'), 'Create class')],
    homeEmpty: (c, filter) => (filter === 'current' && !(c.store.courses || []).length ? h('div.empty',
      icon('school', { size: 56 }), h('div.empty-title', 'Welcome to Lumen Classes'),
      h('div.empty-sub', 'Join a class with the code from your teacher, or create your own class and invite students.'),
      h('div.form-actions.center', h('button.filled-btn', { type: 'button', onclick: joinClass }, icon('add'), 'Join a class'), h('button.tonal-btn', { type: 'button', onclick: createClass }, icon('school'), 'Create a class'))) : null),
    bannerChips: (c2, c) => [
      isTeacher(c) ? h('button.banner-chip', { type: 'button', title: 'Copy class code', onclick: () => navigator.clipboard?.writeText(roles.get(String(c.id)).joinCode).then(() => L.toast('Class code copied.')) }, icon('content_copy'), `Class code: ${roles.get(String(c.id)).joinCode}`) : null,
      h('span.banner-chip', icon(isTeacher(c) ? 'school' : 'person'), isTeacher(c) ? 'You teach this class' : 'Student')],
    streamTop: (c2, c) => (isTeacher(c) ? composer(c) : null),
    postActions: (c2, c, n) => (isTeacher(c) ? L.iconButton('delete', 'Delete announcement', () => confirmDialog('Delete this announcement?', 'Students will no longer see it.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/announcements/${n.id}`); await refresh(); }), { class: 'post-delete' }) : null),
    classworkTop: (c2, c) => (isTeacher(c) ? h('div.toolbar.author',
      h('button.filled-btn', { type: 'button', onclick: () => addMaterial(c) }, icon('add'), 'Material'),
      h('button.tonal-btn', { type: 'button', onclick: () => addAssignment(c) }, icon('assignment'), 'Assignment'),
      h('button.tonal-btn', { type: 'button', onclick: () => addQuiz(c) }, icon('quiz'), 'Quiz'),
      h('button.tonal-btn', { type: 'button', onclick: () => addModule(c) }, icon('folder'), 'Module'),
      h('button.text-btn', { type: 'button', onclick: () => manageContent(c) }, icon('tune'), 'Manage')) : null),
    courseTab(c2, c, tab, rest) {
      if (tab === 'people') return peopleView(c);
      if (tab === 'work') return workView(c);
      if (tab === 'assignment') return assignmentView(c, rest[0]);
      if (tab === 'quiz') return quizView(c, rest[0]);
      if (tab === 'topic') return topicView(c, rest[0]);
      if (tab === 'grades' && isTeacher(c)) return gradebookView(c);
      return null;
    },
  };

  /** The shared views build Brightspace-style links; turn those clicks into in-app navigation. */
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !ctx) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith('/d2l/')) return;
    e.preventDefault();
    let m;
    if ((m = u.pathname.match(/^\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)\/View$/))) {
      try {
        const t = await get(`/api/classes/${m[1]}/topics/${m[2]}`);
        if (t.kind === 'link') window.open(t.url, '_blank', 'noopener');
        else if (t.kind === 'file') window.open(`/files/${t.file.id}`, '_blank', 'noopener');
        else location.hash = t.kind === 'text' ? `#/c/${m[1]}/topic/${t.id}` : `#/c/${m[1]}/${t.kind}/${t.refId}`;
      } catch (ex) { L.toast(ex.message); }
    } else if (u.pathname.endsWith('folder_submit_files.d2l')) location.hash = `#/c/${u.searchParams.get('ou')}/assignment/${u.searchParams.get('db')}`;
    else if (u.pathname.endsWith('quiz_summary.d2l')) location.hash = `#/c/${u.searchParams.get('ou')}/quiz/${u.searchParams.get('qi')}`;
    else location.href = u.href; // let the server redirect anything else
  });

  /* =========================== boot =========================== */
  (async function boot() {
    if (location.hash === '#/logout') { await post('/api/auth/logout').catch(() => {}); location.replace('/'); return; }
    const me = await get('/api/me').catch(() => null);
    if (!me) return showAuth();
    if (location.hash === '#/login') history.replaceState(null, '', '/');
    await loadRoles();
    L.loginUrl = '/#/logout';
    root.className = '';
    ctx = L.mount(root, L.createApi({ imageBase: null }), {
      web: true, standalone: true, initialRoute: '#/',
      connectionNote: `Signed in as ${me.email}.`,
      disconnectLabel: 'Sign out', disconnectIcon: 'logout',
      onDisconnect: async () => { ctx.api.clearCache(); await post('/api/auth/logout').catch(() => {}); location.replace('/'); },
    });
    root.querySelector('.brand-name').textContent = 'Lumen Classes';
  })();
})();
