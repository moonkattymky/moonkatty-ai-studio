'use strict';
// Agent task: prompt → unified diff + node --test, inside bwrap, then an Approval Center request.
// OpenCode is not started. The model does not get a shell. Nothing is merged to main.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./agent-task-guard.js');
const { runGuarded } = require('./proc-guard.js');
const OP = require('./ollama-proxy.js');

const ENV_KEYS = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
function safeEnv(extra) {
  const e = {};
  for (const k of ENV_KEYS) if (process.env[k] != null && !/SECRET|TOKEN|KEY|PASS|COOKIE|AUTH/i.test(k)) e[k] = process.env[k];
  return Object.assign(e, extra || {});
}
function which(name) {
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}
function bwrapArgs(workDir) {
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  for (const d of ['/usr', '/bin', '/sbin', '/lib', '/lib64']) {
    let st; try { st = fs.lstatSync(d); } catch { continue; }
    if (st.isSymbolicLink()) args.push('--symlink', fs.readlinkSync(d), d);
    else args.push('--ro-bind', d, d);
  }
  for (const e of ['/etc/ssl', '/etc/ca-certificates', '/etc/ld.so.cache']) if (fs.existsSync(e)) args.push('--ro-bind', e, e);
  args.push('--dir', '/opt/studio-node',
    '--ro-bind', process.execPath, '/opt/studio-node/node',
    '--ro-bind', path.join(__dirname, 'agent-task-worker.js'), '/opt/studio-node/worker.js',
    '--ro-bind', path.join(__dirname, 'agent-task-guard.js'), '/opt/studio-node/guard.js',
    '--bind', workDir, '/work', '--chdir', '/work',
    '--', '/opt/studio-node/node', '/opt/studio-node/worker.js', '/work/job.json');
  return args;
}
function journal(dir, event, detail) {
  fs.appendFileSync(path.join(dir, 'journal.jsonl'), JSON.stringify({ at: new Date().toISOString(), event, detail: String(detail || '').slice(0, 500) }) + '\n');
}
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.llm' || name === 'job.json') continue;
    const abs = path.join(dir, name); const rel = base ? base + '/' + name : name;
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw G.fail('sandbox_violation', 'symlink в песочнице: ' + rel);
    if (st.isDirectory()) walk(abs, rel, out);
    else out.set(rel, fs.readFileSync(abs, 'utf8'));
  }
  return out;
}
function unified(rel, before, after) {
  if (before === after) return '';
  const a = before.split('\n'); const b = after.split('\n');
  return `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1,${a.length} +1,${b.length} @@\n` + a.map(l => '-' + l).join('\n') + '\n' + b.map(l => '+' + l).join('\n') + '\n';
}

/** Owner approval of an agent diff records the decision and does not merge, publish, or run git. */
function approvalExecutor() {
  return { executed: false, status: 'not_merged', note: 'Дифф остаётся в папке задачи. Слияние в main запрещено и не выполняется.' };
}

const live = new Map();

