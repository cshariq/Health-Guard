/*
 * Content script entry point, injected at document_start on /d2l/home pages.
 * If Lumen is enabled it halts the Brightspace page before its scripts run
 * and mounts Lumen in its place. Add ?lumen=off to a /d2l/home URL for the classic page.
 */
(function () {
  const L = window.Lumen;
  const url = new URL(location.href);
  const param = url.searchParams.get('lumen');
  // ?lumen=off → classic page once; ?lumen=on → Lumen once, even if the homepage takeover is switched off.
  if (param === 'off' || (param !== 'on' && !L.settings.get().enabled)) return; // fab.js offers a way back

  const m = location.pathname.match(/^\/d2l\/home\/?(\d+)?\/?$/);
  if (!m) return;

  window.stop();
  let html = document.documentElement;
  if (!html) { html = document.createElement('html'); document.appendChild(html); }
  html.innerHTML =
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Lumen · Brightspace</title></head><body></body>';
  html.classList.add('lumen');

  const start = () => {
    const root = document.createElement('div');
    document.body.append(root);
    L.mount(root, L.createApi(), { initialRoute: m[1] ? `#/c/${m[1]}` : '#/' });
  };
  // window.stop() ends parsing, so the body we just wrote is ready immediately.
  start();
})();
