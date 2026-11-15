/*
 * Native bridge (loaded by web/index.html, no-op in a normal browser).
 *
 * When the Lumen web UI runs inside one of the native apps (native/ios,
 * native/android, native/windows), that app hosts a WebView and can do what a
 * browser can't: after you log in on the official Brightspace page, the app
 * reads the session cookie from its OWN WebView cookie store and makes the
 * Valence API requests itself (native HTTP isn't bound by CORS). This file is
 * the JS half of that contract; each app implements the matching native half.
 *
 * Contract
 *   JS → native:  a request {id, type, ...} is handed to the host:
 *       iOS/macOS  window.webkit.messageHandlers.lumen.postMessage(req)
 *       Android    window.LumenAndroid.postMessage(JSON.stringify(req))
 *       Windows    window.chrome.webview.postMessage(req)   (WebView2)
 *   native → JS:  the app calls  window.LumenNative.resolve(id, result)
 *       result for a 'get':   { status, contentType, body }
 *       result for 'login':   { signedIn: true } once a session cookie exists
 *       result for 'ping':    { platform, version }
 */
(function () {
  const L = (window.Lumen = window.Lumen || {});

  function host() {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.lumen) {
      return (req) => window.webkit.messageHandlers.lumen.postMessage(req);
    }
    if (window.LumenAndroid && window.LumenAndroid.postMessage) {
      return (req) => window.LumenAndroid.postMessage(JSON.stringify(req));
    }
    if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
      return (req) => window.chrome.webview.postMessage(req);
    }
    return null;
  }

  const post = host();
  const pending = new Map();
  let seq = 0;

  const native = {
    available: !!post,
    platform: null,
    version: null,

    // Native code calls this (directly, or via the WebView2 'message' event below).
    resolve(id, result) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (result && result.error) p.reject(Object.assign(new Error(result.message || result.error), { status: result.status }));
      else p.resolve(result);
    },

    call(req, timeout = 45000) {
      if (!post) return Promise.reject(new Error('No native host'));
      const id = `n${++seq}`;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { pending.delete(id); reject(new Error('The app did not respond')); }, timeout);
        pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
        try { post({ ...req, id }); } catch (e) { clearTimeout(t); pending.delete(id); reject(e); }
      });
    },

    ping() { return native.call({ type: 'ping' }, 4000); },
    // Ask the app to present the official Brightspace login; resolves once signed in.
    login(hostUrl) { return native.call({ type: 'login', host: hostUrl }, 10 * 60e3); },
    // GET a Brightspace API URL using the session the app holds.
    get(url) { return native.call({ type: 'get', url }); },
  };

  // WebView2 (Windows) delivers native → JS messages as an event.
  if (window.chrome && window.chrome.webview && window.chrome.webview.addEventListener) {
    window.chrome.webview.addEventListener('message', (e) => {
      const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (d && d.id) native.resolve(d.id, d.result != null ? d.result : d);
    });
  }

  L.native = native;
})();
