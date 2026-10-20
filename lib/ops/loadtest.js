// Load test / calibration for Ollama + Blender + FFmpeg on the Mac mini. Runs each component alone, then combinations,
// samples memory (Activity-Monitor numbers), pressure, swap, compressed, peak RSS, CPU, duration.
// Safety: auto-abort on red pressure or swap growth over threshold; kills ONLY processes it spawned (and their children);
// Ollama is measured but never killed/unloaded; output only in its own temp folder; dry-run spawns nothing.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const GB = 1024 ** 3, MB = 1024 ** 2;
const SCENARIOS = [['ollama'], ['blender'], ['ffmpeg'], ['ollama', 'ffmpeg'], ['ollama', 'blender'], ['blender', 'ffmpeg'], ['ollama', 'blender', 'ffmpeg']];
const CLASS = { ollama: 'llm-large', blender: 'render', ffmpeg: 'video' };
const RANK = { green: 0, unknown: 0, yellow: 1, red: 2 };
function parsePsTree(txt) { return String(txt).split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(/\s+/); return { pid: +p[0], ppid: +p[1], rssKb: +p[2], cpu: +p[3], comm: p.slice(4).join(' ') }; }).filter(p => p.pid > 0); }
const descendants = (list, root) => { const out = new Set([root]); let grew = true; while (grew) { grew = false; for (const p of list) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true; } } return out; };
function createLoadTest({ spawn, fetchFn = globalThis.fetch, memStats, processes, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, kill = (pid, s) => process.kill(pid, s),
  exists = p => fs.existsSync(p), intervalMs = 1000, outDir, tools = {}, swapAbortMB = 1024, scenarioTimeoutMs = 15 * 60000, cooldownMs = 15000, dryRun = false, only, log = console.log } = {}) {
  const T = { ollamaUrl: 'http://127.0.0.1:11434', blender: '/Applications/Blender.app/Contents/MacOS/Blender', ffmpeg: '/opt/homebrew/bin/ffmpeg', ffmpegSec: 30, blenderSamples: 64, numPredict: 400, ...tools };
  const spawned = new Set(); // pids we started — the only ones we may signal
  const work = path.join(outDir, 'work'); 
  const components = {
    ollama: () => { const ac = new AbortController(); const done = fetchFn(T.ollamaUrl + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ model: T.model, stream: false, prompt: 'Напиши подробную историю (около 300 слов) о коте-космонавте MOONKATTY.', options: { num_predict: T.numPredict } }) })
        .then(async r => { if (!r.ok) throw new Error('HTTP ' + r.status); await r.json(); });
      return { done, owned: false, match: p => /ollama/i.test(p.comm), stop: () => ac.abort() }; },
    blender: () => runProc(T.blender, ['-b', '--factory-startup', '--python-expr',
      `import bpy; s=bpy.context.scene; s.render.engine='CYCLES'; s.cycles.samples=${+T.blenderSamples}; s.render.resolution_x=1920; s.render.resolution_y=1080; s.render.filepath=${JSON.stringify(path.join(work, 'blender_'))}; bpy.ops.render.render(write_still=True)`]),
    ffmpeg: () => runProc(T.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30', '-t', String(+T.ffmpegSec), '-c:v', 'libx264', '-preset', 'medium', path.join(work, 'ffmpeg_test.mp4')])
  };
  function runProc(cmd, args) {
    const p = spawn(cmd, args, { stdio: 'ignore', shell: false }); spawned.add(p.pid);
    const done = new Promise((res, rej) => { p.on('error', rej); p.on('exit', (code, sig) => { spawned.delete(p.pid); code === 0 ? res() : rej(new Error(`exit ${code}${sig ? ' ' + sig : ''}`)); }); });
    return { done, owned: true, root: p.pid, stop: tree => { for (const pid of tree) if (pid === p.pid || spawned.has(p.pid)) { try { kill(pid, 'SIGTERM'); } catch {} } } };
  }
  async function preflight() {
    const r = { ollama: { ok: false }, blender: { ok: exists(T.blender), path: T.blender }, ffmpeg: { ok: exists(T.ffmpeg), path: T.ffmpeg } };
    try { const tags = await (await fetchFn(T.ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(5000) })).json(); const names = (tags.models || []).map(m => m.name);
      if (!T.model) T.model = names[0]; r.ollama = { ok: !!T.model && names.includes(T.model), model: T.model || null, installed: names }; } catch (e) { r.ollama = { ok: false, error: e.message }; }
    return r;
  }
  async function waitCalm(maxMs = 120000) { const t0 = now(); for (;;) { const m = await memStats(); if ((RANK[m.pressure] ?? 0) === 0 || now() - t0 > maxMs) return m; await sleep(intervalMs * 5); } }
  async function runScenario(names) {
    const base = await waitCalm(); const t0 = now(); const res = { scenario: names.join('+'), components: {}, aborted: null, baseline: { usedGB: base.used / GB, swapMB: (base.swapUsed || 0) / MB, pressure: base.pressure } };
    const run = {}; for (const n of names) { try { run[n] = components[n](); run[n].state = 'running'; run[n].done.then(() => { run[n].state = 'done'; }, e => { run[n].state = 'failed'; run[n].error = e.message; }); } catch (e) { run[n] = { state: 'failed', error: e.message, done: Promise.resolve() }; } }
    const peak = { usedGB: 0, compressedGB: 0, swapDeltaMB: 0, pressure: 'green', cpu: 0 }; const rss = Object.fromEntries(names.map(n => [n, 0]));
    for (;;) {
      await sleep(intervalMs);
      const m = await memStats(); let list = []; try { list = await processes(); } catch {}
      let cpu = 0;
      for (const n of names) { const c = run[n]; if (!c || c.state === 'failed' && !c.root) continue;
        const pids = c.owned ? descendants(list, c.root) : new Set(list.filter(c.match).map(p => p.pid)); c.tree = pids;
        const sel = list.filter(p => pids.has(p.pid)); const r = sel.reduce((a, p) => a + p.rssKb * 1024, 0); cpu += sel.reduce((a, p) => a + p.cpu, 0); rss[n] = Math.max(rss[n], r); }
      peak.usedGB = Math.max(peak.usedGB, m.used / GB); peak.compressedGB = Math.max(peak.compressedGB, (m.compressed || 0) / GB); peak.cpu = Math.max(peak.cpu, cpu);
      const swapDelta = ((m.swapUsed || 0) - (base.swapUsed || 0)) / MB; peak.swapDeltaMB = Math.max(peak.swapDeltaMB, swapDelta);
      if ((RANK[m.pressure] ?? 0) > RANK[peak.pressure]) peak.pressure = m.pressure;
      if (m.pressure === 'red') res.aborted = 'давление памяти red'; else if (swapDelta > swapAbortMB) res.aborted = `swap вырос на ${swapDelta.toFixed(0)} МБ (> ${swapAbortMB})`; else if (now() - t0 > scenarioTimeoutMs) res.aborted = 'таймаут сценария';
      if (res.aborted) { log('ABORT ' + res.scenario + ': ' + res.aborted); for (const n of names) { const c = run[n]; if (c && c.stop && c.state === 'running') { c.stopped = true; c.stop(c.tree || new Set()); } } await sleep(intervalMs); break; }
      if (names.every(n => run[n].state !== 'running')) break;
    }
    res.durationSec = Math.round((now() - t0) / 100) / 10;
    for (const n of names) res.components[n] = { state: run[n].stopped ? 'aborted' : run[n].state, error: run[n].error || null, peakRssGB: +(rss[n] / GB).toFixed(3) };
    Object.assign(res, { peakUsedGB: +peak.usedGB.toFixed(2), usedDeltaGB: +(peak.usedGB - base.used / GB).toFixed(2), peakCompressedGB: +peak.compressedGB.toFixed(2), swapDeltaMB: +peak.swapDeltaMB.toFixed(1), maxPressure: peak.pressure, peakCpuPct: Math.round(peak.cpu) });
    res.safe = !res.aborted && peak.pressure === 'green' && peak.swapDeltaMB < Math.min(256, swapAbortMB) && names.every(n => res.components[n].state === 'done');
    return res;
  }
  function calibrationFrom(results, machine) {
    const classes = {};
    for (const n of Object.keys(CLASS)) { const solo = results.find(r => r.scenario === n && !r.aborted && !r.skipped && r.components?.[n]?.state === 'done'); if (!solo) continue;
      const peakGB = +Math.max(solo.components[n].peakRssGB, solo.usedDeltaGB).toFixed(2); if (!(peakGB > 0)) continue;
      classes[CLASS[n]] = { peakGB, limitGB: Math.ceil(peakGB * 1.2 * 10) / 10, component: n }; }
    return { measuredAt: new Date(now()).toISOString(), machine, source: 'loadtest', classes, combos: Object.fromEntries(results.filter(r => r.scenario.includes('+') && !r.skipped).map(r => [r.scenario, { safe: r.safe }])) };
  }
  function markdown(rep) {
    const L = [`# MOONKATTY loadtest — ${rep.startedAt}`, '', `Машина: ${rep.machine}`, `Режим: ${rep.dryRun ? 'DRY-RUN (ничего не запускалось)' : 'реальный'}`, '',
      '| Сценарий | Итог | Длит., с | Пик RSS (ГБ) | Пик Used (ГБ) | ΔUsed | Compressed | ΔSwap МБ | Pressure | CPU % |', '|---|---|---|---|---|---|---|---|---|---|'];
    for (const r of rep.results) L.push(`| ${r.scenario} | ${r.skipped ? 'пропущен: ' + r.skipped : r.aborted ? 'ПРЕРВАН: ' + r.aborted : r.safe ? 'OK' : 'есть риски'} | ${r.durationSec ?? ''} | ${r.components ? Object.entries(r.components).map(([k, v]) => `${k} ${v.peakRssGB}`).join(', ') : ''} | ${r.peakUsedGB ?? ''} | ${r.usedDeltaGB ?? ''} | ${r.peakCompressedGB ?? ''} | ${r.swapDeltaMB ?? ''} | ${r.maxPressure ?? ''} | ${r.peakCpuPct ?? ''} |`);
    L.push('', '## Калибровка (пик × 1.2)', '', ...Object.entries(rep.calibration.classes).map(([k, v]) => `- ${k} (${v.component}): пик ${v.peakGB} ГБ → лимит ${v.limitGB} ГБ`), '', 'Импорт: `node scripts/ops/loadtest.mjs import <report.json>`');
    return L.join('\n') + '\n';
  }
  async function run() {
    fs.mkdirSync(work, { recursive: true, mode: 0o700 }); const startedAt = new Date(now()).toISOString(); const pre = await preflight();
    const machine = `${os.hostname()} ${os.arch()} ${(os.totalmem() / GB).toFixed(0)}GB`;
    let list = SCENARIOS.filter(s => !only || s.every(n => only.includes(n)));
    const results = [];
    for (const s of list) {
      const miss = s.filter(n => !pre[n].ok); if (miss.length) { results.push({ scenario: s.join('+'), skipped: 'нет ' + miss.join(',') }); continue; }
      if (dryRun) { results.push({ scenario: s.join('+'), skipped: 'dry-run' }); continue; }
      log('RUN ' + s.join('+')); const r = await runScenario(s); results.push(r); log(`  → ${r.aborted ? 'ABORT ' + r.aborted : r.safe ? 'OK' : 'risk'} ${r.durationSec}s used≤${r.peakUsedGB}GB swapΔ ${r.swapDeltaMB}MB ${r.maxPressure}`);
      if (r.aborted && /red|swap/.test(r.aborted)) { log('Остановка тестов: опасная нагрузка'); for (const rest of list.slice(list.indexOf(s) + 1)) results.push({ scenario: rest.join('+'), skipped: 'остановлено после прерывания' }); break; }
      await sleep(cooldownMs);
    }
    const rep = { app: 'moonkatty-loadtest', version: 1, startedAt, finishedAt: new Date(now()).toISOString(), machine, dryRun, preflight: pre, thresholds: { swapAbortMB }, results, calibration: calibrationFrom(results, machine) };
    const jf = path.join(outDir, 'loadtest-report.json'), mf = path.join(outDir, 'loadtest-report.md');
    fs.writeFileSync(jf, JSON.stringify(rep, null, 1)); fs.writeFileSync(mf, markdown(rep)); fs.rmSync(work, { recursive: true, force: true });
    return { report: rep, json: jf, md: mf };
  }
  return { run, runScenario, preflight, calibrationFrom, spawned };
}
// Import calibration into <dataDir>/ops/calibration.json (validated; used by the Resource Manager).
function importCalibration(reportFile, dataDir) {
  const { validateCalibration } = require('./resource-manager.js');
  const rep = JSON.parse(fs.readFileSync(reportFile, 'utf8')); if (rep.app !== 'moonkatty-loadtest') throw new Error('Не отчёт loadtest');
  if (rep.dryRun) throw new Error('Dry-run отчёт нельзя импортировать'); const cal = validateCalibration(rep.calibration);
  if (!Object.keys(cal.classes).length) throw new Error('В отчёте нет замеров');
  const f = path.join(dataDir, 'ops', 'calibration.json'); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, JSON.stringify(cal, null, 1), { mode: 0o600 }); return { file: f, calibration: cal };
}
module.exports = { createLoadTest, importCalibration, parsePsTree, descendants, SCENARIOS, CLASS };
