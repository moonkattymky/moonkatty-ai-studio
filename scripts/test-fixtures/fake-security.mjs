#!/usr/bin/env node
// TEST-ONLY stand-in for macOS /usr/bin/security (generic-password subset). Used by scripts/opencode-auth-test.mjs
// on Linux to exercise the real argv/stdin protocol of lib/opencode-auth.js. Never used by the app (NODE_ENV=test only).
import fs from 'fs';
const DB = process.env.FAKE_KEYCHAIN_FILE, ARGV_LOG = process.env.FAKE_KEYCHAIN_ARGV_LOG;
if (ARGV_LOG) fs.appendFileSync(ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return {}; } };
const save = d => fs.writeFileSync(DB, JSON.stringify(d), { mode: 0o600 });
const tok = l => { const out = []; let cur = '', q = false, any = false; for (let i = 0; i < l.length; i++) { const c = l[i];
  if (q) { if (c === '\\') { cur += l[++i]; } else if (c === '"') q = false; else cur += c; } else if (c === '"') { q = true; any = true; } else if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; } else cur += c; }
  if (cur || any) out.push(cur); return out; };
const opt = (a, f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
function cmd(a) {
  const d = load(), key = opt(a, '-s') + '|' + opt(a, '-a');
  if (a[0] === 'add-generic-password') { if (a.includes('-w')) { process.stderr.write('test: -w with secret in argv is forbidden\n'); return 99; }
    if (d[key] && !a.includes('-U')) return 45; d[key] = Buffer.from(opt(a, '-X'), 'hex').toString('utf8'); save(d); return 0; }
  if (a[0] === 'find-generic-password') { if (!(key in d)) return 44; if (a.includes('-w')) process.stdout.write(d[key] + '\n'); return 0; }
  if (a[0] === 'delete-generic-password') { if (!(key in d)) return 44; delete d[key]; save(d); return 0; }
  return 2;
}
const args = process.argv.slice(2);
if (args[0] === '-i') { let s = ''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => { let rc = 0; for (const l of s.split('\n').filter(Boolean)) rc = cmd(tok(l)) || rc; process.exit(rc); }); }
else process.exit(cmd(args));
