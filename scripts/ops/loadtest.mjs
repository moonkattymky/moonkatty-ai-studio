#!/usr/bin/env node
// MOONKATTY load test — run ON the Mac mini (not in CI). See docs/ops/LOADTEST.md.
//   node scripts/ops/loadtest.mjs --dry-run                     # checks tools, spawns nothing
//   node scripts/ops/loadtest.mjs [--model qwen3:8b] [--only ollama,ffmpeg] [--swap-abort-mb 1024] [--ffmpeg-sec 30] [--blender-samples 64]
//   node scripts/ops/loadtest.mjs import <loadtest-report.json> [--data <studio data dir>]
// Output: $TMPDIR/moonkatty-loadtest-<time>/loadtest-report.{json,md} (never the studio data folder).
import { createRequire } from 'module'; import { spawn, execFile } from 'child_process'; import os from 'os'; import path from 'path'; import fs from 'fs';
const require = createRequire(import.meta.url);
const { createLoadTest, importCalibration, parsePsTree } = require('../../lib/ops/loadtest.js');
const { memoryStats } = require('../../lib/ops/memory.js');
const a = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
if (a[0] === 'import') {
  const dataDir = opt('--data', process.env.STUDIO_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'MOONKATTY AI STUDIO'));
  const r = importCalibration(a[1], dataDir); console.log('Калибровка записана: ' + r.file + '\n' + JSON.stringify(r.calibration, null, 1)); process.exit(0);
}
const which = name => { for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) if (fs.existsSync(path.join(d, name))) return path.join(d, name); return path.join('/opt/homebrew/bin', name); };
const outDir = opt('--out', path.join(os.tmpdir(), 'moonkatty-loadtest-' + new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const ps = () => new Promise((res, rej) => execFile('/bin/ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,comm='], { maxBuffer: 8 << 20 }, (e, o) => e ? rej(e) : res(parsePsTree(o))));
const lt = createLoadTest({ spawn, memStats: () => memoryStats(), processes: ps, outDir, dryRun: a.includes('--dry-run'), swapAbortMB: +opt('--swap-abort-mb', 1024),
  only: opt('--only') ? opt('--only').split(',') : undefined,
  tools: { model: opt('--model'), ollamaUrl: opt('--ollama-url', 'http://127.0.0.1:11434'), blender: opt('--blender', '/Applications/Blender.app/Contents/MacOS/Blender'), ffmpeg: opt('--ffmpeg', which('ffmpeg')),
    ffmpegSec: +opt('--ffmpeg-sec', 30), blenderSamples: +opt('--blender-samples', 64) } });
let stopping = false; const onSig = () => { if (stopping) process.exit(130); stopping = true; console.log('Прерывание: останавливаю только запущенные тестом процессы…'); for (const pid of lt.spawned) { try { process.kill(pid, 'SIGTERM'); } catch {} } setTimeout(() => process.exit(130), 3000); };
process.on('SIGINT', onSig); process.on('SIGTERM', onSig);
const r = await lt.run();
console.log('\nОтчёт: ' + r.md + '\nJSON:  ' + r.json + '\n'); console.log(fs.readFileSync(r.md, 'utf8'));
