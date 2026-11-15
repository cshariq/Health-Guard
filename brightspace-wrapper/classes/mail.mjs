/*
 * Minimal SMTP sender (no dependencies).
 *
 *   SMTP_URL=smtps://user:pass@smtp.example.com:465     implicit TLS
 *   SMTP_URL=smtp://user:pass@smtp.example.com:587      STARTTLS when the server offers it
 *   SMTP_FROM="Lumen Classes <classes@example.com>"
 *
 * Bodies are sent base64-encoded UTF-8, which sidesteps dot-stuffing and 8-bit issues.
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();          // no header injection
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const addrOf = (s) => (clean(s).match(/<([^>]+)>/) || [null, clean(s)])[1];

export async function smtpSend(urlString, { from, to, subject, text }) {
  const url = new URL(urlString);
  const implicitTls = url.protocol === 'smtps:';
  const host = url.hostname, port = Number(url.port || (implicitTls ? 465 : 587));
  let socket = implicitTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  socket.setTimeout(20000);

  let buffer = '', waiter = null, failed = null;
  const attach = (s) => {
    s.setEncoding('utf8');
    s.on('data', (d) => { buffer += d; pump(); });
    s.on('error', (e) => { failed = e; pump(); });
    s.on('timeout', () => { failed = new Error('SMTP timed out'); s.destroy(); pump(); });
    s.on('close', () => { failed = failed || new Error('SMTP connection closed'); pump(); });
  };
  function pump() {
    if (!waiter) return;
    // A reply ends with a line "NNN <text>" (a space after the code, not a dash).
    const m = buffer.match(/^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/);
    if (m) { const w = waiter; waiter = null; const reply = m[0]; buffer = buffer.slice(reply.length); w.resolve({ code: Number(m[1]), text: reply }); }
    else if (failed) { const w = waiter; waiter = null; w.reject(failed); }
  }
  const reply = () => new Promise((resolve, reject) => { waiter = { resolve, reject }; pump(); });
  const expect = async (codes, what) => { const r = await reply(); if (![].concat(codes).includes(r.code)) throw new Error(`SMTP ${what} failed: ${r.text.trim()}`); return r; };
  const cmd = async (line, codes, what) => { socket.write(line + '\r\n'); return expect(codes, what || line.split(' ')[0]); };

  attach(socket);
  try {
    await expect(220, 'greeting');
    let ehlo = await cmd('EHLO lumen-classes', 250, 'EHLO');
    if (!implicitTls && /STARTTLS/i.test(ehlo.text)) {
      await cmd('STARTTLS', 220, 'STARTTLS');
      socket.removeAllListeners('data'); socket.removeAllListeners('close'); socket.removeAllListeners('error'); socket.removeAllListeners('timeout');
      socket = tls.connect({ socket, servername: host });
      attach(socket);
      await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
      ehlo = await cmd('EHLO lumen-classes', 250, 'EHLO');
    }
    if (url.username) {
      const token = Buffer.from(`\0${decodeURIComponent(url.username)}\0${decodeURIComponent(url.password)}`).toString('base64');
      await cmd(`AUTH PLAIN ${token}`, 235, 'sign-in');
    }
    await cmd(`MAIL FROM:<${addrOf(from)}>`, 250, 'MAIL FROM');
    await cmd(`RCPT TO:<${addrOf(to)}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', 354, 'DATA');
    const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
    const message = [
      `From: ${clean(from)}`, `To: ${clean(to)}`, `Subject: ${encodeHeader(clean(subject))}`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${host}>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body,
    ].join('\r\n');
    await cmd(message + '\r\n.', 250, 'message');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}
