// Blender diagnostics. Spawns the blender binary directly (the studio 3D gate
// stays closed). Version, a vetted Python probe, then a .blend rendered to PNG.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { makeTemp, assertTempPath } = require('../paths');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PROBE = path.join(__dirname, '..', 'assets', 'sd_probe.py');
const RENDER = path.join(__dirname, '..', 'assets', 'sd_render.py');

function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 32 && buf.subarray(0, 8).equals(PNG);
}

function candidates(explicit) {
  const list = [];
  if (explicit) list.push(explicit);
  if (process.env.STUDIO_BLENDER_BIN) list.push(process.env.STUDIO_BLENDER_BIN);
  list.push('/usr/bin/blender', '/usr/local/bin/blender', '/Applications/Blender.app/Contents/MacOS/Blender', path.join(os.homedir(), 'Applications/Blender.app/Contents/MacOS/Blender'));
  return [...new Set(list)].filter(p => path.isAbsolute(p) && /^blender$/i.test(path.basename(p)) && fs.existsSync(p));
}

function runBlender(bin, args, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(bin, args, {
      shell: false, detached: true, cwd: os.tmpdir(),
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', HOME: os.homedir(), TMPDIR: os.tmpdir() },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const take = d => { out = (out + d).slice(-100000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    let killTimer = null, timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000);
      if (killTimer.unref) killTimer.unref();
    }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); resolve({ code: null, out, error: e.message, timedOut }); });
    child.on('close', code => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); resolve({ code, out, timedOut }); });
  });
}

async function check(opts = {}) {
  const gate = opts.blender && typeof opts.blender.detect === 'function' ? await opts.blender.detect().catch(e => ({ ok: false, error: e.message })) : null;
  const bins = candidates(opts.bin);
  if (!bins.length) {
    return { id: 'blender', status: 'BLOCKED', summary: 'Blender не установлен', data: { studioGate: gate } };
  }
  const bin = bins[0];
  const ver = await runBlender(bin, ['-b', '--factory-startup', '--version'], opts.timeoutMs || 60000);
  const vm = /Blender\s+(\d+\.\d+(?:\.\d+)?)/.exec(ver.out || '');
  if (!vm) return { id: 'blender', status: 'FAIL', summary: 'Blender не сообщил версию', data: { studioGate: gate, tail: (ver.out || '').slice(-200) } };
  const probe = await runBlender(bin, ['-b', '--factory-startup', '--python-exit-code', '3', '--python', PROBE], opts.timeoutMs || 120000);
  if (probe.code !== 0 || !/SDPROBE OK/.test(probe.out || '')) {
    return { id: 'blender', status: 'FAIL', summary: 'Тестовый Python-скрипт не прошёл', data: { version: vm[1], studioGate: gate } };
  }
  const dir = makeTemp();
  const blend = assertTempPath(path.join(dir, 'probe.blend'));
  const png = assertTempPath(path.join(dir, 'frame.png'));
  const rendered = await runBlender(bin, ['-b', '--factory-startup', '--python-exit-code', '3', '--python', RENDER, '--', blend, png], opts.timeoutMs || 180000);
  let pngOk = false, size = 0;
  if (fs.existsSync(png)) {
    const buf = fs.readFileSync(png);
    size = buf.length; pngOk = isPng(buf);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  if (rendered.code !== 0 || !pngOk) {
    return { id: 'blender', status: 'FAIL', summary: 'Рендер .blend → PNG не удался', data: { version: vm[1], pngOk, size, studioGate: gate } };
  }
  return { id: 'blender', status: 'OK', summary: `Blender ${vm[1]}, скрипт OK, PNG ${size} байт`, data: { version: vm[1], pngBytes: size, studioGate: gate } };
}

module.exports = { check, isPng, candidates, PROBE, RENDER };
