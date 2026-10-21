// v1.2.3-test: Electron-side flavor integrity check. This file and desktop/flavor.lock.json are packed INSIDE app.asar
// (covered by Electron's ASAR integrity fuse), while server.js / lib/ run from app.asar.unpacked. Before the shell starts
// or installs the server, it verifies that the unpacked markers still match the lock sealed into the asar.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
function check(unpackedRoot, lockFile = path.join(__dirname, 'flavor.lock.json')) {
  let lock; try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { return { ok: false, reason: 'asar lock missing' }; }
  if (!/^(test|prod)$/.test(lock.flavor) || !/^[a-f0-9]{64}$/.test(lock.bakedSha256 || '')) return { ok: false, reason: 'asar lock invalid' };
  const rd = f => { try { return fs.readFileSync(path.join(unpackedRoot, f)); } catch { return null; } };
  const baked = rd('lib/flavor.baked.js'), ulock = rd('lib/flavor.lock.json'), pkg = rd('package.json');
  if (!baked || !ulock || !pkg) return { ok: false, reason: 'unpacked markers missing' };
  const sha = crypto.createHash('sha256').update(baked).digest('hex'); let u, p; try { u = JSON.parse(ulock); p = JSON.parse(pkg); } catch { return { ok: false, reason: 'unpacked markers unreadable' }; }
  if (sha !== lock.bakedSha256 || u.bakedSha256 !== lock.bakedSha256 || u.flavor !== lock.flavor || p.studioFlavor !== lock.flavor || p.studioFlavorSha256 !== lock.bakedSha256) return { ok: false, reason: 'unpacked markers do not match asar lock' };
  if (lock.flavor === 'test' && fs.existsSync(path.join(unpackedRoot, 'meta.js'))) return { ok: false, reason: 'publisher module present in TEST build' };
  return { ok: true, flavor: lock.flavor };
}
module.exports = { check };
