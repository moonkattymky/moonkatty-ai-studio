'use strict';
// nodes-022-final r2: package build must not leak git credentials and must be byte-reproducible.
// Builds from two separate clones of HEAD whose origin carries a FAKE credential (x-access-token + ghs_/github_pat_ lookalikes).
// Default: JS_ONLY=1 (no download). NODE_PKG_FULL=1 also builds the darwin archives (network, ~80 MB).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const FAKE = 'ghs_' + 'Z9'.repeat(18); const FAKE_PAT = 'github_pat_' + '1A'.repeat(20);
const TOKEN_RE = /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|x-access-token/;
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...o });
const sha = f => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function cloneAndBuild(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-' + tag + '-')); const repo = path.join(d, 'repo'); const out = path.join(d, 'out');
  sh('git', ['clone', '-q', ROOT, repo]); sh('git', ['-C', repo, 'checkout', '-q', sh('git', ['-C', ROOT, 'rev-parse', 'HEAD']).trim()]);
  sh('git', ['-C', repo, 'remote', 'set-url', 'origin', `https://x-access-token:${FAKE}@github.com/moonkattymky/moonkatty-ai-studio.git`]);
  sh('git', ['-C', repo, 'remote', 'add', 'pat', `https://user:${FAKE_PAT}@github.com/x/y.git`]);
  const env = { ...process.env, OUT: out }; if (!process.env.NODE_PKG_FULL) env.JS_ONLY = '1'; delete env.SOURCE_DATE_EPOCH;
  sh('bash', [path.join(repo, 'scripts/node/build-node-pkg.sh')], { cwd: repo, env, timeout: 600000 });
  sh('bash', [path.join(repo, 'scripts/node/source-zip.sh'), 'HEAD', out], { cwd: repo });
  return { out, d };
}
test('package: no credentials in BUILDINFO / any archive member; byte-identical across two clones and two builds', { timeout: 1200000 }, () => {
  const a = cloneAndBuild('a'), b = cloneAndBuild('b'); const archives = fs.readdirSync(a.out).filter(f => /\.(tar\.gz|zip)$/.test(f)).sort();
  assert.ok(archives.some(f => f.endsWith('js-only.tar.gz')) && archives.some(f => f.endsWith('.zip')), archives.join());
  for (const f of archives) {
    assert.equal(sha(path.join(a.out, f)), sha(path.join(b.out, f)), f + ': two clones must give identical bytes');
    if (!f.endsWith('.tar.gz')) continue;
    const x = fs.mkdtempSync(path.join(a.d, 'x-')); sh('tar', ['-xzf', path.join(a.out, f), '-C', x]);
    for (const p of sh('find', [x, '-type', 'f']).trim().split('\n')) {
      const buf = fs.readFileSync(p); const bin = p.endsWith('/bin/node'); const s = buf.toString('latin1');
      assert.ok(!s.includes(FAKE) && !s.includes(FAKE_PAT), p + ': fake credential leaked'); assert.doesNotMatch(s, TOKEN_RE, p + ': token-like string');
      if (!bin && !p.endsWith('.jpg')) assert.doesNotMatch(s, /[a-z][a-z0-9+.-]*:\/\/[^\s/'"`]*@/i, p + ': URL with userinfo');
    }
    const bi = sh('tar', ['-xzOf', path.join(a.out, f), '--wildcards', '*/BUILDINFO']);
    assert.match(bi, /^source: https:\/\/github\.com\/moonkattymky\/moonkatty-ai-studio @ [0-9a-f]{40}$/m); assert.ok(!bi.includes('@github.com'));
    assert.match(bi, /SOURCE_DATE_EPOCH=\d+/);
    const list = sh('tar', ['-tvzf', path.join(a.out, f)]).trim().split('\n'); assert.ok(list.every(l => / 0\/0 /.test(l)), 'owner 0/0');
  }
  const again = path.join(a.d, 'again'); const env = { ...process.env, OUT: again }; if (!process.env.NODE_PKG_FULL) env.JS_ONLY = '1';
  sh('bash', [path.join(a.d, 'repo/scripts/node/build-node-pkg.sh')], { cwd: path.join(a.d, 'repo'), env, timeout: 600000 });
  for (const f of fs.readdirSync(again).filter(f => f.endsWith('.tar.gz'))) assert.equal(sha(path.join(again, f)), sha(path.join(a.out, f)), f + ': rebuild in the same clone must be identical');
  for (const t of [a, b]) fs.rmSync(t.d, { recursive: true, force: true });
});
