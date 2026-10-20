// 3D project workspaces: <dataDir>/projects3d/<projectId>/v001, v002 … Every modifying run gets a NEW version folder;
// the previous .blend is copied into the new version as a backup/base, nothing is modified in place.
'use strict';
const fs = require('fs'), path = require('path');
const ID = /^[A-Za-z0-9_-]{1,64}$/;
module.exports = function createWorkspace(dataDir) {
  const root = path.join(dataDir, 'projects3d'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const projDir = id => { if (!ID.test(id)) throw new Error('Недопустимый id проекта'); return path.join(root, id); };
  const versions = id => { const d = projDir(id); return fs.existsSync(d) ? fs.readdirSync(d).filter(x => /^v\d{3}$/.test(x)).sort() : []; };
  function newVersion(id) {
    const d = projDir(id); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); const vs = versions(id); const prev = vs[vs.length - 1];
    const name = 'v' + String((prev ? +prev.slice(1) : 0) + 1).padStart(3, '0'); const vd = path.join(d, name);
    fs.mkdirSync(vd, { mode: 0o700 }); for (const s of ['renders', 'exports', 'logs']) fs.mkdirSync(path.join(vd, s));
    if (prev && fs.existsSync(path.join(d, prev, 'scene.blend'))) { fs.mkdirSync(path.join(vd, 'backup')); fs.copyFileSync(path.join(d, prev, 'scene.blend'), path.join(vd, 'backup', prev + '-scene.blend')); }
    return { version: name, dir: vd, prev: prev || null };
  }
  function manifest(id, patch) { const f = path.join(projDir(id), 'project.json'); const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id, versions: {} };
    if (patch) { Object.assign(cur, patch, { versions: Object.assign(cur.versions || {}, patch.versions || {}) }); fs.writeFileSync(f, JSON.stringify(cur, null, 2)); } return cur; }
  // Resolve a file inside a version folder for download (no traversal, no symlinks out).
  function file(id, version, rel) {
    if (!/^v\d{3}$/.test(version)) return null; const vd = path.join(projDir(id), version); const p = path.resolve(vd, rel);
    if (!p.startsWith(vd + path.sep) || !fs.existsSync(p)) return null; const real = fs.realpathSync(p); return real.startsWith(fs.realpathSync(vd) + path.sep) && fs.statSync(real).isFile() ? real : null;
  }
  function removeVersion(id, version) { if (!/^v\d{3}$/.test(version)) throw new Error('Недопустимая версия'); fs.rmSync(path.join(projDir(id), version), { recursive: true, force: true }); }
  return { root, projDir, versions, newVersion, manifest, file, removeVersion };
};
