'use strict';
// r5 (QA-R4-001): package contents + current node docs must not recommend unsafe setups:
// Tailscale Serve/Funnel for nodes, *.ts.net:8443, NODE_TLS_MODE=tailscale, 0.0.0.0 binds, Gatekeeper/quarantine bypass, sudo,
// plaintext tokens / secrets in argv. A line that clearly forbids or negates the thing (не/без/never/NOT/…) is allowed.
// Proof: the same scanner reports findings on the r4 content (commit e562345) and none on the current tree.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const NEG = /((?<![\p{L}])(не|НЕ|Не|без|Без|нет)(?![\p{L}])|never|Never|NEVER|\bNOT\b|\bnot\b|\bno\b|\bNo\b|запрещ|отклон|reject|refus|removed|устар|УСТАР|\boff\b|выключ|forbid|ignored|игнорир|unsupported)/u;
const RULES = [
  ['tailscale serve/funnel recommended', /tailscale\s+(serve|funnel)\b(?!\s+(status|--https=\d+\s+off|off))/i, true],
  ['*.ts.net:8443 coordinator URL', /ts\.net:8443/i, true],
  ['NODE_TLS_MODE=tailscale', /NODE_TLS_MODE\s*=\s*['"]?tailscale/, true],
  ['0.0.0.0 bind', /(listen|bind|HOST)[^\n]{0,30}0\.0\.0\.0/i, true],
  ['Gatekeeper disable', /spctl\s+--master-disable/, true],
  ['quarantine removal', /xattr\s+-\w*d\w*[^\n]*quarantine|xattr\s+-\w*d\w*r?\s*$/m, true],
  ['sudo', /\bsudo\b/, true],
  ['plaintext token value', /^\s*NODE_TOKEN\s*=\s*[^\s`#]/m, false],
  ['secret in argv (security -w <value>)', /security\s+add-generic-password[^\n]*\s-w\s+[^\s(]/, false],
  ['one-time code in argv', /--code\s+[A-Z0-9]{5}/, false],
];
function scan(name, text) { const out = []; text.split('\n').forEach((line, i) => { for (const [id, re, negOk] of RULES) if (re.test(line) && !(negOk && NEG.test(line))) out.push(`${name}:${i + 1}: ${id}: ${line.trim().slice(0, 140)}`); }); return out; }
const DOCS = ['docs/NODES_INSTALL_RU.md', 'docs/NODES_022_FINAL_RU.md'];
const PKG_SRC = ['node-agent/agent.js', 'node-agent/enroll.js', 'node-agent/enroll.html', 'node-agent/status.html', 'node-agent/node-agent.env.example', 'deploy/com.moonkatty.node-agent.plist',
  'scripts/node/studio-connection-test.mjs', 'scripts/node/install.sh', 'scripts/node/uninstall.sh', 'scripts/node/detect-specs.sh', 'scripts/node/fetch-ffprobe.sh'];
const LEGACY = ['docs/ops/NEWS_NODE_IMAC.md', 'docs/ops/MONITOR_NODE_MACBOOK.md', 'docs/ops/NODES_IMAC.md', 'docs/ops/NODES_MACBOOK.md'];

test('built package (every text file) + current node docs: no unsafe recommendations; env.example defaults are safe', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-')); execFileSync('bash', [path.join(ROOT, 'scripts/node/build-node-pkg.sh')], { cwd: ROOT, env: { ...process.env, OUT: out, JS_ONLY: '1' }, stdio: 'ignore' });
  const tgz = fs.readdirSync(out).find(f => f.endsWith('.tar.gz')); const x = path.join(out, 'x'); fs.mkdirSync(x); execFileSync('tar', ['-xzf', path.join(out, tgz), '-C', x]);
  const files = execFileSync('find', [x, '-type', 'f', '!', '-name', '*.jpg'], { encoding: 'utf8' }).trim().split('\n'); assert.ok(files.length >= 13, files.join());
  const found = []; for (const f of files) found.push(...scan(path.relative(x, f), fs.readFileSync(f, 'utf8')));
  for (const d of DOCS) found.push(...scan(d, fs.readFileSync(path.join(ROOT, d), 'utf8')));
  assert.deepEqual(found, [], found.join('\n'));
  const env = fs.readFileSync(path.join(ROOT, 'node-agent/node-agent.env.example'), 'utf8');
  assert.match(env, /^NODE_TLS_MODE=pinned$/m); assert.match(env, /^COORDINATOR_URL=https:\/\/100\./m); assert.doesNotMatch(env, /^NODE_TOKEN/m); assert.doesNotMatch(env, /ts\.net/);
  const plist = fs.readFileSync(path.join(ROOT, 'deploy/com.moonkatty.node-agent.plist'), 'utf8'); assert.doesNotMatch(plist, /tailscale serve|ts\.net/i);
  fs.rmSync(out, { recursive: true, force: true });
});

test('legacy 0.2.0 node docs that describe Serve carry the УСТАРЕЛО banner pointing to NODES_INSTALL_RU.md', () => {
  for (const d of LEGACY) { const s = fs.readFileSync(path.join(ROOT, d), 'utf8'); if (/ts\.net:8443|tailscale serve/i.test(s)) assert.match(s.slice(0, 1500), /УСТАРЕЛО для NODE 0\.2\.2[\s\S]*NODES_INSTALL_RU\.md/, d); }
});

test('the scanner catches the r4 content (e562345: env.example Variant A, agent hints, plist, enroll UI)', { skip: (() => { try { execFileSync('git', ['-C', ROOT, 'cat-file', '-e', 'e562345^{commit}'], { stdio: 'ignore' }); return false; } catch { return 'commit e562345 not in this clone'; } })() }, () => {
  const found = []; for (const f of [...PKG_SRC, ...DOCS]) { let t = ''; try { t = execFileSync('git', ['-C', ROOT, 'show', 'e562345:' + f], { encoding: 'utf8' }); } catch {} found.push(...scan(f, t)); }
  const ids = new Set(found.map(l => l.split(': ')[1])); const files = new Set(found.map(l => l.split(':')[0]));
  for (const id of ['tailscale serve/funnel recommended', '*.ts.net:8443 coordinator URL', 'NODE_TLS_MODE=tailscale']) assert.ok(ids.has(id), id + '\n' + found.join('\n'));
  for (const f of ['node-agent/node-agent.env.example', 'node-agent/agent.js', 'deploy/com.moonkatty.node-agent.plist', 'node-agent/enroll.html']) assert.ok(files.has(f), f + '\n' + found.join('\n'));
  console.log('r4 findings:\n' + found.join('\n'));
});
module.exports = { scan };
