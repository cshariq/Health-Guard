/*
 * Lumen website: the same Lumen app as the extension, hosted on its own domain.
 *
 * A normal website can't read another site's logged-in data, so the website
 * connects to Brightspace in one of three ways:
 *   1. extension: the Lumen extension makes the API calls with your Brightspace
 *      login (src/bridge.js). Works for any student, today.
 *   2. oauth: official "Sign in with Brightspace" (OAuth 2.0) through web/server.mjs.
 *      Needs the school to register Lumen as an app in Brightspace.
 *   3. demo: sample data, no account needed.
 */
(function () {
  const L = window.Lumen;
  const { h, icon } = L;

  // Fixed by the "key" in manifest.json, so it's the same for everyone who loads the extension.
  const EXT_ID = 'olgakggjgkjippiinfgkjghidbfjaepp';
  const SCHOOLS = [
    { id: 'carleton', name: 'Carleton University', host: 'https://brightspace.carleton.ca', hue: 25 },
    { id: 'uwaterloo', name: 'University of Waterloo', host: 'https://learn.uwaterloo.ca', hue: 85 },
  ];
  const CKEY = 'lumen:web:connection';
  let serverSchools = []; // extra schools announced by web/server.mjs (config.json)
  const root = document.getElementById('app');
  L.settingsDefaults.newTab = true; // keep Lumen open when jumping into Brightspace

  const conn = {
    get() { try { return JSON.parse(localStorage.getItem(CKEY)); } catch { return null; } },
    set(v) { localStorage.setItem(CKEY, JSON.stringify(v)); },
    clear() { localStorage.removeItem(CKEY); },
  };

  /* ---------------- transports ---------------- */
  function extSend(msg, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const rt = window.chrome && window.chrome.runtime;
      if (!rt || !rt.sendMessage) return reject(new Error('Lumen extension not found'));
      const t = setTimeout(() => reject(new Error('The Lumen extension did not respond')), timeout);
      try {
        rt.sendMessage(EXT_ID, msg, (res) => {
          clearTimeout(t);
          if (rt.lastError || !res) reject(new Error((rt.lastError && rt.lastError.message) || 'Lumen extension not found'));
          else resolve(res);
        });
      } catch (e) { clearTimeout(t); reject(e); }
    });
  }
  const detectExtension = () => extSend({ type: 'ping' }, 1500).catch(() => null);

  const responseLike = (status, contentType, body) => ({
    ok: status >= 200 && status < 400, status,
    headers: { get: () => contentType || 'application/json' },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  function extensionFetch() {
    return async (url) => {
      const r = await extSend({ type: 'get', url }, 45000);
      if (r.error === 'consent_required') { const e = new Error('Approve this website in the Lumen popup, then try again.'); e.status = 'consent'; throw e; }
      if (r.error === 'forbidden') throw new Error('That Brightspace address isn’t allowed by the extension.');
      if (r.error) throw new Error(r.message || 'The Lumen extension couldn’t reach Brightspace.');
      return responseLike(r.status, r.contentType, r.body);
    };
  }

  // OAuth mode: web/server.mjs holds the token and forwards read-only API calls.
  const proxyFetch = () => (url) => {
    const u = new URL(url, location.href);
    return fetch('/bs' + u.pathname + u.search, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  };

  /* ---------------- start the app ---------------- */
  function startApp(c) {
    const school = serverSchools.find((s) => s.id === c.school) || SCHOOLS.find((s) => s.id === c.school) || { name: c.host, host: c.host };
    let api, note;
    if (c.mode === 'demo') {
      api = L.createApi({ fetch: window.mockBrightspaceFetch, imageBase: null });
      note = 'You’re exploring Lumen with sample data. Connect your school to see your real classes.';
      L.loginUrl = '#/';
    } else if (c.mode === 'oauth') {
      api = L.createApi({ base: school.host, fetch: proxyFetch(), imageBase: '/bs' });
      note = `Signed in to ${school.name} with Brightspace. Lumen only has read access.`;
      L.loginUrl = `/auth/login?school=${encodeURIComponent(c.school)}`;
    } else {
      api = L.createApi({ base: school.host, fetch: extensionFetch(), imageBase: null });
      note = `Connected to ${school.name} through the Lumen extension, using your Brightspace login. Nothing is stored on any server.`;
      L.loginUrl = `${school.host}/d2l/login`;
    }
    L.contentBase = c.mode === 'demo' ? '' : school.host;
    root.className = '';
    L.mount(root, api, {
      web: true,
      initialRoute: '#/',
      connectionNote: note,
      onDisconnect: () => {
        conn.clear();
        api.clearCache(); // don't leave Brightspace data behind on a shared computer
        if (c.mode === 'oauth') location.href = '/auth/logout';
        else { location.hash = ''; location.reload(); }
      },
    });
    if (c.mode === 'demo') {
      root.prepend(h('div.demo-banner', icon('info'), h('span', 'Sample data. '),
        h('button.text-btn', { type: 'button', onclick: () => { conn.clear(); location.hash = ''; location.reload(); } }, 'Connect your school')));
    }
  }

  /* ---------------- connect screen ---------------- */
  async function showConnect(message) {
    root.className = 'lumen-app connect-page';
    L.applyScheme(root, 270, L.settings.get().mode);
    const [ext, config] = await Promise.all([
      detectExtension(),
      fetch('config.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    const oauthSchools = new Set(config.oauth || []);
    let selected = (conn.get() && conn.get().school) || 'carleton';
    let other = '';

    const schoolHost = () => {
      if (selected !== 'other') return SCHOOLS.find((s) => s.id === selected).host;
      const v = other.trim().replace(/\/+$/, '');
      if (!v) return null;
      return /^https?:\/\//.test(v) ? v : `https://${v}`;
    };

    const status = h('div.connect-status', message ? h('div.notice.error', icon('error'), message) : null);
    const methods = h('div.methods');
    const schoolList = h('div.schools');

    const drawSchools = () => schoolList.replaceChildren(...[
      ...SCHOOLS.map((s) => h(`button.school${selected === s.id ? '.on' : ''}`, { type: 'button', onclick: () => { selected = s.id; drawSchools(); drawMethods(); } },
        h('span.school-mark', { style: { background: L.courseAccent(s.hue, L.isDark(L.settings.get().mode)) } }, s.name[0]),
        h('span.school-text', h('span.school-name', s.name), h('span.school-host', s.host.replace('https://', ''))),
        selected === s.id ? icon('check_circle', { fill: true }) : null)),
      h(`button.school${selected === 'other' ? '.on' : ''}`, { type: 'button', onclick: () => { selected = 'other'; drawSchools(); drawMethods(); } },
        h('span.school-mark.alt', icon('school')),
        h('span.school-text', h('span.school-name', 'Another school'), h('span.school-host', 'Any Brightspace site')),
        selected === 'other' ? icon('check_circle', { fill: true }) : null),
      selected === 'other' ? h('div.field.other-host', icon('link'),
        h('input.field-input', { placeholder: 'yourschool.brightspace.com', value: other, oninput: (e) => { other = e.target.value; } })) : null,
    ].filter(Boolean));

    const drawMethods = () => {
      const canOauth = selected !== 'other' && oauthSchools.has(selected);
      methods.replaceChildren(...[
        h('div.method.recommended',
          h('div.method-head', h('span.method-icon', icon('swap_horiz')), h('div', h('div.method-title', 'Connect with the Lumen extension'), h('div.method-sub', 'Uses your existing Brightspace login. Works for every student today.'))),
          ext
            ? h('div.method-state.ok', icon('check_circle', { fill: true }), `Extension found (v${ext.version})`)
            : h('div.method-state', icon('info'), 'Install the Lumen extension in Chrome, Edge or Brave, then reload this page.'),
          h('div.method-actions',
            ext ? h('button.filled-btn', { type: 'button', onclick: connectExtension }, 'Connect') : h('button.outlined-btn', { type: 'button', onclick: showInstall }, icon('download'), 'How to install'),
            ext ? null : h('button.text-btn', { type: 'button', onclick: () => location.reload() }, icon('refresh'), 'I’ve installed it'))),
        h(`div.method${canOauth ? '' : '.disabled'}`,
          h('div.method-head', h('span.method-icon', icon('login')), h('div', h('div.method-title', 'Sign in with Brightspace'), h('div.method-sub', 'Official OAuth sign-in. No extension needed.'))),
          canOauth ? null : h('div.method-state', icon('info'), 'Not enabled for this school yet. It needs the school’s IT team to register Lumen in Brightspace.'),
          h('div.method-actions', h('button.tonal-btn', { type: 'button', disabled: !canOauth, onclick: () => {
            conn.set({ mode: 'oauth', school: selected });
            location.href = `/auth/login?school=${encodeURIComponent(selected)}`;
          } }, 'Sign in'))),
        h('div.method',
          h('div.method-head', h('span.method-icon', icon('auto_stories')), h('div', h('div.method-title', 'Just looking?'), h('div.method-sub', 'Explore every screen with sample classes.'))),
          h('div.method-actions', h('button.text-btn', { type: 'button', onclick: () => { conn.set({ mode: 'demo' }); startApp({ mode: 'demo' }); } }, 'Try the demo'))),
      ].filter(Boolean));
    };

    function showInstall() {
      L.dialog({
        title: 'Install the Lumen extension',
        body: h('ol.install-steps',
          h('li', 'Download the ', h('code', 'brightspace-wrapper'), ' folder from the ', h('a', { href: 'https://github.com/cshariq/health-guard', target: '_blank', rel: 'noopener' }, 'Lumen repository'), '.'),
          h('li', 'Open ', h('code', 'chrome://extensions'), ' (or ', h('code', 'edge://extensions'), ') and turn on ', h('b', 'Developer mode'), '.'),
          h('li', 'Click ', h('b', 'Load unpacked'), ' and pick the ', h('code', 'brightspace-wrapper'), ' folder.'),
          h('li', 'Come back here and reload the page.')),
        actions: [{ label: 'Reload', primary: true, run: () => location.reload() }, { label: 'Close' }],
      });
    }

    async function connectExtension() {
      const host = schoolHost();
      if (!host) { status.replaceChildren(h('div.notice.error', icon('error'), 'Enter your school’s Brightspace address.')); return; }
      const c = { mode: 'extension', school: selected === 'other' ? null : selected, host };
      status.replaceChildren(h('div.notice', icon('schedule'), 'Connecting…'));
      try {
        const r = await extSend({ type: 'requestAccess' });
        if (!r.approved) {
          status.replaceChildren(h('div.notice', icon('schedule'), 'Approve this website in the Lumen window that just opened…'));
          // Poll until the student clicks Allow in the consent popup.
          for (let i = 0; i < 120; i++) {
            await new Promise((res) => setTimeout(res, 1000));
            const p = await detectExtension();
            if (p && p.approved) break;
            if (i === 119) throw new Error('Approval timed out. Press Connect to try again.');
          }
        }
        // Check the Brightspace login before switching screens.
        try {
          await L.createApi({ base: host, fetch: extensionFetch() }).whoami();
        } catch (e) {
          if (e.status === 401 || e.status === 403) {
            status.replaceChildren(h('div.notice.error', icon('lock'), h('span', 'You’re not signed in to Brightspace. ',
              h('a', { href: `${host}/d2l/login`, target: '_blank', rel: 'noopener' }, 'Sign in in a new tab'), ', then press Connect again.')));
            return;
          }
          throw new Error(`Couldn’t reach Brightspace at ${host}: ${e.message}`);
        }
        conn.set(c);
        startApp(c);
      } catch (e) {
        status.replaceChildren(h('div.notice.error', icon('error'), e.message));
      }
    }

    drawSchools();
    drawMethods();
    root.replaceChildren(...[
      h('div.connect',
        h('section.connect-hero',
          h('div.brand-lg', h('span.brand-mark', icon('school', { fill: true })), 'Lumen'),
          h('h1.connect-title', 'Brightspace, organized.'),
          h('p.connect-lede', 'Your classes, what’s due, course content and grades in one calm, Material You–style place. Built for Carleton and Waterloo students, and it works with any Brightspace school.'),
          h('ul.connect-points',
            h('li', icon('checklist'), 'One to-do list across every class'),
            h('li', icon('calendar_month'), 'A week view of every deadline'),
            h('li', icon('auto_stories'), 'Searchable course content'),
            h('li', icon('lock'), 'Read-only. Your login never touches our servers'))),
        h('section.connect-card',
          h('h2.step', h('span.step-n', '1'), 'Choose your school'),
          schoolList,
          h('h2.step', h('span.step-n', '2'), 'Connect'),
          status,
          methods)),
    ]);
  }

  /* ---------------- boot ---------------- */
  (async function boot() {
    const cfg = await fetch('config.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    serverSchools = (cfg.schools || []).map((s) => ({ ...(SCHOOLS.find((k) => k.id === s.id) || {}), ...s, name: s.name || (SCHOOLS.find((k) => k.id === s.id) || {}).name || s.host }));
    const params = new URLSearchParams(location.search);
    const c = conn.get();
    if (params.get('error')) return showConnect(params.get('error'));
    if (params.get('connected') === 'oauth') {
      const school = params.get('school');
      conn.set({ mode: 'oauth', school });
      history.replaceState(null, '', location.pathname + location.hash);
      return startApp({ mode: 'oauth', school });
    }
    if (!c) return showConnect();
    if (c.mode === 'extension') {
      const ext = await detectExtension();
      if (!ext) return showConnect('The Lumen extension isn’t available in this browser. Install or enable it, or pick another way to connect.');
      if (!ext.approved) return showConnect('This website’s access was removed in the extension. Connect again to re-approve it.');
    }
    startApp(c);
  })();
})();
