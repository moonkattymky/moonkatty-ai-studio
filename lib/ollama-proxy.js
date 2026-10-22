// Filtered Ollama proxy for sandboxed runners (opencode_task). The sandbox has NO network; the only LLM channel is a
// per-task unix socket (mode 0600, in a 0700 dir inside the task workDir) that is bound into the sandbox.
// The proxy forwards ONLY to the local Ollama (127.0.0.1, fixed host, no redirects) and ONLY these endpoints:
//   POST /api/chat, POST /api/generate, POST /v1/chat/completions, GET /api/tags (filtered to allowlisted models).
// Model allowlist, body limit, concurrency + rate limit, upstream timeout; request headers are rebuilt from scratch
// (no Authorization/Cookie/agent tokens are ever forwarded or added); response headers are filtered too.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const UPSTREAM_HOST = '127.0.0.1'; // never configurable
const ROUTES = { 'POST /api/chat': 1, 'POST /api/generate': 1, 'POST /v1/chat/completions': 1, 'GET /api/tags': 1 };
const RESP_HDR = ['content-type', 'content-length', 'transfer-encoding', 'date'];
function defaultModels() {
  if (process.env.STUDIO_OLLAMA_MODELS) return process.env.STUDIO_OLLAMA_MODELS.split(',').map(s => s.trim()).filter(Boolean);
  let m = 'qwen3:8b'; try { m = String(require('./studio-config.js').opencodeModel || m).replace(/^ollama\//, ''); } catch {}
  return [...new Set([m, 'qwen2.5-coder:7b'])];
}
const normModel = m => { const s = String(m || '').replace(/^ollama\//, ''); return s.includes(':') ? s : s + ':latest'; };
// Ollama reachable? Fast probe (default 1500 ms) so opencode_task keeps failing fast with llm_unavailable when it is down.
function probe(port = 11434, timeoutMs = 1500) {
  return new Promise(res => { const q = http.request({ host: UPSTREAM_HOST, port, path: '/api/tags', method: 'GET', timeout: timeoutMs }, r => { r.resume(); res(r.statusCode === 200); });
    q.on('timeout', () => { q.destroy(); res(false); }); q.on('error', () => res(false)); q.end(); });
}
function startProxy({ dir, port = 11434, models = defaultModels(), maxBody = 1 << 20, maxConcurrent = 2, ratePerMin = 60, timeoutMs = 600000, log = () => {} } = {}) {
  const allow = new Set(models.map(normModel));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
  const sock = path.join(dir, 'ollama.sock'); try { fs.unlinkSync(sock); } catch {}
  let active = 0; const hits = []; const stats = { allowed: 0, rejected: 0 };
  const deny = (res, code, msg) => { stats.rejected++; log('deny ' + code + ' ' + msg); if (!res.headersSent) { res.writeHead(code, { 'content-type': 'application/json', connection: 'close' }); } res.end(JSON.stringify({ error: msg })); };
  const srv = http.createServer((req, res) => {
    const url = String(req.url || ''); const key = req.method + ' ' + url.split('?')[0];
    if (!url.startsWith('/') || req.method === 'CONNECT') return deny(res, 403, 'only local Ollama endpoints'); // absolute-form / CONNECT = other host
    if (!ROUTES[key]) return deny(res, 403, 'endpoint not allowed');
    const now = Date.now(); while (hits.length && now - hits[0] > 60000) hits.shift();
    if (hits.length >= ratePerMin) return deny(res, 429, 'rate limit');
    if (active >= maxConcurrent) return deny(res, 429, 'too many concurrent requests');
    if (Number(req.headers['content-length'] || 0) > maxBody) { req.resume(); return deny(res, 413, 'body too large'); }
    hits.push(now); active++; let done = false; const fin = () => { if (!done) { done = true; active--; } }; res.on('close', fin);
    const chunks = []; let size = 0, over = false;
    req.on('data', c => { if (over) return; size += c.length; if (size > maxBody) { over = true; deny(res, 413, 'body too large'); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      if (over) return; const body = Buffer.concat(chunks); let json = null;
      if (req.method === 'POST') { try { json = JSON.parse(body.toString('utf8')); } catch { return deny(res, 400, 'invalid JSON'); }
        if (!json || typeof json !== 'object' || !allow.has(normModel(json.model))) return deny(res, 403, 'model not allowed'); }
      const headers = { host: UPSTREAM_HOST + ':' + port, accept: 'application/json, text/event-stream', connection: 'close' };
      if (req.method === 'POST') { headers['content-type'] = 'application/json'; headers['content-length'] = body.length; }
      const up = http.request({ host: UPSTREAM_HOST, port, method: req.method, path: url.split('?')[0], headers, timeout: timeoutMs }, ur => {
        if (ur.statusCode >= 300 && ur.statusCode < 400) { ur.resume(); return deny(res, 502, 'upstream redirect refused'); }
        const h = {}; for (const k of RESP_HDR) if (ur.headers[k]) h[k] = ur.headers[k];
        if (key === 'GET /api/tags') { const b = []; ur.on('data', c => b.push(c)); ur.on('end', () => { let o = {}; try { o = JSON.parse(Buffer.concat(b)); } catch {}
          const out = JSON.stringify({ models: (o.models || []).filter(m => allow.has(normModel(m.name || m.model))) }); stats.allowed++; res.writeHead(ur.statusCode, { 'content-type': 'application/json' }); res.end(out); }); return; }
        stats.allowed++; res.writeHead(ur.statusCode, h); ur.pipe(res);
      });
      up.on('timeout', () => { up.destroy(); deny(res, 504, 'upstream timeout'); });
      up.on('error', () => deny(res, 502, 'ollama unavailable'));
      res.on('close', () => up.destroy());
      up.end(req.method === 'POST' ? body : undefined);
    });
  });
  srv.maxHeadersCount = 50; srv.headersTimeout = 10000; srv.requestTimeout = timeoutMs;
  const conns = new Set(); srv.on('connection', s => { conns.add(s); s.on('close', () => conns.delete(s)); });
  const ready = new Promise((resolve, reject) => { const um = process.umask(0o177); srv.once('error', e => { process.umask(um); reject(e); });
    srv.listen(sock, () => { process.umask(um); try { fs.chmodSync(sock, 0o600); } catch {} resolve(); }); });
  const close = () => new Promise(r => { for (const s of conns) s.destroy(); srv.close(() => { try { fs.unlinkSync(sock); } catch {} r(); }); try { fs.unlinkSync(sock); } catch {} });
  return { sock, dir, ready, close, stats, models: [...allow] };
}
module.exports = { startProxy, probe, defaultModels, normModel, ROUTES, UPSTREAM_HOST };
