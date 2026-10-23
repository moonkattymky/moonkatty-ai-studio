// OpenCode on 127.0.0.1:4097 only. Password comes from the environment, never
// from Keychain and never from argv. Port 4096 is refused before any socket.
'use strict';
const fs = require('fs');
const { makeTemp } = require('../paths');

const ALLOWED_PORT = 4097;
const FORBIDDEN_PORT = 4096;
const PROMPT = 'верни строку PONG';
const USER = 'opencode';

function assertUrl(raw, allowTestPort) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('Неверный URL OpenCode'), { code: 'FORBIDDEN', status: 403 }); }
  const port = u.port ? +u.port : (u.protocol === 'https:' ? 443 : 80);
  if (port === FORBIDDEN_PORT || /(^|:)4096($|:)/.test(u.host)) {
    throw Object.assign(new Error('Порт 4096 запрещён. System Doctor не подключается к нему.'), { code: 'FORBIDDEN', status: 403 });
  }
  if (port !== ALLOWED_PORT && !(allowTestPort && process.env.NODE_ENV === 'test')) {
    throw Object.assign(new Error('OpenCode проверяется только на порту 4097'), { code: 'FORBIDDEN', status: 403 });
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) {
    throw Object.assign(new Error('OpenCode только на 127.0.0.1'), { code: 'FORBIDDEN', status: 403 });
  }
  return { origin: u.origin, port };
}

function passwordFromEnv(env) {
  const pw = env.OPENCODE_SERVER_PASSWORD || '';
  if (!pw) return null;
  if (pw.length > 256) return null;
  return pw;
}

async function http(url, { method, headers, body, timeoutMs }) {
  const r = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs || 8000) });
  const text = await r.text();
  return { status: r.status, text: text.slice(0, 2000) };
}

async function check(opts = {}) {
  const env = opts.env || process.env;
  const allowOther = !!(opts.allowTestPort && process.env.NODE_ENV === 'test');
  const raw = opts.baseUrl || `http://127.0.0.1:${ALLOWED_PORT}`;
  let target;
  try { target = assertUrl(raw, allowOther && opts.baseUrl ? true : false); }
  catch (e) { return { id: 'opencode', status: 'FORBIDDEN', summary: e.message, data: { code: e.code } }; }
  if (target.port !== ALLOWED_PORT && !allowOther) {
    return { id: 'opencode', status: 'FORBIDDEN', summary: 'Порт не 4097', data: {} };
  }
  const pw = passwordFromEnv(env);
  const user = /^[A-Za-z0-9._@-]{1,64}$/.test(env.OPENCODE_SERVER_USERNAME || '') ? env.OPENCODE_SERVER_USERNAME : USER;
  const auth = pw ? 'Basic ' + Buffer.from(user + ':' + pw).toString('base64') : null;
  const scrub = s => pw ? String(s).split(pw).join('[REDACTED]') : String(s);
  try {
    const anon = await http(target.origin + '/global/health', { method: 'GET', timeoutMs: opts.timeoutMs || 5000 });
    if (anon.status !== 401) {
      return { id: 'opencode', status: anon.status === 200 ? 'WARN' : 'FAIL', summary: 'Без пароля ожидался HTTP 401, получен ' + anon.status, data: { anon: anon.status } };
    }
    if (!auth) {
      return { id: 'opencode', status: 'BLOCKED', summary: 'OpenCode ответил 401. Пароль есть только в окружении (OPENCODE_SERVER_PASSWORD); Keychain System Doctor не читает.', data: { anon: 401, authed: null } };
    }
    if (opts.healthOnly) {
      const authed = await http(target.origin + '/global/health', { method: 'GET', headers: { authorization: auth, accept: 'application/json' }, timeoutMs: opts.timeoutMs || 5000 });
      return { id: 'opencode', status: authed.status === 200 ? 'OK' : 'FAIL', summary: authed.status === 200 ? '401 без пароля, 200 с паролем' : 'С паролем HTTP ' + authed.status, data: { anon: 401, authed: authed.status, healthOnly: true } };
    }
    const authed = await http(target.origin + '/global/health', { method: 'GET', headers: { authorization: auth, accept: 'application/json' }, timeoutMs: opts.timeoutMs || 5000 });
    if (authed.status !== 200) {
      return { id: 'opencode', status: 'FAIL', summary: 'С паролем ожидался HTTP 200, получен ' + authed.status, data: { anon: 401, authed: authed.status } };
    }
    const dir = makeTemp();
    fs.writeFileSync(pathJoin(dir, '.keep'), '', { mode: 0o600 });
    const created = await http(target.origin + '/session?directory=' + encodeURIComponent(dir), {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ title: 'sd-pong' }), timeoutMs: opts.timeoutMs || 15000
    });
    if (created.status !== 200 && created.status !== 201) {
      return { id: 'opencode', status: 'FAIL', summary: 'Сессия не создана: HTTP ' + created.status, data: { anon: 401, authed: 200 } };
    }
    let sid = '';
    try { sid = JSON.parse(created.text).id; } catch { sid = ''; }
    if (!sid || !/^[\w.-]+$/.test(sid)) return { id: 'opencode', status: 'FAIL', summary: 'Нет id сессии', data: {} };
    await http(target.origin + '/session/' + encodeURIComponent(sid) + '/prompt_async?directory=' + encodeURIComponent(dir), {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: PROMPT }], tools: { write: false, edit: false, bash: false } }),
      timeoutMs: opts.timeoutMs || 20000
    });
    let pong = false, text = '';
    for (let i = 0; i < (opts.polls || 10); i++) {
      const msgs = await http(target.origin + '/session/' + encodeURIComponent(sid) + '/message?directory=' + encodeURIComponent(dir), {
        method: 'GET', headers: { authorization: auth, accept: 'application/json' }, timeoutMs: 8000
      });
      text = scrub(msgs.text);
      if (/PONG/.test(text)) { pong = true; break; }
      await new Promise(r => setTimeout(r, opts.pollMs || 50));
    }
    await http(target.origin + '/session/' + encodeURIComponent(sid) + '/abort?directory=' + encodeURIComponent(dir), {
      method: 'POST', headers: { authorization: auth }, timeoutMs: 5000
    }).catch(() => {});
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    return {
      id: 'opencode', status: pong ? 'OK' : 'FAIL',
      summary: pong ? '4097: 401 без пароля, 200 с паролем, тест PONG' : 'Ответ PONG не получен',
      data: { anon: 401, authed: 200, pong, port: target.port }
    };
  } catch (e) {
    const code = e.cause?.code || e.name || '';
    if (code === 'ECONNREFUSED' || /fetch failed|ECONNREFUSED/i.test(e.message)) {
      return { id: 'opencode', status: 'BLOCKED', summary: 'На 127.0.0.1:' + target.port + ' никто не слушает', data: { port: target.port } };
    }
    return { id: 'opencode', status: 'FAIL', summary: scrub(e.message).slice(0, 200), data: { port: target.port } };
  }
}

function pathJoin(a, b) { return require('path').join(a, b); }

module.exports = { check, assertUrl, ALLOWED_PORT, FORBIDDEN_PORT, PROMPT };
