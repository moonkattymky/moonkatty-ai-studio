// QA-E2E-001 HTTP end-to-end: start server, request owner action, approve, verify execution/journal/consume.
// Covers Studio 4 R1 (reuse), R2 (app-token / self approval / password), R3 (param binding). Node >= 22.5.
// Usage: node scripts/world-approval-e2e-test.mjs            (expects Approval Center wired via lib/world/wiring.js)
//        node scripts/world-approval-e2e-test.mjs --unwired  (expects honest not_wired without server.js wiring)
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os'; import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const UNWIRED = process.argv.includes('--unwired');
const PORT = 8921, BASE = 'http://127.0.0.1:' + PORT, UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-appr-e2e-')); const PW = 'fake-owner-pw-1';
const LOCK_MS = 4000; let srv, slog = '';
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); if (!c) fail++; };
async function start(extra = {}) { slog = ''; srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '127.0.0.1', MK_WORLD_PW_DELAY_MS: '100', MK_WORLD_PW_LOCK_MS: String(LOCK_MS), ...extra } });
  srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
  let up = false; for (let i = 0; i < 75 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch {} if (!up) await sleep(200); }
  ok('server boots on ' + PORT, up, slog.slice(-600)); if (!up) { srv.kill(); process.exit(1); } }
