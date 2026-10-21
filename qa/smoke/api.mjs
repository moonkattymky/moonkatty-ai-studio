/**
 * Studio API smoke on a scratch database. Fake password. No publish calls.
 *   node qa/smoke/api.mjs [--out file.json]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PASSWORD = 'qa-smoke-1';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function check(checks, id, ok, summary, extra) {
  checks.push({ id, result: ok ? 'pass' : 'fail', summary, ...extra });
}

async function req(url, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text: text.slice(0, 300), setCookie: response.headers.get('set-cookie') };
}

function startServer(port, dbPath) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath };
  delete env.STUDIO_ADMIN_PASSWORD;
  delete env.STUDIO_ADMIN_USER;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not listen\n${log}`)), 20000);
    const take = chunk => {
      log += chunk;
      if (log.includes('MOONKATTY AI STUDIO')) {
        clearTimeout(timer);
        resolve();
      }
      if (log.includes('EADDRINUSE')) {
        clearTimeout(timer);
        reject(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${log}`));
    });
  });
  return { child, ready, log: () => log };
}

async function main() {
  const checks = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-api-'));
  const dbPath = path.join(dir, 'studio.db');
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  let child = null;
  let serverLog = () => '';
  try {
    let port = 18971;
    for (let attempt = 0; attempt < 5; attempt++) {
      const started = startServer(port, dbPath);
      try {
        await started.ready;
        child = started.child;
        serverLog = started.log;
        break;
      } catch (error) {
        started.child.kill('SIGKILL');
        if (error.code !== 'EADDRINUSE') throw error;
        port += 1;
      }
    }
    if (!child) throw new Error('no free port');
    const base = `http://127.0.0.1:${port}`;
    const health = await req(`${base}/api/health`);
    check(checks, 'health', health.status === 200 && health.json && health.json.ok === true && health.json.version === expectedVersion,
      `health ${health.status} version ${health.json && health.json.version}`);
    const status = await req(`${base}/api/auth/status`);
    check(checks, 'needsSetup', status.status === 200 && status.json && status.json.needsSetup === true,
      `auth status needsSetup ${status.json && status.json.needsSetup}`);
    const setup = await req(`${base}/api/auth/setup`, { method: 'POST', body: { username: 'qa', password: PASSWORD } });
    const cookie = setup.setCookie && /mk_session=([a-f0-9]+)/.exec(setup.setCookie);
    const session = cookie ? `mk_session=${cookie[1]}` : '';
    check(checks, 'setup', setup.status === 200 && setup.json && setup.json.ok === true && !!session,
      `setup ${setup.status} session cookie ${session ? 'present' : 'missing'}`);
    const tasks = await req(`${base}/api/tasks`, { cookie: session });
    check(checks, 'tasks', tasks.status === 200 && Array.isArray(tasks.json),
      `GET /api/tasks ${tasks.status} array ${Array.isArray(tasks.json)}`);
    const anon = await req(`${base}/api/tasks`, { method: 'POST', body: { title: 'should fail closed' } });
    check(checks, 'anon-post', anon.status === 401, `unauthenticated POST /api/tasks ${anon.status}`);
    const log = serverLog();
    check(checks, 'no-graph', !/graph\.facebook\.com|graph\.instagram\.com|api\.telegram\.org/.test(log),
      /graph\.facebook\.com|graph\.instagram\.com|api\.telegram\.org/.test(log) ? 'server log named a social host' : 'server log did not name a social host');
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 300));
      child.kill('SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const pass = checks.filter(item => item.result === 'pass').length;
  const fail = checks.filter(item => item.result === 'fail').length;
  const report = {
    contract: 'moonkatty.qa.api-smoke/1',
    at: new Date().toISOString(),
    note: 'Scratch database. Fake password. No publish call. Counts are check results, not a score.',
    pass,
    fail,
    not_tested: 0,
    checks
  };
  const text = JSON.stringify(report, null, 2);
  const out = arg('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, text + '\n');
  }
  console.log(text);
  process.exit(fail ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
