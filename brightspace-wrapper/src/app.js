/* App shell: data store, router, top app bar and navigation drawer. */
(function () {
  const L = (window.Lumen = window.Lumen || {});
  const { h, icon, iconButton } = L;

  L.mount = function (root, api, opts = {}) {
    root.classList.add('lumen-app');
    root.innerHTML = '';

    /* ---------------- store ---------------- */
    const store = {
      me: null,
      courses: null,
      work: null,
      error: null,
      listeners: new Set(),
      emit() { store.listeners.forEach((f) => f()); },
      visibleCourses() {
        const hidden = new Set(L.settings.get().hidden.map(String));
        return (store.courses || []).filter((c) => !hidden.has(String(c.id)));
      },
      currentCourses() { return store.visibleCourses().filter(L.isCurrent); },
      course(id) { return (store.courses || []).find((c) => String(c.id) === String(id)); },
      status(item) {
        const o = L.doneStore.all()[item.key];
        const done = o != null ? o : item.done;
        if (done) return 'done';
        if (item.due && new Date(item.due) < new Date()) return 'missing';
        return 'assigned';
      },
      async load(force = false) {
        if (force) api.clearCache();
        store.error = null;
        try {
          const [me, courses] = await Promise.all([api.whoami().catch(() => null), api.courses()]);
          store.me = me;
          // Give every class its own well-separated color, stable across visits.
          const HUES = [265, 150, 30, 230, 340, 85, 195, 300, 10, 120, 250, 60];
          [...courses].sort((a, b) => a.id - b.id).forEach((c, i) => { c.hue = HUES[i % HUES.length]; });
          store.courses = courses;
          store.emit();
          const ids = store.currentCourses().map((c) => c.id);
          store.work = await api.workItems(ids).catch(() => []);
          // de-duplicate (same item may arrive from several sources)
          const seen = new Set();
          store.work = store.work.filter((w) => {
            const k = `${w.courseId}:${w.type}:${w.title}:${w.due}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        } catch (e) {
          store.error = e;
        }
        store.emit();
      },
    };

    /* ---------------- theme ---------------- */
    let currentHue = L.settings.get().seed;
    const applyTheme = (hue = currentHue) => {
      currentHue = hue;
      L.applyScheme(root, hue, L.settings.get().mode);
      root.dataset.density = L.settings.get().density;
    };
    applyTheme();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

    /* ---------------- shell ---------------- */
    const searchInput = h('input.search-input', { type: 'search', placeholder: 'Search classes and work', 'aria-label': 'Search', autocomplete: 'off' });
    const searchResults = h('div.search-results', { role: 'listbox' });
    const searchBox = h('div.search-box', icon('search'), searchInput, searchResults);
    const titleEl = h('div.top-title');
    const avatar = h('button.avatar-btn', { type: 'button', title: 'Account', onclick: () => openAccount() }, '?');
    const themeBtn = iconButton('dark_mode', 'Toggle dark theme', () => {
      const dark = L.isDark(L.settings.get().mode);
      L.settings.set({ mode: dark ? 'light' : 'dark' });
    });

    const topBar = h('header.top-bar',
      iconButton('menu', 'Main menu', () => toggleDrawer()),
      h('a.brand', { href: '#/', title: 'Lumen home' }, h('span.brand-mark', icon('school', { fill: true })), h('span.brand-name', 'Lumen')),
      titleEl,
      h('div.top-spacer'),
      searchBox,
      h('div.top-actions',
        iconButton('refresh', 'Refresh from Brightspace', async () => { L.toast('Refreshing…'); await store.load(true); render(); }),
        themeBtn,
        iconButton('settings', 'Settings', () => L.openSettings(ctx)),
        avatar));

    const drawer = h('nav.drawer', { 'aria-label': 'Main' });
    const drawerScrim = h('div.drawer-scrim', { onclick: () => toggleDrawer(false) });
    const main = h('main.main', { id: 'lumen-main', tabindex: '-1' });
    root.append(topBar, h('div.layout', drawer, drawerScrim, main));

    function toggleDrawer(force) {
      const open = force != null ? force : !root.classList.contains('drawer-open');
      root.classList.toggle('drawer-open', open);
      if (window.innerWidth >= 1100 && force == null) {
        root.classList.toggle('drawer-collapsed', !root.classList.contains('drawer-collapsed'));
        root.classList.remove('drawer-open');
      }
    }

    function navItem(href, iconName, label, active, extra) {
      return h(`a.nav-item${active ? '.active' : ''}`, { href, title: label, onclick: () => toggleDrawer(false) },
        extra || h('span.nav-icon', icon(iconName, { fill: active })),
        h('span.nav-label', label));
    }

    function renderDrawer(route) {
      const r = route.name;
      const cid = route.params.id;
      const courses = store.currentCourses();
      const workCount = (store.work || []).filter((w) => store.status(w) === 'missing').length;
      drawer.replaceChildren(...[
        navItem('#/', 'home', 'Classes', r === 'home'),
        navItem('#/calendar', 'calendar_month', 'Calendar', r === 'calendar'),
        navItem('#/todo', 'checklist', 'To-do', r === 'todo',
          h('span.nav-icon', icon('checklist'), workCount ? h('span.badge', workCount > 99 ? '99+' : workCount) : null)),
        navItem('#/grades', 'grading', 'Grades', r === 'grades'),
        h('div.nav-divider'),
        h('div.nav-heading', 'Enrolled'),
        courses.map((c) => {
          const hue = L.courseHue(c);
          return navItem(`#/c/${c.id}`, null, c.name, String(cid) === String(c.id),
            h('span.nav-avatar', { style: { background: L.courseAccent(hue, L.isDark(L.settings.get().mode)) } }, (c.code || c.name).trim()[0] || '?'));
        }),
        courses.length === 0 && store.courses ? h('div.nav-hint', 'No current classes') : null,
        h('div.nav-divider'),
        navItem('#/archived', 'inbox', 'Past & hidden classes', r === 'archived'),
        opts.web
          ? h('a.nav-item', { href: `${api.base}/d2l/home`, target: '_blank', rel: 'noopener', title: 'Open Brightspace' }, h('span.nav-icon', icon('open_in_new')), h('span.nav-label', 'Open Brightspace'))
          : h('a.nav-item', { href: `${api.base}/d2l/home?lumen=off`, title: 'Classic Brightspace' }, h('span.nav-icon', icon('swap_horiz')), h('span.nav-label', 'Classic Brightspace')),
      ].flat().filter(Boolean));
    }

    function openAccount() {
      const me = store.me;
      L.dialog({
        title: me ? `${me.FirstName} ${me.LastName}` : 'Account',
        body: h('div.stack',
          me && h('p.muted', me.UniqueName || ''),
          h('p', opts.connectionNote || 'Lumen reads your classes straight from Brightspace using the session you are already signed into. Nothing is sent anywhere else.'),
          opts.onDisconnect
            ? h('button.tonal-btn', { type: 'button', onclick: opts.onDisconnect }, icon('swap_horiz'), 'Disconnect / switch school')
            : h('a.text-btn', { href: `${api.base}/d2l/logout` }, icon('login'), 'Sign out of Brightspace')),
        actions: [{ label: 'Close' }],
      });
    }

    /* ---------------- search ---------------- */
    let searchTerm = '';
    searchInput.addEventListener('input', () => { searchTerm = searchInput.value.trim().toLowerCase(); renderSearch(); });
    searchInput.addEventListener('focus', () => renderSearch());
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; searchTerm = ''; renderSearch(); searchInput.blur(); }
      if (e.key === 'Enter') { const first = searchResults.querySelector('a'); if (first) { first.click(); } }
    });
    document.addEventListener('click', (e) => { if (!searchBox.contains(e.target)) searchResults.classList.remove('open'); });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); searchInput.focus(); }
    });
    function renderSearch() {
      if (!searchTerm) { searchResults.classList.remove('open'); searchResults.replaceChildren(); return; }
      const cs = (store.courses || []).filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(searchTerm)).slice(0, 6);
      const ws = (store.work || []).filter((w) => w.title.toLowerCase().includes(searchTerm)).slice(0, 8);
      const close = () => { searchInput.value = ''; searchTerm = ''; searchResults.classList.remove('open'); };
      searchResults.replaceChildren(...[
        cs.length ? h('div.sr-heading', 'Classes') : null,
        cs.map((c) => h('a.sr-item', { href: `#/c/${c.id}`, onclick: close }, h('span.sr-dot', { style: { background: L.courseAccent(L.courseHue(c), L.isDark(L.settings.get().mode)) } }), h('span', c.name), h('span.sr-meta', c.code))),
        ws.length ? h('div.sr-heading', 'Work') : null,
        ws.map((w) => {
          const c = store.course(w.courseId);
          return h('a.sr-item', { href: w.url || `#/c/${w.courseId}/work`, onclick: close }, icon(L.TYPE_META[w.type]?.icon || 'article'), h('span', w.title), h('span.sr-meta', c ? c.code || c.name : ''));
        }),
        !cs.length && !ws.length ? h('div.sr-empty', `No results for “${searchInput.value}”`) : null,
        h('div.sr-hint', 'Tip: open a class and use Classwork search to find any file or topic.'),
      ].flat().filter(Boolean));
      searchResults.classList.add('open');
    }

    /* ---------------- router ---------------- */
    function parse() {
      const hash = location.hash.replace(/^#/, '') || '/';
      const parts = hash.split('/').filter(Boolean);
      if (parts[0] === 'c' && parts[1]) return { name: 'course', params: { id: parts[1], tab: parts[2] || 'stream' } };
      if (['todo', 'calendar', 'grades', 'archived'].includes(parts[0])) return { name: parts[0], params: { tab: parts[1], offset: parts[1] } };
      return { name: 'home', params: {} };
    }

    const ctx = { api, store, root, web: !!opts.web, navigate: (hash) => { location.hash = hash; }, applyTheme, render: () => render() };
    let lastRouteKey = '';

    function render() {
      const route = parse();
      const key = `${route.name}:${route.params.id || ''}`;
      if (key !== lastRouteKey) { main.scrollTop = 0; window.scrollTo(0, 0); }
      lastRouteKey = key;

      // Per-course dynamic color, otherwise the user's seed.
      const course = route.name === 'course' ? store.course(route.params.id) : null;
      applyTheme(course ? L.courseHue(course) : L.settings.get().seed);
      themeBtn.replaceChildren(icon(L.isDark(L.settings.get().mode) ? 'light_mode' : 'dark_mode'));

      if (store.me) avatar.textContent = (store.me.FirstName || '?')[0];
      titleEl.textContent = course ? course.name : '';
      root.classList.toggle('in-course', !!course);
      renderDrawer(route);

      if (store.error && !store.courses) { main.replaceChildren(L.errorState(store.error, () => store.load(true))); return; }
      const view = L.views[route.name] || L.views.home;
      main.replaceChildren(view(ctx, route.params));
    }

    window.addEventListener('scroll', () => root.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
    window.addEventListener('hashchange', render);
    window.addEventListener('lumen:settings', render);
    store.listeners.add(render);

    if (opts.initialRoute && !location.hash) history.replaceState(null, '', opts.initialRoute);
    render();
    store.load();
    return ctx;
  };
})();
