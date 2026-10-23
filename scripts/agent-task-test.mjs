// Sandboxed agent task: diff + node --test + approval request. OpenCode stays off. No merge to main.
import { createRequire } from 'module';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
process.env.STUDIO_FLAVOR = 'test';
process.env.NODE_ENV = 'test';
const express = require('express');
const G = require('../lib/agent-task-guard.js');
const perms = require('../lib/world/permissions.js');
const { runAgentTask, mountAgentTasks, approvalExecutor, cancelAgentTask } = require('../lib/agent-task.js');
const { runGuarded } = require('../lib/proc-guard.js');
let fail = 0, pass = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + String(x).slice(0, 400) : '')); c ? pass++ : fail++; };
const DIFF = `diff --git a/hello.js b/hello.js
--- a/hello.js
+++ b/hello.js
@@ -1 +1 @@
-module.exports = 1;
+module.exports = 2;
`;
const files = [{ path: 'hello.js', text: 'module.exports = 1;\n' }];
const tests = [{ path: 'hello.test.js', text: "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('exports 2', () => { assert.equal(require('./hello.js'), 2); });\n" }];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-agent-'));

ok('path escape rejected', (() => { try { G.checkBundle('x', [{ path: '../x.js', text: '1' }], tests); return false; } catch (e) { return e.code === 'bad_path'; } })());
ok('git argv rejected', (() => { try { G.assertTestArgv('/usr/bin/git', ['merge', 'main'], []); return false; } catch (e) { return e.code === 'command_forbidden'; } })());
ok('node --test on the owner file is allowed', JSON.stringify(G.assertTestArgv('/opt/studio-node/node', ['--test', 'hello.test.js'], ['hello.test.js'])) === JSON.stringify(['--test', 'hello.test.js']));
ok('merge_to_main is forbidden', perms.tierOf('merge_to_main') === 'forbidden');
ok('agent_diff needs the owner', perms.tierOf('agent_diff') === 'owner');
const exec = approvalExecutor();
ok('approval does not merge', exec.executed === false && exec.status === 'not_merged' && /main/.test(exec.note));

const approvals = [];
const row = await runAgentTask({
  dataDir: root, prompt: 'export 2', files, tests, stubResponse: DIFF,
  requestOwner(_req, action, detail, params) { approvals.push({ action, detail, params }); return { approvalId: 'ap-1', code: 'needs_owner' }; }
});
ok('stub task waits for approval', row.status === 'waiting_approval' && row.approvalId === 'ap-1' && row.tests && row.tests.ok === true, JSON.stringify({ status: row.status, code: row.code, error: row.error, tests: row.tests && row.tests.ok }));
ok('diff is the hello.js change', row.diff && row.diff.includes('+module.exports = 2;') && !row.diff.includes('hello.test.js'));
ok('approval is agent_diff bound to the diff hash', approvals.length === 1 && approvals[0].action === 'agent_diff' && approvals[0].params.diffSha256 === row.diffSha256 && approvals[0].params.testsOk === true);
const journal = fs.readFileSync(path.join(root, row.id, 'journal.jsonl'), 'utf8');
ok('journal records start, diff, approval', /"event":"start"/.test(journal) && /"event":"approval"/.test(journal));
ok('result file has no merge instruction', !/git merge|merge_to_main/.test(fs.readFileSync(path.join(root, row.id, 'result.json'), 'utf8')));

const bad = await runAgentTask({
  dataDir: root, prompt: 'merge it', files, tests, stubResponse: 'git merge origin/main\n',
  requestOwner() { throw new Error('approval must not be requested'); }
});
ok('shell text is not executed', bad.status === 'failed' && (bad.code === 'no_diff' || bad.code === 'diff_rejected'), JSON.stringify(bad));

const esc = await runAgentTask({
  dataDir: root, prompt: 'escape', files, tests,
  stubResponse: 'diff --git a/../../etc/passwd b/../../etc/passwd\n--- a/../../etc/passwd\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-x\n+y\n',
  requestOwner() { throw new Error('approval must not be requested'); }
});
ok('diff outside the sandbox is rejected', esc.status === 'failed' && esc.code === 'diff_rejected', JSON.stringify(esc));

const down = await runAgentTask({ dataDir: root, prompt: 'x', files, tests, probe: async () => false, requestOwner() { throw new Error('no'); } });
ok('Ollama down does not run the task', down.status === 'failed' && down.code === 'llm_unavailable', JSON.stringify(down));
ok('missing bwrap does not run', (await runAgentTask({ dataDir: root, prompt: 'x', files, tests, stubResponse: DIFF, bwrapBin: null })).code === 'sandbox_unavailable');

const app = express(); app.use(express.json());
mountAgentTasks(app, { dataDir: path.join(root, 'http'), requestOwner() { return { approvalId: 'ap-http' }; } });
const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const post = body => new Promise(res => {
  const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/agent-tasks', headers: { 'content-type': 'application/json' } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ s: r.statusCode, j: JSON.parse(d || '{}') }));
  });
  q.end(JSON.stringify(body));
});
const forbid = await post({ prompt: 'x', files, tests, command: 'git merge main' });
ok('HTTP refuses a command', forbid.s === 400 && forbid.j.code === 'command_forbidden', JSON.stringify(forbid));
srv.close();

const dir = fs.mkdtempSync(path.join(root, 'kill-'));
const marker = path.join(dir, 'ticks');
const script = path.join(dir, 'k.sh');
fs.writeFileSync(script, `#!/bin/bash\n( setsid bash -c 'cd /; while true; do echo x >> ${marker}; sleep 0.2; done' & ) &\nsleep 60\n`, { mode: 0o755 });
const ac = new AbortController();
const running = runGuarded(script, [], { cwd: dir, signal: ac.signal, timeoutMs: 20000, env: { PATH: process.env.PATH } });
await new Promise(r => setTimeout(r, 700));
ac.abort();
await running.catch(() => {});
await new Promise(r => setTimeout(r, 1800));
const n1 = fs.existsSync(marker) ? fs.statSync(marker).size : 0;
await new Promise(r => setTimeout(r, 900));
const n2 = fs.existsSync(marker) ? fs.statSync(marker).size : 0;
ok('cancel kills a reparented grandchild', n1 > 0 && n1 === n2, JSON.stringify({ n1, n2 }));
ok('cancel of an unknown task is false', cancelAgentTask('nope') === false);

console.log(pass + ' passed, ' + fail + ' failed');
fs.rmSync(root, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