async function stop() { srv.kill('SIGTERM'); await new Promise(r => srv.once('exit', r)); }
await start();
const tok = fs.readFileSync(path.join(UD, 'app-token'), 'utf8').trim(); let cookie = '';
const call = async (who, m, p, b) => { const h = { 'content-type': 'application/json', 'x-studio-request': '1' }; if (who === 'app') h['x-studio-app-token'] = tok; else if (who === 'forged') { h['x-studio-app-token'] = tok; h.cookie = 'mk_session=deadbeef'; } else if (who === 'both') { h['x-studio-app-token'] = tok; h.cookie = cookie; } else if (who === 'bearer') { h.authorization = 'Bearer ' + tok; h.cookie = cookie; } else h.cookie = cookie;
  const r = await fetch(BASE + p, { method: m, headers: h, body: b == null ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc && /mk_session=/.test(sc) && who === 'sess') cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
ok('setup owner', (await call('app', 'POST', '/api/auth/setup', { username: 'igor', password: PW })).s === 200);
ok('owner session login', (await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW })).s === 200 && !!cookie);
// confirm:true alone
const c1 = await call('app', 'POST', '/api/world/savings', { target_usd: 5000, confirm: true });
ok('confirm:true alone -> 403 needs_owner', c1.s === 403 && c1.j.code === 'needs_owner' && !!c1.j.approvalId, JSON.stringify(c1.j)); const A = c1.j.approvalId;
// R2
const r2a = await call('app', 'POST', '/api/world/approvals/' + A, { decision: 'approve', password: PW });
ok('R2 app token cannot approve (even with password)', r2a.s === 403 || (UNWIRED && r2a.s === 503), JSON.stringify(r2a.j));
const r2b = await call('sess', 'POST', '/api/world/approvals/' + A, { decision: 'approve' });
ok('R2 session without password cannot approve', r2b.s === 403 && r2b.j.code === 'owner_reauth' || (UNWIRED && r2b.s === 503), JSON.stringify(r2b.j));
const appSelf = await call('app', 'POST', '/api/world/savings', { target_usd: 2 });
const r2c = await call('app', 'POST', '/api/world/approvals/' + appSelf.j.approvalId, { decision: 'approve', password: PW });
ok('agent/app token cannot approve its own request', r2c.s === 403 && ['self_approval', 'owner_session_required'].includes(r2c.j.code) || (UNWIRED && r2c.s === 503), JSON.stringify(r2c.j));
const apA = await call('sess', 'POST', '/api/world/approvals/' + A, { decision: 'approve', password: PW });
if (UNWIRED) {
  ok('unwired: approve -> 503 not_wired, nothing executed', apA.s === 503 && apA.j.status === 'not_wired' && apA.j.executed !== true, JSON.stringify(apA.j));
  const st = await call('sess', 'GET', '/api/world/approvals/' + A); ok('unwired: approval stays pending', st.j.status === 'pending', JSON.stringify(st.j));
} else {
  ok('approve (owner session + password, other principal) -> executed', apA.s === 200 && apA.j.executed === true && apA.j.execStatus === 'executed', JSON.stringify(apA.j));
  const st = await call('sess', 'GET', '/api/world/approvals/' + A);
  ok('status exposed: approved, consumed, execStatus executed', st.j.status === 'approved' && st.j.consumed === true && st.j.execStatus === 'executed' && st.j.decidedBy === 'igor', JSON.stringify(st.j));
  const cc = await call('sess', 'GET', '/api/world/command-center'); ok('action effect: savings target 5000 applied', JSON.stringify(cc.j.savings || {}).includes('5000'), JSON.stringify(cc.j.savings));
  const jr = await call('sess', 'GET', '/api/world/journal'); ok('journal has executed entry for approval', (jr.j || []).some(r => r.decision === 'executed' && r.detail.includes(A)), '');
  // R1 reuse
  const re1 = await call('app', 'POST', '/api/world/savings', { target_usd: 5000, approvalId: A });
  ok('R1 replay of consumed id -> 409 consumed', re1.s === 409 && re1.j.code === 'consumed', JSON.stringify(re1.j));
  const re2 = await call('sess', 'POST', '/api/world/approvals/' + A, { decision: 'approve', password: PW }); ok('R1 re-approve same id -> 409 consumed', re2.s === 409 && re2.j.code === 'consumed', JSON.stringify(re2.j));
  // R3 param binding: 999999 with an id approved for 5000 / pending id for 7
  const re3 = await call('app', 'POST', '/api/world/savings', { target_usd: 999999, approvalId: A }); ok('R3 999999 with consumed id for 5000 -> rejected (409 consumed)', re3.s === 409 && re3.j.code === 'consumed', JSON.stringify(re3.j));
  const D = (await call('app', 'POST', '/api/world/savings', { target_usd: 7 })).j.approvalId;
  const re4 = await call('app', 'POST', '/api/world/savings', { target_usd: 999999, approvalId: D }); ok('R3 pending id + other value -> 403', re4.s === 403);
  const cc2 = await call('sess', 'GET', '/api/world/command-center'); ok('R3 pending request did not overwrite applied value', JSON.stringify(cc2.j.savings || {}).includes('5000') && !JSON.stringify(cc2.j.savings).includes('999999'), JSON.stringify(cc2.j.savings));
  // external action: approved but never executed externally
  const pa = await call('app', 'POST', '/api/world/action', { action: 'paid_ads', detail: 'campaign x', confirm: true });
  const ap2 = await call('sess', 'POST', '/api/world/approvals/' + pa.j.approvalId, { decision: 'approve', password: PW });
  ok('paid_ads approved -> executed:false, external_disabled (no payment)', pa.s === 403 && ap2.s === 200 && ap2.j.executed === false && ap2.j.execStatus === 'external_disabled', JSON.stringify(ap2.j));
  // N1: app token + forged cookie must stay app channel (cannot approve, nothing executed)
  const n1 = (await call('app', 'POST', '/api/world/savings', { target_usd: 42 })).j.approvalId;
  const n1a = await call('forged', 'POST', '/api/world/approvals/' + n1, { decision: 'approve', password: PW });
  ok('N1 app token + forged mk_session=deadbeef -> 403 (app channel)', n1a.s === 403 && ['owner_session_required', 'self_approval'].includes(n1a.j.code) && n1a.j.executed !== true, JSON.stringify(n1a.j));
  const n1b = await call('both', 'POST', '/api/world/approvals/' + n1, { decision: 'approve', password: PW });
  ok('N1 app token + real session cookie -> still app channel, 403', n1b.s === 403 && ['owner_session_required', 'self_approval'].includes(n1b.j.code), JSON.stringify(n1b.j));
  const n1s = await call('sess', 'GET', '/api/world/approvals/' + n1); ok('N1 approval stays pending, not executed', n1s.j.status === 'pending' && !n1s.j.execStatus, JSON.stringify(n1s.j));
  const rj = await call('app', 'POST', '/api/world/savings', { target_usd: 3 }); const rr = await call('sess', 'POST', '/api/world/approvals/' + rj.j.approvalId, { decision: 'reject' });
  const re5 = await call('app', 'POST', '/api/world/savings', { target_usd: 3, approvalId: rj.j.approvalId }); ok('rejected id -> 403', rr.s === 200 && re5.s === 403);
  // Bearer/Authorization + real cookie = mixed credentials -> never a session
  const mx = (await call('app', 'POST', '/api/world/savings', { target_usd: 44 })).j.approvalId;
  const mxa = await call('bearer', 'POST', '/api/world/approvals/' + mx, { decision: 'approve', password: PW });
  ok('mixed Authorization + session cookie -> 403 (app channel)', mxa.s === 403 && ['owner_session_required', 'self_approval'].includes(mxa.j.code), JSON.stringify(mxa.j));
  // Concurrency: two approvals of one id in parallel -> exactly one executes
  const cx = (await call('app', 'POST', '/api/world/savings', { target_usd: 6000 })).j.approvalId;
  const [p1, p2] = await Promise.all([1, 2].map(() => call('sess', 'POST', '/api/world/approvals/' + cx, { decision: 'approve', password: PW })));
  ok('concurrent double approve -> exactly one 200 executed, other 409', [p1, p2].filter(r => r.s === 200 && r.j.executed).length === 1 && [p1, p2].filter(r => r.s === 409).length === 1, JSON.stringify([p1.j, p2.j]));
  // Owner self-approval (Igor's rule): owner-session request, owner-session approval + fresh password
  const os1 = (await call('sess', 'POST', '/api/world/savings', { target_usd: 6100 })).j.approvalId;
  const os0 = await call('sess', 'POST', '/api/world/approvals/' + os1, { decision: 'approve' });
  ok('owner self-approval without password -> 403 owner_reauth', os0.s === 403 && os0.j.code === 'owner_reauth', JSON.stringify(os0.j));
  const osA = await call('both', 'POST', '/api/world/approvals/' + os1, { decision: 'approve', password: PW });
  ok('owner self-approval via token+cookie -> 403', osA.s === 403 && osA.j.executed !== true, JSON.stringify(osA.j));
  const os2 = await call('sess', 'POST', '/api/world/approvals/' + os1, { decision: 'approve', password: PW });
  ok('owner self-approval (session + fresh password) -> executed', os2.s === 200 && os2.j.executed === true, JSON.stringify(os2.j));
  const jr2 = await call('sess', 'GET', '/api/world/journal'); ok("journal event exactly 'owner_self_approval'", (jr2.j || []).some(r => r.decision === 'owner_self_approval' && r.detail.includes(os1)));
  ok('owner self-approval replay -> 409 consumed', (await call('sess', 'POST', '/api/world/approvals/' + os1, { decision: 'approve', password: PW })).j?.code === 'consumed');
  ok('owner self-approved id + other params -> rejected', (await call('sess', 'POST', '/api/world/savings', { target_usd: 999999, approvalId: os1 })).s >= 403);
  // Throttle + lockout (persistent, per user)
  const n2 = (await call('app', 'POST', '/api/world/savings', { target_usd: 43 })).j.approvalId; const codes = [];
  codes.push((await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: 'wrong-0' })).j.code);
  const th = await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: PW });
  ok('progressive delay: immediate retry -> 429 throttled (even correct pw)', th.s === 429 && th.j.code === 'throttled', JSON.stringify(th.j));
  for (let i = 1; i < 5; i++) { await sleep(100 * 2 ** (i - 1) + 50); codes.push((await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: 'wrong-' + i })).j.code); }
  ok('five wrong passwords -> owner_reauth', codes.every(c => c === 'owner_reauth'), codes.join(','));
  const n2b = await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: PW });
  ok('correct password after lockout -> 429 locked, not executed', n2b.s === 429 && n2b.j.code === 'locked' && n2b.j.executed !== true, JSON.stringify(n2b.j));
  const n2c = await call('app', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: 'x' });
  ok('channel checked before password (app -> owner_session_required)', ['owner_session_required', 'self_approval'].includes(n2c.j.code), JSON.stringify(n2c.j));
  // Storage-level checks via the same SQLite file (server-side state)
  const { DatabaseSync } = await import('node:sqlite'); const dbf = fs.readdirSync(UD).find(f => f.endsWith('.db')); const sdb = new DatabaseSync(path.join(UD, dbf));
  const af = sdb.prepare('SELECT user, fails, locked_until FROM world_auth_fails WHERE user LIKE ?').get('igor|%');
  ok('limiter is persisted in SQLite world_auth_fails keyed by user', af && af.fails >= 5 && af.locked_until > Date.now(), JSON.stringify(af));
  const tp = (await call('app', 'POST', '/api/world/savings', { target_usd: 45 })).j.approvalId;
  sdb.prepare('UPDATE world_approvals SET payload_json = ? WHERE id = ?').run(JSON.stringify({ kind: 'savings', target_usd: 999999 }), tp);
  // F2: stale rows (expired lockout, idle counter) must be purged at boot
  const ins = sdb.prepare('INSERT INTO world_auth_fails (user, fails, locked_until, next_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  ins.run('ghost|10.9.9.9', 5, Date.now() - 1000, 0, '2026-01-01'); ins.run('idle|10.9.9.9', 2, 0, Date.now() - 3600e3, '2026-01-01'); sdb.close();
  // lockout is active; tampered approval is checked after restart+expiry below
  // Restart mid-test: lockout + consumed state must persist; short self-approval window to test expiry
  const os3 = (await call('sess', 'POST', '/api/world/savings', { target_usd: 6200 })).j.approvalId;
  await stop(); await start({ MK_WORLD_SELF_APPROVAL_WINDOW_MS: '1' });
  ok('same session cookie still valid after restart (no new login)', (await call('sess', 'GET', '/api/world/approvals/' + n2)).s === 200);
  const lk = await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: PW });
  ok('restart: lockout persists across restart -> 429 locked', lk.s === 429 && lk.j.code === 'locked', JSON.stringify(lk.j));
  ok('restart: consumed id still 409 consumed', (await call('app', 'POST', '/api/world/savings', { target_usd: 5000, approvalId: A })).j?.code === 'consumed');
  // Re-login (main login with password) after lockout = safe reset; a session-only request cannot do it
  const tp2 = (await call('app', 'POST', '/api/world/savings', { target_usd: 46 })).j.approvalId;
  await sleep(LOCK_MS + 300); // let the persisted lockout expire first, so the DoS lockout below is deterministic
  for (let i = 0; i < 5; i++) { await sleep(100 * 2 ** i + 50); (await call('sess', 'POST', '/api/world/approvals/' + tp2, { decision: 'approve', password: 'bad-' + i })); }
  ok('lockout again (DoS attempt from session)', (await call('sess', 'POST', '/api/world/approvals/' + tp2, { decision: 'approve', password: PW })).j?.code === 'locked');
  await sleep(1100); cookie = ''; ok('owner main login', (await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW })).s === 200);
  const rs = await call('sess', 'POST', '/api/world/approvals/' + tp2, { decision: 'approve', password: PW });
  ok('successful main login after lockout resets limiter', rs.s === 200 && rs.j.executed === true, JSON.stringify(rs.j));
  const wsH = await fetch(BASE + '/api/world/approvals/' + tp, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1', 'x-studio-app-token': ' ', cookie }, body: JSON.stringify({ decision: 'approve', password: PW }) });
  ok('whitespace-only token header + cookie -> not a session (rejected)', wsH.status === 401 || wsH.status === 403, String(wsH.status));
  await sleep(LOCK_MS + 300);
  const rc = await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: PW });
  ok('lockout expires; correct password -> executed, counter reset', rc.s === 200 && rc.j.executed === true, JSON.stringify(rc.j));
  const tpa = await call('sess', 'POST', '/api/world/approvals/' + tp, { decision: 'approve', password: PW });
  const cc3 = await call('sess', 'GET', '/api/world/command-center');
  ok('payload tampered in DB -> hash mismatch at execution, not executed', tpa.j?.executed !== true && !JSON.stringify(cc3.j.savings || {}).includes('999999'), JSON.stringify(tpa.j));
  ok('F1 tampered approve -> 409 payload_mismatch, status invalidated, consumed', tpa.s === 409 && tpa.j.code === 'payload_mismatch' && tpa.j.approval?.status === 'invalidated' && tpa.j.approval?.consumed === true, JSON.stringify(tpa.j));
  const f1b = await call('app', 'POST', '/api/world/savings', { target_usd: 45, approvalId: tp });
  ok('F1 /savings with ORIGINAL params + invalidated id -> 409 consumed, not applied', f1b.s === 409 && f1b.j.code === 'consumed' && !JSON.stringify((await call('sess', 'GET', '/api/world/command-center')).j.savings || {}).includes('"target_usd":45'), JSON.stringify(f1b.j));
  ok('F1 re-approve invalidated id -> 409', (await call('sess', 'POST', '/api/world/approvals/' + tp, { decision: 'approve', password: PW })).s === 409);
  { const { DatabaseSync: D2 } = await import('node:sqlite'); const d2 = new D2(path.join(UD, fs.readdirSync(UD).find(f => f.endsWith('.db'))));
    ok('F2 boot/access purge removed expired lockout + idle counter rows', d2.prepare("SELECT COUNT(*) n FROM world_auth_fails WHERE user LIKE '%|10.9.9.9'").get().n === 0);
    const ins2 = d2.prepare('INSERT INTO world_auth_fails (user, fails, locked_until, next_at, updated_at) VALUES (?, 1, 0, ?, ?)');
    for (let i = 0; i < 25; i++) ins2.run('u' + i + '|127.0.0.1', Date.now() + 3600e3, '2026-01-01T00:00:' + String(i).padStart(2, '0'));
    d2.close(); }
  await call('sess', 'POST', '/api/world/approvals/' + (await call('app', 'POST', '/api/world/savings', { target_usd: 47 })).j.approvalId, { decision: 'approve', password: 'wrong-cap' });
  { const { DatabaseSync: D3 } = await import('node:sqlite'); const d3 = new D3(path.join(UD, fs.readdirSync(UD).find(f => f.endsWith('.db'))));
    const n = d3.prepare("SELECT COUNT(*) n FROM world_auth_fails WHERE user LIKE '%|127.0.0.1'").get().n; const me = d3.prepare("SELECT fails FROM world_auth_fails WHERE user = 'igor|127.0.0.1'").get(); d3.close();
    ok('F2 per-IP cap: <= 20 rows for 127.0.0.1, new failure still recorded', n <= 20 && me && me.fails === 1, JSON.stringify({ n, me })); }
  const ex = await call('sess', 'POST', '/api/world/approvals/' + os3, { decision: 'approve', password: PW });
  ok('owner self-approval outside window -> 403 self_approval, not executed', ex.s === 403 && ex.j.code === 'self_approval' && ex.j.executed !== true, JSON.stringify(ex.j));
}
await stop(); fs.rmSync(UD, { recursive: true, force: true });
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
