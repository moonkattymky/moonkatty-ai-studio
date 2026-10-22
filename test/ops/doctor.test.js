'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const { spawn } = require('child_process');
const express = require('express');
const { open } = require('../../lib/db.js');
const sec = require('../../lib/security.js');
const heavy = require('../../lib/heavy-lock.js');
const exec = require('../../lib/ops/doctor/exec');
const registry = require('../../lib/ops/doctor/registry');
const host = require('../../lib/ops/doctor/checks/host');
const dbcheck = require('../../lib/ops/doctor/checks/db');
const files = require('../../lib/ops/doctor/checks/files');
const ollama = require('../../lib/ops/doctor/checks/ollama');
const opencode = require('../../lib/ops/doctor/checks/opencode');
const blender = require('../../lib/ops/doctor/checks/blender');
const tailscale = require('../../lib/ops/doctor/checks/tailscale');
const runs = require('../../lib/ops/doctor/checks/index');
const actionsMod = require('../../lib/ops/doctor/actions');
const schedule = require('../../lib/ops/doctor/schedule');
const report = require('../../lib/ops/doctor/report');
const { mountDoctor } = require('../../lib/ops/doctor/mount');
const { makeTemp } = require('../../lib/ops/doctor/paths');
const { openStudioIntelligence } = require('../../studio-intelligence/src');

const PW = 'owner-pass-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..', '..');

function lab() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-sd-test-'));
  const dbPath = path.join(dir, 'studio.db');
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { mode: 0o700 });
  const db = open(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
           CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);
  const si = openStudioIntelligence({ db, now: () => new Date().toISOString() });
  const ctx = {
    db, openDb: open, backupDir, dbPath, approvals: si.approval, heavy,
    checkPassword: (u, p) => u === 'igor' && p === PW,
    log: () => {}, now: () => Date.now()
  };
  const actions = actionsMod.createActions(ctx);
  return { dir, db, dbPath, backupDir, actions, si, ctx };
}

