// MOONKATTY AI STUDIO — desktop shell (Electron). The window only shows the panel served by the LOCAL server
// (http://127.0.0.1:<port>); it never loads GitHub Pages. The server runs as a separate background process.
// Security model and audit: docs/SECURITY_AUDIT.md
'use strict';
const { app, BrowserWindow, Menu, shell, dialog, session, ipcMain, nativeImage } = require('electron');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const svc = require('./service.js');
const CFG = require('../lib/studio-config.js'); // all names/ids/paths/labels/ports (prod vs isolated TEST build)
const PRODUCT = CFG.product;
const REPO = 'moonkattymky/moonkatty-ai-studio'; // pinned: update checks never use a configurable repo
const { externalHref } = require('./external-hosts.js');
app.setName(PRODUCT);
app.commandLine.appendSwitch('lang', 'ru');
app.enableSandbox();
if (process.env.STUDIO_USER_DATA && !app.isPackaged) app.setPath('userData', process.env.STUDIO_USER_DATA); // tests only (dev runs)
else if (process.platform === 'darwin') app.setPath('userData', CFG.macDataDir()); // explicit: ~/Library/Application Support/<product>/
// Startup guard (TEST build): refuse to run if userData would resolve into the production data folder.
try { CFG.assertTestPath(app.getPath('userData'), 'userData'); } catch (e) { dialog.showErrorBox(PRODUCT, e.message); app.exit(78); }
// v1.2.3-test: packaged app — unpacked flavor markers must match the lock sealed inside app.asar, and the config module
// must agree; otherwise refuse (exit 78) before any server is started or installed.
if (app.isPackaged) { const g = require('./flavor-guard.js').check(path.join(process.resourcesPath, 'app.asar.unpacked'));
  if (!g.ok || g.flavor !== CFG.FLAVOR) { dialog.showErrorBox(PRODUCT, 'ОТКАЗ: целостность сборки нарушена (' + (g.reason || 'flavor ' + CFG.FLAVOR) + ')'); app.exit(78); process.exit(78); } }
else if (!CFG.FLAVOR) { dialog.showErrorBox(PRODUCT, 'ОТКАЗ: сборка не определена'); app.exit(78); process.exit(78); }

const ROOT = path.join(__dirname, '..');
const BUILD = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')); } catch { return { commit: 'dev', builtAt: null }; } })();
const dataDir = () => app.getPath('userData');
const single = require('./single-instance.js');
const identity = require('../lib/server-identity.js');
const MINE = { version: app.getVersion(), commit: BUILD.commit && BUILD.commit !== 'dev' ? BUILD.commit : null };
const lockOther = single.readInstance(dataDir());
const gotLock = app.requestSingleInstanceLock({ version: MINE.version, commit: MINE.commit });
const lockDecision = single.onLockResult({ gotLock, mine: MINE, other: lockOther, flavor: CFG.FLAVOR });
if (lockDecision.action === 'quit') { dialog.showErrorBox(PRODUCT, lockDecision.message); app.quit(); process.exit(0); }
single.writeInstance(dataDir(), { ...MINE, pid: process.pid });
const logDir = () => process.platform === 'darwin' ? path.join(app.getPath('home'), 'Library', 'Logs', PRODUCT) : path.join(dataDir(), 'logs');
const cfgFile = () => path.join(dataDir(), 'desktop.json');
const DEF = { port: CFG.defaultPort, autoStartServer: CFG.autoStartServer, startAtLogin: false, checkUpdates: CFG.checkUpdates }; // TEST: 8687, no autostart, no update checks
const cfg = () => { let c = {}; try { c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch {}
  let port = Number.isInteger(c.port) && c.port >= 1024 && c.port <= 65535 ? c.port : DEF.port; if (CFG.IS_TEST && port === CFG.PROD.defaultPort) port = DEF.port; // test never uses the production port
  return { port, autoStartServer: typeof c.autoStartServer === 'boolean' ? c.autoStartServer : DEF.autoStartServer, startAtLogin: c.startAtLogin === true, checkUpdates: typeof c.checkUpdates === 'boolean' ? c.checkUpdates : DEF.checkUpdates, enableOpenCode: c.enableOpenCode === true,
    allowedHosts: (Array.isArray(c.allowedHosts) ? c.allowedHosts : []).filter(h => typeof h === 'string' && /^[a-z0-9.-]+\.ts\.net(:\d+)?$/i.test(h)).slice(0, 5) }; }; // only Tailscale names
const saveCfg = c => { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2), { mode: 0o600 }); };
// Packaged: official Node binary (Resources/node/node) runs server.js from app.asar.unpacked → the RunAsNode fuse stays OFF.
// Dev (electron .): Electron itself as Node.
const serverRuntime = () => app.isPackaged
  ? { execPath: path.join(process.resourcesPath, 'node', 'node'), serverJs: path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js'), runAsNode: false }
  : { execPath: process.execPath, serverJs: path.join(ROOT, 'server.js'), runAsNode: true };
const svcOpts = c => ({ ...serverRuntime(), dataDir: dataDir(), port: c.port, startAtLogin: c.startAtLogin, logDir: logDir(), enableOpenCode: c.enableOpenCode, allowedHosts: c.allowedHosts });
const panelOrigin = c => `http://127.0.0.1:${c.port}`;
const STARTUP = path.join(__dirname, 'startup.html');
const STARTUP_URL = pathToFileURL(STARTUP).href;
let win = null;

const isPanel = url => { try { return new URL(url).origin === panelOrigin(cfg()); } catch { return false; } };
const isStartup = url => String(url).split('#')[0] === STARTUP_URL;
function openExternalSafe(url) {
  const href = externalHref(url); if (!href) return false;
  shell.openExternal(href); return true;
}

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 640, title: PRODUCT, backgroundColor: '#0b0f1a', show: false,
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: false, devTools: !app.isPackaged || process.env.STUDIO_DEVTOOLS === '1' } });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; }); // closing the window never stops the background server
  win.loadFile(STARTUP);
}

