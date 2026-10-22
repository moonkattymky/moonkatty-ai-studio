'use strict';
// v1.3.1-test: App Translocation / location check (macOS), TEST flavor only. Standard Electron API only:
// app.isInApplicationsFolder() + app.moveToApplicationsFolder(). No xattr, no quarantine removal, no Gatekeeper changes.
// QA-131-001: never runs in prod; an existing app at the destination is replaced only after an explicit second
// confirmation (default: cancel) and only if its Info.plist is readable and its bundle id is the TEST bundle id.
const path = require('path'), os = require('os'), fs = require('fs');
const TEST_BUNDLE_ID = 'com.moonkatty.aistudio.test';
function classify(exePath, { home = os.homedir(), inAppsApi = null } = {}) {
  const p = String(exePath || '');
  if (p.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' };
  const appsDirs = ['/Applications/', path.join(home, 'Applications') + '/'];
  if (inAppsApi === true || appsDirs.some(d => p.startsWith(d))) return { ok: true, reason: 'applications' };
  return { ok: false, reason: 'outside' };
}
// <X>.app/Contents/MacOS/<bin> → <X>.app
function bundleOf(exePath) { const m = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(String(exePath || '')); return m ? m[1] : null; }
// Reads CFBundleIdentifier from an XML Info.plist. Returns null if unreadable/binary/missing (caller refuses).
function readBundleId(appPath, { readFile = fs.readFileSync } = {}) {
  let s; try { s = String(readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8')); } catch { return null; }
  const m = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<\s]+)\s*<\/string>/.exec(s); return m ? m[1] : null;
}
// Synchronous conflict decision for app.moveToApplicationsFolder({ conflictHandler }).
function makeConflictHandler({ dest, dialog, product, readFile }) {
  return conflictType => {
    const id = readBundleId(dest, { readFile });
    if (id !== TEST_BUNDLE_ID) {
      dialog.showMessageBoxSync({ type: 'error', buttons: ['OK'], title: product, message: 'Перемещение отменено',
        detail: `В «Программах» уже есть приложение с таким именем:\n${dest}\n\n` + (id ? `Его идентификатор «${id}» — это не тестовая сборка (${TEST_BUNDLE_ID}).` : 'Не удалось прочитать его Info.plist и убедиться, что это тестовая сборка.') + '\nЗаменять его нельзя. Перенесите приложение вручную в Finder.' });
      return false;
    }
    const r = dialog.showMessageBoxSync({ type: 'warning', buttons: ['Отмена', 'Заменить'], defaultId: 0, cancelId: 0, title: product,
      message: 'Заменить существующую тестовую сборку?',
      detail: `В «Программах» уже есть:\n${dest}\n(${TEST_BUNDLE_ID}${conflictType === 'existsAndRunning' ? ', сейчас запущено — будет закрыто' : ''}).\n\nОна будет заменена этой версией. Данные и настройки тестовой сборки не удаляются.` });
    return r === 1;
  };
}
const TEXT = {
  translocated: 'macOS запустил приложение из временной изолированной копии (App Translocation), потому что оно открыто прямо из папки загрузок или архива. В таком режиме обновление, запуск при входе и доступ к данным могут работать неправильно.',
  outside: 'Приложение запущено не из папки «Программы» (/Applications или ~/Applications).',
};
// Returns true if the app is being moved/relaunched (caller must stop startup).
async function checkLocation({ app, dialog, product, flavor, platform = process.platform, readFile }) {
  if (flavor !== 'test') return false; // QA-131-001 (1): never in prod
  if (platform !== 'darwin' || !app.isPackaged) return false;
  let inApps = null; try { inApps = app.isInApplicationsFolder(); } catch {}
  const exe = app.getPath('exe'); const c = classify(exe, { inAppsApi: inApps });
  if (c.ok) return false;
  const bundle = bundleOf(exe); const dest = path.join('/Applications', bundle ? path.basename(bundle) : product + '.app');
  const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Переместить в «Программы»', 'Продолжить без перемещения'], defaultId: 0, cancelId: 1,
    title: product, message: 'Переместить приложение в папку «Программы»?',
    detail: TEXT[c.reason] + `\n\nПриложение будет перемещено в ${dest} и перезапущено оттуда. Данные и настройки не изменятся. Если там уже есть приложение с таким именем, перед заменой будет отдельный вопрос.` });
  if (response !== 0) return false;
  try { return app.moveToApplicationsFolder({ conflictHandler: makeConflictHandler({ dest, dialog, product, readFile }) }); }
  catch (e) { await dialog.showMessageBox({ type: 'error', title: product, message: 'Не удалось переместить приложение', detail: String(e.message || e) + '\n\nПеретащите приложение в «Программы» в Finder и запустите его оттуда.' }); return false; }
}
module.exports = { classify, checkLocation, bundleOf, readBundleId, makeConflictHandler, TEXT, TEST_BUNDLE_ID };
