// OpenCode server HTTP client (opencode serve, v1 routes; verified against opencode 1.19.3).
// Auth: HTTP Basic, the password is read from the macOS Keychain per request (lib/opencode-auth.js) and kept only in memory.
// It is never put into argv, env of child processes, logs, task data or error messages (all errors are scrubbed).
'use strict';
const oca = require('./opencode-auth.js');
const MIN_VERSION = [1, 1, 0];
const vcmp = (a, b) => { for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
function createClient({ url, username, sec, getPassword = oca.getPassword, timeoutMs = 15000 }) {
  const v = oca.validateUrl(url); if (v.error) throw Object.assign(new Error(v.error), { blocked: true });
  const base = v.url; let pwCache = null;
  async function auth() { if (pwCache === null) pwCache = (await getPassword()) || ''; return pwCache ? 'Basic ' + Buffer.from((username || oca.DEFAULT_USER) + ':' + pwCache).toString('base64') : null; }
  const scrub = s => oca.scrub(s, pwCache, sec);
  async function req(method, p, { body, query, signal, timeout = timeoutMs, raw } = {}) {
    const u = new URL(base + p); for (const [k, val] of Object.entries(query || {})) if (val != null) u.searchParams.set(k, val);
    const headers = { accept: 'application/json' }; const a = await auth(); if (a) headers.authorization = a; if (body !== undefined) headers['content-type'] = 'application/json';
    const sigs = [AbortSignal.timeout(timeout)]; if (signal) sigs.push(signal);
    let r; try { r = await fetch(u, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.any(sigs) }); }
    catch (e) { const c = String(e.cause?.code || e.name || e.message); const err = new Error(scrub(c === 'ECONNREFUSED' ? 'OpenCode не запущен (соединение отклонено: ' + base + ')' : /Timeout/.test(c) ? `OpenCode: нет ответа за ${timeout / 1000} с (${method} ${p})` : 'OpenCode: сетевая ошибка ' + c));
      err.code = c === 'ECONNREFUSED' ? 'refused' : /Timeout/.test(c) ? 'timeout' : /Abort/.test(c) ? 'aborted' : 'network'; err.blocked = err.code === 'refused'; throw err; }
    if (raw) return r;
    const text = await r.text();
    if (r.status === 401) throw Object.assign(new Error('OpenCode: неверный логин или пароль (HTTP 401) — проверьте пароль в настройках (Keychain)'), { code: 'unauthorized', blocked: true });
    if (r.status >= 300 && r.status < 400) throw Object.assign(new Error('OpenCode: перенаправление не выполняется'), { code: 'redirect' });
    if (!r.ok) throw Object.assign(new Error(scrub(`OpenCode HTTP ${r.status} (${method} ${p}): ${text.slice(0, 300)}`)), { code: 'http', status: r.status });
    if (!text) return null; try { return JSON.parse(text); } catch { return text; }
  }
  const dq = dir => ({ directory: dir });
  return {
    base, scrub, get authed() { return !!pwCache; },
    async health() { const h = await req('GET', '/global/health', { timeout: 5000 }); const ver = String(h?.version || '0').split(/[.-]/).map(Number);
      if (!h?.healthy) throw Object.assign(new Error('OpenCode сообщает healthy=false'), { blocked: true });
      if (vcmp(ver, MIN_VERSION) < 0) throw Object.assign(new Error(`OpenCode ${h.version} слишком старый (нужна ≥ ${MIN_VERSION.join('.')})`), { blocked: true });
      return h; },
    config: dir => req('GET', '/config', { query: dq(dir) }),
    createSession: (dir, title) => req('POST', '/session', { query: dq(dir), body: { title: String(title).slice(0, 80) } }),
    promptAsync: (dir, id, text, model, tools) => req('POST', `/session/${encodeURIComponent(id)}/prompt_async`, { query: dq(dir), body: { parts: [{ type: 'text', text }], ...(model ? { model } : {}), ...(tools ? { tools } : {}) } }),
    status: dir => req('GET', '/session/status', { query: dq(dir) }),
    session: (dir, id) => req('GET', `/session/${encodeURIComponent(id)}`, { query: dq(dir) }),
    messages: (dir, id) => req('GET', `/session/${encodeURIComponent(id)}/message`, { query: dq(dir) }),
    permissions: dir => req('GET', '/permission', { query: dq(dir) }),
    reply: (dir, pid, reply, message) => { if (!['once', 'reject'].includes(reply)) throw new Error('only once/reject'); // never "always"
      return req('POST', `/permission/${encodeURIComponent(pid)}/reply`, { query: dq(dir), body: message ? { reply, message } : { reply } }); },
    abort: (dir, id) => req('POST', `/session/${encodeURIComponent(id)}/abort`, { query: dq(dir), timeout: 5000 }),
    // Server-sent events: calls onEvent(obj) per event until signal aborts. Best-effort (used for the action log only).
    async events(dir, onEvent, signal) {
      const r = await req('GET', '/event', { query: dq(dir), raw: true, signal, timeout: 24 * 3600e3 }); if (!r.ok || !r.body) return;
      const dec = new TextDecoder(); let buf = '';
      try { for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (data) { try { onEvent(JSON.parse(data)); } catch {} } } } } catch {}
    }
  };
}
module.exports = { createClient, MIN_VERSION };