app.on('web-contents-created', (e, contents) => {
  contents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  const guard = (ev, url) => { if (isPanel(url) || isStartup(url)) return; ev.preventDefault(); openExternalSafe(url); };
  contents.on('will-navigate', guard); contents.on('will-redirect', guard); contents.on('will-frame-navigate', ev => { if (!isPanel(ev.url) && !isStartup(ev.url)) ev.preventDefault(); });
  contents.on('will-attach-webview', ev => ev.preventDefault());
});

// Local app token: injected only into requests to our loopback origin (never exposed to page JS).
function installTokenHeader(c) {
  const f = path.join(dataDir(), 'app-token');
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${c.port}/*`] }, (d, cb) => {
    let tok = null; try { tok = fs.readFileSync(f, 'utf8').trim(); } catch {}
    if (tok && isPanel(d.url)) d.requestHeaders['X-Studio-App-Token'] = tok; cb({ requestHeaders: d.requestHeaders });
  });
}

async function ollama() {
  try { const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) }); if (!r.ok) return { ok: false, detail: 'HTTP ' + r.status };
    const m = ((await r.json()).models || []).map(x => String(x.name)).slice(0, 30); const has = m.some(n => n.startsWith('qwen3:8b'));
    return { ok: has, detail: m.length ? 'Модели: ' + m.join(', ') + (has ? '' : ' — нет qwen3:8b (ollama pull qwen3:8b)') : 'Нет моделей (ollama pull qwen3:8b)' };
  } catch (e) { return { ok: false, detail: 'Не запущена (' + (e.cause?.code || e.message) + '). Агенты, которым нужен LLM, будут ставить задачи в «Заблокировано».' }; }
}
async function status() {
  const c = cfg(); const h = await svc.health(c.port);
  return { port: c.port, cfg: { autoStartServer: c.autoStartServer, startAtLogin: c.startAtLogin }, version: app.getVersion(), commit: BUILD.commit, platform: process.platform + '/' + process.arch,
    server: h ? (h.foreign ? { ok: false, detail: `Порт ${c.port} занят другим приложением` } : h.stale ? { ok: false, stale: true, detail: `На порту ${c.port} работает другая версия сервера (v${h.version}${h.commit ? ', ' + String(h.commit).slice(0, 7) : ''}, pid ${h.pid}), а это приложение v${svc.EXPECT.version}. ⌘Q закрывает только окно и не освобождает порт. Нажмите «Запустить сервер» — старый сервер TEST будет перезапущен этой версией.` } : { ok: true, detail: `pid ${h.pid}, работает ${h.uptimeSec} с, v${h.version}` }) : { ok: false, detail: 'Не запущен' },
    db: h && !h.foreign && !h.stale ? { ok: h.db === 'ok', detail: `${h.dbDriver}, ${path.join(dataDir(), 'studio.db')}` } : { ok: false, detail: 'Нет данных — сервер не запущен' },
    keys: h && h.keySource ? { ok: true, detail: h.keySource === 'keychain' ? 'macOS Keychain' : h.keySource } : null,
    ollama: await ollama(), launchd: await svc.launchdStatus() };
}
// IPC: only the bundled startup page may call these; arguments are validated.
const fromStartup = e => !!e.senderFrame && isStartup(e.senderFrame.url) && e.sender === win?.webContents;
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromStartup(e)) throw new Error('IPC denied'); return fn(...a); });
handle('status', () => status());
handle('start-server', async () => { const c = cfg(); const h = await svc.health(c.port); if (h && !h.foreign && !h.stale) return { ok: true, already: true };
  if (h && h.foreign) return { ok: false, error: `Порт ${c.port} занят другим приложением` };
  if (h && h.stale && process.platform !== 'darwin') { // dev/test path: SIGTERM only if the health PID is the one written to server.pid
    if (!identity.pidMatchesServerFile(dataDir(), h.pid)) return { ok: false, error: `PID ${h.pid} из /api/health не совпадает с server.pid в каталоге данных. Процесс не остановлен.` };
    try { process.kill(h.pid, 'SIGTERM'); } catch (e) { return { ok: false, error: `Не удалось остановить старый сервер v${h.version} (pid ${h.pid}): ${e.message}` }; }
    for (let i = 0; i < 20 && await svc.health(c.port); i++) await new Promise(r => setTimeout(r, 250)); }
  const r = await svc.installAndStart({ ...svcOpts(c), restart: !!(h && h.stale) }); if (h && h.stale && r.method === 'launchd') r.restartedStale = h.version; const ok = await svc.waitHealthy(c.port); const now = ok ? null : await svc.health(c.port);
  return { ok: !!ok, method: r.method, error: ok ? null : now && now.stale ? `На порту ${c.port} всё ещё отвечает сервер v${now.version} (pid ${now.pid}), а не v${svc.EXPECT.version}. Остановите старую версию TEST и повторите.` : 'Сервер не ответил за 20 с — см. журнал ' + path.join(logDir(), 'server.log') }; });
handle('open-panel', () => { const c = cfg(); installTokenHeader(c); win && win.loadURL(panelOrigin(c) + '/'); return true; });
handle('set-cfg', async patch => {
  if (!patch || typeof patch !== 'object') throw new Error('bad args'); const c = cfg();
  if ('autoStartServer' in patch) { if (typeof patch.autoStartServer !== 'boolean') throw new Error('bad args'); c.autoStartServer = patch.autoStartServer; }
  if ('startAtLogin' in patch) { if (typeof patch.startAtLogin !== 'boolean') throw new Error('bad args'); c.startAtLogin = patch.startAtLogin; }
  saveCfg(c); if ('startAtLogin' in patch) return svc.setStartAtLogin(svcOpts(c)); return { ok: true };
});
handle('open-path', which => { if (which !== 'logs' && which !== 'data') throw new Error('bad args'); return shell.openPath(which === 'logs' ? logDir() : dataDir()); });

// Update check: HTTPS GitHub API of the pinned repo only. Never downloads or installs anything.
// Before offering, the release must contain the zip and its .sha256, and the .sha256 must equal GitHub's own asset digest.
const verNum = t => String(t).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkUpdates(manual) {
  if (CFG.IS_TEST) return; // v1.2.4: the TEST flavor never contacts GitHub (no automatic or manual update check)
  const c = cfg(); if (!manual && !c.checkUpdates) return;
  const msg = (o) => dialog.showMessageBox(win || undefined, o);
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers: { accept: 'application/vnd.github+json', 'user-agent': PRODUCT }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);
    const rels = (await r.json()).filter(x => !x.draft && /-mac|^v\d/.test(x.tag_name)).sort((a, b) => newer(a.tag_name, b.tag_name) ? -1 : 1);
    const rel = rels.find(x => newer(x.tag_name, app.getVersion()));
    if (!rel) { if (manual) msg({ message: `Установлена последняя версия (${app.getVersion()})` }); return; }
    const zip = rel.assets.find(a => /arm64-mac\.zip$/.test(a.name)), sum = rel.assets.find(a => zip && a.name === zip.name + '.sha256');
    if (!zip || !sum) { if (manual) msg({ type: 'warning', message: `Версия ${rel.tag_name}: нет архива или файла SHA-256 — обновление не предлагается` }); return; }
    const su = new URL(sum.browser_download_url); if (su.protocol !== 'https:' || su.hostname !== 'github.com') throw new Error('Неожиданный адрес файла');
    const sr = await fetch(su, { signal: AbortSignal.timeout(10000) }); const published = ((await sr.text()).match(/\b[a-f0-9]{64}\b/) || [])[0];
    const gh = String(zip.digest || '').replace(/^sha256:/, '');
    if (!published || (gh && gh !== published)) { msg({ type: 'error', message: 'Обновление отклонено: SHA-256 не совпадает', detail: `Файл .sha256: ${published || 'нет'}\nGitHub digest: ${gh || 'нет'}` }); return; }
    const { response } = await msg({ type: 'info', buttons: ['Открыть страницу релиза', 'Позже'], defaultId: 0, message: `Доступна версия ${rel.tag_name} (у вас ${app.getVersion()})`,
      detail: `SHA-256 архива (сверено с GitHub): ${published}\n${gh ? '' : '(GitHub не вернул digest — проверено только наличие .sha256)\n'}Скачайте архив в браузере, сверьте SHA-256 командой «shasum -a 256 <файл>» и замените приложение. Автоматическая установка не выполняется. Данные сохранятся.` });
    if (response === 0) openExternalSafe(rel.html_url);
  } catch (e) { if (manual) msg({ type: 'warning', message: 'Не удалось проверить обновления', detail: e.message }); }
}

function menu() {
  const c = cfg(); const startup = () => win ? win.loadFile(STARTUP, { hash: 'status' }) : createWindow();
  const tpl = [
    ...(process.platform === 'darwin' ? [{ label: PRODUCT, submenu: [{ role: 'about', label: 'О программе' }, ...(CFG.IS_TEST ? [] : [{ type: 'separator' }, { label: 'Проверить обновления…', click: () => checkUpdates(true) }]), { type: 'separator' }, { role: 'hide', label: 'Скрыть' }, { role: 'hideOthers', label: 'Скрыть остальные' }, { type: 'separator' }, { role: 'quit', label: 'Выйти (сервер продолжит работу)' }] }] : []),
    { label: 'Сервер', submenu: [
      { label: 'Статус компонентов', click: startup },
      { label: 'Запускать сервер при входе в систему', type: 'checkbox', checked: c.startAtLogin, enabled: process.platform === 'darwin', click: async i => { const n = { ...cfg(), startAtLogin: i.checked }; saveCfg(n); const r = await svc.setStartAtLogin(svcOpts(n)); if (r && r.ok === false) dialog.showMessageBox({ type: 'warning', message: 'Не удалось изменить автозапуск', detail: r.out || '' }); } },
      { label: 'Запускать сервер при открытии приложения', type: 'checkbox', checked: c.autoStartServer, click: i => saveCfg({ ...cfg(), autoStartServer: i.checked }) },
      { type: 'separator' },
      { label: 'Остановить фоновый сервер', click: async () => { const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Остановить', 'Отмена'], message: 'Остановить фоновый сервер?', detail: 'Расписания и агенты перестанут работать до следующего запуска.' }); if (response === 0) { await svc.stop(cfg().port, dataDir()); startup(); } } },
      { label: 'Открыть папку данных', click: () => shell.openPath(dataDir()) }, { label: 'Открыть журналы', click: () => shell.openPath(logDir()) }] },
    { label: 'Правка', submenu: [{ role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' }, { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' }, { role: 'selectAll', label: 'Выбрать всё' }] },
    { label: 'Вид', submenu: [{ role: 'reload', label: 'Обновить' }, { role: 'resetZoom', label: 'Фактический размер' }, { role: 'zoomIn', label: 'Увеличить' }, { role: 'zoomOut', label: 'Уменьшить' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Полный экран' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Инструменты разработчика' }])] },
    { label: 'Окно', submenu: [{ role: 'minimize', label: 'Свернуть' }, { role: 'close', label: 'Закрыть окно' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  if (await require('./location-check.js').checkLocation({ app, dialog, product: PRODUCT, flavor: CFG.FLAVOR })) return; // v1.3.1-test: App Translocation → offer moveToApplicationsFolder (relaunches)
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false)); // camera, mic, notifications, geolocation… all denied
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (e, item) => { if (!isPanel(item.getURL())) e.preventDefault(); }); // only panel backups/exports
  app.setAboutPanelOptions({ applicationName: PRODUCT, applicationVersion: app.getVersion(), version: `commit ${String(BUILD.commit).slice(0, 12)}`, copyright: 'MOONKATTY', credits: BUILD.builtAt ? 'Сборка: ' + BUILD.builtAt : 'Сборка из исходников (dev)' });
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')));
  menu(); createWindow(); setTimeout(() => checkUpdates(false), 5000);
});
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); }); // macOS: app stays in Dock; server keeps running either way
// never preventDefault on quit — macOS shutdown is not blocked
