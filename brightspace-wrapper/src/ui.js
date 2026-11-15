/* Small DOM + formatting toolkit shared by every view. */
(function () {
  const L = (window.Lumen = window.Lumen || {});

  /** Hyperscript: h('div.card#id', {onclick}, children...) */
  L.h = function h(tag, props, ...children) {
    if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
      if (props != null) children.unshift(props);
      props = {};
    }
    const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
    const el = document.createElement(name || 'div');
    for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
      if (m[1] === '.') el.classList.add(m[2]);
      else el.id = m[2];
    }
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  };
  const h = L.h;

  const SVGNS = 'http://www.w3.org/2000/svg';
  L.icon = function (name, opts = {}) {
    const d = L.ICONS[(opts.fill && L.ICONS[name + '-fill']) ? name + '-fill' : name] || L.ICONS.info;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    if (opts.size) svg.style.setProperty('--icon-size', opts.size + 'px');
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
  };

  L.iconButton = function (name, label, onclick, extra = {}) {
    return h('button.icon-btn', { type: 'button', title: label, 'aria-label': label, onclick, ...extra }, L.icon(name, extra.iconOpts));
  };

  /* ---------- dates ---------- */
  const DAY = 864e5;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  L.startOfDay = startOfDay;
  L.daysFromToday = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);

  const fmt = (o) => new Intl.DateTimeFormat(undefined, o);
  const fTime = fmt({ hour: 'numeric', minute: '2-digit' });
  const fDay = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
  const fLong = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
  const fShort = fmt({ month: 'short', day: 'numeric' });
  L.fmtTime = (d) => fTime.format(new Date(d));
  L.fmtDay = (d) => fDay.format(new Date(d));
  L.fmtLong = (d) => fLong.format(new Date(d));
  L.fmtShort = (d) => fShort.format(new Date(d));

  /** "Due today, 11:59 PM" / "Due tomorrow" / "Due Fri, Nov 21" */
  L.dueLabel = function (due, prefix = 'Due') {
    if (!due) return 'No due date';
    const n = L.daysFromToday(due);
    const t = L.fmtTime(due);
    if (n === 0) return `${prefix} today, ${t}`;
    if (n === 1) return `${prefix} tomorrow, ${t}`;
    if (n === -1) return `${prefix} yesterday, ${t}`;
    if (n > 1 && n < 7) return `${prefix} ${fmt({ weekday: 'long' }).format(new Date(due))}, ${t}`;
    return `${prefix} ${L.fmtDay(due)}`;
  };

  L.relative = function (d) {
    if (!d) return '';
    const diff = (Date.now() - new Date(d)) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
    return L.fmtShort(d);
  };

  /** Academic term from a course's start date (Canadian calendar). */
  L.termOf = function (course) {
    const d = course.start ? new Date(course.start) : null;
    if (!d || isNaN(d)) {
      const m = /(fall|winter|summer|spring)\s*(20\d\d)/i.exec(`${course.name} ${course.code}`);
      return m ? { label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`, sort: Number(m[2]) * 10 } : { label: 'Other', sort: 0 };
    }
    const m = d.getMonth(), y = d.getFullYear();
    if (m >= 8) return { label: `Fall ${y}`, sort: y * 10 + 3 };
    if (m >= 4) return { label: `Summer ${y}`, sort: y * 10 + 2 };
    return { label: `Winter ${y}`, sort: y * 10 + 1 };
  };

  L.isCurrent = function (course) {
    const now = Date.now();
    const s = course.start ? new Date(course.start).getTime() : null;
    const e = course.end ? new Date(course.end).getTime() : null;
    if (s && s > now + 21 * DAY) return false; // starts > 3 weeks out
    if (e && e < now - 7 * DAY) return false;  // ended over a week ago
    if (!s && !e) return course.active;
    return true;
  };

  /* ---------- html sanitizing for announcement / instruction bodies ---------- */
  const ALLOWED = new Set(['A','B','STRONG','I','EM','U','P','BR','UL','OL','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','CODE','PRE','SPAN','DIV','IMG','TABLE','THEAD','TBODY','TR','TD','TH','HR','SUB','SUP','S','SMALL','FIGURE','FIGCAPTION']);
  L.sanitize = function (html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const walk = (node) => {
      for (const child of [...node.children]) {
        if (!ALLOWED.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'LINK', 'META'].includes(child.tagName)) child.remove();
          else { walk(child); child.replaceWith(...child.childNodes); }
          continue;
        }
        for (const attr of [...child.attributes]) {
          const n = attr.name.toLowerCase();
          const keep = (n === 'href' && child.tagName === 'A') || (n === 'src' && child.tagName === 'IMG') || n === 'alt' || n === 'colspan' || n === 'rowspan';
          if (!keep || /^\s*javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
          // On the website, Brightspace's relative links must point back at Brightspace.
          else if (L.contentBase && (n === 'href' || n === 'src') && attr.value.startsWith('/') && !attr.value.startsWith('//')) attr.value = L.contentBase + attr.value;
        }
        if (child.tagName === 'A') { child.target = '_blank'; child.rel = 'noopener noreferrer'; }
        if (child.tagName === 'IMG') child.loading = 'lazy';
        walk(child);
      }
    };
    walk(root);
    return root.innerHTML;
  };
  L.textOf = (html) => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();

  /* ---------- settings (per Brightspace site, synchronous so boot can decide instantly) ---------- */
  const SKEY = 'lumen:settings';
  const DEFAULTS = (L.settingsDefaults = { enabled: true, mode: 'system', seed: 270, newTab: false, hidden: [], density: 'comfortable', courseView: 'grid', termFilter: 'current' });
  L.settings = {
    get() {
      try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...DEFAULTS }; }
    },
    set(patch) {
      const next = { ...L.settings.get(), ...patch };
      try { localStorage.setItem(SKEY, JSON.stringify(next)); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('lumen:settings', { detail: next }));
      return next;
    },
  };

  /* ---------- done overrides (lets students tick things off like in Classroom) ---------- */
  const DKEY = 'lumen:done';
  L.doneStore = {
    all() { try { return JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch { return {}; } },
    toggle(key, value) {
      const all = L.doneStore.all();
      if (value == null) delete all[key]; else all[key] = value;
      try { localStorage.setItem(DKEY, JSON.stringify(all)); } catch { /* ignore */ }
    },
  };

  /* ---------- snackbar ---------- */
  L.toast = function (msg, action) {
    const host = document.querySelector('.lumen-app');
    if (!host) return;
    host.querySelectorAll('.snackbar').forEach((s) => s.remove());
    const bar = h('div.snackbar', { role: 'status' }, h('span', msg),
      action && h('button.text-btn.inverse', { onclick: () => { action.run(); bar.remove(); } }, action.label));
    host.append(bar);
    setTimeout(() => bar.classList.add('show'));
    setTimeout(() => { bar.classList.remove('show'); setTimeout(() => bar.remove(), 300); }, 4500);
  };

  /* ---------- dialog ---------- */
  L.dialog = function ({ title, body, actions = [] }) {
    const host = document.querySelector('.lumen-app');
    const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const wrap = h('div.scrim', { onclick: (e) => { if (e.target === wrap) close(); } },
      h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2.dialog-title', title),
        h('div.dialog-body', body),
        h('div.dialog-actions', actions.map((a) => h(`button.${a.primary ? 'filled-btn' : 'text-btn'}`, { onclick: () => { a.run && a.run(); if (!a.keepOpen) close(); } }, a.label)))));
    document.addEventListener('keydown', onKey);
    host.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    return close;
  };

  /* ---------- misc components ---------- */
  L.skeleton = (n = 3, cls = '') => h('div.skeleton-list', Array.from({ length: n }, () => h(`div.skeleton${cls ? '.' + cls : ''}`)));

  L.empty = (iconName, title, sub) =>
    h('div.empty', L.icon(iconName, { size: 56 }), h('div.empty-title', title), sub && h('div.empty-sub', sub));

  L.errorState = (err, retry) => {
    const auth = err && (err.status === 401 || err.status === 403);
    return h('div.empty',
      L.icon(auth ? 'lock' : 'wifi_off', { size: 56 }),
      h('div.empty-title', auth ? 'You’re signed out of Brightspace' : 'Couldn’t load this from Brightspace'),
      h('div.empty-sub', auth ? 'Sign in again and Lumen will pick up where you left off.' : (err && err.message) || 'Check your connection and try again.'),
      auth
        ? h('a.filled-btn', { href: L.loginUrl || '/d2l/login' }, L.icon('login'), 'Sign in')
        : retry && h('button.tonal-btn', { onclick: retry }, L.icon('refresh'), 'Try again'));
  };

  L.TYPE_META = {
    assignment: { icon: 'assignment', label: 'Assignment' },
    quiz: { icon: 'quiz', label: 'Quiz' },
    discussion: { icon: 'forum', label: 'Discussion' },
    survey: { icon: 'checklist', label: 'Survey' },
    content: { icon: 'article', label: 'Material' },
    pdf: { icon: 'picture_as_pdf', label: 'PDF' },
    slides: { icon: 'slideshow', label: 'Slides' },
    sheet: { icon: 'table_chart', label: 'Spreadsheet' },
    image: { icon: 'image', label: 'Image' },
    video: { icon: 'play_circle', label: 'Video' },
    meeting: { icon: 'videocam', label: 'Meeting' },
    link: { icon: 'link', label: 'Link' },
    doc: { icon: 'description', label: 'Document' },
  };
})();
