// Identity of the RUNNING app (QA-UC-001). Never a single hardcoded constant: resolved at runtime from, in order,
//  1) the enclosing macOS bundle's Contents/Info.plist (CFBundleIdentifier) — packaged app,
//  2) STUDIO_APP_BUNDLE_ID (set by the launcher / tests),
//  3) the build config of this checkout (package.json build.appId) — dev runs.
// The bundle id is then mapped to a KNOWN profile (prod / test, values from docs/RELEASE_MANIFEST.md @ f2440e1).
// Unknown bundle id or a STUDIO_FLAVOR that contradicts it → identity.known=false → every install is blocked.
'use strict';
const fs = require('fs'), path = require('path');
const PROFILES = {
  prod: { flavor: 'prod', channels: ['preview', 'stable'], bundleId: 'com.moonkatty.aistudio', appName: 'MOONKATTY AI STUDIO', dataDirName: 'MOONKATTY AI STUDIO',
    launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: 'MOONKATTY AI STUDIO', defaultPort: 8787 },
  test: { flavor: 'test', channels: ['test'], bundleId: 'com.moonkatty.aistudio.test', appName: 'MOONKATTY AI STUDIO TEST', dataDirName: 'MOONKATTY AI STUDIO TEST',
    launchdLabel: 'com.moonkatty.aistudio.test.server', keychainServicePrefix: 'MOONKATTY AI STUDIO.test', defaultPort: 8687 },
};
const ID_KEYS = ['bundleId', 'appName', 'dataDirName', 'launchdLabel', 'keychainServicePrefix'];
const profileByBundle = id => Object.values(PROFILES).find(p => p.bundleId === id) || null;
const profileByChannel = ch => Object.values(PROFILES).find(p => p.channels.includes(ch)) || null;
const appPathOf = p => `/Applications/${p.appName}.app`;
function findBundle(start) { let d = path.resolve(start); for (let i = 0; i < 12; i++) { if (/\.app$/.test(d)) return d; const up = path.dirname(d); if (up === d) break; d = up; } return null; }
function plistBundleId(xml) { const m = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(String(xml)); return m ? m[1].trim() : null; }
function resolveIdentity({ env = process.env, startDirs = [__dirname, process.execPath], readFile = f => fs.readFileSync(f, 'utf8'), pkg } = {}) {
  let bundleId = null, source = null, bundlePath = null;
  for (const s of startDirs) { const b = findBundle(s); if (!b) continue; try { const id = plistBundleId(readFile(path.join(b, 'Contents', 'Info.plist'))); if (id) { bundleId = id; source = 'Info.plist'; bundlePath = b; break; } } catch {} }
  if (!bundleId && env.STUDIO_APP_BUNDLE_ID) { bundleId = String(env.STUDIO_APP_BUNDLE_ID); source = 'env:STUDIO_APP_BUNDLE_ID'; }
  if (!bundleId) { try { const p = pkg || require('../../package.json'); if (p.build && p.build.appId) { bundleId = p.build.appId; source = 'package.json build.appId'; } } catch {} }
  const prof = profileByBundle(bundleId); const problems = [];
  if (!bundleId) problems.push('bundle id запущенного приложения не определён');
  else if (!prof) problems.push('неизвестный bundle id: ' + bundleId);
  if (prof && env.STUDIO_FLAVOR && env.STUDIO_FLAVOR !== prof.flavor) problems.push(`STUDIO_FLAVOR=${env.STUDIO_FLAVOR} противоречит bundle id ${bundleId}`);
  if (bundlePath && prof && path.basename(bundlePath) !== prof.appName + '.app') problems.push(`бандл «${path.basename(bundlePath)}» не совпадает с именем профиля «${prof.appName}.app»`);
  const base = prof || { flavor: 'unknown', channels: [], bundleId, appName: null, dataDirName: null, launchdLabel: null, keychainServicePrefix: null, defaultPort: null };
  return { ...base, known: !!prof && !problems.length, source, bundlePath, appPath: prof ? appPathOf(prof) : null, problems, working: true };
}
module.exports = { resolveIdentity, PROFILES, ID_KEYS, profileByBundle, profileByChannel, appPathOf, plistBundleId };
