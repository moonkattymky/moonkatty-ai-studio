// Blender automation service: detection, version/Python-API probe and headless runs of VETTED templates.
// Spawned without a shell, argv contains only paths (no secrets), minimal env, timeout + cancel (SIGTERM → SIGKILL).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const MIN = [4, 2]; const { withHeavy } = require('./heavy-lock.js');
const unpacked = p => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const TEMPLATES = unpacked(path.join(__dirname, '..', 'blender', 'templates'));
function candidates(configured) {
  const c = [];
  if (configured) c.push(configured);
  if (process.env.STUDIO_BLENDER_BIN) c.push(process.env.STUDIO_BLENDER_BIN);
  if (process.platform === 'darwin') {
    c.push('/Applications/Blender.app/Contents/MacOS/Blender', path.join(os.homedir(), 'Applications/Blender.app/Contents/MacOS/Blender'));
    try { for (const d of fs.readdirSync('/Applications')) if (/^Blender.*\.app$/i.test(d)) c.push(path.join('/Applications', d, 'Contents/MacOS/Blender')); } catch {}
  }
  for (const d of String(process.env.PATH || '').split(path.delimiter)) if (path.isAbsolute(d)) c.push(path.join(d, 'blender'));
  return [...new Set(c)].filter(p => path.isAbsolute(p) && /^blender$/i.test(path.basename(p)));
}
function runProc(bin, args, { timeoutMs = 600000, signal, cwd, onSpawn, onLine } = {}) {
  require('./feature-gate.js').assert3dAllowed('blender:spawn'); // fail closed: no Blender process at all while 3D is not approved
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Отменено'), { cancelled: true }));
    const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), LANG: 'en_US.UTF-8', TMPDIR: os.tmpdir() }; // no studio env / secrets
    const p = spawn(bin, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    onSpawn && onSpawn(p.pid);
    let out = '', buf = '', done = false, why = null;
    const kill = reason => { if (done) return; why = reason; try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} }
      setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, 5000).unref(); };
    const t = setTimeout(() => kill('timeout'), timeoutMs); const onAbort = () => kill('cancel'); signal?.addEventListener('abort', onAbort, { once: true });
    const feed = d => { const s = String(d); out = (out + s).slice(-60000); buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onLine && onLine(l); } };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', e => { done = true; clearTimeout(t); reject(e); });
    p.on('close', (code, sig) => { done = true; clearTimeout(t); signal?.removeEventListener('abort', onAbort);
      if (why === 'cancel') return reject(Object.assign(new Error('Отменено пользователем'), { cancelled: true, out }));
      if (why === 'timeout') return reject(Object.assign(new Error(`Blender: превышено время ожидания (${Math.round(timeoutMs / 1000)} с)`), { timeout: true, out }));
      resolve({ code, sig, out }); });
  });
}
const pyError = out => { const m = String(out).match(/(?:^|\n)((?:\w+\.)*\w*(?:Error|Exception)[^\n]*)(?![\s\S]*\n(?:\w+\.)*\w*(?:Error|Exception))/); return m ? m[1].trim().slice(0, 500) : null; };
module.exports = function createBlender() {
  let cache = null;
  async function detect(configured, { force } = {}) {
    { const g = require('./feature-gate.js'); if (!g.DESIGN3D_ENABLED) return { ok: false, configured, disabled: true, code: 'feature_disabled', error: g.DESIGN3D_DISABLED_MSG }; }
    if (cache && !force && cache.configured === configured) return cache;
    const tried = [];
    for (const bin of candidates(configured)) {
      try { fs.accessSync(bin, fs.constants.X_OK); } catch { tried.push(bin); continue; }
      try {
        const v = await runProc(bin, ['-b', '--factory-startup', '--version'], { timeoutMs: 60000 });
        const m = /Blender\s+(\d+)\.(\d+)(?:\.(\d+))?([^\n]*)/.exec(v.out); if (!m) { tried.push(bin + ' (нет версии)'); continue; }
        const ver = [+m[1], +m[2], +(m[3] || 0)];
        if (ver[0] < MIN[0] || (ver[0] === MIN[0] && ver[1] < MIN[1])) return cache = { ok: false, configured, bin, version: ver.join('.'), error: `Blender ${ver.join('.')} слишком старый (нужен ≥ ${MIN.join('.')})` };
        const pr = await runProc(bin, ['-b', '--factory-startup', '--python-exit-code', '3', '--python', path.join(TEMPLATES, 'probe.py')], { timeoutMs: 120000 });
        const line = pr.out.split('\n').find(l => l.startsWith('MKPROBE ')); const probe = line ? JSON.parse(line.slice(8)) : null;
        if (pr.code !== 0 || !probe) return cache = { ok: false, configured, bin, version: ver.join('.'), error: 'Python API Blender не отвечает: ' + (pyError(pr.out) || 'код ' + pr.code) };
        return cache = { ok: true, configured, bin, version: probe.version, lts: /LTS/.test(m[4] || probe.version), python: probe.python, engines: probe.engines, gltf: probe.gltf, fbx: probe.fbx, arch: os.arch(), platform: process.platform };
      } catch (e) { tried.push(bin + ' (' + e.message + ')'); }
    }
    return cache = { ok: false, configured, error: 'Blender не найден. Установите Blender 4.2+ (blender.org) или укажите путь в настройках.', tried };
  }
  // Run a vetted template headless. Returns parsed logs/<mode>-result.json; throws with a readable Python error.
  async function runTemplate(bin, tpl, mode, paramsFile, vdir, opts = {}) {
    require('./feature-gate.js').assert3dAllowed('blender:runTemplate');
    if (!/^[a-z_]+$/.test(tpl)) throw new Error('bad template'); const script = path.join(TEMPLATES, tpl + '.py');
    const args = ['-b', '--factory-startup', '--python-exit-code', '3', '--python', script, '--', mode, paramsFile, vdir];
    const r = await withHeavy('blender:' + mode, () => runProc(bin, args, { ...opts, cwd: vdir }), opts.signal);
    fs.writeFileSync(path.join(vdir, 'logs', mode + '-blender.log'), r.out);
    const rf = path.join(vdir, 'logs', mode + '-result.json'); const res = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : null;
    if (r.code !== 0 || !res || !res.ok) { const e = new Error(`Blender (${mode}) завершился с кодом ${r.code}${r.sig ? ' / ' + r.sig : ''}: ${res?.error || pyError(r.out) || (String(r.out).trim().split('\n').pop() || '').slice(0, 300) + ' (см. logs/' + mode + '-blender.log)'}`); e.out = r.out; throw e; }
    return res;
  }
  return { detect, runTemplate, runProc, candidates, TEMPLATES, pyError };
};
