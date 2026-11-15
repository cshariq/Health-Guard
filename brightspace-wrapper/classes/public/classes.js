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
  let me = null;                  // the signed-in account
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
    root.querySelector('.dialog .form-input')?.focus();   // right away (a delayed focus could steal fast typing)
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
    const resetToken = (location.hash.match(/^#\/reset\/([\w-]+)/) || [])[1];
    const ssoError = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
    let mode = resetToken ? 'reset' : 'login';
    let notice = ssoError || '';
    const card = h('section.auth-card');
    const draw = () => {
      const name = input({ autocomplete: 'name', placeholder: 'Ada Lovelace' });
      const email = input({ type: 'email', autocomplete: 'email', placeholder: 'you@school.ca' });
      const pass = input({ type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
      const err = errorLine(); err.textContent = notice; notice = '';
      const info = h('div.notice');
      const titles = { login: 'Sign in', register: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' };
      const go = async (e) => {
        e.preventDefault(); err.textContent = '';
        try {
          if (mode === 'forgot') {
            const r = await post('/api/auth/forgot', { email: email.value });
            info.replaceChildren(icon('mail'), r.emailConfigured ? 'If that email has an account, a reset link is on its way. It works for one hour.' : 'This server can’t send email. Ask your administrator for a reset link.');
            form.replaceWith(info); return;
          }
          if (mode === 'reset') {
            await post('/api/auth/reset', { token: resetToken, password: pass.value });
            history.replaceState(null, '', '/'); mode = 'login'; notice = 'Password changed. Sign in with your new password.'; draw(); return;
          }
          await post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { name: name.value, email: email.value, password: pass.value });
          location.href = '/'; // a real navigation, so the native apps' login web view notices too
        } catch (ex) { err.textContent = ex.message; }
      };
      const form = h('form.form', { onsubmit: go },
        mode === 'register' ? field('Your name', name) : null,
        mode !== 'reset' ? field('Email', email) : null,
        mode !== 'forgot' ? field(mode === 'reset' ? 'New password' : 'Password', pass, mode === 'login' ? null : 'At least 8 characters.') : null,
        err,
        h('button.filled-btn.wide', { type: 'submit' }, { login: 'Sign in', register: 'Create account', forgot: 'Email me a reset link', reset: 'Save new password' }[mode]));
      const swap = (to, label) => h('button.text-btn.wide', { type: 'button', onclick: () => { mode = to; draw(); } }, label);
      card.replaceChildren(
        h('h2.auth-title', titles[mode]),
        cfg.sso && (mode === 'login' || mode === 'register') ? h('a.tonal-btn.wide', { href: '/auth/sso/start' }, icon('school'), `Continue with ${cfg.sso}`) : null,
        cfg.sso && (mode === 'login' || mode === 'register') ? h('div.auth-or', 'or') : null,
        form,
        mode === 'login' ? swap('forgot', 'Forgot your password?') : null,
        mode === 'login' && cfg.signup ? swap('register', 'New here? Create an account') : null,
        mode !== 'login' ? swap('login', 'Back to sign in') : null);
    };
    draw();
    root.replaceChildren(h('div.auth',
      h('section.auth-hero',
        h('div.brand-lg', h('span.brand-mark', icon('school', { fill: true })), 'Lumen Classes'),
        h('h1.auth-headline', 'A calm home for your class.'),
        h('p.auth-lede', 'Teachers create a class and share a code. Students join, hand in work, take quizzes and see their grades — all in one organized place.'),
        h('ul.auth-points',
          h('li', icon('campaign'), 'Announcements, materials and discussions'),
          h('li', icon('assignment'), 'Assignments with rubrics, hand-ins and feedback'),
          h('li', icon('quiz'), 'Timed quizzes that mark themselves'),
          h('li', icon('grading'), 'A gradebook for teachers, grades for students'))),
      card));
  }

  function profileDialog() {
    const name = input(); name.value = me.name;
    const notify = h('input.switch', { type: 'checkbox', checked: me.notify });
    formDialog({ title: 'Profile and notifications', body: [field('Your name', name),
      h('label.switch-row', h('span', h('span.switch-label', 'Email me about my classes'), h('span.switch-sub', 'New announcements, new work, and grades.')), notify)], submit: async () => {
      await req('PATCH', '/api/me', { name: name.value, notify: notify.checked });
      me = await get('/api/me'); L.toast('Saved.'); await refresh();
    } });
  }
  function passwordDialog() {
    const cur = input({ type: 'password', autocomplete: 'current-password' }), next = input({ type: 'password', autocomplete: 'new-password' });
    formDialog({ title: 'Change password', submitLabel: 'Change', body: [field('Current password', cur), field('New password', next, 'At least 8 characters.')], submit: async () => {
      await post('/api/me/password', { current: cur.value, password: next.value }); L.toast('Password changed.');
    } });
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
  const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const pick = (select, value) => { select.value = value == null ? '' : String(value); return select; };

  function moduleDialog(c, existing) {
    const title = input({ placeholder: 'Unit 1: Cells' }), desc = textarea({ rows: 2 });
    if (existing) { title.value = existing.title; desc.value = existing.description || ''; }
    formDialog({ title: existing ? 'Edit module' : 'New module', submitLabel: existing ? 'Save' : 'Add', body: [field('Title', title), field('Description (optional)', desc)], submit: async () => {
      const body = { title: title.value, description: desc.value };
      if (existing) await req('PATCH', `/api/classes/${c.id}/modules/${existing.id}`, body); else await post(`/api/classes/${c.id}/modules`, body);
      await refresh();
    } });
  }
  async function materialDialog(c, existing) {
    const modules = await classModules(c);
    const kind = h('select.form-input', h('option', { value: 'text' }, 'Note'), h('option', { value: 'link' }, 'Link'), h('option', { value: 'file' }, 'File'));
    const title = input(), mod = moduleSelect(modules);
    const body = textarea({ rows: 6 }), link = input({ type: 'url', placeholder: 'https://…' }), file = h('input.form-input', { type: 'file' });
    if (existing) { kind.value = existing.kind; kind.disabled = true; title.value = existing.title; body.value = existing.body || ''; link.value = existing.url || ''; pick(mod, existing.moduleId); }
    const extra = h('div');
    const draw = () => extra.replaceChildren(kind.value === 'text' ? field('Text', body) : kind.value === 'link' ? field('Link', link)
      : existing ? h('p.form-hint', `File: ${existing.file.name}. To swap the file, delete this item and add a new one.`) : field('File', file, 'Up to 25 MB.'));
    kind.addEventListener('change', draw); draw();
    formDialog({ title: existing ? 'Edit material' : 'Add material', submitLabel: existing ? 'Save' : 'Add', body: [field('Type', kind), field('Title', title), extra, field('Module', mod)], submit: async () => {
      const payload = { kind: kind.value, title: title.value, moduleId: mod.value, body: body.value, url: link.value };
      if (existing) { await req('PATCH', `/api/classes/${c.id}/topics/${existing.id}`, payload); }
      else {
        if (kind.value === 'file') { if (!file.files[0]) throw new Error('Choose a file.'); payload.fileId = (await upload(c.id, file.files[0])).id; }
        await post(`/api/classes/${c.id}/topics`, payload);
      }
      await refresh();
    } });
  }

  async function assignmentDialog(c, existing) {
    const modules = await classModules(c);
    const title = input(), instr = textarea({ rows: 5 }), due = input({ type: 'datetime-local' }), points = input({ type: 'number', min: '1', value: '100' }), mod = moduleSelect(modules);
    const useRubric = h('input.switch', { type: 'checkbox' });
    const rows = h('div.rubric-rows'); const total = h('span.form-hint');
    const addRow = (r = {}) => {
      const t = input({ placeholder: 'What you’re marking, e.g. Research' }), p = input({ type: 'number', min: '1', class: 'narrow', placeholder: 'Pts' });
      t.value = r.title || ''; p.value = r.points || '';
      const row = h('div.rubric-row', t, p, L.iconButton('close', 'Remove row', () => { row.remove(); sum(); }));
      row.read = () => ({ title: t.value, points: Number(p.value) });
      p.addEventListener('input', sum); rows.append(row);
    };
    const readRubric = () => [...rows.children].map((r) => r.read());
    function sum() { total.textContent = `Total: ${fmt(readRubric().reduce((n, r) => n + (r.points || 0), 0))} points`; }
    const rubricBox = h('div.rubric-box', rows, h('div.form-actions.start.tight', h('button.text-btn', { type: 'button', onclick: () => addRow() }, icon('add'), 'Add row'), total));
    const sync = () => { rubricBox.hidden = !useRubric.checked; points.disabled = useRubric.checked; if (useRubric.checked && !rows.children.length) { addRow(); addRow(); } sum(); };
    useRubric.addEventListener('change', sync);
    if (existing) {
      title.value = existing.title; instr.value = existing.instructions || ''; due.value = localInput(existing.due); points.value = existing.points; pick(mod, existing.moduleId);
      if (existing.rubric) { useRubric.checked = true; existing.rubric.forEach(addRow); }
    }
    sync();
    formDialog({ title: existing ? 'Edit assignment' : 'New assignment', submitLabel: existing ? 'Save' : 'Assign', body: [field('Title', title), field('Instructions', instr),
      h('div.form-row', field('Due', due), field('Points', points)), field('Module', mod),
      h('label.switch-row', h('span', h('span.switch-label', 'Mark with a rubric'), h('span.switch-sub', 'Score each criterion; the grade is their total.')), useRubric), rubricBox], submit: async () => {
      const body = { title: title.value, instructions: instr.value, due: toIso(due.value), points: Number(points.value), moduleId: mod.value, rubric: useRubric.checked ? readRubric() : null };
      if (existing) await req('PATCH', `/api/classes/${c.id}/assignments/${existing.id}`, body); else await post(`/api/classes/${c.id}/assignments`, body);
      await refresh();
    } });
  }

  const Q_TYPES = [['choice', 'Multiple choice'], ['multi', 'Checkboxes'], ['short', 'Short answer'], ['paragraph', 'Written answer']];
  async function quizDialog(c, existing) {
    const modules = await classModules(c);
    const title = input(), due = input({ type: 'datetime-local' }), mod = moduleSelect(modules);
    const limit = input({ type: 'number', min: '1', placeholder: 'None' }), tries = input({ type: 'number', min: '0', value: '1' });
    const list = h('div.quiz-builder');
    const locked = existing && existing.hasAttempts;
    const addQuestion = (q = {}) => {
      const uid = Math.random().toString(36).slice(2);
      const type = h('select.form-input', Q_TYPES.map(([v, l]) => h('option', { value: v }, l))); type.value = q.type || 'choice';
      const prompt = input({ placeholder: 'Question' }), points = input({ type: 'number', min: '1', value: '1', class: 'narrow' });
      prompt.value = q.prompt || ''; points.value = q.points || 1;
      const choiceText = [0, 1, 2, 3].map((i) => { const t = input({ placeholder: i < 2 ? `Choice ${i + 1}` : `Choice ${i + 1} (optional)` }); t.value = (q.choices || [])[i] || ''; return t; });
      const accepted = input({ placeholder: 'Accepted answers, separated by commas' }); accepted.value = q.type === 'short' ? (q.answers || []).join(', ') : '';
      const extra = h('div.quiz-choices'); let marks = [];
      const draw = () => {
        const t = type.value;
        if (t === 'choice' || t === 'multi') {
          const right = t === 'choice' ? [q.answer ?? 0] : (q.type === 'multi' ? q.answers : [0]);
          marks = choiceText.map((_, i) => h('input', { type: t === 'choice' ? 'radio' : 'checkbox', name: `correct-${uid}`, checked: (right || []).includes(i), title: 'Correct answer' }));
          extra.replaceChildren(...choiceText.map((ct, i) => h('div.quiz-choice', marks[i], ct)), h('span.form-hint', t === 'choice' ? 'Select the circle next to the correct answer.' : 'Tick every correct answer.'));
        } else if (t === 'short') extra.replaceChildren(accepted, h('span.form-hint', 'Marked automatically. Capitals and extra spaces are ignored.'));
        else extra.replaceChildren(h('span.form-hint', 'Students write a longer answer. You mark it by hand.'));
      };
      type.addEventListener('change', draw); draw();
      const block = h('div.quiz-q', h('div.form-row', field('Question', prompt), field('Type', type), field('Points', points), L.iconButton('close', 'Remove question', () => block.remove())), extra);
      block.read = (n) => {
        const out = { type: type.value, prompt: prompt.value, points: Number(points.value) };
        if (out.type === 'choice' || out.type === 'multi') {
          const filled = choiceText.map((ct, i) => ({ text: ct.value.trim(), right: marks[i].checked })).filter((x) => x.text);
          out.choices = filled.map((x) => x.text);
          const right = filled.map((x, i) => (x.right ? i : -1)).filter((i) => i >= 0);
          if (!right.length) throw new Error(`Question ${n}: mark the correct answer (it can’t be a blank choice).`);
          if (out.type === 'choice') out.answer = right[0]; else out.answers = right;
        }
        if (out.type === 'short') out.answers = accepted.value.split(',').map((x) => x.trim()).filter(Boolean);
        return out;
      };
      list.append(block);
    };
    if (existing) {
      title.value = existing.title; due.value = localInput(existing.due); pick(mod, existing.moduleId); limit.value = existing.timeLimit || ''; tries.value = existing.maxAttempts;
      if (!locked) existing.questions.forEach(addQuestion);
    } else addQuestion();
    formDialog({ title: existing ? 'Edit quiz' : 'New quiz', submitLabel: existing ? 'Save' : 'Assign', body: [field('Title', title), h('div.form-row', field('Due', due), field('Module', mod)),
      h('div.form-row', field('Time limit (minutes)', limit, 'Leave empty for no limit.'), field('Attempts allowed', tries, '0 means unlimited. The best attempt counts.')),
      locked ? h('div.notice.info', icon('lock'), 'Students have started this quiz, so its questions are locked.') : [list, h('button.tonal-btn', { type: 'button', onclick: () => addQuestion() }, icon('add'), 'Add question')]], submit: async () => {
      const body = { title: title.value, due: toIso(due.value), moduleId: mod.value, timeLimit: limit.value === '' ? null : Number(limit.value), maxAttempts: tries.value === '' ? 1 : Number(tries.value) };
      if (!locked) { body.questions = [...list.children].map((b, i) => b.read(i + 1)); if (!body.questions.length) throw new Error('Add at least one question.'); }
      if (existing) await req('PATCH', `/api/classes/${c.id}/quizzes/${existing.id}`, body); else await post(`/api/classes/${c.id}/quizzes`, body);
      await refresh();
    } });
  }

  async function manageContent(c) {
    const [toc, modules] = await Promise.all([ctx.api.toc(c.id), classModules(c)]);
    const closeAnd = (fn) => async () => { try { close(); await fn(); } catch (e) { L.toast(e.message); } };
    const del = (url) => closeAnd(async () => { await req('DELETE', url); await refresh(); });
    const row = (label, sub, actions) => h('div.manage-row', h('div', h('div.manage-title', label), h('div.form-hint', sub)), h('div.manage-actions', actions));
    const body = h('div.manage', toc.length ? toc.map((m) => [
      m.id ? row(m.title, 'Module — deleting it keeps its items under General', [
        L.iconButton('edit', 'Edit module', closeAnd(() => moduleDialog(c, modules.find((x) => x.id === m.id)))),
        L.iconButton('delete', 'Delete module', del(`/api/classes/${c.id}/modules/${m.id}`))]) : h('div.manage-title', 'General'),
      m.topics.map((t) => h('div.manage-indent', row(t.title, L.TYPE_META[t.type]?.label || 'Material', [
        L.iconButton('edit', 'Edit', closeAnd(async () => {
          const full = await get(`/api/classes/${c.id}/topics/${t.id}`);
          if (full.kind === 'assignment') assignmentDialog(c, await get(`/api/classes/${c.id}/assignments/${full.refId}`));
          else if (full.kind === 'quiz') quizDialog(c, await get(`/api/classes/${c.id}/quizzes/${full.refId}`));
          else materialDialog(c, full);
        })),
        L.iconButton('delete', 'Delete', del(`/api/classes/${c.id}/topics/${t.id}`))]))),
    ]) : h('p', 'Nothing to manage yet.'));
    const close = L.dialog({ title: 'Manage classwork', body, actions: [{ label: 'Done', primary: true }] });
  }

  /* =========================== work list (both roles) =========================== */
  function workView(c) {
    const teacher = isTeacher(c);
    return loading(get(`/api/classes/${c.id}/work`), (d) => h('div.work',
      teacher ? h('div.toolbar', h('button.filled-btn', { type: 'button', onclick: () => assignmentDialog(c) }, icon('add'), 'Assignment'), h('button.tonal-btn', { type: 'button', onclick: () => quizDialog(c) }, icon('add'), 'Quiz')) : null,
      !d.items.length ? L.empty('assignment', 'No assignments or quizzes yet', teacher ? 'Create one and it appears here and in Classwork.' : 'Anything your teacher assigns will be listed here.')
        : h('div.list-card', d.items.map((i) => {
          const past = i.due && new Date(i.due) < new Date();
          const state = teacher ? h('span.work-due', `${i.handedIn} of ${d.students} handed in${i.type === 'assignment' ? ` · ${i.graded} graded` : i.toMark ? ` · ${i.toMark} to mark` : ''}`)
            : i.score != null ? h('span.chip-status.done', icon('check_circle', { fill: true }), `${fmt(i.score)}/${fmt(i.points)}`)
              : i.done ? h('span.chip-status.done', i.pending ? 'Being marked' : 'Handed in')
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
          a.role === 'teacher' ? [L.iconButton('edit', 'Edit assignment', () => assignmentDialog(c, a)),
            L.iconButton('delete', 'Delete assignment', () => confirmDialog('Delete this assignment?', 'Every hand-in and grade for it is deleted too.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/assignments/${id}`); await refresh(); location.hash = `#/c/${c.id}/work`; }))] : null),
        a.html ? h('div.prose', { html: L.sanitize(a.html) }) : h('p.muted', 'No instructions.'),
        a.rubric ? rubricTable(a.rubric, a.submission && a.submission.rubricScores) : null),
      a.role === 'teacher' ? gradingTable(c, a) : handIn(c, a)));
  }
  function rubricTable(rubric, scores) {
    return h('table.rubric', h('thead', h('tr', h('th', 'Rubric'), h('th.num', scores ? 'Score' : 'Points'))),
      h('tbody', rubric.map((r, i) => h('tr', h('td', r.title), h('td.num', scores ? `${fmt(scores[i])} / ${fmt(r.points)}` : fmt(r.points))))));
  }

  function handIn(c, a) {
    const s = a.submission;
    if (s && s.grade != null) {
      return h('section.side-card.result',
        h('div.side-title', 'Your grade'),
        h('div.grade-big', `${fmt(s.grade)} / ${fmt(a.points)}`),
        s.feedback ? h('div.grade-comment', s.feedback) : null,
        s.submitted && (s.text || s.file) ? h('div.form-hint', `Handed in ${L.fmtDay(s.submitted)}${s.late ? ' (late)' : ''}`) : h('div.form-hint', 'Nothing was handed in.'),
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
        const feedback = input({ placeholder: 'Feedback (optional)', 'aria-label': `Feedback for ${s.name}` }); feedback.value = s.feedback || '';
        const saved = h('span.form-hint');
        let controls, payload;
        if (a.rubric) {
          const cells = a.rubric.map((r, i) => { const n = input({ type: 'number', min: '0', max: String(r.points), step: 'any', class: 'narrow', 'aria-label': `${r.title} for ${s.name}` }); n.value = s.rubricScores ? s.rubricScores[i] : ''; return n; });
          const total = h('span.score');
          const sum = () => { total.textContent = `${fmt(cells.reduce((n, x) => n + (Number(x.value) || 0), 0))} / ${fmt(a.points)}`; };
          cells.forEach((x) => x.addEventListener('input', sum)); sum();
          controls = h('div.rubric-grade', a.rubric.map((r, i) => h('label.rubric-cell', h('span.form-hint', `${r.title} (/${fmt(r.points)})`), cells[i])), h('div.rubric-cell', h('span.form-hint', 'Total'), total));
          payload = () => ({ rubricScores: cells.map((x) => x.value) });
        } else {
          const grade = input({ type: 'number', min: '0', max: String(a.points), step: 'any', class: 'narrow', 'aria-label': `Grade for ${s.name}` }); grade.value = s.grade ?? '';
          controls = [grade, h('span.muted', `/ ${fmt(a.points)}`)];
          payload = () => ({ grade: grade.value === '' ? null : Number(grade.value) });
        }
        return h('div.grade-entry',
          h('div.grade-entry-head',
            h('span.row-avatar', s.name[0]),
            h('div.row-main', h('span.row-title', s.name), h('span.row-sub', has ? `Handed in ${L.fmtDay(s.submitted)}${s.late ? ' · late' : ''}` : 'Not handed in'))),
          has ? h('div.answer-box', s.text ? h('div.prose.answer', s.text) : null, s.file ? fileChip(s.file) : null) : null,
          h('div.grade-entry-form', controls, feedback,
            h('button.tonal-btn', { type: 'button', onclick: async () => {
              try { await post(`/api/classes/${c.id}/assignments/${a.id}/grade`, { studentId: s.id, feedback: feedback.value, ...payload() }); saved.textContent = 'Saved'; ctx.api.clearCache(); }
              catch (e) { saved.textContent = e.message; }
            } }, 'Save'), saved));
      })));
  }

  /* =========================== quiz =========================== */
  const typeOf = (q) => q.type || 'choice';
  const mins = (n) => `${n} minute${n === 1 ? '' : 's'}`;

  /** One question shown after the fact: the student's answer, and the key when it's revealed. */
  function reviewQuestion(q, i, answer, manual, showKey) {
    const t = typeOf(q); const has = answer !== undefined;
    const head = h('div.quiz-prompt', `${i + 1}. ${q.prompt}`, h('span.form-hint', ` ${fmt(q.points)} pt`));
    if (t === 'choice' || t === 'multi') {
      const chosen = (k) => has && (t === 'choice' ? answer === k : Array.isArray(answer) && answer.includes(k));
      const right = (k) => showKey && (t === 'choice' ? q.answer === k : q.answers.includes(k));
      return h('div.quiz-card', head, q.choices.map((ch, k) => h(`div.quiz-option${right(k) ? '.correct' : chosen(k) && showKey ? '.wrong' : ''}`,
        icon(right(k) ? 'check_circle' : chosen(k) ? (showKey ? 'close' : 'check') : 'radio_button_unchecked'), ch, chosen(k) ? h('span.form-hint', ' — your answer') : null)));
    }
    if (t === 'short') {
      const ok = showKey && has && answer != null && q.answers.some((x) => x.trim().toLowerCase().replace(/\s+/g, ' ') === String(answer).trim().toLowerCase().replace(/\s+/g, ' '));
      return h('div.quiz-card', head, has ? h(`div.quiz-option${showKey ? (ok ? '.correct' : '.wrong') : ''}`, icon(showKey ? (ok ? 'check_circle' : 'close') : 'edit'), answer == null ? 'No answer' : String(answer), h('span.form-hint', ' — your answer')) : null,
        showKey ? h('div.form-hint', `Accepted: ${q.answers.join(', ')}`) : null);
    }
    return h('div.quiz-card', head, has ? h('div.answer-box', h('div.prose.answer', answer == null ? 'No answer' : String(answer))) : h('div.form-hint', 'Written answer, marked by the teacher.'),
      has ? h('div.form-hint', manual && manual[i] != null ? `Marked: ${fmt(manual[i])} / ${fmt(q.points)}` : 'Waiting for your teacher to mark this.') : null);
  }

  function quizView(c, id) {
    return loading(get(`/api/classes/${c.id}/quizzes/${id}`), (q) => {
      const facts = [`${q.questions.length} question${q.questions.length === 1 ? '' : 's'}`, `${fmt(q.points)} points`, q.due ? L.dueLabel(q.due) : 'No due date',
        q.timeLimit ? `${mins(q.timeLimit)} limit` : null, q.maxAttempts === 1 ? null : q.maxAttempts ? `${q.maxAttempts} attempts` : 'Unlimited attempts'].filter(Boolean).join(' · ');
      const head = h('article.post',
        h('header.post-head', h('span.post-avatar', icon('quiz', { fill: true })),
          h('div', h('div.detail-title', q.title), h('div.post-date', facts)),
          q.role === 'teacher' ? [L.iconButton('edit', 'Edit quiz', () => quizDialog(c, q)),
            L.iconButton('delete', 'Delete quiz', () => confirmDialog('Delete this quiz?', 'Every attempt and score for it is deleted too.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/quizzes/${id}`); await refresh(); location.hash = `#/c/${c.id}/work`; }))] : null));
      const shell = (...kids) => h('div.detail', backLink(c, 'work', 'All work'), head, ...kids);
      if (q.role === 'teacher') return shell(...quizResults(c, q));
      if (q.inProgress) return shell(takeQuiz(c, q));

      const scoreCard = q.attempt ? h('section.side-card.result', h('div.side-title', q.attemptsUsed > 1 ? 'Your best score' : 'Your score'),
        h('div.grade-big', q.best != null ? `${fmt(q.best)} / ${fmt(q.points)}` : 'Being marked'),
        q.pending ? h('div.form-hint', 'Your teacher still has written answers to mark.') : null,
        h('div.form-hint', `Last handed in ${L.fmtDay(q.attempt.submitted)} · ${q.attemptsUsed} attempt${q.attemptsUsed === 1 ? '' : 's'} used`)) : null;
      const canStart = q.attemptsLeft !== 0;
      const start = canStart ? h('section.side-card', h('div.side-title', q.attempt ? 'Try again?' : 'Ready?'),
        h('p.muted', [q.timeLimit ? `Once you start, you have ${mins(q.timeLimit)}. The clock keeps running if you leave.` : 'There’s no time limit. Your answers are saved as you go.',
          q.attemptsLeft == null ? 'You can take this as many times as you like; your best score counts.' : q.attemptsLeft === 1 ? (q.attempt ? 'This is your last attempt.' : 'You get one attempt.') : `You have ${q.attemptsLeft} attempts left; your best score counts.`].join(' ')),
        h('div.form-actions', h('button.filled-btn', { type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await post(`/api/classes/${c.id}/quizzes/${id}/start`); ctx.render(); } catch (ex) { L.toast(ex.message); } } }, icon('timer'), q.attempt ? 'Start another attempt' : 'Start quiz'))) : null;
      const review = q.attempt ? h('div.quiz-list', q.questions.map((qu, i) => reviewQuestion(qu, i, q.attempt.answers[i] ?? null, q.attempt.manual, q.revealed))) : null;
      return shell(scoreCard, start, q.attempt && !q.revealed ? h('p.form-hint', 'The correct answers are shown once you have no attempts left.') : null, review);
    });
  }

  function takeQuiz(c, q) {
    const saved = q.inProgress.answers || [];
    const err = errorLine(), status = h('span.form-hint');
    const form = h('form.quiz-list', q.questions.map((qu, i) => {
      const t = typeOf(qu); const prev = saved[i];
      const body = t === 'choice' ? qu.choices.map((ch, k) => h('label.quiz-option.pick', h('input', { type: 'radio', name: `q${i}`, value: String(k), checked: prev === k }), ch))
        : t === 'multi' ? [h('span.form-hint', 'Choose all that apply.'), qu.choices.map((ch, k) => h('label.quiz-option.pick', h('input', { type: 'checkbox', name: `q${i}`, value: String(k), checked: Array.isArray(prev) && prev.includes(k) }), ch))]
          : t === 'short' ? (() => { const x = input({ name: `q${i}`, placeholder: 'Your answer', autocomplete: 'off' }); x.value = prev || ''; return x; })()
            : (() => { const x = textarea({ name: `q${i}`, rows: 5, placeholder: 'Write your answer…' }); x.value = prev || ''; return x; })();
      return h('fieldset.quiz-card', h('legend.quiz-prompt', `${i + 1}. ${qu.prompt}`, h('span.form-hint', ` ${fmt(qu.points)} pt`)), body);
    }));
    const collect = () => q.questions.map((qu, i) => {
      const t = typeOf(qu);
      if (t === 'choice') { const p = form.querySelector(`input[name="q${i}"]:checked`); return p ? Number(p.value) : null; }
      if (t === 'multi') { const p = [...form.querySelectorAll(`input[name="q${i}"]:checked`)].map((x) => Number(x.value)); return p.length ? p : null; }
      const v = form.querySelector(`[name="q${i}"]`).value.trim(); return v || null;
    });
    let done = false, saveTimer = null;
    const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(async () => { if (done) return; try { await req('PUT', `/api/classes/${c.id}/quizzes/${q.id}/attempt`, { answers: collect() }); status.textContent = 'Saved'; } catch { status.textContent = 'Not saved — check your connection'; } }, 600); };
    form.addEventListener('input', save); form.addEventListener('change', save);
    const handInNow = async (auto) => {
      if (done) return; done = true; clearTimeout(saveTimer);
      try {
        const r = await post(`/api/classes/${c.id}/quizzes/${q.id}/attempt`, { attemptId: q.inProgress.id, answers: collect() });
        L.toast(auto || r.timedOut ? 'Time’s up — your quiz was handed in.' : r.pending ? 'Handed in. Your teacher will mark the written answers.' : `You scored ${fmt(r.score)} out of ${fmt(r.points)}.`);
        await refresh();
      } catch (e) { done = false; err.textContent = e.message; }
    };
    const clock = h('div.quiz-clock');
    if (q.inProgress.deadline) {
      const end = new Date(q.inProgress.deadline).getTime();
      const tick = () => {
        if (!document.body.contains(clock) || done) return clearInterval(timer);
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        clock.replaceChildren(icon('timer'), `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`);
        clock.classList.toggle('low', left <= 60);
        if (left <= 0) { clearInterval(timer); handInNow(true); }
      };
      const timer = setInterval(tick, 1000); setTimeout(tick);
    }
    return h('div.quiz-take', q.inProgress.deadline ? clock : null, form, err,
      h('div.form-actions', status, h('button.filled-btn', { type: 'button', onclick: () => {
        const blank = collect().filter((x) => x === null).length;
        if (!blank) return handInNow(false);
        confirmDialog('Hand in with blanks?', `${blank} question${blank === 1 ? ' is' : 's are'} unanswered.`, 'Hand in anyway', () => handInNow(false));
      } }, icon('send'), 'Hand in quiz')));
  }

  function quizResults(c, q) {
    const taken = q.students.filter((s) => s.attempts.length);
    const written = q.questions.map((qu, i) => [qu, i]).filter(([qu]) => typeOf(qu) === 'paragraph');
    const rows = q.students.map((s) => {
      const last = s.attempts[s.attempts.length - 1];
      const marking = last && written.length ? h('div.marking', written.map(([qu, i]) => {
        const pts = input({ type: 'number', min: '0', max: String(qu.points), step: 'any', class: 'narrow', 'aria-label': `Marks for question ${i + 1}` }); pts.value = last.manual[i] ?? '';
        const note = h('span.form-hint');
        return h('div.marking-row', h('div.form-hint', `${i + 1}. ${qu.prompt}`), h('div.answer-box', h('div.prose.answer', last.answers[i] == null ? 'No answer' : String(last.answers[i]))),
          h('div.grade-entry-form', pts, h('span.muted', `/ ${fmt(qu.points)}`), h('button.tonal-btn', { type: 'button', onclick: async () => {
            try { const r = await post(`/api/classes/${c.id}/quizzes/${q.id}/grade`, { attemptId: last.id, scores: { [i]: pts.value } }); note.textContent = `Saved — attempt total ${fmt(r.score)} / ${fmt(q.points)}`; ctx.api.clearCache(); }
            catch (e) { note.textContent = e.message; }
          } }, 'Save'), note));
      })) : null;
      return h('div.grade-entry', h('div.grade-entry-head', h('span.row-avatar', s.name[0]),
        h('div.row-main', h('span.row-title', s.name), h('span.row-sub', s.inProgress ? 'Taking it now' : last ? `${s.attempts.length} attempt${s.attempts.length === 1 ? '' : 's'} · last ${L.fmtDay(last.submitted)}` : 'Not taken')),
        h('span.score', s.best != null ? `${fmt(s.best)} / ${fmt(q.points)}` : s.pending ? 'To mark' : '—')), marking);
    });
    return [h('h3.group-title', icon('groups'), 'Results', h('span.count', `${taken.length} of ${q.students.length} taken`)),
      q.students.length ? h('div.list-card', rows) : L.empty('groups', 'No students yet'),
      h('h3.group-title', icon('quiz'), 'Answer key'),
      h('div.quiz-list', q.questions.map((qu, i) => reviewQuestion(qu, i, undefined, null, true)))];
  }

  /* =========================== note / material page =========================== */
  function topicView(c, id) {
    return loading(get(`/api/classes/${c.id}/topics/${id}`), (t) => h('div.detail',
      backLink(c, 'classwork', 'Classwork'),
      h('article.post', h('header.post-head', h('span.post-avatar', icon('article', { fill: true })), h('div', h('div.detail-title', t.title), h('div.post-date', `Posted ${L.fmtDay(t.created)}`)),
        isTeacher(c) ? L.iconButton('edit', 'Edit', () => materialDialog(c, t)) : null),
        t.html ? h('div.prose', { html: L.sanitize(t.html) }) : null,
        t.file ? fileChip(t.file) : null,
        t.url ? h('a.attach-chip', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), t.url) : null)));
  }

  /* =========================== gradebook (teacher) =========================== */
  function gradebookView(c) {
    return loading(get(`/api/classes/${c.id}/gradebook`), (g) => {
      if (!g.items.length) return L.empty('grading', 'Nothing to grade yet', 'Assignments and quizzes you create show up as columns here.');
      if (!g.students.length) return L.empty('groups', 'No students yet', 'Share the class code from the People tab.');
      return h('div', h('div.toolbar', h('a.tonal-btn', { href: `/api/classes/${c.id}/gradebook.csv`, download: '' }, icon('download'), 'Export CSV')),
        h('div.gradebook-wrap', h('table.gradebook',
          h('thead', h('tr', h('th.sticky', 'Student'), g.items.map((i) => h('th', h('a', { href: `#/c/${c.id}/${i.type}/${i.id}` }, i.title), h('div.form-hint', `${fmt(i.points)} pts`))), h('th', 'Overall'))),
          h('tbody', g.students.map((s) => h('tr', h('th.sticky', s.name),
            s.cells.map((cell) => h(`td${cell.score != null ? '' : cell.done ? '.pending' : '.none'}`, cell.score != null ? fmt(cell.score) : cell.done ? 'To grade' : '—')),
            h('td.overall', s.percent == null ? '—' : `${s.percent.toFixed(1)}%`)))))));
    });
  }

  /* =========================== people =========================== */
  function peopleView(c) {
    return loading(get(`/api/classes/${c.id}`), (d) => {
      const teacher = d.role === 'teacher';
      const again = () => refresh();
      const row = (p) => h('div.list-row', h('span.row-avatar', p.name[0]),
        h('div.row-main', h('span.row-title', p.name, p.owner ? h('span.form-hint', ' · class owner') : null), p.email ? h('span.row-sub', p.email) : null),
        teacher && p.role === 'student' ? L.iconButton('school', `Make ${p.name} a co-teacher`, () => confirmDialog(`Make ${p.name} a co-teacher?`, 'They’ll be able to post, create work, see every hand-in and grade.', 'Make co-teacher', async () => { await req('PATCH', `/api/classes/${c.id}/members/${p.id}`, { role: 'teacher' }); await again(); })) : null,
        d.isOwner && p.role === 'teacher' && !p.owner ? L.iconButton('person', `Make ${p.name} a student`, () => confirmDialog(`Make ${p.name} a student again?`, 'They lose teacher access to this class.', 'Make student', async () => { await req('PATCH', `/api/classes/${c.id}/members/${p.id}`, { role: 'student' }); await again(); })) : null,
        teacher && p.role === 'student' ? L.iconButton('close', `Remove ${p.name}`, () => confirmDialog(`Remove ${p.name}?`, 'They lose access to the class. Their past work is kept in case they rejoin.', 'Remove', async () => { await req('DELETE', `/api/classes/${c.id}/members/${p.id}`); await again(); })) : null);
      const students = d.people.filter((p) => p.role === 'student'), teachers = d.people.filter((p) => p.role === 'teacher');
      return h('div.people',
        teacher ? h('section.code-card',
          h('div', h('div.side-title', 'Class code'), h('div.form-hint', 'Students enter this under “Join class”.')),
          h('div.code-value', d.joinCode),
          h('div.form-actions', h('button.tonal-btn', { type: 'button', onclick: () => navigator.clipboard?.writeText(d.joinCode).then(() => L.toast('Class code copied.')) }, icon('content_copy'), 'Copy'),
            h('button.text-btn.on-container', { type: 'button', onclick: () => confirmDialog('Get a new class code?', 'The old code stops working. People already in the class stay in it.', 'New code', async () => { await req('PATCH', `/api/classes/${c.id}`, { resetJoinCode: true }); await again(); }) }, icon('refresh'), 'New code'))) : null,
        h('h3.group-title', icon('school'), teachers.length > 1 ? 'Teachers' : 'Teacher', teachers.length > 1 ? h('span.count', teachers.length) : null),
        h('div.list-card', teachers.map(row)),
        h('h3.group-title', icon('groups'), 'Students', h('span.count', students.length)),
        students.length ? h('div.list-card', students.map(row)) : h('p.muted', teacher ? 'No students yet. Share the class code above.' : 'No classmates yet.'),
        h('div.form-actions.start',
          teacher ? h('button.text-btn', { type: 'button', onclick: () => confirmDialog('Archive this class?', 'It moves to “Past & hidden classes” for everyone and no one new can join. Nothing is deleted.', 'Archive', async () => { await req('PATCH', `/api/classes/${c.id}`, { archived: true }); await refresh(); location.hash = '#/'; }) }, icon('archive'), 'Archive class') : null,
          !d.isOwner ? h('button.text-btn', { type: 'button', onclick: () => confirmDialog('Leave this class?', 'You can rejoin later with the class code.', 'Leave', async () => { await post(`/api/classes/${c.id}/leave`); await refresh(); location.hash = '#/'; }) }, icon('logout'), 'Leave class') : null));
    });
  }

  /* =========================== discussions =========================== */
  function discussionsView(c) {
    const startThread = () => {
      const title = input({ placeholder: 'What do you want to ask or share?' }), body = textarea({ rows: 5 });
      formDialog({ title: 'Start a discussion', submitLabel: 'Post', body: [field('Title', title), field('Message', body)], submit: async () => {
        const { id } = await post(`/api/classes/${c.id}/discussions`, { title: title.value, body: body.value }); location.hash = `#/c/${c.id}/discussion/${id}`;
      } });
    };
    return loading(get(`/api/classes/${c.id}/discussions`), (list) => h('div.work',
      h('div.toolbar', h('button.filled-btn', { type: 'button', onclick: startThread }, icon('add'), 'Start a discussion')),
      !list.length ? L.empty('forum', 'No discussions yet', 'Ask a question or share something with the class.')
        : h('div.list-card', list.map((d) => h('a.work-row', { href: `#/c/${c.id}/discussion/${d.id}` },
          h('span.work-icon', icon('forum')),
          h('span.work-main', h('span.work-title', d.title), h('span.work-sub', `${d.author} · ${L.relative(d.active)}`)),
          h('span.work-due', `${d.replies} repl${d.replies === 1 ? 'y' : 'ies'}`))))));
  }
  function discussionView(c, id) {
    return loading(get(`/api/classes/${c.id}/discussions/${id}`), (d) => {
      const reply = textarea({ rows: 3, placeholder: 'Write a reply…', 'aria-label': 'Reply' }), err = errorLine();
      const post1 = (who, when, html, teacher, del) => h('article.post', h('header.post-head', h('span.row-avatar', who[0]),
        h('div', h('div.post-title', who, teacher ? h('span.pill', 'Teacher') : null), h('div.post-date', `${L.fmtDay(when)} · ${L.relative(when)}`)), del), h('div.prose', { html: L.sanitize(html) }));
      return h('div.detail', backLink(c, 'discussions', 'All discussions'),
        h('h2.detail-title', d.title),
        post1(d.author, d.created, d.html, false, d.canDelete ? L.iconButton('delete', 'Delete discussion', () => confirmDialog('Delete this discussion?', 'Every reply is deleted too.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/discussions/${id}`); location.hash = `#/c/${c.id}/discussions`; })) : null),
        d.replies.length ? h('h3.group-title', icon('reply'), `${d.replies.length} repl${d.replies.length === 1 ? 'y' : 'ies'}`) : null,
        d.replies.map((r) => h('div.reply', post1(r.author, r.created, r.html, r.teacher, r.canDelete ? L.iconButton('delete', 'Delete reply', async () => { try { await req('DELETE', `/api/classes/${c.id}/discussions/${id}/replies/${r.id}`); ctx.render(); } catch (e) { L.toast(e.message); } }) : null))),
        h('section.side-card', h('div.form', reply, err, h('div.form-actions', h('button.filled-btn', { type: 'button', onclick: async () => {
          try { await post(`/api/classes/${c.id}/discussions/${id}/replies`, { body: reply.value }); ctx.render(); } catch (e) { err.textContent = e.message; }
        } }, icon('send'), 'Reply')))));
    });
  }

  /* =========================== admin console =========================== */
  function adminPage(c2, { rest }) {
    const tab = ['users', 'classes', 'email'].includes(rest[0]) ? rest[0] : 'overview';
    const page = h('div.page', h('h1.headline', 'Admin'),
      h('nav.tabs.inline', [['overview', 'Overview'], ['users', 'People'], ['classes', 'Classes'], ['email', 'Email']].map(([k, l]) => h(`a.tab${k === tab ? '.active' : ''}`, { href: `#/admin/${k}` }, l))));
    if (!me.admin) { page.append(L.empty('lock', 'Administrators only')); return page; }
    const redraw = () => ctx.render();
    const act = (fn) => async () => { try { await fn(); redraw(); } catch (e) { L.toast(e.message); } };
    if (tab === 'overview') page.append(loading(get('/api/admin/overview'), (o) => {
      const stat = (n, label) => h('div.stat', h('div.stat-n', String(n)), h('div.form-hint', label));
      const signup = h('input.switch', { type: 'checkbox', checked: o.settings.signup, onchange: (e) => req('PATCH', '/api/admin/settings', { signup: e.target.checked }).then(() => L.toast('Saved.')) });
      const approved = h('input.switch', { type: 'checkbox', checked: o.settings.classCreation === 'approved', onchange: (e) => req('PATCH', '/api/admin/settings', { classCreation: e.target.checked ? 'approved' : 'anyone' }).then(() => L.toast('Saved.')) });
      return h('div.admin', h('div.stats', stat(o.stats.users, 'accounts'), stat(o.stats.classes, 'active classes'), stat(o.stats.archived, 'archived'), stat(o.stats.submissions, 'hand-ins'), stat(o.stats.attempts, 'quiz attempts'), stat(fmtSize(o.stats.storageBytes), 'of uploads')),
        h('section.side-card', h('div.side-title', 'Policies'),
          h('label.switch-row', h('span', h('span.switch-label', 'Allow new sign-ups'), h('span.switch-sub', 'When off, only existing accounts (and single sign-on) can get in.')), signup),
          h('label.switch-row', h('span', h('span.switch-label', 'Only approved teachers can create classes'), h('span.switch-sub', 'Approve people under People. Administrators can always create classes.')), approved)),
        h('section.side-card', h('div.side-title', 'Connections'),
          h('p', icon('mail'), ' Email: ', o.email.configured ? `sending as ${o.email.from}` : 'not configured — set SMTP_URL to send notifications and reset links'),
          h('p', icon('key'), ' Single sign-on: ', o.sso ? `${o.sso.name} (${o.sso.issuer})` : 'not configured — set OIDC_ISSUER and OIDC_CLIENT_ID')));
    }));
    if (tab === 'users') {
      const search = input({ type: 'search', placeholder: 'Search by name or email', 'aria-label': 'Search people' });
      const host = h('div');
      const draw = () => host.replaceChildren(loading(get(`/api/admin/users?q=${encodeURIComponent(search.value)}`), (users) => h('div.list-card', users.map((u) => h('div.list-row.admin-row',
        h('span.row-avatar', u.name[0]),
        h('div.row-main', h('span.row-title', u.name, u.you ? h('span.form-hint', ' · you') : null, u.admin ? h('span.pill', 'Admin') : null, u.disabled ? h('span.pill.off', 'Turned off') : null),
          h('span.row-sub', `${u.email} · ${u.classes} class${u.classes === 1 ? '' : 'es'} · joined ${L.fmtShort(u.created)}`)),
        h('div.admin-actions',
          h('button.text-btn', { type: 'button', onclick: act(() => req('PATCH', `/api/admin/users/${u.id}`, { canTeach: !u.canTeach })) }, u.canTeach ? 'Unapprove teacher' : 'Approve as teacher'),
          h('button.text-btn', { type: 'button', onclick: async () => { try { const r = await post(`/api/admin/users/${u.id}/reset-link`); L.dialog({ title: 'Password reset link', body: h('div.stack', h('p', `Send this to ${u.name}. It works once, for one hour.`), h('code.reset-link', r.link)), actions: [{ label: 'Copy', primary: true, run: () => navigator.clipboard?.writeText(r.link) }, { label: 'Close' }] }); } catch (e) { L.toast(e.message); } } }, 'Reset link'),
          u.you ? null : h('button.text-btn', { type: 'button', onclick: act(() => req('PATCH', `/api/admin/users/${u.id}`, { admin: !u.admin })) }, u.admin ? 'Remove admin' : 'Make admin'),
          u.you ? null : h('button.text-btn', { type: 'button', onclick: act(() => req('PATCH', `/api/admin/users/${u.id}`, { disabled: !u.disabled })) }, u.disabled ? 'Turn on' : 'Turn off'),
          u.you ? null : L.iconButton('delete', `Delete ${u.name}`, () => confirmDialog(`Delete ${u.name}’s account?`, 'Their hand-ins, quiz attempts and posts are deleted with it. This can’t be undone.', 'Delete', act(() => req('DELETE', `/api/admin/users/${u.id}`))))))))));
      let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 250); });
      draw();
      page.append(h('div.toolbar', h('div.field', icon('search'), search)), host);
    }
    if (tab === 'classes') page.append(loading(get('/api/admin/classes'), (list) => (!list.length ? L.empty('school', 'No classes yet') : h('div.list-card', list.map((k) => h('div.list-row.admin-row',
      h('span.row-avatar', k.name[0]),
      h('div.row-main', h('span.row-title', k.name, k.archived ? h('span.pill.off', 'Archived') : null), h('span.row-sub', `${[k.code, k.owner].filter(Boolean).join(' · ')} · ${k.students} student${k.students === 1 ? '' : 's'}`)),
      h('div.admin-actions',
        h('button.text-btn', { type: 'button', onclick: act(() => req('PATCH', `/api/admin/classes/${k.id}`, { archived: !k.archived })) }, k.archived ? 'Restore' : 'Archive'),
        L.iconButton('delete', `Delete ${k.name}`, () => confirmDialog(`Delete ${k.name}?`, 'The class, its content, every hand-in, grade and uploaded file are deleted. This can’t be undone.', 'Delete class', act(async () => { await req('DELETE', `/api/admin/classes/${k.id}`); await refresh(); }))))))))));
    if (tab === 'email') page.append(loading(get('/api/admin/outbox'), (list) => (!list.length ? L.empty('mail', 'No email yet', 'Notifications and reset links are listed here as they go out.') : h('div.list-card', list.map((m) => h('div.list-row',
      h('span.row-avatar', icon('mail')), h('div.row-main', h('span.row-title', m.subject), h('span.row-sub', `${m.to_email} · ${L.fmtDay(m.created)}${m.error ? ` · ${m.error}` : ''}`)),
      h(`span.pill${m.status === 'sent' ? '' : '.off'}`, m.status)))))));
    return page;
  }

  /* =========================== plug into the Lumen UI =========================== */
  L.ext = {
    routes: ['assignment', 'quiz', 'topic', 'discussion'],
    pages: { admin: adminPage },
    navItems: () => (me && me.admin ? [{ name: 'admin', href: '#/admin', icon: 'admin_panel_settings', label: 'Admin' }] : []),
    extraTabs: () => [['discussions', 'Discussions'], ['people', 'People']],
    homeChips: () => [
      h('button.assist-chip', { type: 'button', onclick: joinClass }, icon('add'), 'Join class'),
      me.canCreateClasses ? h('button.assist-chip', { type: 'button', onclick: createClass }, icon('school'), 'Create class') : null],
    homeEmpty: (c, filter) => (filter === 'current' && !(c.store.courses || []).length ? h('div.empty',
      icon('school', { size: 56 }), h('div.empty-title', 'Welcome to Lumen Classes'),
      h('div.empty-sub', me.canCreateClasses ? 'Join a class with the code from your teacher, or create your own class and invite students.' : 'Join a class with the code from your teacher.'),
      h('div.form-actions.center', h('button.filled-btn', { type: 'button', onclick: joinClass }, icon('add'), 'Join a class'), me.canCreateClasses ? h('button.tonal-btn', { type: 'button', onclick: createClass }, icon('school'), 'Create a class') : null)) : null),
    bannerChips: (c2, c) => [
      isTeacher(c) ? h('button.banner-chip', { type: 'button', title: 'Copy class code', onclick: () => navigator.clipboard?.writeText(roles.get(String(c.id)).joinCode).then(() => L.toast('Class code copied.')) }, icon('content_copy'), `Class code: ${roles.get(String(c.id)).joinCode}`) : null,
      h('span.banner-chip', icon(isTeacher(c) ? 'school' : 'person'), isTeacher(c) ? 'You teach this class' : 'Student')],
    streamTop: (c2, c) => (isTeacher(c) ? composer(c) : null),
    postActions: (c2, c, n) => (isTeacher(c) ? [
      L.iconButton('edit', 'Edit announcement', async () => {
        const raw = (await get(`/d2l/api/le/1.79/${c.id}/news/`)).find((x) => x.Id === n.id);
        const title = input(), body = textarea({ rows: 6 }); title.value = raw.Title; body.value = raw.Body.Text;
        formDialog({ title: 'Edit announcement', body: [field('Title', title), field('Message', body)], submit: async () => { await req('PATCH', `/api/classes/${c.id}/announcements/${n.id}`, { title: title.value, body: body.value }); await refresh(); } });
      }, { class: 'post-delete' }),
      L.iconButton('delete', 'Delete announcement', () => confirmDialog('Delete this announcement?', 'Students will no longer see it.', 'Delete', async () => { await req('DELETE', `/api/classes/${c.id}/announcements/${n.id}`); await refresh(); }), { class: 'post-delete' })] : null),
    classworkTop: (c2, c) => (isTeacher(c) ? h('div.toolbar.author',
      h('button.filled-btn', { type: 'button', onclick: () => materialDialog(c) }, icon('add'), 'Material'),
      h('button.tonal-btn', { type: 'button', onclick: () => assignmentDialog(c) }, icon('assignment'), 'Assignment'),
      h('button.tonal-btn', { type: 'button', onclick: () => quizDialog(c) }, icon('quiz'), 'Quiz'),
      h('button.tonal-btn', { type: 'button', onclick: () => moduleDialog(c) }, icon('folder'), 'Module'),
      h('button.text-btn', { type: 'button', onclick: () => manageContent(c) }, icon('tune'), 'Manage')) : null),
    courseTab(c2, c, tab, rest) {
      if (tab === 'people') return peopleView(c);
      if (tab === 'discussions') return discussionsView(c);
      if (tab === 'discussion') return discussionView(c, rest[0]);
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
    me = await get('/api/me').catch(() => null);
    if (!me || /^#\/reset\//.test(location.hash)) return showAuth();
    if (location.hash.startsWith('#/login')) history.replaceState(null, '', '/');
    await loadRoles();
    L.loginUrl = '/#/logout';
    root.className = '';
    ctx = L.mount(root, L.createApi({ imageBase: null }), {
      web: true, standalone: true, initialRoute: '#/',
      connectionNote: `Signed in as ${me.email}.`,
      disconnectLabel: 'Sign out', disconnectIcon: 'logout',
      accountActions: (closeAccount) => [
        h('button.list-btn', { type: 'button', onclick: () => { closeAccount(); profileDialog(); } }, icon('person'), 'Profile and notifications'),
        h('button.list-btn', { type: 'button', onclick: () => { closeAccount(); passwordDialog(); } }, icon('key'), 'Change password')],
      onDisconnect: async () => { ctx.api.clearCache(); await post('/api/auth/logout').catch(() => {}); location.replace('/'); },
    });
    root.querySelector('.brand-name').textContent = 'Lumen Classes';
  })();
})();
