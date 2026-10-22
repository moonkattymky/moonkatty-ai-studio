// v1.3.1-test: App Translocation check — pure logic + dialog flow with fakes (no Electron needed).
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const L = require('../desktop/location-check.js'); let pass = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { failed.push(n); console.log('FAIL ' + n); } };
const H = '/Users/igor';
ok('translocated path', L.classify('/private/var/folders/x/T/AppTranslocation/ABC/d/MOONKATTY AI STUDIO TEST.app/Contents/MacOS/MOONKATTY AI STUDIO TEST', { home: H }).reason === 'translocated');
ok('translocated wins over API true', L.classify('/private/var/AppTranslocation/x/a.app/Contents/MacOS/a', { home: H, inAppsApi: true }).reason === 'translocated');
ok('/Applications ok', L.classify('/Applications/MOONKATTY AI STUDIO TEST.app/Contents/MacOS/x', { home: H }).ok);
ok('~/Applications ok', L.classify(H + '/Applications/MOONKATTY AI STUDIO TEST.app/Contents/MacOS/x', { home: H }).ok);
ok('Downloads outside', L.classify(H + '/Downloads/MOONKATTY AI STUDIO TEST.app/Contents/MacOS/x', { home: H }).reason === 'outside');
ok('/ApplicationsX not matched', !L.classify('/ApplicationsX/a.app/Contents/MacOS/a', { home: H }).ok);
const fake = (exe, resp, inApps = false) => { const calls = { moved: 0, dialogs: [] };
  return { calls, app: { isPackaged: true, getPath: () => exe, isInApplicationsFolder: () => inApps, moveToApplicationsFolder: o => { calls.moved++; calls.opts = o; return true; } },
    dialog: { showMessageBox: async o => { calls.dialogs.push(o); return { response: resp }; } } }; };
let f = fake('/private/var/AppTranslocation/x/a.app/Contents/MacOS/a', 0);
ok('move accepted → moveToApplicationsFolder, returns true', await L.checkLocation({ ...f, product: 'T', platform: 'darwin' }) === true && f.calls.moved === 1 && /Программы/.test(f.calls.dialogs[0].message));
f = fake(H + '/Downloads/a.app/Contents/MacOS/a', 1);
ok('declined → continue, no move', await L.checkLocation({ ...f, product: 'T', platform: 'darwin' }) === false && f.calls.moved === 0 && f.calls.dialogs.length === 1);
f = fake('/Applications/a.app/Contents/MacOS/a', 0, true);
ok('in /Applications → no dialog', await L.checkLocation({ ...f, product: 'T', platform: 'darwin' }) === false && f.calls.dialogs.length === 0);
f = fake('/x/AppTranslocation/a', 0); f.app.isPackaged = false;
ok('dev run → no dialog', await L.checkLocation({ ...f, product: 'T', platform: 'darwin' }) === false && f.calls.dialogs.length === 0);
f = fake('/x/AppTranslocation/a', 0);
ok('non-darwin → no dialog', await L.checkLocation({ ...f, product: 'T', platform: 'linux' }) === false && f.calls.dialogs.length === 0);
const src = require('fs').readFileSync(new URL('../desktop/location-check.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/mg, '');
ok('no xattr/quarantine/spctl in code', !/xattr|quarantine|spctl|child_process/.test(src));
console.log(JSON.stringify({ passed: pass, failed })); process.exit(failed.length ? 1 : 0);
