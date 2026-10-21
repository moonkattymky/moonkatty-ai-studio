// Single source of truth for every name / id / path / label / Keychain service / port that differs between the
// production app and the isolated TEST build (v1.2.2-test). The flavor is fixed at BUILD time: the packager writes
// "studioFlavor": "test" into the bundled package.json (electron-builder extraMetadata). There is no runtime switch in
// packaged apps; STUDIO_FLAVOR is honoured only for plain-Node test runs (NODE_ENV=test, not Electron).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

function readFlavor() {
  let f = 'prod';
  try { const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')); if (p.studioFlavor === 'test') f = 'test'; } catch {}
  if (process.env.NODE_ENV === 'test' && !process.versions.electron && /^(test|prod)$/.test(process.env.STUDIO_FLAVOR || '')) f = process.env.STUDIO_FLAVOR;
  return f;
}
const PROD = Object.freeze({
  flavor: 'prod',
  product: 'MOONKATTY AI STUDIO',               // app name, window title, userData / Logs folder name
  appId: 'com.moonkatty.aistudio',              // CFBundleIdentifier
  launchdLabel: 'com.moonkatty.aistudio.server',
  keychainService: 'MOONKATTY AI STUDIO',       // every Keychain item (master key, OpenCode password)
  kcAccountMasterKey: 'studio-master-key',
  kcAccountOpencode: 'opencode-server-password',
  defaultPort: 8787,                            // v1.1.2 / v1.2.x production port
  opencodeUrl: 'http://127.0.0.1:4096',
  autoStartServer: true, checkUpdates: true,
});
const TEST = Object.freeze({
  flavor: 'test',
  product: 'MOONKATTY AI STUDIO TEST',
  appId: 'com.moonkatty.aistudio.test',
  launchdLabel: 'com.moonkatty.aistudio.test.server',
  keychainService: 'MOONKATTY AI STUDIO.test',
  kcAccountMasterKey: 'studio-master-key',
  kcAccountOpencode: 'opencode-server-password',
  defaultPort: 8687,                            // loopback only; never 8787, so it runs side by side with v1.1.2
  opencodeUrl: 'http://127.0.0.1:4097',         // its own `opencode serve` with its own (test) password
  autoStartServer: false, checkUpdates: false,  // test build never autostarts / never offers updates
});
const FLAVOR = readFlavor();
const C = FLAVOR === 'test' ? TEST : PROD;
const home = () => os.homedir();
const macAppSupport = name => path.join(home(), 'Library', 'Application Support', name);
const macLogs = name => path.join(home(), 'Library', 'Logs', name);
// Directories that belong to the PRODUCTION install and must never be opened by the test build.
const prodDirs = () => [macAppSupport(PROD.product), macLogs(PROD.product), path.join(home(), 'Library', 'LaunchAgents', PROD.launchdLabel + '.plist')];
const real = p => { let cur = path.resolve(p), rest = []; for (;;) { try { return path.join(fs.realpathSync(cur), ...rest); } catch { const up = path.dirname(cur); if (up === cur) return path.join(cur, ...rest); rest.unshift(path.basename(cur)); cur = up; } } };
const under = (p, dir) => { const a = real(p), b = real(dir); const ci = x => process.platform === 'darwin' ? x.toLowerCase() : x; return ci(a) === ci(b) || ci(a).startsWith(ci(b) + path.sep); };
function isProdPath(p) { return prodDirs().some(d => under(p, d) || under(path.resolve(p), d)); }
// Startup guard: the test build refuses to touch any production path (symlinks resolved, case-insensitive on macOS).
function assertTestPath(p, what = 'path') {
  if (FLAVOR !== 'test' || !p) return p;
  if (isProdPath(p)) { const e = new Error(`[${C.product}] ОТКАЗ: ${what} «${p}» находится в данных production-версии (${PROD.product}). Тестовая сборка не открывает production-данные.`); e.code = 'PROD_PATH_REFUSED'; throw e; }
  return p;
}
module.exports = { FLAVOR, IS_TEST: FLAVOR === 'test', ...C, PROD, TEST, macDataDir: () => macAppSupport(C.product), macLogDir: () => macLogs(C.product), prodDirs, isProdPath, assertTestPath };
