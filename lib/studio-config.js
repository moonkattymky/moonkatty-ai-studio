// Single source of truth for every name / id / path / label / Keychain service / port that differs between the
// production app and the isolated TEST build (v1.2.2-test). The flavor is fixed at BUILD time: the packager writes
// "studioFlavor": "test" into the bundled package.json (electron-builder extraMetadata). There is no runtime switch in
// packaged apps; STUDIO_FLAVOR is honoured only for plain-Node test runs (NODE_ENV=test, not Electron).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

// v1.2.3-test — fail-closed, integrity-checked flavor. The packager writes THREE consistent markers:
//   lib/flavor.baked.js        module.exports = '<flavor>';            (constant module)
//   lib/flavor.lock.json       {"flavor","bakedSha256"}                 (SHA-256 of flavor.baked.js bytes)
//   package.json               "studioFlavor", "studioFlavorSha256"     (electron-builder extraMetadata)
// (+ desktop/flavor.lock.json inside app.asar, checked by the Electron shell — desktop/flavor-guard.js.)
// If ANY marker exists, ALL must exist and agree, otherwise FLAVOR = null → server.js exits 78. Env vars (STUDIO_FLAVOR,
// NODE_ENV …), settings and CLI arguments are never consulted for a packaged tree. Without any marker, STUDIO_FLAVOR is
// honoured ONLY in a source checkout (scripts/package-mac-on-linux.sh present, not inside an .app, not Electron);
// NODE_ENV is irrelevant. There is NO default flavor.
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
function readFlavor() {
  const bakedF = path.join(__dirname, 'flavor.baked.js'), lockF = path.join(__dirname, 'flavor.lock.json'), pkgF = path.join(ROOT, 'package.json');
  let pkg = {}; try { pkg = JSON.parse(fs.readFileSync(pkgF, 'utf8')); } catch {}
  const has = { baked: fs.existsSync(bakedF), lock: fs.existsSync(lockF), pkg: 'studioFlavor' in pkg || 'studioFlavorSha256' in pkg };
  if (has.baked || has.lock || has.pkg) {
    if (!has.baked || !has.lock || !has.pkg) return { flavor: null, source: 'markers-missing:' + Object.keys(has).filter(k => !has[k]).join(',') };
    let baked, lock, sha; try { const buf = fs.readFileSync(bakedF); sha = crypto.createHash('sha256').update(buf).digest('hex');
      const m = /^'use strict';\n(?:\/\/[^\n]*\n)*module\.exports = '(test|prod)';\n$/.exec(buf.toString('utf8')); baked = m && m[1];
      lock = JSON.parse(fs.readFileSync(lockF, 'utf8')); } catch { return { flavor: null, source: 'markers-unreadable' }; }
    if (!baked) return { flavor: null, source: 'baked-invalid' };
    if (lock.flavor !== baked || pkg.studioFlavor !== baked) return { flavor: null, source: 'markers-disagree' };
    if (lock.bakedSha256 !== sha || pkg.studioFlavorSha256 !== sha) return { flavor: null, source: 'baked-sha256-mismatch' };
    return { flavor: baked, source: 'baked' };
  }
  const sourceCheckout = !process.versions.electron && fs.existsSync(path.join(ROOT, 'scripts', 'package-mac-on-linux.sh')) && !/\.app[\\/]Contents[\\/]/.test(ROOT);
  if (sourceCheckout && /^(test|prod)$/.test(process.env.STUDIO_FLAVOR || '')) return { flavor: process.env.STUDIO_FLAVOR, source: 'env(source-checkout)' };
  return { flavor: null, source: 'none' };
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
  nodesPort: 8790, nodeIdSuffix: '',            // Node API (TLS) of the coordinator — contract default
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
  nodesPort: 8690, nodeIdSuffix: '-test',       // Node API (TLS); node ids end with -test → node Keychain service moonkatty-node-<id>-test
  opencodeUrl: 'http://127.0.0.1:4097',         // its own `opencode serve` with its own (test) password
  autoStartServer: false, checkUpdates: false,  // test build never autostarts / never offers updates
});
const { flavor: FLAVOR, source: FLAVOR_SOURCE } = readFlavor();
const C = FLAVOR === 'prod' ? PROD : TEST; // unknown flavor → TEST names (never touches prod paths); server.js refuses to start anyway
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
module.exports = { FLAVOR, FLAVOR_SOURCE, readFlavor, IS_TEST: FLAVOR !== 'prod', ...C, PROD, TEST, macDataDir: () => macAppSupport(C.product), macLogDir: () => macLogs(C.product), prodDirs, isProdPath, assertTestPath };
