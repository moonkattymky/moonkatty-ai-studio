// MOONKATTY AI STUDIO — desktop shell (Electron). The window only shows the panel served by the LOCAL server
// (http://127.0.0.1:<port>); it never loads GitHub Pages. The server runs as a separate background process.
'use strict';
const { app, BrowserWindow, Menu, shell, dialog, session, ipcMain, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');
const svc = require('./service.js');
const PRODUCT = 'MOONKATTY AI STUDIO';
app.setName(PRODUCT);
app.commandLine.appendSwitch('lang', 'ru');
if (process.env.STUDIO_USER_DATA) app.setPath('userData', process.env.STUDIO_USER_DATA); // tests
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const dataDir = () => app.getPath('userData');
const logDir = () => process.platform === 'darwin' ? path.join(app.getPath('home'), 'Library', 'Logs', PRODUCT) : path.join(dataDir(), 'logs');
const cfgFile = () => path.join(dataDir(), 'desktop.json');
const DEF = { port: 8787, autoStartServer: true, startAtLogin: false, checkUpdates: true, repo: 'moonkattymky/moonkatty-ai-studio' };
const cfg = () => { try { return { ...DEF, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; } catch { return { ...DEF }; } };
const saveCfg = c => { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); };
const svcOpts = c => ({ execPath: process.execPath, serverJs: path.join(ROOT, 'server.js'), dataDir: dataDir(), port: c.port, startAtLogin: c.startAtLogin, logDir: logDir() });
const panelUrl = c => `http://127.0.0.1:${c.port}/`;
let win = null;

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 640, title: PRODUCT, backgroundColor: '#0b0f1a', show: false,
    icon: path.join(ROOT, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url) && !url.startsWith(panelUrl(cfg()))) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(panelUrl(cfg())) && !url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; }); // closing the window never stops the background server
  win.loadFile(path.join(__dirname, 'startup.html'));
}

