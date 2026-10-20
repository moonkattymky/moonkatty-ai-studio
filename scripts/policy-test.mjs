// Unit tests: permission policy (allow/deny/confirm + rule ids), path confinement incl. symlink escapes,
// OpenCode server config check, scene parameter schema. No servers needed. Usage: node scripts/policy-test.mjs
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../lib/policy.js'), SP = require('../lib/scene-params.js'), createWs = require('../lib/workspace.js');
const res = []; const ok = (n, c, x = '') => { res.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const R = '/tmp/mk-policy-test'; fs.rmSync(R, { recursive: true, force: true }); const ws = path.join(R, 'ws'); fs.mkdirSync(ws, { recursive: true });
fs.mkdirSync(path.join(R, 'secret')); fs.symlinkSync(path.join(R, 'secret'), path.join(ws, 'link')); fs.writeFileSync(path.join(ws, 'scene.blend'), 'x');
const d = a => P.decide(a);
ok('write inside workspace → allow', d({ type: 'fs.write', ws, path: path.join(ws, 'scene_params.json') }).decision === 'allow');
ok('write with ../ escape → deny fs.outside', d({ type: 'fs.write', ws, path: path.join(ws, '../escape.txt') }).rule === 'fs.outside');
ok('write through symlink to outside → deny', d({ type: 'fs.write', ws, path: path.join(ws, 'link/x.txt') }).rule === 'fs.outside');
ok('absolute outside path → deny', d({ type: 'fs.write', ws, path: '/etc/passwd' }).decision === 'deny');
ok('NUL byte path → deny', d({ type: 'fs.write', ws, path: ws + '/a\0b' }).decision === 'deny');
ok('overwrite existing .blend → deny fs.versioned', d({ type: 'fs.write', ws, path: path.join(ws, 'scene.blend') }).rule === 'fs.versioned');
ok('agent writing new .png → deny fs.blender-only', d({ type: 'fs.write', ws, path: path.join(ws, 'renders/x.png') }).rule === 'fs.blender-only');
ok('delete inside workspace → confirm', d({ type: 'fs.delete', ws, path: path.join(ws, 'scene.blend') }).decision === 'confirm');
ok('delete outside → deny', d({ type: 'fs.delete', ws, path: '/tmp' }).decision === 'deny');
ok('shell → always deny', d({ type: 'shell', command: 'ls' }).rule === 'shell.never');
ok('publish → confirm', d({ type: 'publish' }).decision === 'confirm');
ok('generated Blender script → confirm', d({ type: 'blender.generated' }).decision === 'confirm');
ok('vetted template → allow', d({ type: 'blender.template' }).decision === 'allow');
for (const p of ['bash', 'webfetch', 'websearch', 'task', 'skill', 'question', 'external_directory', 'doom_loop', 'lsp'])
  ok(`OpenCode permission «${p}» → deny`, d({ type: 'opencode.permission', permission: p, files: [path.join(ws, 'a')], ws }).decision === 'deny');
ok('OpenCode edit inside → allow', d({ type: 'opencode.permission', permission: 'edit', files: [path.join(ws, 'scene_params.json')], ws }).decision === 'allow');
ok('OpenCode edit without path → deny', d({ type: 'opencode.permission', permission: 'edit', files: [], ws }).rule === 'oc.nopath');
ok('OpenCode edit outside → deny', d({ type: 'opencode.permission', permission: 'edit', files: ['/home/x/.zshrc'], ws }).rule === 'fs.outside');
ok('unknown action → deny', d({ type: 'rm -rf' }).decision === 'deny');
const studioCfg = JSON.parse(fs.readFileSync('opencode/opencode-studio.json', 'utf8'));
ok('shipped opencode-studio.json passes the config check', P.checkOpencodeConfig(studioCfg).length === 0, P.checkOpencodeConfig(studioCfg).join('; '));
ok('default (empty) OpenCode config is refused', P.checkOpencodeConfig({}).length >= 4);
ok('bash allow is refused', P.checkOpencodeConfig({ permission: { ...studioCfg.permission, bash: 'allow' } }).some(x => /bash/.test(x)));
ok('bash pattern object with one allow is refused', P.checkOpencodeConfig({ permission: { ...studioCfg.permission, bash: { '*': 'deny', 'git *': 'allow' } } }).some(x => /bash/.test(x)));
ok('edit allow (no per-file check) is refused', P.checkOpencodeConfig({ permission: { ...studioCfg.permission, edit: 'allow' } }).some(x => /edit/.test(x)));
ok('"permission":"allow" string is refused', P.checkOpencodeConfig({ permission: 'allow' }).length > 0);
// scene params
ok('defaults valid', SP.validate(SP.DEFAULTS).ok);
for (const [n, bad] of [['code in subject', { subject: '__import__("os")' }], ['huge samples', { render: { samples: 1e9 } }], ['unknown key', { script: 'import os' }], ['NaN color', { color: [NaN, 0, 0] }],
  ['newline title', { title: 'a\nimport os' }], ['unknown engine', { render: { engine: 'OCTANE' } }], ['extra camera key', { camera: { exec: 1 } }], ['fractional frames', { animation: { frames: 1.5 } }], ['array instead of object', []]])
  ok('schema rejects ' + n, !SP.validate(bad).ok);
ok('fromText: "фиолетовый кот" → cat + purple', (p => p.subject === 'cat' && p.color[2] > 0.8)(SP.fromText('Создай фиолетового кота')));
// workspace versions + backup
const W = createWs(path.join(R, 'data')); const v1 = W.newVersion('p_test'); fs.writeFileSync(path.join(v1.dir, 'scene.blend'), 'v1'); const v2 = W.newVersion('p_test');
ok('versions v001 → v002, previous .blend backed up', v1.version === 'v001' && v2.version === 'v002' && fs.readFileSync(path.join(v2.dir, 'backup', 'v001-scene.blend'), 'utf8') === 'v1');
ok('workspace.file blocks traversal', W.file('p_test', 'v001', '../../../etc/passwd') === null && W.file('p_test', 'v001', 'scene.blend') !== null);
let threw = false; try { W.newVersion('../evil'); } catch { threw = true; } ok('invalid project id refused', threw);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); process.exit(res.every(Boolean) ? 0 : 1);
