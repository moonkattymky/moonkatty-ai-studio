// 3D project workspaces: <dataDir>/projects3d/<projectId>/v001, v002 … Every modifying run gets a NEW version folder;
// the previous .blend is copied into the new version as a backup/base, nothing is modified in place.
'use strict';
const fs = require('fs'), path = require('path');
const ID = /^[A-Za-z0-9_-]{1,64}$/;
function secureDir(p) {
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(p, 0o700); } catch (e) { throw new Error('Не удалось выставить права 0700 на папку проекта (' + (e.code || 'ошибка') + ')'); }
  try { fs.accessSync(p, fs.constants.W_OK | fs.constants.X_OK); }
  catch { throw new Error('Нет права записи в папку проекта. Нужны права владельца (0700).'); }
}
module.exports = function createWorkspace(dataDir) {
  const root = path.join(dataDir, 'projects3d'); fs.mkdirSync(root, { recursive: true, mode: 0o700 }); try { fs.chmodSync(root, 0o700); } catch {}
  const projDir = id => { if (!ID.test(id)) throw new Error('Недопустимый id проекта'); return path.join(root, id); };
  const versions = id => { const d = projDir(id); return fs.existsSync(d) ? fs.readdirSync(d).filter(x => /^v\d{3}$/.test(x)).sort() : []; };
  function newVersion(id) {
    const d = projDir(id); secureDir(d); const vs = versions(id); const prev = vs[vs.length - 1];
    const name = 'v' + String((prev ? +prev.slice(1) : 0) + 1).padStart(3, '0'); const vd = path.join(d, name);
    secureDir(vd); for (const s of ['renders', 'exports', 'logs']) secureDir(path.join(vd, s));
    if (prev && fs.existsSync(path.join(d, prev, 'scene.blend'))) { secureDir(path.join(vd, 'backup')); fs.copyFileSync(path.join(d, prev, 'scene.blend'), path.join(vd, 'backup', prev + '-scene.blend')); }
    return { version: name, dir: vd, prev: prev || null };
  }
  function manifest(id, patch) { const f = path.join(projDir(id), 'project.json'); const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id, versions: {} };
    if (patch) { Object.assign(cur, patch, { versions: Object.assign(cur.versions || {}, patch.versions || {}) }); fs.writeFileSync(f, JSON.stringify(cur, null, 2)); } return cur; }
  // Resolve a file inside a version folder for download (no traversal, no symlinks out).
  function file(id, version, rel) {
    if (!/^v\d{3}$/.test(version)) return null; const vd = path.join(projDir(id), version); const p = path.resolve(vd, rel);
    if (!p.startsWith(vd + path.sep) || !fs.existsSync(p)) return null; const real = fs.realpathSync(p); return real.startsWith(fs.realpathSync(vd) + path.sep) && fs.statSync(real).isFile() ? real : null;
  }
  // Deletion keeps a backup: the version folder is moved to <project>/_trash/<version>-<timestamp>/ (never rm -rf of live data).
  function removeVersion(id, version) { if (!/^v\d{3}$/.test(version)) throw new Error('Недопустимая версия'); const src = path.join(projDir(id), version); if (!fs.existsSync(src)) throw new Error('Версия не найдена');
    const trash = path.join(projDir(id), '_trash'); fs.mkdirSync(trash, { recursive: true, mode: 0o700 }); const dst = path.join(trash, version + '-' + new Date().toISOString().replace(/[:.]/g, '-')); fs.renameSync(src, dst); return dst; }
  const IMG = [['png', 'image/png', b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a], ['jpg', 'image/jpeg', b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
    ['webp', 'image/webp', b => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP']];
  const REF_MAX = 15 * 1024 * 1024, REF_COUNT = 20;
  // Reference images: type by magic bytes (not by name/Content-Type), size limit, stored as <sha256>.<ext> — the client name is metadata only.
  function addReference(id, buf, origName) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw Object.assign(new Error('Пустой файл'), { status: 400 });
    if (buf.length > REF_MAX) throw Object.assign(new Error('Файл больше 15 МБ'), { status: 413 });
    const t = IMG.find(x => x[2](buf)); if (!t) throw Object.assign(new Error('Разрешены только изображения PNG, JPEG, WEBP'), { status: 415 });
    const sha = require('crypto').createHash('sha256').update(buf).digest('hex'); const d = path.join(projDir(id), 'references'); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    const m = manifest(id); const refs = m.references || []; const ex = refs.find(r => r.sha256 === sha); if (ex) return { ...ex, duplicate: true };
    if (refs.length >= REF_COUNT) throw Object.assign(new Error('Не больше ' + REF_COUNT + ' референсов на проект'), { status: 400 });
    const file = sha + '.' + t[0]; fs.writeFileSync(path.join(d, file), buf, { mode: 0o600 });
    const name = String(origName || 'reference').replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '').slice(0, 100) || 'reference';
    const ref = { sha256: sha, file, name, size: buf.length, mime: t[1], at: new Date().toISOString() }; manifest(id, { references: [...refs, ref] }); return ref;
  }
  function refFile(id, sha) { if (!/^[0-9a-f]{64}$/.test(sha)) return null; const r = (manifest(id).references || []).find(x => x.sha256 === sha); if (!r) return null; const p = path.join(projDir(id), 'references', r.file); return fs.existsSync(p) ? { path: p, mime: r.mime } : null; }
  function exists(id) { try { return fs.existsSync(projDir(id)); } catch { return false; } }
  function list() { return fs.readdirSync(root).filter(x => ID.test(x)).map(x => { const m = manifest(x); return { id: x, title: m.title || x, versions: versions(x).length, references: (m.references || []).length, updatedAt: fs.statSync(path.join(root, x)).mtime.toISOString() }; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  function versionInfo(id, v) { const vd = path.join(projDir(id), v); const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(vd, f), 'utf8')); } catch { return null; } };
    const files = ['scene.blend', 'renders/preview.png', 'exports/scene.glb', 'exports/scene.fbx'].filter(f => fs.existsSync(path.join(vd, f))).map(f => ({ name: f, size: fs.statSync(path.join(vd, f)).size }));
    const anim = fs.existsSync(path.join(vd, 'renders/anim')) ? fs.readdirSync(path.join(vd, 'renders/anim')).length : 0;
    return { version: v, files, animFrames: anim, params: rd('logs/params.validated.json'), backup: fs.existsSync(path.join(vd, 'backup')) ? fs.readdirSync(path.join(vd, 'backup')) : [], ...(manifest(id).versions?.[v] || {}) }; }
  return { root, projDir, versions, newVersion, manifest, file, removeVersion, addReference, refFile, exists, list, versionInfo, REF_MAX };
};
