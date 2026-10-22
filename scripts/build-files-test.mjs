// QA-NV-001 regression: every local module reachable via require() from server.js (and the desktop shell entry)
// must be shipped by package.json build.files AND, because server.js runs from app.asar.unpacked with plain Node,
// also by build.asarUnpack. Static scan (string-literal requires, incl. lazy ones inside functions).
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { minimatch } = require('minimatch');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const matches = (pats, rel) => { let inc = false; for (const p of pats) { if (p.startsWith('!')) { if (minimatch(rel, p.slice(1), { dot: true })) inc = false; } else if (minimatch(rel, p, { dot: true })) inc = true; } return inc; };
const resolveLocal = (from, spec) => { const b = path.resolve(path.dirname(from), spec); for (const c of [b, b + '.js', b + '.json', path.join(b, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };
const seen = new Set(), missingFile = []; const entries = ['server.js', pkg.main].filter(Boolean).map(f => path.join(ROOT, f));
const stack = [...entries];
while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) { const r = resolveLocal(f, m[1]); if (r) stack.push(r); else missingFile.push(path.relative(ROOT, f) + ' → ' + m[1]); } }
const IGNORE = new Set(['lib/flavor.baked.js', 'meta.js']); // generated at build time / prod-only (TEST strips meta.js; server loads it guarded)
let fail = 0; const files = [...seen].map(f => path.relative(ROOT, f)).filter(r => !IGNORE.has(r)).sort();
const desk = r => r.startsWith('desktop/');
for (const r of files) { const inF = matches(pkg.build.files, r), inU = desk(r) || matches(pkg.build.asarUnpack, r);
  if (!inF || !inU) { fail++; console.log(`FAIL ${r} — build.files:${inF} asarUnpack:${inU}`); } }
for (const m of missingFile) console.log('WARN unresolved (generated or optional): ' + m);
console.log(`${files.length - fail}/${files.length} reachable modules shipped` + (fail ? ` — ${fail} MISSING` : ''));
for (const must of ['lib/news-video.js', 'media-automation/src/news/index.js']) if (!files.includes(must)) { fail++; console.log('FAIL scan did not reach ' + must); }
process.exit(fail ? 1 : 0);
