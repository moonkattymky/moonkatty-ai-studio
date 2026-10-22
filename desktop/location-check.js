'use strict';
// v1.3.1-test: App Translocation / location check (macOS). Standard Electron API only:
// app.isInApplicationsFolder() + app.moveToApplicationsFolder(). No xattr, no quarantine removal, no Gatekeeper changes.
const path = require('path'), os = require('os');
function classify(exePath, { home = os.homedir(), inAppsApi = null } = {}) {
  const p = String(exePath || '');
  if (p.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' };
  const appsDirs = ['/Applications/', path.join(home, 'Applications') + '/'];
  if (inAppsApi === true || appsDirs.some(d => p.startsWith(d))) return { ok: true, reason: 'applications' };
  return { ok: false, reason: 'outside' };
}
const TEXT = {
  translocated: 'macOS запустил приложение из временной изолированной копии (App Translocation), потому что оно открыто прямо из папки загрузок или архива. В таком режиме обновление, запуск при входе и доступ к данным могут работать неправильно.',
  outside: 'Приложение запущено не из папки «Программы» (/Applications или ~/Applications).',
};
// Returns true if the app is being moved/relaunched (caller must stop startup).
async function checkLocation({ app, dialog, product, platform = process.platform }) {
  if (platform !== 'darwin' || !app.isPackaged) return false;
  let inApps = null; try { inApps = app.isInApplicationsFolder(); } catch {}
  const c = classify(app.getPath('exe'), { inAppsApi: inApps });
  if (c.ok) return false;
  const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Переместить в «Программы»', 'Продолжить без перемещения'], defaultId: 0, cancelId: 1,
    title: product, message: 'Переместить приложение в папку «Программы»?',
    detail: TEXT[c.reason] + '\n\nРекомендуется переместить приложение в «Программы»: оно будет перезапущено оттуда. Ваши данные и настройки не изменятся. Если там уже есть старая версия этой тестовой сборки, macOS спросит о её замене.' });
  if (response !== 0) return false;
  try { return app.moveToApplicationsFolder({ conflictHandler: () => true }); }
  catch (e) { await dialog.showMessageBox({ type: 'error', title: product, message: 'Не удалось переместить приложение', detail: String(e.message || e) + '\n\nПеретащите приложение в «Программы» в Finder и запустите его оттуда.' }); return false; }
}
module.exports = { classify, checkLocation, TEXT };
