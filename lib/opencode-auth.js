// OpenCode server HTTP Basic Auth (OPENCODE_SERVER_PASSWORD). The password lives ONLY in the macOS Keychain
// (generic password, service from lib/studio-config.js — "MOONKATTY AI STUDIO" or, in the TEST build, "MOONKATTY AI STUDIO.test" — account "opencode-server-password"). It is never written to
// SQLite, JSON, backups, logs, env files or localStorage, and never returned by the API (only hasPassword).
// The secret never appears in a process argv: it is sent hex-encoded (-X) over stdin of `security -i`.
// Where the Keychain is not available (Linux, Docker, browser demo) the feature is reported as unavailable —
// there is deliberately NO fallback store.
'use strict';
const fs = require('fs'), { execFile, spawn } = require('child_process');
const CFG = require('./studio-config.js');
const SERVICE = CFG.keychainService, ACCOUNT = CFG.kcAccountOpencode; // TEST build: service "MOONKATTY AI STUDIO.test"
const LABEL = SERVICE + ' — OpenCode'; // Name column in Keychain Access (not the product name "… STUDIO TEST")
const DEFAULT_USER = 'opencode', TEST_PATH = '/global/health', TIMEOUT_MS = 5000;

// Test hook: a fake `security` binary, honoured ONLY under NODE_ENV=test on plain Node (never in the Electron app).
function securityBin() {
  if (process.env.NODE_ENV === 'test' && !process.versions.electron && process.env.STUDIO_TEST_SECURITY_BIN) return process.env.STUDIO_TEST_SECURITY_BIN;
  if (process.platform === 'darwin' && process.env.STUDIO_KEYCHAIN !== '0' && fs.existsSync('/usr/bin/security')) return '/usr/bin/security';
  return null;
}
function keychainStatus() {
  if (securityBin()) return { available: true, store: 'macOS Keychain' };
  return { available: false, reason: process.platform !== 'darwin' ? 'Хранилище паролей доступно только в приложении на macOS (Keychain). На этой системе функция не подключена.' : 'macOS Keychain отключена (STUDIO_KEYCHAIN=0) или /usr/bin/security не найден.' };
}
const run = (args, input) => new Promise(resolve => {
  const bin = securityBin(); if (!bin) return resolve({ code: -1, out: '' });
  let pathEnv = '/usr/bin:/bin';
  if (bin !== '/usr/bin/security') { const nodeDir = require('path').dirname(process.execPath); if (nodeDir && !pathEnv.split(':').includes(nodeDir)) pathEnv = nodeDir + ':' + pathEnv; }
  const env = { PATH: pathEnv, HOME: process.env.HOME || '' };
  if (bin !== '/usr/bin/security') for (const k of ['FAKE_KEYCHAIN_FILE', 'FAKE_KEYCHAIN_ARGV_LOG']) if (process.env[k]) env[k] = process.env[k]; // test fixture only
  const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000, env });
  let out = ''; p.stdout.on('data', d => out += d); p.on('error', () => resolve({ code: -1, out: '' })); p.on('close', code => resolve({ code, out }));
  p.stdin.end(input || '');
});
const q = s => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
async function setPassword(pw) {
  if (!securityBin()) throw Object.assign(new Error('Keychain недоступна — пароль не сохранён'), { status: 409 });
  // secret only on stdin, hex-encoded; argv is just ["-i"]
  const line = `add-generic-password -U -s ${q(SERVICE)} -a ${q(ACCOUNT)} -l ${q(LABEL)} -X ${Buffer.from(pw, 'utf8').toString('hex')}\n`;
  const r = await run(['-i'], line);
  if (r.code !== 0 || (await getPassword()) !== pw) throw Object.assign(new Error('Не удалось сохранить пароль в Keychain (доступ запрещён или Keychain заблокирована)'), { status: 500 });
}
async function getPassword() { const r = await run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']); return r.code === 0 ? r.out.replace(/\n$/, '') : null; }
async function hasPassword() { if (!securityBin()) return false; return (await run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT])).code === 0; }
async function deletePassword() { if (!securityBin()) return; await run(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]); }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const allowRemote = () => process.env.STUDIO_OPENCODE_ALLOW_REMOTE === '1'; // server-side opt-in only, not settable from the UI
function validateUrl(u) {
  let x; try { x = new URL(String(u || '').trim()); } catch { return { error: 'Неверный URL OpenCode' }; }
  if (!['http:', 'https:'].includes(x.protocol)) return { error: 'Разрешены только http(s) URL' };
  if (x.username || x.password) return { error: 'Не указывайте логин/пароль в URL — используйте поля «Логин» и «Пароль»' };
  if (!LOOPBACK.has(x.hostname.toLowerCase()) && !allowRemote()) return { error: 'Разрешены только локальные адреса (127.0.0.1, localhost, ::1). Удалённый OpenCode отключён в целях безопасности.', code: 'non_loopback' };
  if (x.search || x.hash) return { error: 'URL не должен содержать параметры (?…, #…)' };
  return { url: x.origin + x.pathname.replace(/\/+$/, '') };
}
const validUser = u => typeof u === 'string' && /^[A-Za-z0-9._@-]{1,64}$/.test(u);
const validPw = p => typeof p === 'string' && p.length >= 1 && p.length <= 256 && /^[\x20-\x7e]+$/.test(p);
const scrub = (s, pw, sec) => { let t = String(s ?? ''); if (pw) t = t.split(pw).join('[REDACTED]'); return sec ? sec.redact(t) : t; };

