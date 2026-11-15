#!/usr/bin/env node
/*
 * Lumen website server (no dependencies, Node 18+).
 *
 *   node web/server.mjs        → http://localhost:8080
 *
 * • Serves the website (web/), the shared app code (src/), the demo data and icons.
 * • Optional "Sign in with Brightspace" (OAuth 2.0 authorization-code flow) for each
 *   school that has registered Lumen as an app, plus a read-only proxy to the
 *   Brightspace API. Tokens stay on the server; the browser only gets a session cookie.
 *
 * Without any OAuth settings it is just a static server, and the extension and demo
 * modes still work. See web/README.md for configuration.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECURE = PUBLIC_URL.startsWith('https://');
const AUTH_URL = process.env.D2L_AUTH_URL || 'https://auth.brightspace.com/oauth2/auth';
const TOKEN_URL = process.env.D2L_TOKEN_URL || 'https://auth.brightspace.com/core/connect/token';
const SCOPE = process.env.D2L_SCOPE || 'core:*:*';
const SESSION_TTL = 14 * 864e5;

/* ---------- schools with OAuth credentials ---------- */
const KNOWN = {
  carleton: 'https://brightspace.carleton.ca',
  uwaterloo: 'https://learn.uwaterloo.ca',
};
const schools = new Map();
try {
  for (const s of JSON.parse(process.env.LUMEN_SCHOOLS || '[]')) schools.set(s.id, s);
} catch (e) {
  console.error('LUMEN_SCHOOLS is not valid JSON:', e.message);
}
for (const [id, host] of Object.entries(KNOWN)) {
  const key = id.toUpperCase();
  if (process.env[`${key}_CLIENT_ID`] && process.env[`${key}_CLIENT_SECRET`]) {
    schools.set(id, { id, host, clientId: process.env[`${key}_CLIENT_ID`], clientSecret: process.env[`${key}_CLIENT_SECRET`] });
  }
}
for (const s of schools.values()) {
  if (!s.host || !s.clientId || !s.clientSecret) { console.error(`School "${s.id}" needs host, clientId and clientSecret`); schools.delete(s.id); }
}

/* ---------- sessions (in memory; use a shared store if you run several instances) ---------- */
const sessions = new Map(); // sid → { school, access, refresh, expiresAt, seen }
const states = new Map();   // state → { school, created }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.seen > SESSION_TTL) sessions.delete(k);
  for (const [k, v] of states) if (now - v.created > 10 * 60e3) states.delete(k);
}, 60e3).unref();

