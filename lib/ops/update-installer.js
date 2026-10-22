// E2E-UC: installers for Update Center executeInstall(). One interface: stage → verifyStaged → swap → restart → health → rollback.
//  - createMacInstaller: real macOS steps (ditto, codesign --verify --strict, spctl --assess, mv current → -previous, launchctl).
//    Gatekeeper/quarantine are never bypassed; a staged bundle that spctl rejects is refused (ad-hoc builds → BLOCKED, see audit).
//    Electron relaunch of the replaced bundle needs a detached helper — not implemented here (BLOCKED until Studio 4 QA on a Mac).
//  - createDirInstaller: the same flow on a plain directory "bundle" (pure-Node unzip); used by the loopback e2e tests on Linux.
//    Never touches /Applications: every target is resolved under `root`.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const err = (code, msg) => Object.assign(new Error(msg), { code });
// minimal zip extractor (stored/deflate, central directory); names are re-checked even though inspectZip already ran
function extractZip(file, dest) {
  const b = fs.readFileSync(file); let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw err('BAD_ARCHIVE', 'нет EOCD'); const count = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const root = path.resolve(dest); let n = 0;
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw err('BAD_ARCHIVE', 'central directory повреждён');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), attr = b.readUInt32LE(p + 38), lho = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    const out = path.resolve(root, name); if (out !== root && !out.startsWith(root + path.sep)) throw err('BAD_ARCHIVE', 'опасный путь: ' + name);
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const ln = b.readUInt16LE(lho + 26), lx = b.readUInt16LE(lho + 28), start = lho + 30 + ln + lx; const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : (() => { throw err('BAD_ARCHIVE', 'метод сжатия ' + method); })();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (((attr >>> 16) & 0o170000) === 0o120000) fs.symlinkSync(data.toString('utf8'), out); else fs.writeFileSync(out, data, { mode: 0o644 }); n++;
  }
  return n;
}
function createDirInstaller({ root, stagingDir, restart = async () => {}, health, verify = async () => {} }) {
  const R = path.resolve(root); const at = t => { const x = path.resolve(R, '.' + path.resolve('/', t)); if (!x.startsWith(R + path.sep)) throw err('BAD_TARGET', 'цель вне root'); return x; };
  return { kind: 'dir',
    async stage(file, { tag, appName }) { const d = path.join(stagingDir, String(tag).replace(/[^A-Za-z0-9._-]/g, '_')); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); extractZip(file, d);
      const app = path.join(d, appName + '.app'); if (!fs.existsSync(app)) throw err('BAD_ARCHIVE', 'в архиве нет ' + appName + '.app'); return app; },
    async verifyStaged(app, ctx) { await verify(app, ctx); },
    async swap(staged, target) { const t = at(target), prev = t.replace(/\.app$/, '-previous.app'); fs.rmSync(prev, { recursive: true, force: true }); if (fs.existsSync(t)) fs.renameSync(t, prev); fs.renameSync(staged, t); return { target: t, prev }; },
    async rollback(sw) { if (!sw || !fs.existsSync(sw.prev)) throw err('NO_PREVIOUS', 'нет сохранённой предыдущей версии'); const failed = sw.target.replace(/\.app$/, `-failed-${Date.now()}.app`); if (fs.existsSync(sw.target)) fs.renameSync(sw.target, failed); fs.renameSync(sw.prev, sw.target); return { failed }; },
    restart: ({ target }) => restart(at(target)), health: o => health(o) };
}
function createMacInstaller({ exec, stagingDir, identity, healthCheck, uid = process.getuid(), home = process.env.HOME }) {
  const label = identity.launchdLabel, plist = `${home}/Library/LaunchAgents/${label}.plist`;
  return { kind: 'macos',
    async stage(file, { tag, appName }) { const d = path.join(stagingDir, String(tag).replace(/[^A-Za-z0-9._-]/g, '_')); if (fs.existsSync(d)) throw err('STAGE_EXISTS', 'папка staging уже существует — проверьте вручную');
      await exec('/usr/bin/ditto', ['-x', '-k', file, d], 300000); return path.join(d, appName + '.app'); },
    async verifyStaged(app, { manifest }) { await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], 300000);
      const info = String(await exec('/usr/bin/codesign', ['-dv', '--verbose=4', app], 60000).catch(e => String(e.message)));
      if (!new RegExp('Identifier=' + manifest.bundleId.replace(/\./g, '\\.') + '(\\s|$)').test(info)) throw err('BUNDLE_ID', 'codesign Identifier не совпадает с подписанным manifest');
      await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', app], 120000); /* Gatekeeper decides; never bypassed */ },
    async swap(staged, target) { const prev = target.replace(/\.app$/, '-previous.app'); await exec('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], 60000).catch(() => {});
      if (fs.existsSync(prev)) throw err('PREVIOUS_EXISTS', `${prev} уже существует — проверьте вручную`); await exec('/bin/mv', [target, prev], 120000); await exec('/bin/mv', [staged, target], 120000); return { target, prev }; },
    async rollback(sw) { const failed = sw.target.replace(/\.app$/, `-failed-${Date.now()}.app`); await exec('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], 60000).catch(() => {}); await exec('/bin/mv', [sw.target, failed], 120000); await exec('/bin/mv', [sw.prev, sw.target], 120000); return { failed }; },
    async restart() { await exec('/bin/launchctl', ['bootstrap', `gui/${uid}`, plist], 60000); },
    health: o => healthCheck({ ...o, tries: 15 }) };
}
module.exports = { extractZip, createDirInstaller, createMacInstaller };