test.describe('system doctor', { concurrency: 1 }, () => {
  test('registry rejects sudo, tailscale writes and HTTP to 4096', () => {
    assert.equal(registry.lintAll().ok, true);
    assert.throws(() => registry.assertCommand({ id: 'bad', bins: ['/usr/bin/sudo'], args: ['id'] }), /запрещ|sudo/i);
    assert.throws(() => registry.assertCommand({ id: 'ts', bins: ['/usr/bin/tailscale'], args: ['up'], tailscale: true }), /Tailscale|запрещ/i);
    assert.throws(() => registry.assertCommand({ id: 'fetch', bins: ['/usr/bin/curl'], args: ['http://127.0.0.1:4096'], http: true }), /запрещ|4096/i);
    const src = fs.readFileSync(path.join(ROOT, 'lib/ops/doctor/exec.js'), 'utf8');
    assert.match(src, /shell:\s*false/);
    assert.doesNotMatch(src, /exec\(/);
    for (const list of Object.values(registry.BY_PLATFORM)) {
      for (const spec of list) {
        for (const bin of spec.bins) assert.equal(registry.BANNED_BIN.test(path.basename(bin)), false, bin);
        assert.equal(Boolean(/4096/.test((spec.args || []).join(' ')) && spec.http), false);
      }
    }
  });

  test('real allowlisted commands: nproc, df, ps, and a rejected injection', async () => {
    exec.resetForTests();
    const n = await exec.run('cpu.nproc');
    assert.equal(n.status, 'OK');
    const expected = require('child_process').execFileSync('/usr/bin/nproc', { encoding: 'utf8' }).trim();
    assert.equal(n.stdout.trim(), expected);
    const df = await exec.run('disk.df');
    assert.equal(df.code, 0);
    const parsed = host.parseDf(df.stdout);
    assert.ok(parsed && parsed.totalBytes > 1e9);
    const live = host.parseDf(require('child_process').execFileSync('/usr/bin/df', ['-kP', '/'], { encoding: 'utf8' }));
    assert.ok(Math.abs(parsed.avail - live.avail) < 1024 * 64);
    const ps = await exec.run('proc.ps');
    assert.equal(ps.code, 0);
    assert.ok(host.parsePs(ps.stdout).some(p => p.pid === process.pid || p.comm === 'node' || p.comm === 'ps'));
    await assert.rejects(() => exec.run('sudo', {}), e => e.code === 'FORBIDDEN');
    await assert.rejects(() => exec.run('port.lsof', { params: { port: '22' } }), e => e.code === 'BAD_PARAMS');
    await assert.rejects(() => exec.run('port.lsof', { params: { port: '4097;rm' } }), e => e.code === 'BAD_PARAMS');
    await assert.rejects(() => exec.run('engine.cat', { params: { path: '/etc/passwd' } }), e => e.code === 'FORBIDDEN');
    const listen = await exec.run('port.lsof', { params: { port: '4096' } });
    assert.notEqual(listen.status, 'FORBIDDEN');
    assert.equal(exec.SAFE_ENV.PATH.includes('sudo'), false);
  });

  test('output cap, timeout kills the process group, two-at-a-time limit', async () => {
    exec.resetForTests();
    const seq = await exec.run('engine.seq');
    assert.equal(seq.truncated, true);
    assert.ok(seq.stdout.length <= exec.MAX_BUFFER);
    const hang = await exec.run('engine.hang', { timeoutMs: 400 });
    assert.equal(hang.timedOut, true);
    await sleep(50);
    assert.throws(() => process.kill(hang.pid, 0));
    let peak = 0;
    const watch = setInterval(() => { peak = Math.max(peak, exec.active()); }, 20);
    await Promise.all([exec.run('engine.sleep', { params: { seconds: '1' } }), exec.run('engine.sleep', { params: { seconds: '1' } }), exec.run('engine.sleep', { params: { seconds: '1' } })]);
    clearInterval(watch);
    assert.ok(peak <= exec.MAX_PARALLEL, 'peak ' + peak);
    assert.ok(peak >= 1);
  });

  test('secret redaction of a real command stdout', async () => {
    const dir = makeTemp();
    const file = path.join(dir, 'note.txt');
    fs.writeFileSync(file, 'password=supersecret Basic dXNlcjpwYXNz Authorization: Bearer tokentoken12 nk_live_abcdefghij sk-proj-abcdefghijklmnop /Users/a/Library/Keychains/login.keychain-db\n');
    const r = await exec.run('engine.cat', { params: { path: file }, sec });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /supersecret|dXNlcjpwYXNz|tokentoken12|nk_live_abcdefghij|sk-proj-abcdefghijklmnop|login\.keychain/);
    assert.match(r.stdout, /REDACTED/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('host parsers and a real disk quota fault', async () => {
    const mem = host.parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
    assert.ok(mem.total > 0 && mem.available > 0);
    const dir = makeTemp();
    fs.writeFileSync(path.join(dir, 'fill'), Buffer.alloc(8192));
    const full = await host.disk({ quotaBytes: 4096, quotaDir: dir });
    assert.equal(full.status, 'FAIL');
    assert.ok(full.summary.includes('Квота'));
    const live = await host.disk({});
    assert.ok(live.data.totalBytes > 0);
    assert.ok(['OK', 'WARN', 'FAIL'].includes(live.status));
    const cpu = await host.cpu({});
    assert.equal(cpu.status === 'BLOCKED' ? 'BLOCKED' : cpu.status, cpu.status);
    assert.ok(cpu.data.cores > 0 || cpu.status === 'BLOCKED');
    const temp = await host.temperature();
    if (process.platform !== 'darwin' && !(temp.data.zones || []).length) assert.equal(temp.status, 'BLOCKED');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('dead port, corrupted sqlite, and a good integrity copy', async () => {
    const probe = net.createServer();
    await new Promise((res, rej) => probe.listen(4097, '127.0.0.1', err => err ? rej(err) : res()));
    const busy = await host.ports({});
    assert.equal(busy.data.ports.find(p => p.port === 4097).listening, true);
    assert.equal(busy.data.ports.find(p => p.port === 4096).http, 'forbidden');
    await new Promise(res => probe.close(res));
    await sleep(100);
    const free = await host.ports({});
    assert.equal(free.data.ports.find(p => p.port === 4097).listening, false);

    const { dir, dbPath } = lab();
    const good = path.join(dir, 'good.db');
    const g = open(good); g.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);'); g.close();
    assert.equal(dbcheck.integrityOn(open, good).status, 'OK');
    fs.writeFileSync(path.join(dir, 'bad.db'), Buffer.from('this is not sqlite'));
    const bad = dbcheck.integrityOn(open, path.join(dir, 'bad.db'));
    assert.equal(bad.status, 'FAIL');
    const quick = dbcheck.quickCheck({ db: open(dbPath) });
    assert.equal(quick.status, 'OK');
  });

  test('file hash mismatch is a real failure; codesign is blocked off macOS', () => {
    const dir = makeTemp();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
    const manifest = { files: { 'a.txt': files.sha256File(path.join(dir, 'a.txt')) } };
    assert.equal(files.verify(dir, manifest, ['a.txt']).status, 'OK');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two');
    assert.equal(files.verify(dir, manifest, ['a.txt']).status, 'FAIL');
    if (process.platform !== 'darwin') assert.equal(files.codesign().status, 'BLOCKED');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ollama: live endpoint is honest, local server measures latency', async () => {
    const live = await ollama.generate({ skipLock: true, timeoutMs: 3000 });
    assert.ok(['BLOCKED', 'OK', 'FAIL'].includes(live.status));
    if (live.status === 'BLOCKED') assert.match(live.summary, /недоступн|не установлена|Ollama/i);
    const seen = [];
    const srv = http.createServer((q, res) => {
      if (q.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
      let body = '';
      q.on('data', d => body += d);
      q.on('end', () => {
        seen.push(JSON.parse(body));
        res.end(JSON.stringify({ response: 'OK', total_duration: 10, load_duration: 1, eval_duration: 2 }));
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const hit = await ollama.generate({ skipLock: true, baseUrl: 'http://127.0.0.1:' + port });
    assert.equal(hit.status, 'OK');
    assert.ok(hit.data.latencyMs >= 0);
    assert.equal(seen[0].model, 'qwen3:8b');
    assert.equal(seen[0].prompt, ollama.PROMPT);
    assert.equal(seen[0].stream, false);
    srv.close();
  });

  test('opencode refuses 4096 with zero connections and completes PONG on an allowed test port', async () => {
    let hits = 0;
    const banned = http.createServer((q, res) => { hits++; res.end('no'); });
    await new Promise((res, rej) => banned.listen(4096, '127.0.0.1', err => err ? rej(err) : res()));
    const refused = await opencode.check({ baseUrl: 'http://127.0.0.1:4096', allowTestPort: true });
    assert.equal(refused.status, 'FORBIDDEN');
    assert.equal(hits, 0);
    banned.close();

    const pw = 'sd-test-pw';
    const auth = 'Basic ' + Buffer.from('opencode:' + pw).toString('base64');
    let prompted = null;
    const srv = http.createServer((q, res) => {
      const u = new URL(q.url, 'http://127.0.0.1');
      const ok = q.headers.authorization === auth;
      if (u.pathname === '/global/health') {
        if (!ok) { res.writeHead(401); return res.end('unauthorized'); }
        return res.end(JSON.stringify({ healthy: true, version: '1.2.0' }));
      }
      if (!ok) { res.writeHead(401); return res.end('no'); }
      if (u.pathname === '/session' && q.method === 'POST') return res.end(JSON.stringify({ id: 's1' }));
      if (/prompt_async$/.test(u.pathname)) {
        let b = ''; q.on('data', d => b += d); q.on('end', () => { prompted = JSON.parse(b); res.end('{}'); });
        return;
      }
      if (/\/message$/.test(u.pathname)) return res.end(JSON.stringify([{ parts: [{ type: 'text', text: 'PONG' }] }]));
      res.end('{}');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const result = await opencode.check({
      baseUrl: 'http://127.0.0.1:' + srv.address().port,
      allowTestPort: true,
      env: { OPENCODE_SERVER_PASSWORD: pw, OPENCODE_SERVER_USERNAME: 'opencode' }
    });
    assert.equal(result.status, 'OK', result.summary);
    assert.equal(result.data.anon, 401);
    assert.equal(result.data.authed, 200);
    assert.equal(result.data.pong, true);
    assert.equal(prompted.parts[0].text, opencode.PROMPT);
    assert.equal(prompted.tools.write, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(pw));
    srv.close();
    const absent = await opencode.check({ env: {} });
    assert.equal(absent.status, 'BLOCKED');
  });

  test('tailscale parser drops peer names; missing binary is BLOCKED', async () => {
    const parsed = tailscale.parseStatus(JSON.stringify({
      Self: { Online: true, TailscaleIPs: ['100.1.1.1'], HostName: 'secret-host' },
      Peer: { a: { HostName: 'alice' }, b: { DNSName: 'bob' } }
    }));
    assert.equal(parsed.online, true);
    assert.equal(parsed.peers, 2);
    assert.equal(parsed.ipCount, 1);
    assert.equal(JSON.stringify(parsed).includes('alice'), false);
    assert.equal(JSON.stringify(parsed).includes('secret-host'), false);
    const live = await tailscale.check({});
    if (!fs.existsSync('/usr/bin/tailscale') && !fs.existsSync('/usr/local/bin/tailscale')) assert.equal(live.status, 'BLOCKED');
  });

  test('blender is a real probe when installed and BLOCKED otherwise', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    assert.equal(blender.isPng(Buffer.concat([png, Buffer.alloc(40)])), true);
    assert.equal(blender.isPng(Buffer.from('not a png')), false);
    const r = await blender.check({ blender: { detect: async () => ({ ok: false, disabled: true, code: 'feature_disabled' }) } });
    if (blender.candidates().length === 0) assert.equal(r.status, 'BLOCKED');
    else {
      assert.equal(r.status, 'OK', r.summary);
      assert.ok(r.data.pngBytes > 32);
    }
    assert.equal(r.data.studioGate.disabled, true);
  });

  test('approval hash, tamper, expired TTL, replay, bad password, forbidden action', async () => {
    const { actions, db } = lab();
    assert.throws(() => actions.request({ user: 'igor', actionId: 'port-4096', params: {} }), e => e.code === 'FORBIDDEN');
    assert.throws(() => actions.request({ user: 'igor', actionId: 'sudo', params: {} }), e => e.code === 'FORBIDDEN');
    assert.throws(() => actions.request({ user: 'igor', actionId: 'svc-restart', params: { target: 'opencode', port: '4096' } }), e => e.code === 'BAD_PARAMS');
    const badPw = actions.request({ user: 'igor', actionId: 'lock-reset', params: {} });
    await assert.rejects(() => actions.execute({ user: 'igor', approvalId: badPw.approvalId, password: 'wrong' }), e => e.code === 'BAD_PASSWORD');
    assert.equal(db.prepare('SELECT status, auto_execute FROM si_approvals WHERE id = ?').get(badPw.approvalId).status, 'pending');
    assert.equal(db.prepare('SELECT auto_execute FROM si_approvals WHERE id = ?').get(badPw.approvalId).auto_execute, 0);
    assert.equal(badPw.subjectId.length, 64);
    assert.equal(badPw.binding, 'lock-reset:' + badPw.subjectId);

    const expired = actions.request({ user: 'igor', actionId: 'lock-reset', params: {}, ttlMs: -1000 });
    await assert.rejects(() => actions.execute({ user: 'igor', approvalId: expired.approvalId, password: PW }), e => e.code === 'EXPIRED');

    const tampered = actions.request({ user: 'igor', actionId: 'lock-reset', params: {} });
    db.prepare('UPDATE si_approvals SET subject_id = ? WHERE id = ?').run('a'.repeat(64), tampered.approvalId);
    await assert.rejects(() => actions.execute({ user: 'igor', approvalId: tampered.approvalId, password: PW }), e => e.code === 'TAMPERED');

    const ok = actions.request({ user: 'igor', actionId: 'lock-reset', params: {} });
    const stored = db.prepare('SELECT subject_id FROM si_approvals WHERE id = ?').get(ok.approvalId).subject_id;
    assert.equal(stored, ok.subjectId);
    const done = await actions.execute({ user: 'igor', approvalId: ok.approvalId, password: PW });
    assert.equal(done.result.status, 'OK');
    await assert.rejects(() => actions.execute({ user: 'igor', approvalId: ok.approvalId, password: PW }), e => e.code === 'REPLAY');
    const row = db.prepare('SELECT status, auto_execute FROM si_approvals WHERE id = ?').get(ok.approvalId);
    assert.equal(row.status, 'approved');
    assert.equal(row.auto_execute, 0);
  });

  test('backup, prune, vacuum, kill allowlisted pid, refuse protected port, restart plan', async () => {
    const box = lab();
    const backup = actionsMod.createBackup(box.ctx);
    assert.equal(backup.status, 'OK', backup.summary);
    assert.equal(fs.existsSync(path.join(box.backupDir, backup.data.file)), true);
    const side = fs.readFileSync(path.join(box.backupDir, backup.data.file + '.sha256'), 'utf8');
    assert.ok(side.startsWith(backup.data.sha256));

    for (let year = 2016; year <= 2023; year++) {
      fs.writeFileSync(path.join(box.backupDir, 'sd-manual-' + year + '.db'), 'x');
    }
    const pruneReq = box.actions.request({ user: 'igor', actionId: 'backup-prune', params: { keep: '7' } });
    const pruned = await box.actions.execute({ user: 'igor', approvalId: pruneReq.approvalId, password: PW });
    assert.equal(pruned.result.ok, true);
    const left = fs.readdirSync(box.backupDir).filter(n => n.endsWith('.db'));
    assert.ok(left.includes('sd-manual-2023.db'));
    assert.ok(left.includes(backup.data.file));
    assert.equal(left.includes('sd-manual-2016.db'), false);

    const vac = box.actions.request({ user: 'igor', actionId: 'db-vacuum', params: {} });
    assert.equal((await box.actions.execute({ user: 'igor', approvalId: vac.approvalId, password: PW })).result.status, 'OK');
    const rei = box.actions.request({ user: 'igor', actionId: 'db-reindex', params: {} });
    assert.equal((await box.actions.execute({ user: 'igor', approvalId: rei.approvalId, password: PW })).result.status, 'OK');

    const restore = box.actions.request({ user: 'igor', actionId: 'db-restore', params: { backup: backup.data.file, mode: 'apply' } });
    const restored = await box.actions.execute({ user: 'igor', approvalId: restore.approvalId, password: PW });
    assert.equal(restored.result.status, 'OK', restored.result.summary);
    assert.equal(restored.result.live, false);
    fs.writeFileSync(path.join(box.backupDir, 'sd-manual-broken.db'), Buffer.from('nope'));
    const badReq = box.actions.request({ user: 'igor', actionId: 'db-restore', params: { backup: 'sd-manual-broken.db', mode: 'verify' } });
    const bad = await box.actions.execute({ user: 'igor', approvalId: badReq.approvalId, password: PW });
    assert.equal(bad.result.status, 'FAIL');

    const dir = makeTemp();
    const bin = path.join(dir, 'ollama');
    fs.copyFileSync('/bin/sleep', bin); fs.chmodSync(bin, 0o755);
    const child = spawn(bin, ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    await sleep(150);
    const killReq = box.actions.request({ user: 'igor', actionId: 'proc-kill', params: { pid: String(child.pid), name: 'ollama' } });
    const killed = await box.actions.execute({ user: 'igor', approvalId: killReq.approvalId, password: PW });
    assert.equal(killed.result.status, 'OK', killed.result.summary);
    await sleep(100);
    assert.throws(() => process.kill(child.pid, 0));

    const guardDir = makeTemp();
    const guardBin = path.join(guardDir, 'ollama');
    try { fs.linkSync(process.execPath, guardBin); } catch { fs.copyFileSync(process.execPath, guardBin); }
    const guard = spawn(guardBin, ['-e', "require('net').createServer().listen(8787,'127.0.0.1')"], { detached: true, stdio: 'ignore' });
    guard.unref();
    await sleep(300);
    const denyReq = box.actions.request({ user: 'igor', actionId: 'proc-kill', params: { pid: String(guard.pid), name: 'ollama' } });
    const denied = await box.actions.execute({ user: 'igor', approvalId: denyReq.approvalId, password: PW });
    assert.equal(denied.result.status, 'FORBIDDEN', denied.result.summary);
    assert.doesNotThrow(() => process.kill(guard.pid, 0));
    try { process.kill(-guard.pid, 'SIGKILL'); } catch { try { process.kill(guard.pid, 'SIGKILL'); } catch { /* gone */ } }

    const planReq = box.actions.request({ user: 'igor', actionId: 'server-restart', params: { mode: 'plan' } });
    const plan = await box.actions.execute({ user: 'igor', approvalId: planReq.approvalId, password: PW });
    assert.equal(plan.result.planned, true);
    assert.equal(plan.result.signal, 'SIGTERM');
    let signaled = null;
    box.ctx.killFn = (pid, sig) => { signaled = { pid, sig }; };
    const applyReq = box.actions.request({ user: 'igor', actionId: 'server-restart', params: { mode: 'apply' } });
    const apply = await box.actions.execute({ user: 'igor', approvalId: applyReq.approvalId, password: PW });
    assert.equal(apply.result.scheduled, true);
    await sleep(250);
    assert.deepEqual(signaled, { pid: process.pid, sig: 'SIGTERM' });
  });

  test('startup stays under 3s and periodic under 500ms without a model call', async () => {
    const box = lab();
    let generate = 0;
    const original = global.fetch;
    global.fetch = (url, opts) => {
      if (String(url).includes('/api/generate')) generate++;
      return original(url, opts);
    };
    try {
      const start = await runs.startup({ ...box, sec, env: {} });
      assert.ok(start.ms < 3000, 'startup ' + start.ms);
      assert.equal(start.heavy, false);
      assert.equal(generate, 0);
      assert.ok(start.checks.some(c => c.id === 'db.quick' && c.status === 'OK'));
      const peri = await runs.periodic({ ...box, sec });
      assert.ok(peri.ms < 500, 'periodic ' + peri.ms);
      assert.equal(generate, 0);
      assert.equal(peri.checks.some(c => c.id === 'ollama'), false);
    } finally { global.fetch = original; }
  });

  test('schedule ring, nightly gate, and redacted report', () => {
    const ring = schedule.createRing(288);
    for (let i = 0; i < 300; i++) ring.push(i);
    assert.equal(ring.size(), 288);
    assert.equal(ring.list()[0], 12);
    assert.equal(schedule.shouldRunNightly(new Date('2026-10-22T03:10:00'), true, null), true);
    assert.equal(schedule.shouldRunNightly(new Date('2026-10-22T03:10:00'), false, null), false);
    assert.equal(schedule.shouldRunNightly(new Date('2026-10-22T04:10:00'), true, null), false);
    const md = report.markdown({ kind: 'full', checks: [{ id: 'logs', status: 'OK', summary: 'password=supersecret Basic dXNlcjpwYXNz', data: {} }] }, sec);
    assert.doesNotMatch(md, /supersecret|dXNlcjpwYXNz/);
    assert.match(md, /REDACTED/);
    const sch = schedule.createSchedule({ onStartup() {}, onPeriodic() {}, onHourly() {}, nightlyEnabled: false });
    sch.arm(); sch.stop();
  });

  test('HTTP mount runs a real quick check', async () => {
    const box = lab();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = 'igor'; next(); });
    const doctor = mountDoctor(app, {
      ...box, sec, heavy, log: () => {}, listLogs: () => [{ level: 'info', source: 'test', message: 'password=supersecret', at: '2026-10-22T00:00:00Z' }],
      blender: { detect: async () => ({ ok: false, disabled: true }) }, port: 8687
    });
    const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
    try {
      const port = server.address().port;
      const r = await fetch('http://127.0.0.1:' + port + '/api/ops/doctor/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json();
      assert.equal(r.status, 200);
      const disk = j.checks.find(c => c.id === 'disk');
      assert.ok(disk.data.totalBytes > 1e9, JSON.stringify(disk));
      const logs = await fetch('http://127.0.0.1:' + port + '/api/ops/doctor/full', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(logs.status, 200);
      const full = await logs.json();
      const logRow = full.checks.find(c => c.id === 'logs');
      assert.doesNotMatch(JSON.stringify(logRow), /supersecret/);
      assert.equal(doctor.history.size() >= 1, true);
    } finally { server.close(); doctor.stop(); }
  });

  test('server.js mounts doctor and a live test server answers quick', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const at = src.indexOf('SYSTEM DOCTOR');
    assert.ok(at > 0);
    const before = src.slice(0, at);
    assert.match(before, /mountUpdateCenter/);
    assert.equal(before.includes('SYSTEM DOCTOR'), false);
    const port = 18787;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-sd-srv-'));
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TMPDIR: os.tmpdir(),
        NODE_ENV: 'test', STUDIO_FLAVOR: 'test', HOST: '127.0.0.1', PORT: String(port),
        STUDIO_DATA_DIR: dir, DB_PATH: path.join(dir, 'studio.db')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    try {
      let health = null;
      for (let i = 0; i < 40; i++) {
        try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); if (r.ok) { health = await r.json(); break; } } catch { /* booting */ }
        await sleep(250);
      }
      assert.ok(health && health.app === 'moonkatty-ai-studio', log.slice(-1500));
      const setup = await fetch('http://127.0.0.1:' + port + '/api/auth/setup', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1', origin: 'http://127.0.0.1:' + port },
        body: JSON.stringify({ username: 'igor', password: PW })
      });
      const cookie = (setup.headers.get('set-cookie') || '').split(';')[0];
      assert.ok(cookie.startsWith('mk_session='), setup.status + ' ' + log.slice(-800));
      const quick = await fetch('http://127.0.0.1:' + port + '/api/ops/doctor/quick', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1', origin: 'http://127.0.0.1:' + port, cookie },
        body: '{}'
      });
      const body = await quick.json();
      assert.equal(quick.status, 200, JSON.stringify(body));
      assert.ok(body.checks.find(c => c.id === 'disk' && c.data.totalBytes > 1e9));
    } finally {
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* stopped */ }
      await sleep(200);
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* stopped */ }
    }
  });
});