// Connection check. Never includes the password or Authorization header in the result/logs.
async function test({ url, username, sec }) {
  const v = validateUrl(url); const t0 = Date.now(); const at = new Date().toISOString();
  const base = { url: v.url || String(url || ''), at, via: 'server', auth: false };
  if (v.error) return { ...base, ok: false, status: null, ms: 0, code: v.code || 'invalid_url', detail: v.error };
  const ks = keychainStatus(); let pw = null;
  if (ks.available) pw = await getPassword();
  const target = v.url + TEST_PATH; const headers = { accept: 'application/json' };
  if (pw) headers.authorization = 'Basic ' + Buffer.from((username || DEFAULT_USER) + ':' + pw).toString('base64');
  const fin = (o) => ({ ...base, url: target, auth: !!pw, ms: Date.now() - t0, ...o, detail: scrub(o.detail, pw, sec) });
  try {
    const r = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = (await r.text().catch(() => '')).slice(0, 200);
    if (r.status === 401) return fin({ ok: false, status: 401, code: 'unauthorized', detail: pw ? 'Неверный логин или пароль OpenCode (HTTP 401). Проверьте OPENCODE_SERVER_PASSWORD и логин (по умолчанию «opencode»).' : ks.available ? 'OpenCode требует пароль (HTTP 401): укажите пароль в настройках.' : 'OpenCode требует пароль (HTTP 401), но хранилище паролей (Keychain) не подключено.' });
    if (r.status === 403) return fin({ ok: false, status: 403, code: 'forbidden', detail: 'Доступ запрещён (HTTP 403): сервер OpenCode отклонил запрос.' });
    if (r.status >= 300 && r.status < 400) return fin({ ok: false, status: r.status, code: 'redirect', detail: 'Сервер ответил перенаправлением — оно не выполняется (пароль не отправляется на другой адрес).' });
    if (!r.ok) return fin({ ok: false, status: r.status, code: 'http_error', detail: `Сервер ответил HTTP ${r.status}` + (r.status === 404 ? ' (нет /global/health — проверьте URL и версию OpenCode)' : '') });
    let ver = ''; try { const j = JSON.parse(text); if (j.version) ver = ' · версия ' + String(j.version).slice(0, 40); } catch {}
    return fin({ ok: true, status: r.status, code: 'ok', detail: (pw ? 'Подключено (Basic Auth)' : 'Подключено (сервер без пароля)') + ver });
  } catch (e) {
    const c = String(e.cause?.code || e.name || '');
    if (c === 'ECONNREFUSED') return fin({ ok: false, status: null, code: 'refused', detail: refusedDetail(v.url) });
    if (/Timeout|Abort|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(c)) return fin({ ok: false, status: null, code: 'timeout', detail: `Нет ответа от ${v.url} за ${TIMEOUT_MS / 1000} с (таймаут).` });
    return fin({ ok: false, status: null, code: 'network', detail: 'Сетевая ошибка: ' + c.slice(0, 60) });
  }
}
function refusedDetail(origin) {
  return `Соединение отклонено: на ${origin} никто не слушает. Пароль ищется только в Keychain: service «${SERVICE}», account «${ACCOUNT}» (название «${LABEL}»). Запустите OpenCode кнопкой «Запустить OpenCode» или скриптом opencode/serve-test.sh — пароль попадёт в окружение процесса, в командную строку и журналы он не пишется. Рабочий порт не используется.`;
}
module.exports = { SERVICE, ACCOUNT, LABEL, DEFAULT_USER, keychainStatus, setPassword, getPassword, hasPassword, deletePassword, validateUrl, validUser, validPw, test, scrub, refusedDetail };
