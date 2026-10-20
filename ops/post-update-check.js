#!/usr/bin/env node
// Post-update checks against a running server: health/version, auth still enforced, security headers, host check,
// optional ops endpoints (with app-token or mobile token), latest ops backup verifies.
//   node ops/post-update-check.js [--url http://127.0.0.1:8787] [--expect-version 1.1.2] [--data <dir>]
'use strict';
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const a = process.argv.slice(2); const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const B = (opt('--url') || 'http://127.0.0.1:8787').replace(/\/$/, '');
const dataDir = opt('--data') || process.env.STUDIO_DATA_DIR || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MOONKATTY AI STUDIO') : null);
const res = []; const ok = (n, c, x = '') => { res.push({ n, ok: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const raw = (p, headers) => new Promise(r => { const u = new URL(B + p); const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers }, s => { s.resume(); s.on('end', () => r(s.statusCode)); }); q.on('error', () => r(0)); q.end(); });
(async () => {
  let h = null; try { h = await (await fetch(B + '/api/health', { signal: AbortSignal.timeout(5000) })).json(); } catch {}
  ok('health', h && h.ok, h ? `v${h.version}, db ${h.db}` : 'нет ответа');
  if (opt('--expect-version')) ok('version', h && h.version === opt('--expect-version'), h && h.version);
  ok('scheduler tick fresh', h && h.lastTick && Date.now() - Date.parse(h.lastTick) < 90000, h && h.lastTick);
  for (const p of ['/api/tasks', '/api/backup', '/api/ops/status']) ok('auth required ' + p, (await fetch(B + p)).status === 401);
  const r = await fetch(B + '/'); ok('CSP present', /script-src 'self'/.test(r.headers.get('content-security-policy') || ''));
  const u = new URL(B); ok('host check (DNS rebinding)', (await raw('/api/health', { host: 'evil.example:' + u.port })) === 421);
  let tok = null; try { tok = fs.readFileSync(path.join(dataDir, 'app-token'), 'utf8').trim(); } catch {}
  if (tok && ['127.0.0.1', 'localhost'].includes(u.hostname)) {
    const s = await fetch(B + '/api/ops/status', { headers: { 'x-studio-app-token': tok } });
    if (s.status === 401) ok('ops status', true, 'app-token выключен после «Выйти» — пропущено');
    else { const j = await s.json(); ok('ops status', s.ok, JSON.stringify(j.flags));
      if (j.flags && j.flags.dashboard) { const st = await (await fetch(B + '/api/ops/update/status', { headers: { 'x-studio-app-token': tok } })).json(); ok('schema compatible', st.schema && st.schema.ok, JSON.stringify(st.schema && st.schema.schemaVersion)); }
      if (j.flags && j.flags.backup) { const l = await (await fetch(B + '/api/ops/backups', { headers: { 'x-studio-app-token': tok } })).json();
        if (l.length) { const v = await (await fetch(B + `/api/ops/backups/${l[0].id}/verify`, { method: 'POST', headers: { 'x-studio-app-token': tok, 'x-studio-request': '1' } })).json(); ok('latest backup verifies', v.ok, l[0].id); } } }
  }
  const failed = res.filter(x => !x.ok); console.log(JSON.stringify({ passed: res.length - failed.length, failed: failed.map(x => x.n) })); process.exit(failed.length ? 1 : 0);
})();
