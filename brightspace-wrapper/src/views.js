/* Views: Classes, Class (Stream / Classwork / Work / Grades), To-do, Calendar, Grades, Settings. */
(function () {
  const L = (window.Lumen = window.Lumen || {});
  const { h, icon, iconButton } = L;
  const V = (L.views = {});
  const ui = { expanded: new Map(), classworkQuery: '', todoCourse: 'all' };

  const dark = () => L.isDark(L.settings.get().mode);
  const target = () => (L.settings.get().newTab ? { target: '_blank', rel: 'noopener' } : {});

  /** Render an async section: skeleton → content | error. */
  function loadInto(promiseFn, renderFn, skeleton = L.skeleton(3)) {
    const box = h('div.async', skeleton);
    Promise.resolve()
      .then(promiseFn)
      .then((data) => box.replaceChildren(renderFn(data)))
      .catch((err) => box.replaceChildren(L.errorState(err, () => box.replaceWith(loadInto(promiseFn, renderFn, skeleton)))));
    return box;
  }

  function greeting(name) {
    const hr = new Date().getHours();
    const part = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  }

  function courseColorVars(course) {
    const hue = L.courseHue(course);
    return { '--course-accent': L.courseAccent(hue, dark()), '--course-banner': L.courseBanner(hue, dark()) };
  }

  /* ======================= work item row (shared) ======================= */
  function workRow(ctx, item, { showCourse = true, compact = false } = {}) {
    const { store } = ctx;
    const course = store.course(item.courseId);
    const status = store.status(item);
    const meta = L.TYPE_META[item.type] || L.TYPE_META.content;
    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = status !== 'done';
      L.doneStore.toggle(item.key, now === !!item.done ? null : now);
      ctx.render();
      L.toast(now ? `Marked “${item.title}” as done` : 'Moved back to assigned', { label: 'Undo', run: () => { L.doneStore.toggle(item.key, null); ctx.render(); } });
    };
    return h(`a.work-row.status-${status}${compact ? '.compact' : ''}`, { href: item.url || `#/c/${item.courseId}/work`, style: course ? courseColorVars(course) : {}, ...target() },
      h('span.work-icon', icon(meta.icon)),
      h('span.work-main',
        h('span.work-title', item.title),
        h('span.work-sub',
          showCourse && course ? h('span.work-course', course.code || course.name) : null,
          showCourse && course ? h('span.dot-sep', '·') : null,
          h('span', meta.label))),
      h('span.work-due', status === 'done' ? h('span.chip-status.done', icon('check_circle', { fill: true }), 'Done')
        : status === 'missing' ? h('span.chip-status.missing', L.dueLabel(item.due, 'Was due')) : L.dueLabel(item.due)),
      h('button.check-btn', { type: 'button', title: status === 'done' ? 'Mark as not done' : 'Mark as done', 'aria-label': 'Toggle done', onclick: toggle },
        icon(status === 'done' ? 'task_alt' : 'radio_button_unchecked')));
  }

  /* ======================= Classes (home) ======================= */
  V.home = function (ctx) {
    const { store } = ctx;
    const s = L.settings.get();
    const page = h('div.page');
    const first = store.me && store.me.FirstName;
    const work = store.work || [];
    const upcoming = work
      .filter((w) => store.status(w) === 'assigned' && w.due && L.daysFromToday(w.due) <= 7)
      .sort((a, b) => new Date(a.due) - new Date(b.due));
    const missing = work.filter((w) => store.status(w) === 'missing');

    page.append(h('section.hero',
      h('div',
        h('h1.display', greeting(first)),
        h('p.hero-sub', store.work == null ? 'Gathering what’s due…'
          : upcoming.length ? `${upcoming.length} thing${upcoming.length > 1 ? 's' : ''} due in the next 7 days` : 'Nothing due this week. Nice.')),
      h('div.hero-chips',
        h('a.assist-chip', { href: '#/todo' }, icon('checklist'), 'To-do'),
        missing.length ? h('a.assist-chip.error', { href: '#/todo/missing' }, icon('error'), `${missing.length} missing`) : null,
        h('a.assist-chip', { href: '#/calendar' }, icon('calendar_month'), 'This week'))));

    // Due soon strip
    if (store.work == null) {
      page.append(h('section.section', h('h2.section-title', 'Due soon'), L.skeleton(1, 'strip')));
    } else if (upcoming.length) {
      page.append(h('section.section',
        h('div.section-head', h('h2.section-title', 'Due soon'), h('a.text-btn', { href: '#/todo' }, 'View all')),
        h('div.due-strip', upcoming.slice(0, 10).map((w) => {
          const c = store.course(w.courseId);
          const meta = L.TYPE_META[w.type] || L.TYPE_META.content;
          const n = L.daysFromToday(w.due);
          return h('a.due-card', { href: w.url || `#/c/${w.courseId}/work`, style: c ? courseColorVars(c) : {}, ...target() },
            h('div.due-when', n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : L.fmtDay(w.due), h('span', L.fmtTime(w.due))),
            h('div.due-title', w.title),
            h('div.due-course', icon(meta.icon), c ? c.code || c.name : ''));
        }))));
    }

    if (!store.courses) {
      page.append(h('section.section', h('div.course-grid', Array.from({ length: 6 }, () => h('div.skeleton.card')))));
      return page;
    }

    // Term filter
    const visible = store.visibleCourses();
    const terms = new Map();
    visible.forEach((c) => { const t = L.termOf(c); terms.set(t.label, t.sort); });
    const termList = [...terms.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    let filter = s.termFilter;
    if (filter !== 'current' && filter !== 'all' && !terms.has(filter)) filter = 'current';
    const shown = visible
      .filter((c) => (filter === 'current' ? L.isCurrent(c) : filter === 'all' ? true : L.termOf(c).label === filter))
      .sort((a, b) => (b.pinned - a.pinned) || a.name.localeCompare(b.name));

    const chip = (value, label) => h(`button.filter-chip${filter === value ? '.selected' : ''}`, { type: 'button', onclick: () => L.settings.set({ termFilter: value }) },
      filter === value ? icon('check') : null, label);

    page.append(h('section.section',
      h('div.section-head',
        h('h2.section-title', 'Your classes'),
        h('div.seg',
          h(`button.seg-btn${s.courseView === 'grid' ? '.on' : ''}`, { type: 'button', title: 'Grid', onclick: () => L.settings.set({ courseView: 'grid' }) }, icon('grid_view')),
          h(`button.seg-btn${s.courseView === 'list' ? '.on' : ''}`, { type: 'button', title: 'List', onclick: () => L.settings.set({ courseView: 'list' }) }, icon('view_agenda')))),
      h('div.chip-row', chip('current', 'Current'), termList.map((t) => chip(t, t)), chip('all', 'All'))));

    if (!shown.length) {
      page.append(L.empty('school', filter === 'current' ? 'No current classes' : 'No classes here', filter === 'current' ? 'Try “All” to see past and upcoming terms.' : null));
      return page;
    }
    page.append(h(`div.${s.courseView === 'list' ? 'course-list' : 'course-grid'}`, shown.map((c) => courseCard(ctx, c))));
    return page;
  };

  function courseCard(ctx, c) {
    const { store } = ctx;
    const items = (store.work || [])
      .filter((w) => String(w.courseId) === String(c.id) && store.status(w) === 'assigned' && w.due && L.daysFromToday(w.due) <= 14)
      .sort((a, b) => new Date(a.due) - new Date(b.due));
    const missing = (store.work || []).filter((w) => String(w.courseId) === String(c.id) && store.status(w) === 'missing').length;
    const term = L.termOf(c).label;
    const img = c.hasImage ? h('img.banner-img', { src: c.image, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null;

    const menu = iconButton('more_vert', 'Class options', (e) => {
      e.preventDefault();
      e.stopPropagation();
      L.dialog({
        title: c.name,
        body: h('div.stack',
          h('a.list-btn', { href: `#/c/${c.id}/classwork` }, icon('auto_stories'), 'Classwork'),
          h('a.list-btn', { href: `#/c/${c.id}/grades` }, icon('grading'), 'Grades'),
          h('a.list-btn', { href: `${c.homeUrl}?lumen=off` }, icon('open_in_new'), 'Open in classic Brightspace'),
          h('button.list-btn', { type: 'button', onclick: () => hideCourse(ctx, c) }, icon('visibility_off'), 'Hide from Lumen')),
        actions: [{ label: 'Close' }],
      });
    }, { class: 'card-menu' });

    return h('article.course-card', { style: courseColorVars(c) },
      h('a.card-banner', { href: `#/c/${c.id}` },
        img,
        h('div.banner-scrim'),
        h('div.banner-text',
          h('h3.card-title', c.name),
          h('div.card-code', [c.code, term].filter(Boolean).join(' · ')))),
      menu,
      h('div.card-avatar', (c.code || c.name).trim()[0]),
      h('div.card-body',
        store.work == null ? h('div.skeleton.line') :
          items.length ? items.slice(0, 3).map((w) => h('a.card-due', { href: w.url || `#/c/${c.id}/work`, ...target() },
            h('span.card-due-when', L.daysFromToday(w.due) <= 0 ? 'Today' : L.fmtShort(w.due)), h('span.card-due-title', w.title)))
            : h('div.card-quiet', 'No work due soon'),
        missing ? h('a.card-missing', { href: `#/c/${c.id}/work` }, icon('error'), `${missing} missing`) : null),
      h('div.card-foot',
        iconButton('campaign', 'Stream', () => ctx.navigate(`#/c/${c.id}`)),
        iconButton('auto_stories', 'Classwork', () => ctx.navigate(`#/c/${c.id}/classwork`)),
        iconButton('assignment', 'Work', () => ctx.navigate(`#/c/${c.id}/work`)),
        iconButton('grading', 'Grades', () => ctx.navigate(`#/c/${c.id}/grades`))));
  }

  function hideCourse(ctx, c) {
    const hidden = new Set(L.settings.get().hidden.map(String));
    hidden.add(String(c.id));
    L.settings.set({ hidden: [...hidden] });
    L.toast(`Hid ${c.name}`, { label: 'Undo', run: () => { hidden.delete(String(c.id)); L.settings.set({ hidden: [...hidden] }); } });
  }

  /* ======================= Past & hidden ======================= */
  V.archived = function (ctx) {
    const { store } = ctx;
    const page = h('div.page', h('h1.headline', 'Past & hidden classes'));
    if (!store.courses) return page.appendChild(L.skeleton(5)) && page;
    const hidden = new Set(L.settings.get().hidden.map(String));
    const rows = store.courses
      .filter((c) => hidden.has(String(c.id)) || !L.isCurrent(c))
      .sort((a, b) => L.termOf(b).sort - L.termOf(a).sort || a.name.localeCompare(b.name));
    if (!rows.length) { page.append(L.empty('inbox', 'Nothing here', 'Hidden and finished classes show up here.')); return page; }
    let lastTerm = '';
    const list = h('div.list-card');
    rows.forEach((c) => {
      const t = L.termOf(c).label;
      if (t !== lastTerm) { list.append(h('div.list-subheader', t)); lastTerm = t; }
      const isHidden = hidden.has(String(c.id));
      list.append(h('div.list-row', { style: courseColorVars(c) },
        h('span.row-avatar', (c.code || c.name)[0]),
        h('a.row-main', { href: `#/c/${c.id}` }, h('span.row-title', c.name), h('span.row-sub', c.code)),
        isHidden
          ? h('button.text-btn', { type: 'button', onclick: () => { hidden.delete(String(c.id)); L.settings.set({ hidden: [...hidden] }); } }, icon('visibility'), 'Show')
          : h('button.text-btn', { type: 'button', onclick: () => hideCourse(ctx, c) }, icon('visibility_off'), 'Hide')));
    });
    page.append(list);
    return page;
  };

  /* ======================= Class ======================= */
  V.course = function (ctx, { id, tab }) {
    const { store, api } = ctx;
    const c = store.course(id) || (store.courses ? null : { id, name: 'Loading…', code: '' });
    if (!c) return h('div.page', L.empty('school', 'Class not found', 'You may no longer be enrolled in this class.'));
    const tabs = [['stream', 'Stream'], ['classwork', 'Classwork'], ['work', 'Work'], ['grades', 'Grades']];
    if (!tabs.some(([k]) => k === tab)) tab = 'stream';
    const base = api.base;

    const page = h('div.page.course-page', { style: courseColorVars(c) },
      h('section.course-banner',
        c.hasImage ? h('img.banner-img', { src: c.image, alt: '', onerror: (e) => e.target.remove() }) : null,
        h('div.banner-scrim'),
        h('div.course-banner-text',
          h('h1.course-title', c.name),
          h('div.course-sub', [c.code, c.start ? L.termOf(c).label : ''].filter(Boolean).join(' · '))),
        h('div.course-links',
          h('a.banner-chip', { href: `${base}/d2l/le/${c.id}/discussions/List`, ...target() }, icon('forum'), 'Discussions'),
          h('a.banner-chip', { href: `${base}/d2l/lms/classlist/classlist.d2l?ou=${c.id}`, ...target() }, icon('groups'), 'Classlist'),
          h('a.banner-chip', { href: `${base}/d2l/home/${c.id}?lumen=off` }, icon('open_in_new'), 'Classic view'))),
      h('nav.tabs', { role: 'tablist' }, tabs.map(([k, label]) =>
        h(`a.tab${k === tab ? '.active' : ''}`, { href: `#/c/${c.id}/${k}`, role: 'tab', 'aria-selected': String(k === tab) }, label))));

    const body = h('div.tab-body');
    page.append(body);
    if (tab === 'stream') body.append(streamTab(ctx, c));
    if (tab === 'classwork') body.append(classworkTab(ctx, c));
    if (tab === 'work') body.append(workTab(ctx, c));
    if (tab === 'grades') body.append(gradesTab(ctx, c));
    return page;
  };

  function streamTab(ctx, c) {
    const { store, api } = ctx;
    const upcoming = (store.work || [])
      .filter((w) => String(w.courseId) === String(c.id) && store.status(w) !== 'done' && (!w.due || L.daysFromToday(w.due) >= -7))
      .sort((a, b) => new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15))
      .slice(0, 5);
    const aside = h('aside.stream-aside',
      h('div.side-card',
        h('div.side-title', 'Upcoming'),
        store.work == null ? L.skeleton(2, 'line')
          : upcoming.length ? upcoming.map((w) => h('a.side-item', { href: w.url || '#', ...target() }, h('span.side-when', w.due ? L.dueLabel(w.due) : 'No due date'), h('span.side-what', w.title)))
            : h('div.muted.small', 'Woohoo, no work due soon!'),
        h('a.text-btn.end', { href: `#/c/${c.id}/work` }, 'View all')),
      h('div.side-card',
        h('div.side-title', 'Jump to'),
        h('a.side-link', { href: `#/c/${c.id}/classwork` }, icon('auto_stories'), 'Course content'),
        h('a.side-link', { href: `#/c/${c.id}/grades` }, icon('grading'), 'My grades'),
        h('a.side-link', { href: `${api.base}/d2l/lms/dropbox/user/folders_list.d2l?ou=${c.id}`, ...target() }, icon('assignment'), 'Assignment dropbox'),
        h('a.side-link', { href: `${api.base}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${c.id}`, ...target() }, icon('quiz'), 'Quizzes')));

    const feed = loadInto(() => api.news(c.id), (news) => {
      if (!news.length) return L.empty('campaign', 'No announcements yet', 'This is where your instructor’s announcements will appear.');
      return h('div.feed', news.map((n) => {
        const bodyEl = h('div.prose', { html: L.sanitize(n.html) });
        const card = h('article.post',
          h('header.post-head',
            h('span.post-avatar', icon('campaign', { fill: true })),
            h('div', h('div.post-title', n.title), h('div.post-date', n.date ? `${L.fmtDay(n.date)} · ${L.relative(n.date)}` : ''))),
          bodyEl,
          n.attachments.length ? h('div.attach-row', n.attachments.map((a) => h('a.attach-chip', { href: a.url, target: '_blank', rel: 'noopener' }, icon('attach_file'), a.name))) : null);
        requestAnimationFrame(() => {
          if (bodyEl.scrollHeight > 320) {
            bodyEl.classList.add('clamped');
            const more = h('button.text-btn.more', { type: 'button', onclick: () => { bodyEl.classList.toggle('clamped'); more.textContent = bodyEl.classList.contains('clamped') ? 'Show more' : 'Show less'; } }, 'Show more');
            bodyEl.after(more);
          }
        });
        return card;
      }));
    }, h('div.feed', L.skeleton(3, 'post')));

    return h('div.stream', aside, h('div.stream-main', feed));
  }

  function classworkTab(ctx, c) {
    const { api } = ctx;
    const key = (mid) => `${c.id}:${mid}`;
    return loadInto(() => api.toc(c.id), (modules) => {
      if (!modules.length) return L.empty('auto_stories', 'No content yet', 'Your instructor hasn’t posted any course content.');
      const search = h('input.field-input', { type: 'search', placeholder: 'Search this class’s content', value: ui.classworkQuery, 'aria-label': 'Search classwork' });
      const listHost = h('div.modules');
      const count = (m) => m.topics.length + m.modules.reduce((n, x) => n + count(x), 0);
      const unread = (m) => m.topics.filter((t) => t.unread).length + m.modules.reduce((n, x) => n + unread(x), 0);

      const topicRow = (t) => {
        const meta = L.TYPE_META[t.type] || L.TYPE_META.doc;
        return h(`a.topic${t.unread ? '.unread' : ''}`, { href: t.viewUrl, ...target() },
          h('span.topic-icon', icon(meta.icon)),
          h('span.topic-main', h('span.topic-title', t.title), h('span.topic-sub', meta.label, t.due ? ` · ${L.dueLabel(t.due)}` : '')),
          t.locked ? icon('lock') : null,
          t.unread ? h('span.unread-dot', { title: 'New' }) : null);
      };

      const moduleEl = (m, depth, q, index = -1) => {
        const match = (t) => !q || t.title.toLowerCase().includes(q);
        const topics = m.topics.filter(match);
        const subs = m.modules.map((s) => moduleEl(s, depth + 1, q)).filter(Boolean);
        if (q && !topics.length && !subs.length && !m.title.toLowerCase().includes(q)) return null;
        // Default: the first module and anything with new items start open.
        const open = q ? true : ui.expanded.has(key(m.id)) ? ui.expanded.get(key(m.id)) : index === 0 || (depth === 0 && unread(m) > 0);
        const n = count(m), u = unread(m);
        const el = h(`section.module.depth-${Math.min(depth, 2)}${open ? '.open' : ''}`,
          h('button.module-head', { type: 'button', 'aria-expanded': String(open), onclick: () => {
            const now = !el.classList.contains('open');
            el.classList.toggle('open', now);
            ui.expanded.set(key(m.id), now);
          } },
            h('span.module-icon', icon(depth ? 'folder' : 'folder_open')),
            h('span.module-title', m.title),
            u ? h('span.pill', `${u} new`) : null,
            h('span.module-count', `${n} item${n === 1 ? '' : 's'}`),
            h('span.chev', icon('keyboard_arrow_down'))),
          h('div.module-body',
            m.description && depth === 0 ? h('div.prose.module-desc', { html: L.sanitize(m.description) }) : null,
            topics.map(topicRow),
            subs,
            !topics.length && !subs.length ? h('div.muted.small.pad', 'Empty module') : null));
        return el;
      };

      const draw = () => {
        const q = ui.classworkQuery.toLowerCase();
        const els = modules.map((m, i) => moduleEl(m, 0, q, i)).filter(Boolean);
        listHost.replaceChildren(...(els.length ? els : [L.empty('search', 'No matches', `Nothing in this class matches “${ui.classworkQuery}”.`)]));
      };
      search.addEventListener('input', () => { ui.classworkQuery = search.value.trim(); draw(); });
      const setAll = (v) => { const walk = (ms) => ms.forEach((m) => { ui.expanded.set(key(m.id), v); walk(m.modules); }); walk(modules); draw(); };
      draw();
      return h('div.classwork',
        h('div.toolbar',
          h('div.field', icon('search'), search),
          h('button.text-btn', { type: 'button', onclick: () => setAll(true) }, icon('unfold_more'), 'Expand all'),
          h('button.text-btn', { type: 'button', onclick: () => setAll(false) }, icon('unfold_less'), 'Collapse all')),
        listHost);
    }, L.skeleton(5, 'module'));
  }

  function workTab(ctx, c) {
    const { store, api } = ctx;
    return loadInto(async () => {
      const [a, q] = await Promise.all([api.assignments(c.id).catch(() => []), api.quizzes(c.id).catch(() => [])]);
      // Prefer the completion-aware feed, add anything it doesn't know about.
      const fromFeed = (store.work || []).filter((w) => String(w.courseId) === String(c.id));
      const titles = new Set(fromFeed.map((w) => `${w.type}:${w.title}`));
      return [...fromFeed, ...[...a, ...q].filter((x) => !titles.has(`${x.type}:${x.title}`))];
    }, (items) => {
      if (!items.length) return L.empty('assignment', 'No assignments or quizzes', 'Anything your instructor assigns will be listed here.');
      const groups = { missing: [], assigned: [], nodate: [], done: [] };
      items.forEach((w) => {
        const s = store.status(w);
        if (s === 'assigned' && !w.due) groups.nodate.push(w);
        else groups[s].push(w);
      });
      groups.assigned.sort((a, b) => new Date(a.due) - new Date(b.due));
      groups.missing.sort((a, b) => new Date(b.due) - new Date(a.due));
      groups.done.sort((a, b) => new Date(b.due || 0) - new Date(a.due || 0));
      const section = (title, list, ic) => list.length ? h('section.work-group', h('h3.group-title', icon(ic), title, h('span.count', list.length)), h('div.list-card', list.map((w) => workRow(ctx, w, { showCourse: false })))) : null;
      return h('div.work',
        section('Missing', groups.missing, 'error'),
        section('Upcoming', groups.assigned, 'schedule'),
        section('No due date', groups.nodate, 'event'),
        section('Done', groups.done, 'task_alt'));
    });
  }

  function gradeRing(percent, size = 120) {
    const r = 52, circ = 2 * Math.PI * r, p = Math.max(0, Math.min(100, percent || 0));
    const svg = `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="ring-track"/><circle cx="60" cy="60" r="${r}" class="ring-value" stroke-dasharray="${(p / 100) * circ} ${circ}" transform="rotate(-90 60 60)"/></svg>`;
    return h('div.ring', { html: svg }, h('span.ring-label', percent == null ? '—' : `${Math.round(percent)}%`));
  }

  function gradesTab(ctx, c) {
    return loadInto(() => ctx.api.grades(c.id), (g) => {
      if (!g.items.length && !g.final) return L.empty('grading', 'No grades released yet', 'Grades appear here once your instructor publishes them.');
      const graded = g.items.filter((x) => x.percent != null);
      const avg = currentGrade(g);
      return h('div.grades',
        h('div.grade-summary',
          gradeRing(g.final ? g.final.percent : avg && avg.value),
          h('div',
            h('div.summary-label', g.final ? 'Final grade' : avg && avg.weighted ? 'Current weighted grade' : 'Average of released grades'),
            h('div.summary-value', g.final && g.final.display ? g.final.display : avg ? `${avg.value.toFixed(1)}%` : '—'),
            h('div.muted.small', `${graded.length} of ${g.items.length} item${g.items.length === 1 ? '' : 's'} graded`))),
        h('div.list-card', g.items.map((x) =>
          h('div.grade-row',
            h('div.grade-main',
              h('div.grade-name', x.name),
              x.weight ? h('div.grade-sub', `Worth ${x.weight}%${x.weighted != null ? ` · earned ${(+x.weighted).toFixed(2)}%` : ''}`) : null,
              x.comment ? h('div.grade-comment', L.textOf(x.comment)) : null),
            h('div.grade-score',
              h('div.score', x.denominator ? `${fmtNum(x.numerator)}/${fmtNum(x.denominator)}` : x.display || '—'),
              x.percent != null ? h('div.bar', h('span', { style: { width: `${Math.min(100, x.percent)}%` } })) : null)))));
    });
  }
  /** Weighted grade so far (earned weight ÷ released weight), else a plain average. */
  function currentGrade(g) {
    const graded = g.items.filter((x) => x.percent != null);
    if (!graded.length) return null;
    const w = graded.filter((x) => x.weight > 0 && x.weighted != null);
    if (w.length === graded.length) {
      const tot = w.reduce((s, x) => s + +x.weight, 0);
      return { value: (w.reduce((s, x) => s + +x.weighted, 0) / tot) * 100, weighted: true };
    }
    return { value: graded.reduce((s, x) => s + x.percent, 0) / graded.length, weighted: false };
  }
  const fmtNum = (n) => (n == null ? '–' : Number.isInteger(+n) ? String(n) : (+n).toFixed(1));

  /* ======================= To-do ======================= */
  V.todo = function (ctx, { tab }) {
    const { store } = ctx;
    tab = ['assigned', 'missing', 'done'].includes(tab) ? tab : 'assigned';
    const page = h('div.page', h('h1.headline', 'To-do'));
    const courses = store.currentCourses();
    const all = (store.work || []).filter((w) => ui.todoCourse === 'all' || String(w.courseId) === ui.todoCourse);
    const by = { assigned: [], missing: [], done: [] };
    all.forEach((w) => by[store.status(w)].push(w));

    page.append(h('nav.tabs.inline', ['assigned', 'missing', 'done'].map((k) =>
      h(`a.tab${k === tab ? '.active' : ''}`, { href: `#/todo/${k}` }, k[0].toUpperCase() + k.slice(1), store.work ? h('span.tab-count', by[k].length) : null))));

    const select = h('select.select', { 'aria-label': 'Filter by class', onchange: (e) => { ui.todoCourse = e.target.value; ctx.render(); } },
      h('option', { value: 'all' }, 'All classes'),
      courses.map((c) => h('option', { value: String(c.id), selected: ui.todoCourse === String(c.id) }, c.name)));
    page.append(h('div.toolbar', h('div.select-wrap', icon('filter_list'), select)));

    if (store.work == null) { page.append(L.skeleton(6, 'row')); return page; }
    const list = by[tab];
    if (!list.length) {
      page.append(tab === 'missing' ? L.empty('task_alt', 'Nothing missing', 'You’re all caught up.')
        : tab === 'done' ? L.empty('done_all', 'Nothing marked done yet', 'Tick items off as you finish them.')
          : L.empty('checklist', 'No work assigned', 'New assignments, quizzes and readings land here.'));
      return page;
    }
    const buckets = new Map();
    const bucketOf = (w) => {
      if (!w.due) return ['No due date', 99];
      const n = L.daysFromToday(w.due);
      const dow = new Date().getDay();
      const toEndOfWeek = 6 - dow;
      if (tab === 'assigned') {
        if (n <= toEndOfWeek) return ['This week', 1];
        if (n <= toEndOfWeek + 7) return ['Next week', 2];
        return ['Later', 3];
      }
      if (n >= -dow) return ['This week', 1];
      if (n >= -dow - 7) return ['Last week', 2];
      return ['Earlier', 3];
    };
    list.sort((a, b) => (tab === 'assigned' ? 1 : -1) * (new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15)));
    list.forEach((w) => { const [b, o] = bucketOf(w); if (!buckets.has(b)) buckets.set(b, { o, items: [] }); buckets.get(b).items.push(w); });
    [...buckets.entries()].sort((a, b) => a[1].o - b[1].o).forEach(([label, { items }]) => {
      page.append(h('section.work-group', h('h3.group-title', label, h('span.count', items.length)), h('div.list-card', items.map((w) => workRow(ctx, w)))));
    });
    return page;
  };

  /* ======================= Calendar ======================= */
  V.calendar = function (ctx, { offset }) {
    const { store } = ctx;
    const weekOffset = Number(offset) || 0;
    const start = L.startOfDay(new Date());
    start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
    const end = new Date(days[6]); end.setDate(end.getDate() + 1);
    const label = `${L.fmtShort(days[0])} – ${L.fmtShort(days[6])}, ${days[6].getFullYear()}`;

    const page = h('div.page.calendar-page',
      h('div.cal-head',
        h('h1.headline', 'Calendar'),
        h('div.cal-nav',
          h('a.outlined-btn', { href: '#/calendar/0' }, 'Today'),
          h('a.icon-btn', { href: `#/calendar/${weekOffset - 1}`, title: 'Previous week', 'aria-label': 'Previous week' }, icon('chevron_left')),
          h('a.icon-btn', { href: `#/calendar/${weekOffset + 1}`, title: 'Next week', 'aria-label': 'Next week' }, icon('chevron_right')),
          h('span.cal-range', label))));

    if (store.work == null) { page.append(L.skeleton(1, 'cal')); return page; }
    const inWeek = store.work.filter((w) => w.due && new Date(w.due) >= start && new Date(w.due) < end);
    const today = L.startOfDay(new Date()).getTime();
    page.append(h('div.week', days.map((d) => {
      const items = inWeek.filter((w) => L.startOfDay(w.due).getTime() === d.getTime()).sort((a, b) => new Date(a.due) - new Date(b.due));
      return h(`div.day${d.getTime() === today ? '.today' : ''}`,
        h('div.day-head', h('span.dow', d.toLocaleDateString(undefined, { weekday: 'short' })), h('span.dom', d.getDate())),
        h('div.day-items', items.map((w) => {
          const c = store.course(w.courseId);
          const s = store.status(w);
          return h(`a.event.status-${s}`, { href: w.url || `#/c/${w.courseId}/work`, style: c ? courseColorVars(c) : {}, title: w.title, ...target() },
            h('span.event-time', L.fmtTime(w.due)),
            h('span.event-title', s === 'done' ? icon('check_circle', { fill: true }) : null, w.title),
            h('span.event-course', c ? c.code || c.name : ''));
        }), !items.length ? h('div.day-empty') : null));
    })));
    if (!inWeek.length) page.append(h('p.muted.center', 'Nothing due this week.'));
    return page;
  };

  /* ======================= Grades overview ======================= */
  V.grades = function (ctx) {
    const { store, api } = ctx;
    const page = h('div.page', h('h1.headline', 'Grades'), h('p.muted', 'Released grades across your current classes. Select a class for the full breakdown.'));
    if (!store.courses) { page.append(L.skeleton(4, 'row')); return page; }
    const courses = store.currentCourses();
    if (!courses.length) { page.append(L.empty('grading', 'No current classes')); return page; }
    page.append(h('div.grade-grid', courses.map((c) =>
      h('a.grade-card', { href: `#/c/${c.id}/grades`, style: courseColorVars(c) },
        h('div.grade-card-head', h('div.grade-card-title', c.name), h('div.muted.small', c.code)),
        loadInto(() => api.grades(c.id), (g) => {
          const graded = g.items.filter((x) => x.percent != null);
          const cur = currentGrade(g);
          const avg = g.final ? g.final.percent : cur && cur.value;
          return h('div.grade-card-body', gradeRing(avg, 84),
            h('div', h('div.summary-label', g.final ? 'Final' : 'Current average'), h('div.muted.small', `${graded.length} graded item${graded.length === 1 ? '' : 's'}`)));
        }, h('div.skeleton.line'))))));
    return page;
  };

  /* ======================= Settings ======================= */
  L.openSettings = function (ctx) {
    const s = L.settings.get();
    const seg = (key, opts) => h('div.seg.wide', opts.map(([v, label, ic]) =>
      h(`button.seg-btn${s[key] === v ? '.on' : ''}`, { type: 'button', onclick: () => { L.settings.set({ [key]: v }); close(); L.openSettings(ctx); } }, ic ? icon(ic) : null, label)));
    const swatches = h('div.swatches', L.SEEDS.map((seed) => {
      const sw = h(`button.swatch${s.seed === seed.hue ? '.on' : ''}`, { type: 'button', title: seed.name, 'aria-label': seed.name, onclick: () => { L.settings.set({ seed: seed.hue }); close(); L.openSettings(ctx); } });
      sw.style.background = L.courseAccent(seed.hue, false);
      return sw;
    }));
    const toggle = (key, label, sub) => h('label.switch-row',
      h('span', h('span.switch-label', label), sub ? h('span.switch-sub', sub) : null),
      h('input.switch', { type: 'checkbox', checked: !!s[key], onchange: (e) => L.settings.set({ [key]: e.target.checked }) }));

    const close = L.dialog({
      title: 'Settings',
      body: h('div.settings',
        h('div.setting-label', 'Theme'),
        seg('mode', [['system', 'System', 'tune'], ['light', 'Light', 'light_mode'], ['dark', 'Dark', 'dark_mode']]),
        h('div.setting-label', 'Accent color'),
        swatches,
        h('div.setting-label', 'Density'),
        seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']]),
        toggle('newTab', 'Open Brightspace pages in a new tab', 'Keeps Lumen open while you read files and submit work.'),
        ctx.web ? null : toggle('enabled', 'Replace the Brightspace homepage', 'When off, Brightspace looks normal and Lumen is a button away.'),
        h('p.muted.small', 'Lumen only reads from Brightspace. Hidden classes and items you tick off are stored in this browser.')),
      actions: [{ label: 'Done', primary: true }],
    });
  };
})();