// Local app token: injected only into requests to our loopback server.
function installTokenHeader(c) {
  const f = path.join(dataDir(), 'app-token');
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${c.port}/*`] }, (d, cb) => {
    let tok = null; try { tok = fs.readFileSync(f, 'utf8').trim(); } catch {}
    if (tok) d.requestHeaders['X-Studio-App-Token'] = tok; cb({ requestHeaders: d.requestHeaders });
  });
}

async function ollama() {
  try { const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) }); if (!r.ok) return { ok: false, detail: 'HTTP ' + r.status };
    const m = ((await r.json()).models || []).map(x => x.name); return { ok: m.some(n => n.startsWith('qwen3:8b')), detail: m.length ? 'Модели: ' + m.join(', ') + (m.some(n => n.startsWith('qwen3:8b')) ? '' : ' — нет qwen3:8b (ollama pull qwen3:8b)') : 'Нет моделей (ollama pull qwen3:8b)' };
  } catch (e) { return { ok: false, detail: 'Не запущена (' + (e.cause?.code || e.message) + '). Агенты, которым нужен LLM, будут ставить задачи в «Заблокировано».' }; }
}
async function status() {
  const c = cfg(); const h = await svc.health(c.port);
  return { port: c.port, cfg: c, version: app.getVersion(), platform: process.platform + '/' + process.arch,
    server: h ? (h.foreign ? { ok: false, detail: `Порт ${c.port} занят другим приложением` } : { ok: true, detail: `pid ${h.pid}, работает ${h.uptimeSec} с, v${h.version}` }) : { ok: false, detail: 'Не запущен' },
    db: h && !h.foreign ? { ok: h.db === 'ok', detail: `${h.dbDriver}, ${path.join(dataDir(), 'studio.db')}` } : { ok: false, detail: 'Нет данных — сервер не запущен' },
    keys: h && h.keySource ? { ok: true, detail: h.keySource === 'keychain' ? 'macOS Keychain' : h.keySource } : null,
    ollama: await ollama(), launchd: await svc.launchdStatus(), dataDir: dataDir(), logDir: logDir() };
}
ipcMain.handle('status', () => status());
ipcMain.handle('start-server', async () => { const c = cfg(); const h = await svc.health(c.port); if (h && !h.foreign) return { ok: true, already: true };
  if (h && h.foreign) return { ok: false, error: `Порт ${c.port} занят другим приложением` };
  const r = await svc.installAndStart(svcOpts(c)); const ok = await svc.waitHealthy(c.port); return { ok: !!ok, method: r.method, error: ok ? null : 'Сервер не ответил за 20 с — см. журнал ' + path.join(logDir(), 'server.log') }; });
ipcMain.handle('open-panel', () => { const c = cfg(); installTokenHeader(c); win && win.loadURL(panelUrl(c)); return true; });
ipcMain.handle('set-cfg', async (e, patch) => { const c = { ...cfg(), ...patch }; saveCfg(c); if ('startAtLogin' in patch) return svc.setStartAtLogin(svcOpts(c)); return { ok: true }; });
ipcMain.handle('open-path', (e, which) => shell.openPath(which === 'logs' ? logDir() : dataDir()));

async function checkUpdates(manual) {
  const c = cfg(); if (!manual && !c.checkUpdates) return;
  try { const r = await fetch(`https://api.github.com/repos/${c.repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
    if (r.status === 404) { if (manual) dialog.showMessageBox({ message: 'Опубликованных версий пока нет' }); return; }
    const j = await r.json(); const latest = String(j.tag_name || '').replace(/^v/, ''); const cur = app.getVersion();
    const newer = latest.split('.').map(Number).reduce((acc, n, i) => acc !== 0 ? acc : Math.sign(n - (cur.split('.').map(Number)[i] || 0)), 0) > 0;
    if (!newer) { if (manual) dialog.showMessageBox({ message: `Установлена последняя версия (${cur})` }); return; }
    const { response } = await dialog.showMessageBox({ type: 'info', buttons: ['Открыть страницу загрузки', 'Позже'], defaultId: 0, message: `Доступна версия ${latest} (у вас ${cur})`, detail: 'Скачайте архив, закройте приложение и замените его в «Программах». Данные в «Application Support» сохранятся.' });
    if (response === 0) shell.openExternal(j.html_url);
  } catch (e) { if (manual) dialog.showMessageBox({ type: 'warning', message: 'Не удалось проверить обновления', detail: e.message }); }
}

function menu() {
  const c = cfg();
  const tpl = [
    ...(process.platform === 'darwin' ? [{ label: PRODUCT, submenu: [{ role: 'about', label: 'О программе' }, { type: 'separator' }, { label: 'Проверить обновления…', click: () => checkUpdates(true) }, { type: 'separator' }, { role: 'hide', label: 'Скрыть' }, { role: 'hideOthers', label: 'Скрыть остальные' }, { type: 'separator' }, { role: 'quit', label: 'Выйти (сервер продолжит работу)' }] }] : []),
    { label: 'Сервер', submenu: [
      { label: 'Статус компонентов', click: () => win ? win.loadFile(path.join(__dirname, 'startup.html'), { hash: 'status' }) : createWindow() },
      { label: 'Запускать сервер при входе в систему', type: 'checkbox', checked: c.startAtLogin, enabled: process.platform === 'darwin', click: async i => { saveCfg({ ...cfg(), startAtLogin: i.checked }); const r = await svc.setStartAtLogin(svcOpts(cfg())); if (r && r.ok === false) dialog.showMessageBox({ type: 'warning', message: 'Не удалось изменить автозапуск', detail: r.out || '' }); } },
      { label: 'Запускать сервер при открытии приложения', type: 'checkbox', checked: c.autoStartServer, click: i => saveCfg({ ...cfg(), autoStartServer: i.checked }) },
      { type: 'separator' },
      { label: 'Остановить фоновый сервер', click: async () => { const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Остановить', 'Отмена'], message: 'Остановить фоновый сервер?', detail: 'Расписания и агенты перестанут работать до следующего запуска.' }); if (response === 0) { await svc.stop(cfg().port); win && win.loadFile(path.join(__dirname, 'startup.html')); } } },
      { label: 'Открыть папку данных', click: () => shell.openPath(dataDir()) }, { label: 'Открыть журналы', click: () => shell.openPath(logDir()) }] },
    { label: 'Правка', submenu: [{ role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' }, { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' }, { role: 'selectAll', label: 'Выбрать всё' }] },
    { label: 'Вид', submenu: [{ role: 'reload', label: 'Обновить' }, { role: 'resetZoom', label: 'Фактический размер' }, { role: 'zoomIn', label: 'Увеличить' }, { role: 'zoomOut', label: 'Уменьшить' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Полный экран' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' }] },
    { label: 'Окно', submenu: [{ role: 'minimize', label: 'Свернуть' }, { role: 'close', label: 'Закрыть окно' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')));
  menu(); createWindow(); setTimeout(() => checkUpdates(false), 5000);
});
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); }); // macOS: app stays in Dock; server keeps running either way
// never preventDefault — macOS shutdown is not blocked
