#!/usr/bin/env node
/*
 * A fake Brightspace over real HTTP, for testing the native apps and anything else that
 * can't run the in-browser mock.   node demo/mock-server.mjs   →  http://127.0.0.1:8091
 *
 * It serves the same sample data as demo/mock-brightspace.js and behaves like a real
 * Brightspace session: /d2l/api/* answers 403 until you've visited /d2l/login (which sets
 * the d2lSessionVal cookie), exactly the signed-out → signed-in transition the apps handle.
 */
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8091);
const src = fs.readFileSync(fileURLToPath(new URL('./mock-brightspace.js', import.meta.url)), 'utf8');
const sandbox = { window: {}, location: { href: `http://127.0.0.1:${PORT}/` }, URL, Date, Promise, JSON, Array, Number, String, Object };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const mock = sandbox.window.mockBrightspaceFetch;

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === '/d2l/login') {
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'd2lSessionVal=ok; Path=/' });
    return res.end('<!doctype html><title>Brightspace</title><h1>Signed in</h1>');
  }
  if (u.pathname.startsWith('/d2l/api/')) {
    if (!(req.headers.cookie || '').includes('d2lSessionVal=ok')) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{}'); }
    const r = await mock(u.href);
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(await r.text());
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>Brightspace</title>');
}).listen(PORT, '127.0.0.1', () => console.log(`Mock Brightspace on http://127.0.0.1:${PORT}  (visit /d2l/login to sign in)`));
