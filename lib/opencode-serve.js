// Starts a separate local `opencode serve` for the TEST build only.
// The password is read from the Keychain and placed in the child environment — never argv, files, or logs.
// The production port (CFG.PROD.opencodeUrl) is never bound and never probed.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const CFG = require('./studio-config.js');
const oca = require('./opencode-auth.js');

const portOf = u => { try { return String(new URL(u).port || (new URL(u).protocol === 'https:' ? 443 : 80)); } catch { return ''; } };
const ALLOWED_PORT = portOf(CFG.TEST.opencodeUrl);
const FORBIDDEN_PORT = portOf(CFG.PROD.opencodeUrl);
const ALLOWED_URL = 'http://127.0.0.1:' + ALLOWED_PORT;

function unpacked(p) { return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); }
function defaultConfig() { return unpacked(path.join(__dirname, '..', 'opencode', 'opencode-studio.json')); }
function resolveBin(explicit) {
  const list = [explicit, process.env.OPENCODE_BIN, path.join(os.homedir(), '.opencode', 'bin', 'opencode')].filter(Boolean);
  for (const p of list) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue; const p = path.join(d, process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}
function childEnv(pw, configPath, username) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME || os.homedir(),
    LANG: process.env.LANG || 'en_US.UTF-8',
    TMPDIR: os.tmpdir(),
    OPENCODE_CONFIG: configPath,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_SERVER_PASSWORD: pw,
    OPENCODE_SERVER_USERNAME: username || oca.DEFAULT_USER,
  };
  if (process.env.USER) env.USER = process.env.USER;
  if (process.env.LOGNAME) env.LOGNAME = process.env.LOGNAME;
  return env;
}

function createOpencodeServe(opts = {}) {
  const spawnFn = opts.spawnFn || spawn;
  const getPassword = opts.getPassword || oca.getPassword;
  const log = opts.log || (() => {});
  let child = null, buf = '', pwHeld = '', gate = Promise.resolve();
  const scrub = s => oca.scrub(s, pwHeld);
  const running = () => !!(child && child.exitCode == null && !child.killed);
  function status() {
    return { running: running(), pid: running() ? child.pid : null, port: +ALLOWED_PORT, url: ALLOWED_URL };
  }
  function fail(status, detail) { return { ok: false, status, detail: scrub(detail) }; }
  async function start(req) {
    const prev = gate; let release; gate = new Promise(r => { release = r; }); await prev;
    try { return await startLocked(req || {}); } finally { release(); }
  }
  async function startLocked({ url, username } = {}) {
    const v = oca.validateUrl(url || CFG.TEST.opencodeUrl);
    if (v.error) return fail(400, v.error);
    let origin; try { origin = new URL(v.url); } catch { return fail(400, 'Неверный URL OpenCode'); }
    const port = portOf(origin);
    if (port === FORBIDDEN_PORT) return fail(400, 'Отказ: этот порт принадлежит рабочему OpenCode. Тестовая сборка его не запускает и не проверяет.');
    if (port !== ALLOWED_PORT || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(origin.hostname.toLowerCase()))
      return fail(400, 'Тестовый OpenCode запускается только на ' + ALLOWED_URL + '. Укажите этот адрес в настройках.');
    if (running()) return { ok: true, already: true, ...status() };
    const pw = await getPassword();
    if (!pw) return fail(409, 'Пароль OpenCode не найден в Keychain (service «' + oca.SERVICE + '», account «' + oca.ACCOUNT + '»). Сохраните его в Настройках. Без пароля сервер не запускается.');
    const bin = resolveBin(opts.bin);
    if (!bin) return fail(409, 'Команда opencode не найдена. Установите OpenCode или задайте OPENCODE_BIN. Сервер не запущен.');
    const configPath = opts.configPath || defaultConfig();
    if (!fs.existsSync(configPath)) return fail(409, 'Нет файла политики OpenCode. Сервер не запущен.');
    const args = ['serve', '--hostname', '127.0.0.1', '--port', ALLOWED_PORT];
    if (args.some(a => a.includes(pw)) || bin.includes(pw)) return fail(500, 'Отказ: пароль не должен попасть в командную строку');
    pwHeld = pw; buf = '';
    const env = childEnv(pw, configPath, username);
    let proc;
    try { proc = spawnFn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: false }); }
    catch (e) { pwHeld = ''; return fail(500, 'Не удалось запустить OpenCode'); }
    child = proc;
    const take = d => { buf = scrub((buf + d).slice(-8000)); };
    proc.stdout && proc.stdout.on('data', take);
    proc.stderr && proc.stderr.on('data', take);
    proc.on('error', () => {});
    proc.on('exit', () => { pwHeld = ''; });
    const exited = await new Promise(resolve => {
      const t = setTimeout(() => resolve(false), opts.readyMs || 1500);
      proc.once('exit', () => { clearTimeout(t); resolve(true); });
      proc.once('error', () => { clearTimeout(t); resolve(true); });
    });
    if (exited || !running()) {
      const detail = buf.trim() || 'процесс OpenCode сразу завершился';
      child = null; pwHeld = '';
      return fail(500, 'OpenCode не остался запущенным: ' + detail.slice(0, 300));
    }
    log('opencode serve запущен на ' + ALLOWED_URL);
    return { ok: true, already: false, ...status() };
  }
  function stop() {
    if (!running()) { child = null; return { ok: true, running: false }; }
    try { child.kill('SIGTERM'); } catch {}
    child = null; pwHeld = '';
    return { ok: true, running: false };
  }
  return { start, stop, status, ALLOWED_URL, ALLOWED_PORT, FORBIDDEN_PORT };
}
module.exports = { createOpencodeServe, resolveBin, ALLOWED_PORT, FORBIDDEN_PORT, ALLOWED_URL };
