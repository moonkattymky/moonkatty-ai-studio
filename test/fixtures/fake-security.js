#!/usr/bin/env node
'use strict';
// Test double for macOS /usr/bin/security: stores items in $FAKE_KC_FILE (outside node HOME), logs argv to $FAKE_KC_ARGV.
const fs = require('fs'); const F = process.env.FAKE_KC_FILE; const db = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : {};
const save = () => fs.writeFileSync(F, JSON.stringify(db)); const a = process.argv.slice(2); if (process.env.FAKE_KC_ARGV) fs.appendFileSync(process.env.FAKE_KC_ARGV, JSON.stringify(a) + '\n');
const opt = (arr, k) => { const i = arr.indexOf(k); return i >= 0 ? arr[i + 1] : undefined; };
function cmd(arr) { const c = arr[0];
  if (c === 'add-generic-password') { db[opt(arr, '-s') + '|' + opt(arr, '-a')] = opt(arr, '-w'); save(); return 0; }
  if (c === 'find-generic-password') { const v = db[opt(arr, '-s') + '|' + opt(arr, '-a')]; if (v == null) return 44; process.stdout.write(v + '\n'); return 0; }
  if (c === 'delete-generic-password') { const k = opt(arr, '-s') + '|' + opt(arr, '-a'); if (!(k in db)) return 44; delete db[k]; save(); return 0; }
  return 1; }
if (a[0] === '-i') { let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => { let rc = 0; for (const l of s.split('\n').filter(Boolean)) rc = cmd(l.trim().split(/\s+/)) || rc; process.exit(rc); }); }
else process.exit(cmd(a));