async function runAgentTask(opts) {
  const bundle = G.checkBundle(opts.prompt, opts.files, opts.tests);
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(opts.dataDir, id);
  const work = path.join(dir, 'work');
  fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dir, 'orig'), { recursive: true, mode: 0o700 });
  const all = [...bundle.files, ...bundle.tests];
  for (const f of all) {
    const dest = path.join(work, f.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.text, { mode: 0o644 });
    const orig = path.join(dir, 'orig', f.path); fs.mkdirSync(path.dirname(orig), { recursive: true });
    fs.writeFileSync(orig, f.text, { mode: 0o644 });
  }
  const ac = opts.signal || new AbortController();
  live.set(id, ac);
  journal(dir, 'start', id);
  const started = { id, status: 'running' };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(started));
  if (opts.onStart) opts.onStart(started);
  const finish = (status, extra) => { const row = { id, status, ...extra }; fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...row, dir }, null, 2)); journal(dir, status, extra.code || extra.approvalId || ''); return row; };
  const bwrap = opts.bwrapBin === undefined ? which('bwrap') : opts.bwrapBin;
  if (!bwrap) return finish('failed', { code: 'sandbox_unavailable', error: 'bwrap не найден — задача не запускалась' });
  let proxy = null;
  try {
    if (ac.signal.aborted) return finish('cancelled', { code: 'cancelled' });
    if (opts.stubResponse == null) {
      const port = opts.ollamaPort || 11434;
      const up = opts.probe ? await opts.probe(port) : await OP.probe(port);
      if (!up) return finish('failed', { code: 'llm_unavailable', error: 'Ollama недоступна. Задача не запускалась.' });
      proxy = (opts.startProxy || OP.startProxy)({ dir: path.join(work, '.llm'), port, timeoutMs: 90000 });
      await proxy.ready;
    }
    const job = {
      prompt: bundle.prompt, editable: bundle.files.map(f => f.path), tests: bundle.tests.map(f => f.path),
      sock: '/work/.llm/ollama.sock', model: (proxy && proxy.models && proxy.models[0]) || 'qwen3:8b',
      stub: opts.stubResponse == null ? null : String(opts.stubResponse)
    };
    fs.writeFileSync(path.join(work, 'job.json'), JSON.stringify(job));
    journal(dir, 'spawn', 'bwrap node --test');
    const ran = await runGuarded(bwrap, bwrapArgs(work), { cwd: work, signal: ac.signal, timeoutMs: opts.timeoutMs || 120000, env: safeEnv() });
    let body = {}; try { body = JSON.parse(ran.stdout || '{}'); } catch { body = { ok: false, code: 'bad_worker', message: ran.stderr }; }
    if (!body.ok) return finish('failed', { code: body.code || 'worker_error', error: body.message || ran.stderr || ('код ' + ran.code) });
    const got = walk(work, '', new Map());
    const expect = new Set(all.map(f => f.path));
    for (const rel of got.keys()) if (!expect.has(rel)) throw G.fail('sandbox_violation', 'лишний файл ' + rel);
    for (const t of bundle.tests) {
      const now = got.get(t.path); const was = fs.readFileSync(path.join(dir, 'orig', t.path), 'utf8');
      if (now !== was) throw G.fail('sandbox_violation', 'тест изменён: ' + t.path);
    }
    let diff = '';
    for (const f of bundle.files) diff += unified(f.path, fs.readFileSync(path.join(dir, 'orig', f.path), 'utf8'), got.get(f.path) ?? '');
    if (!diff.trim()) return finish('failed', { code: 'no_diff', error: 'Модель не изменила файлы' });
    const diffSha256 = sha(diff);
    const testsOk = body.testCode === 0;
    const testsSha256 = sha(String(body.testOutput || ''));
    fs.writeFileSync(path.join(dir, 'change.diff'), diff, { mode: 0o644 });
    journal(dir, 'diff', diffSha256.slice(0, 12) + ' tests=' + (testsOk ? 'ok' : 'fail'));
    let approvalId = null;
    if (typeof opts.requestOwner === 'function') {
      const ap = opts.requestOwner(opts.req, 'agent_diff', `Задача агента ${id}: тесты ${testsOk ? 'прошли' : 'не прошли'}. Слияние в main не выполняется.`, { taskId: id, diffSha256, testsOk, testsSha256 });
      approvalId = ap && (ap.approvalId || ap.id);
      journal(dir, 'approval', approvalId);
    }
    return finish('waiting_approval', { diff, diffSha256, tests: { ok: testsOk, output: body.testOutput || '' }, approvalId, code: 'needs_owner' });
  } catch (e) {
    if (e && e.cancelled) return finish('cancelled', { code: 'cancelled' });
    journal(dir, 'error', e.message);
    return finish('failed', { code: e.code || 'error', error: e.message });
  } finally {
    live.delete(id);
    if (proxy) { try { await proxy.close(); } catch {} }
  }
}

function cancelAgentTask(id) { const ac = live.get(id); if (!ac) return false; ac.abort(); return true; }

function mountAgentTasks(app, deps) {
  app.post('/api/agent-tasks', async (req, res) => {
    try {
      const b = req.body || {};
      if (b.command || b.argv || b.shell || b.merge || b.opencode) return res.status(400).json({ error: 'Команда, shell, OpenCode и слияние в main из запроса не принимаются', code: 'command_forbidden' });
      let sent = false;
      const p = runAgentTask({
        dataDir: deps.dataDir, prompt: b.prompt, files: b.files, tests: b.tests, req, log: deps.log,
        requestOwner: deps.requestOwner,
        onStart(info) { sent = true; res.status(202).json({ id: info.id, status: 'running' }); }
      });
      p.then(row => { if (!sent) res.status(200).json(row); }, e => { if (!sent) res.status(400).json({ error: e.message, code: e.code || 'error' }); });
    } catch (e) { res.status(e.code && String(e.code).startsWith('bad') || e.code === 'too_large' ? 400 : 500).json({ error: e.message, code: e.code || 'error' }); }
  });
  app.post('/api/agent-tasks/:id/cancel', (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'bad id' });
    res.json({ ok: cancelAgentTask(id) });
  });
  app.get('/api/agent-tasks/:id', (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'bad id' });
    const f = path.join(deps.dataDir, id, 'result.json');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'not found' });
    const row = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete row.dir;
    res.json(row);
  });
}

module.exports = { runAgentTask, cancelAgentTask, mountAgentTasks, approvalExecutor, safeEnv };
