// QA-E2E-001 HTTP end-to-end: start server, request owner action, approve, verify execution/journal/consume.
// Covers Studio 4 R1 (reuse), R2 (app-token / self approval / password), R3 (param binding). Node >= 22.5.
// Usage: node scripts/world-approval-e2e-test.mjs            (expects Approval Center wired via lib/world/wiring.js)
//        node scripts/world-approval-e2e-test.mjs --unwired  (expects honest not_wired without server.js wiring)
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os'; import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const UNWIRED = process.argv.includes('--unwired');
const PORT = 8921, BASE = 'http://127.0.0.1:' + PORT, UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-appr-e2e-')); const PW = 'fake-owner-pw-1';
const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '127.0.0.1' } });
let slog = ''; srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); if (!c) fail++; };
let up = false; for (let i = 0; i < 75 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch {} if (!up) await sleep(200); }
ok('server boots on ' + PORT, up, slog.slice(-600)); if (!up) { srv.kill(); process.exit(1); }
const tok = fs.readFileSync(path.join(UD, 'app-token'), 'utf8').trim(); let cookie = '';
const call = async (who, m, p, b) => { const h = { 'content-type': 'application/json', 'x-studio-request': '1' }; if (who === 'app') h['x-studio-app-token'] = tok; else if (who === 'forged') { h['x-studio-app-token'] = tok; h.cookie = 'mk_session=deadbeef'; } else if (who === 'both') { h['x-studio-app-token'] = tok; h.cookie = cookie; } else h.cookie = cookie;
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
const self = await call('sess', 'POST', '/api/world/savings', { target_usd: 1 });
const r2c = await call('sess', 'POST', '/api/world/approvals/' + self.j.approvalId, { decision: 'approve', password: PW });
ok('R2 self-approval (same principal) rejected', r2c.s === 403 && r2c.j.code === 'self_approval' || (UNWIRED && r2c.s === 503), JSON.stringify(r2c.j));
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
  ok('R1 reuse of consumed id -> 403', re1.s === 403 && re1.j.code === 'needs_owner', JSON.stringify(re1.j));
  const re2 = await call('sess', 'POST', '/api/world/approvals/' + A, { decision: 'approve', password: PW }); ok('R1 re-approve same id -> 409', re2.s === 409);
  // R3 param binding: 999999 with an id approved for 5000 / pending id for 7
  const re3 = await call('app', 'POST', '/api/world/savings', { target_usd: 999999, approvalId: A }); ok('R3 999999 with id for 5000 -> 403', re3.s === 403, JSON.stringify(re3.j));
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
  ok('N1 app token + forged mk_session=deadbeef -> 403 owner_session_required', n1a.s === 403 && n1a.j.code === 'owner_session_required' && n1a.j.executed !== true, JSON.stringify(n1a.j));
  const n1b = await call('both', 'POST', '/api/world/approvals/' + n1, { decision: 'approve', password: PW });
  ok('N1 app token + real session cookie -> still app channel, 403', n1b.s === 403 && n1b.j.code === 'owner_session_required', JSON.stringify(n1b.j));
  const n1s = await call('sess', 'GET', '/api/world/approvals/' + n1); ok('N1 approval stays pending, not executed', n1s.j.status === 'pending' && !n1s.j.execStatus, JSON.stringify(n1s.j));
  const rj = await call('app', 'POST', '/api/world/savings', { target_usd: 3 }); const rr = await call('sess', 'POST', '/api/world/approvals/' + rj.j.approvalId, { decision: 'reject' });
  const re5 = await call('app', 'POST', '/api/world/savings', { target_usd: 3, approvalId: rj.j.approvalId }); ok('rejected id -> 403', rr.s === 200 && re5.s === 403);
  // N2: lockout after 5 wrong approve passwords; correct password afterwards is still locked; channel checked before password
  const n2 = (await call('app', 'POST', '/api/world/savings', { target_usd: 43 })).j.approvalId; const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: 'wrong-' + i })).j.code);
  ok('N2 five wrong passwords -> owner_reauth', codes.every(c => c === 'owner_reauth'), codes.join(','));
  const n2b = await call('sess', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: PW });
  ok('N2 correct password after lockout -> 429 locked, not executed', n2b.s === 429 && n2b.j.code === 'locked' && n2b.j.executed !== true, JSON.stringify(n2b.j));
  const n2c = await call('app', 'POST', '/api/world/approvals/' + n2, { decision: 'approve', password: 'x' });
  ok('N2 channel checked before password (app -> owner_session_required, not counted)', n2c.j.code === 'owner_session_required', JSON.stringify(n2c.j));
  ok('N2 approval stays pending', (await call('sess', 'GET', '/api/world/approvals/' + n2)).j.status === 'pending');
}
srv.kill('SIGTERM'); await new Promise(r => srv.once('exit', r)); fs.rmSync(UD, { recursive: true, force: true });
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