const rand = () => crypto.randomBytes(32).toString('base64url');
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const cookie = (name, value, maxAgeSec) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE ? '; Secure' : ''}`;

/* ---------- helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj, headers) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
const redirect = (res, to, headers = {}) => send(res, 302, '', { Location: to, ...headers });

async function exchange(school, params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: school.clientId, client_secret: school.clientSecret }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) throw new Error(body.error_description || body.error || `token endpoint returned ${r.status}`);
  return { access: body.access_token, refresh: body.refresh_token || null, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
}

async function validToken(sess) {
  if (Date.now() < sess.expiresAt - 60e3) return sess.access;
  if (!sess.refresh) return null;
  const school = schools.get(sess.school);
  Object.assign(sess, await exchange(school, { grant_type: 'refresh_token', refresh_token: sess.refresh }));
  return sess.access;
}

/* ---------- routes ---------- */
async function route(req, res) {
  const url = new URL(req.url, PUBLIC_URL);
  const p = url.pathname;

  if (p === '/' || p === '/web') return redirect(res, '/web/');
  if (p === '/healthz') return json(res, 200, { ok: true });
  if (p === '/web/config.json') {
    return json(res, 200, { oauth: [...schools.keys()], schools: [...schools.values()].map((s) => ({ id: s.id, host: s.host, name: s.name || null })) });
  }

  // OAuth: start
  if (p === '/auth/login') {
    const school = schools.get(url.searchParams.get('school'));
    if (!school) return redirect(res, '/web/?error=' + encodeURIComponent('Brightspace sign-in isn’t set up for that school on this server.'));
    const state = rand();
    states.set(state, { school: school.id, created: Date.now() });
    const q = new URLSearchParams({ response_type: 'code', client_id: school.clientId, redirect_uri: `${PUBLIC_URL}/auth/callback`, scope: SCOPE, state });
    return redirect(res, `${AUTH_URL}?${q}`, { 'Set-Cookie': cookie('lumen_state', state, 600) });
  }

  // OAuth: return from Brightspace
  if (p === '/auth/callback') {
    const state = url.searchParams.get('state');
    const saved = state && states.get(state);
    states.delete(state);
    const fail = (msg) => redirect(res, '/web/?error=' + encodeURIComponent(msg), { 'Set-Cookie': cookie('lumen_state', '', 0) });
    if (!saved || cookies(req).lumen_state !== state) return fail('Sign-in expired or was started in another tab. Please try again.');
    if (url.searchParams.get('error')) return fail(`Brightspace said: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    try {
      const tokens = await exchange(schools.get(saved.school), { grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: `${PUBLIC_URL}/auth/callback` });
      const sid = rand();
      sessions.set(sid, { school: saved.school, ...tokens, seen: Date.now() });
      return send(res, 302, '', {
        Location: `/web/?connected=oauth&school=${encodeURIComponent(saved.school)}`,
        'Set-Cookie': [cookie('lumen_sid', sid, SESSION_TTL / 1000), cookie('lumen_state', '', 0)],
      });
    } catch (e) {
      return fail(`Couldn’t finish signing in: ${e.message}`);
    }
  }

  if (p === '/auth/logout') {
    sessions.delete(cookies(req).lumen_sid);
    return redirect(res, '/web/', { 'Set-Cookie': cookie('lumen_sid', '', 0) });
  }

  // Read-only Brightspace API proxy: /bs/d2l/api/... → https://<school>/d2l/api/...
  if (p.startsWith('/bs/')) {
    if (req.method !== 'GET') return json(res, 405, { error: 'read_only' });
    const sess = sessions.get(cookies(req).lumen_sid);
    if (!sess) return json(res, 401, { error: 'signed_out' });
    const apiPath = p.slice(3);
    if (!apiPath.startsWith('/d2l/api/') || apiPath.includes('..')) return json(res, 403, { error: 'forbidden' });
    sess.seen = Date.now();
    let token;
    try { token = await validToken(sess); } catch { token = null; }
    if (!token) { sessions.delete(cookies(req).lumen_sid); return json(res, 401, { error: 'signed_out' }); }
    const school = schools.get(sess.school);
    const upstream = await fetch(school.host + apiPath + url.search, { headers: { Authorization: `Bearer ${token}`, Accept: req.headers.accept || 'application/json' }, redirect: 'manual' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    return send(res, upstream.status >= 300 && upstream.status < 400 ? 401 : upstream.status, buf, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  }

  // Static files
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  const allowed = ['/web/', '/src/', '/demo/', '/assets/', '/docs/'];
  if (!allowed.some((a) => p.startsWith(a))) return send(res, 404, 'Not found');
  let file = path.resolve(ROOT, '.' + decodeURIComponent(p));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  if (p.endsWith('/')) file = path.join(file, 'index.html');
  if (/server\.mjs$/.test(file)) return send(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': p.startsWith('/web/') ? 'no-cache' : 'public, max-age=300',
    });
  });
}

http.createServer((req, res) => {
  route(req, res).catch((e) => { console.error(e); if (!res.headersSent) json(res, 502, { error: 'upstream', message: e.message }); });
}).listen(PORT, () => {
  console.log(`Lumen website on ${PUBLIC_URL} (listening on :${PORT})`);
  console.log(schools.size ? `Brightspace sign-in enabled for: ${[...schools.keys()].join(', ')}` : 'Brightspace sign-in not configured (extension + demo modes only).');
});
