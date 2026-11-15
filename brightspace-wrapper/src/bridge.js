/*
 * Website bridge (extension service worker).
 *
 * Lets the Lumen website read Brightspace data with the student's existing
 * Brightspace login, without passwords or API keys:
 *   website ──chrome.runtime.sendMessage──▶ this worker ──fetch──▶ Brightspace /d2l/api/
 *
 * Safety rails:
 *   • Only sites listed in manifest "externally_connectable" can even send messages.
 *   • Each site must also be approved once by the student in a consent popup.
 *   • Only GET requests, only /d2l/api/ paths, only the Brightspace hosts below.
 */
const HOSTS = [/^https:\/\/brightspace\.carleton\.ca$/, /^https:\/\/learn\.uwaterloo\.ca$/, /^https:\/\/[a-z0-9-]+\.brightspace\.com$/];
const pendingConsent = new Set();

async function approvedOrigins() {
  const { approved = [] } = await chrome.storage.local.get('approved');
  return approved;
}

async function askConsent(origin) {
  if (pendingConsent.has(origin)) return;
  pendingConsent.add(origin);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`src/consent.html?origin=${encodeURIComponent(origin)}`),
    type: 'popup', width: 440, height: 420, focused: true,
  });
  chrome.windows.onRemoved.addListener(function done(id) {
    if (id === win.id) { pendingConsent.delete(origin); chrome.windows.onRemoved.removeListener(done); }
  });
}

async function pack(res) {
  const type = res.headers.get('content-type') || '';
  // Brightspace sends signed-out API calls to the login page instead of returning 401.
  if (res.redirected && /\/d2l\/login|\/login/i.test(res.url) && !type.includes('json')) {
    return { status: 401, contentType: 'application/json', body: null };
  }
  const body = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, contentType: type, body };
}

/*
 * Fallback: run the request inside a Brightspace tab, where the login cookie always applies.
 * Chrome only attaches SameSite=None cookies to the worker's own requests, so schools whose
 * session cookie is SameSite=Lax/Strict need this path. If no Brightspace tab is open we open
 * a small pinned background tab (a plain JSON API page, so nothing heavy loads) and reuse it.
 */
const helperTabs = new Map(); // origin → Promise<tabId>
const viaTabOnly = new Set(); // origins where direct requests are known not to carry the login

function waitForTab(tabId) {
  return new Promise((resolve) => {
    const check = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(check); resolve(); } };
    chrome.tabs.onUpdated.addListener(check);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') { chrome.tabs.onUpdated.removeListener(check); resolve(); } }).catch(resolve);
  });
}

async function tabFor(origin) {
  const open = await chrome.tabs.query({ url: `${origin}/*` });
  const usable = open.find((t) => !t.discarded && /^https:/.test(t.url || ''));
  if (usable) return usable.id;
  if (!helperTabs.has(origin)) {
    helperTabs.set(origin, (async () => {
      const t = await chrome.tabs.create({ url: `${origin}/d2l/api/versions/`, active: false, pinned: true });
      await waitForTab(t.id);
      return t.id;
    })());
    chrome.tabs.onRemoved.addListener(function gone(id) {
      helperTabs.get(origin)?.then((tid) => { if (tid === id) { helperTabs.delete(origin); chrome.tabs.onRemoved.removeListener(gone); } });
    });
  }
  return helperTabs.get(origin);
}

async function fetchInTab(url) {
  const tabId = await tabFor(url.origin);
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (href) => {
      const r = await fetch(href, { credentials: 'include', headers: { Accept: 'application/json' } });
      const type = r.headers.get('content-type') || '';
      if (r.redirected && /login/i.test(r.url) && !type.includes('json')) return { status: 401, contentType: 'application/json', body: null };
      return { status: r.status, contentType: type, body: type.includes('json') ? await r.json().catch(() => null) : await r.text() };
    },
    args: [url.href],
  });
  return result || null;
}

async function handle(msg, sender) {
  const origin = sender.origin || new URL(sender.url).origin;
  const approved = (await approvedOrigins()).includes(origin);

  if (msg && msg.type === 'ping') {
    return { ok: true, version: chrome.runtime.getManifest().version, approved };
  }
  if (msg && msg.type === 'requestAccess') {
    if (!approved) await askConsent(origin);
    return { ok: true, approved };
  }
  if (!msg || msg.type !== 'get' || typeof msg.url !== 'string') return { error: 'bad_request' };
  if (!approved) { await askConsent(origin); return { error: 'consent_required' }; }

  let url;
  try { url = new URL(msg.url); } catch { return { error: 'bad_request' }; }
  if (!HOSTS.some((r) => r.test(url.origin)) || !url.pathname.startsWith('/d2l/api/')) return { error: 'forbidden' };

  if (viaTabOnly.has(url.origin)) return (await fetchInTab(url).catch(() => null)) || { status: 0, error: 'network', message: 'Couldn’t reach Brightspace' };

  let out;
  try {
    out = await pack(await fetch(url.href, { credentials: 'include', headers: { Accept: 'application/json' } }));
  } catch (e) {
    out = { status: 0, error: 'network', message: String(e && e.message || e) };
  }
  if (out.status === 401 || out.status === 403 || out.status === 0) {
    const viaTab = await fetchInTab(url).catch(() => null);
    if (viaTab) {
      if (viaTab.status < 400) viaTabOnly.add(url.origin); // remember: go straight to the tab next time
      return viaTab;
    }
  }
  return out;
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: 'failed', message: String(e && e.message || e) }));
  return true; // async response
});
