// Update Center (STUDIO_OPS_UPDATE=1). SAFE update flow for the macOS app, built on update.js (schema/origin/codesign
// checks) and backup.js (SHA-256 verified backups + test restore). Never installs anything by default:
//   check (pinned GitHub repos, HTTPS, redirect host allowlist) → signed manifest (Ed25519, pinned key) → download
//   (resume, atomic state, size cap) → SHA-256 vs SIGNED manifest → zip inspection (traversal/truncation) → gate
//   (downgrade, minUpgradeFrom, same-bundleId rule, schema compat, verified backup, owner approval) → MANUAL install plan.
// Auto-install exists but is OFF unless OPS_UPDATE_AUTO_INSTALL=1 AND all three readiness flags are set.
// It never disables Gatekeeper, never removes quarantine, never deletes user data / Ollama / OpenCode / Keychain.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { stateFile } = require('./state.js');
const KEY_DIR = path.join(__dirname, 'update-keys');
const AI = require('./app-identity.js');
const DEFAULT_REPOS = ['moonkattymky/moonkatty-ai-studio'];
const API_HOST = 'api.github.com';
const ASSET_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const MAX_SMALL = 512 * 1024, MAX_ARCHIVE = 2 * 1024 ** 3;
const APP_NAME = 'MOONKATTY AI STUDIO'; // default only for inspectZip without a manifest
const KNOWN_SCHEMAS = [1, 2, 3, 4, 5, 6]; // docs/RELEASE_MANIFEST.md: 1=v1.1.x 2=early v1.2.0 3=v1.2.0/1.2.1 4=v1.2.2-test 5=world 6=v1.3.0-test ledger cols
const MAX_RELEASE_AGE_DAYS = 365;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const err = (code, msg) => Object.assign(new Error(msg), { code });

// ---------- versions ----------
function parseVer(v) { const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim()); return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null; }
function cmpVer(a, b) { const x = parseVer(a), y = parseVer(b); if (!x || !y) throw err('BAD_VERSION', `неверная версия: ${a} / ${b}`);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1; return 0; } // pre-release suffixes (-mac-preview, -test) are channels, not ordering

// ---------- URL policy (no SSRF) ----------
function checkRepo(repo, repos) { if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo) || !repos.includes(repo)) throw err('REPO_NOT_ALLOWED', 'репозиторий не в allowlist: ' + repo); return repo; }
function assertUrl(u, { repos, initial }) {
  let url; try { url = new URL(u); } catch { throw err('BAD_URL', 'неверный URL'); }
  if (url.protocol !== 'https:') throw err('NOT_HTTPS', 'только HTTPS: ' + url.protocol);
  if (url.username || url.password || (url.port && url.port !== '443')) throw err('BAD_URL', 'учётные данные/порт в URL запрещены');
  const h = url.hostname.toLowerCase();
  if (initial) {
    if (h === API_HOST) { const m = /^\/repos\/([^/]+\/[^/]+)\//.exec(url.pathname); if (!m) throw err('URL_NOT_ALLOWED', 'путь API не разрешён'); checkRepo(m[1], repos); return url; }
    if (h === 'github.com') { const m = /^\/([^/]+\/[^/]+)\/releases\/download\/[^/]+\/[^/]+$/.exec(url.pathname); if (!m) throw err('URL_NOT_ALLOWED', 'разрешены только ассеты релизов'); checkRepo(m[1], repos); return url; }
    throw err('URL_NOT_ALLOWED', 'хост не разрешён: ' + h);
  }
  if (!ASSET_HOSTS.has(h)) throw err('REDIRECT_NOT_ALLOWED', 'редирект на чужой хост: ' + h);
  return url;
}
// fetch with manual redirects, every hop re-validated
async function safeFetch(u, { fetchImpl, repos, headers = {}, timeoutMs = 30000, maxRedirects = 5, signal } = {}) {
  let url = assertUrl(u, { repos, initial: true });
  for (let i = 0; i <= maxRedirects; i++) {
    const r = await fetchImpl(url.toString(), { redirect: 'manual', headers: { 'user-agent': 'moonkatty-update-center', ...headers }, signal: signal || AbortSignal.timeout(timeoutMs) });
    if (r.status >= 300 && r.status < 400) { const loc = r.headers.get('location'); if (!loc) throw err('BAD_REDIRECT', 'редирект без location'); url = assertUrl(new URL(loc, url).toString(), { repos, initial: false }); continue; }
    return r;
  }
  throw err('TOO_MANY_REDIRECTS', 'слишком много редиректов');
}
async function readSmall(r, max = MAX_SMALL) { const ab = Buffer.from(await r.arrayBuffer()); if (ab.length > max) throw err('TOO_LARGE', 'ответ слишком большой'); return ab; }

// ---------- signature ----------
// ---------- keyring (QA-UC-001): per-channel sets, keyId, rotation, revocation, stub flag ----------
const PRIVATE_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const BLOCKED_NO_KEY = 'BLOCKED: нет публичного ключа владельца';
// Owner decision (v1.3.0-test): a READY keyring only makes the SIGNATURE status READY. Download / install through Update Center
// additionally need the explicit owner flag OPS_UPDATE_DOWNLOAD_ENABLED=1 AND the hard gate below to be lifted in code after QA
// (QA-UC-010 must be closed for the platform). There is no env/HTTP switch for the hard gate.
const HARD_GATE = { closed: true, reason: 'загрузка/установка через Update Center отключены до закрытия QA-UC-010 (жёсткий запрет в коде; ключ владельца это не меняет)' };
const keyIdOf = k => crypto.createHash('sha256').update(k.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
const setOfChannel = ch => ch === 'test' ? 'test' : (ch === 'preview' || ch === 'stable') ? 'prod' : null;
function loadKeyring({ dir = KEY_DIR, ring } = {}) {
  const out = { prod: new Map(), test: new Map(), revoked: new Set(), problems: [], stubOnly: { prod: true, test: true } };
  let r = ring; if (!r) { try { r = JSON.parse(fs.readFileSync(path.join(dir, 'keyring.json'), 'utf8')); } catch (e) { out.problems.push('keyring.json не прочитан: ' + e.message); return out; } }
  for (const id of Array.isArray(r.revoked) ? r.revoked : []) out.revoked.add(String(id));
  for (const [id, e] of Object.entries(r.keys || {})) {
    if (!/^[0-9a-f]{16}$/.test(id) || !e || !['prod', 'test'].includes(e.set)) { out.problems.push('неверная запись ключа ' + id); continue; }
    if (out.revoked.has(id)) continue; if (!['active', 'next'].includes(e.status)) continue;
    if (e.stub && e.set === 'prod') { out.problems.push(`ключ-заглушка ${id} отклонён для prod`); continue; }
    let key; try { const pem = String(e.publicKeyPem || fs.readFileSync(path.join(dir, path.basename(String(e.file || ''))), 'utf8'));
      if (PRIVATE_RE.test(pem)) { out.problems.push(`ключ ${id}: это ПРИВАТНЫЙ ключ — в keyring допускается только публичный; запись отклонена`); continue; }
      key = crypto.createPublicKey(pem); } catch (x) { out.problems.push(`ключ ${id}: ${x.message}`); continue; }
    if (key.asymmetricKeyType !== 'ed25519' || keyIdOf(key) !== id) { out.problems.push(`ключ ${id}: keyId не совпадает с ключом`); continue; }
    out[e.set].set(id, { key, stub: !!e.stub, status: e.status }); if (!e.stub) out.stubOnly[e.set] = false;
  }
  return out;
}
// Owner keyring outside the repo/app bundle (OPS_UPDATE_KEYRING_DIR): only ADDS public keys / revocations to the built-in ring.
// QA-UC-007: the external dir is fail-closed: real dir (no symlink), mode 0700, owned by the current uid; keyring.json and every
// referenced .pub.pem are regular files (lstat, no symlinks), inside the dir, not group/other-writable. Any violation => BLOCKED.
// QA-UC-009 (TOCTOU): realpath resolved ONCE; dir and files opened with O_NOFOLLOW (dir also O_DIRECTORY); mode/owner/type from fstat
// of the SAME fd; content read from that fd; dir identity (dev/ino) re-checked after reading; every ancestor of the realpath must not be
// writable by others unless sticky (/tmp 1777 is fine). Returns { problem } or { ring } with publicKeyPem inlined from the fds.
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0, ODIR = fs.constants.O_DIRECTORY || 0;
// QA-UC-010: files are opened RELATIVE TO THE CHECKED DIRECTORY FD when the platform allows (Linux: /proc/self/fd/<dirfd>/<name>
// resolves through the fd object, i.e. openat semantics; O_NOFOLLOW guards the last component). Where that is not available
// (macOS: /dev/fd/<n> is not traversable) files are opened by path → mode 'path' (race bounded only by the before/after dev/ino
// checks) → the update mechanism hard gate stays closed (see mechanismStatus).
function fdRelativeBase(dfd, probeName) {
  for (const b of [`/proc/self/fd/${dfd}`, `/dev/fd/${dfd}`]) { try { const st = fs.statSync(path.join(b, probeName)); if (st) return b; } catch {} }
  return null;
}
function readExternalKeyring(dir, uid, { forcePathMode = false } = {}) {
  const fail = problem => ({ problem }); let st;
  try { st = fs.lstatSync(dir); } catch (e) { return fail('папка недоступна: ' + e.code); }
  if (st.isSymbolicLink()) return fail('папка — символическая ссылка (запрещено)'); if (!st.isDirectory()) return fail('это не папка');
  let rp; try { rp = fs.realpathSync(dir); } catch (e) { return fail('папка недоступна: ' + e.code); } // parent symlinks (/var -> /private/var) are legit
  for (let a = path.dirname(rp); ; a = path.dirname(a)) { let as; try { as = fs.statSync(a); } catch (e) { return fail(`родительская папка ${a}: ${e.code}`); }
    if ((as.mode & 0o002) && !(as.mode & 0o1000)) return fail(`родительская папка ${a} доступна на запись всем без sticky-бита`); if (a === path.dirname(a)) break; }
  if (!NOFOLLOW) return fail('O_NOFOLLOW не поддерживается на этой платформе');
  let dfd; try { dfd = fs.openSync(rp, fs.constants.O_RDONLY | NOFOLLOW | ODIR); } catch (e) { return fail(e.code === 'ELOOP' ? 'папка — символическая ссылка (запрещено)' : 'папка не открыта: ' + e.code); }
  try {
    const ds = fs.fstatSync(dfd); if (!ds.isDirectory()) return fail('это не папка');
    if ((ds.mode & 0o777) !== 0o700) return fail(`права папки ${(ds.mode & 0o777).toString(8)} — нужны 700 (chmod 700)`);
    if (uid != null && ds.uid !== uid) return fail(`владелец папки uid ${ds.uid}, а не текущий пользователь ${uid}`);
    if (ds.ino !== st.ino || ds.dev !== st.dev) return fail('папка была подменена во время проверки');
    const base = forcePathMode ? null : fdRelativeBase(dfd, 'keyring.json'); const mode = base ? 'fd-relative' : 'path';
    if (base) { const bs = fs.statSync(base); if (bs.ino !== ds.ino || bs.dev !== ds.dev) return fail('fd-relative путь не совпадает с проверенной папкой'); }
    const readSafe = name => { if (!name || name !== path.basename(name) || name === '.' || name === '..') return { problem: `${name}: имя файла должно быть без пути` };
      let fd; try { fd = fs.openSync(path.join(base || rp, name), fs.constants.O_RDONLY | NOFOLLOW); } catch (e) { return { problem: `${name}: ` + (e.code === 'ELOOP' ? 'символическая ссылка (запрещено)' : e.code) }; }
      try { const fst = fs.fstatSync(fd); if (!fst.isFile()) return { problem: `${name}: не обычный файл` };
        if (fst.mode & 0o022) return { problem: `${name}: доступен на запись группе/другим (нужно chmod 600/644)` }; if (uid != null && fst.uid !== uid) return { problem: `${name}: чужой владелец uid ${fst.uid}` };
        if (fst.size > 256 * 1024) return { problem: `${name}: слишком большой` }; return { text: fs.readFileSync(fd, 'utf8') }; } finally { fs.closeSync(fd); } };
    const kj = readSafe('keyring.json'); if (kj.problem) return fail(kj.problem);
    let r; try { r = JSON.parse(kj.text); } catch (e) { return fail('keyring.json не прочитан: ' + e.message); }
    const keys = {};
    for (const [id, e] of Object.entries((r && r.keys) || {})) { if (!e || e.publicKeyPem) { keys[id] = e; continue; }
      const f = readSafe(String(e.file || '')); if (f.problem) return fail(`ключ ${id}: ${f.problem}`); keys[id] = { ...e, publicKeyPem: f.text }; }
    let after; try { after = fs.lstatSync(rp); } catch (e) { return fail('папка исчезла во время проверки'); }
    if (after.isSymbolicLink() || after.ino !== ds.ino || after.dev !== ds.dev) return fail('папка была подменена во время проверки');
    let again; try { again = fs.lstatSync(dir); } catch { return fail('папка исчезла во время проверки'); } if (again.isSymbolicLink() || again.ino !== ds.ino) return fail('папка была подменена во время проверки');
    return { ring: { ...r, keys }, mode, dirIno: ds.ino, dirDev: ds.dev };
  } finally { fs.closeSync(dfd); }
}
function loadKeyrings({ env = {}, dir = KEY_DIR, uid = typeof process.getuid === 'function' ? process.getuid() : null, forcePathMode = false } = {}) {
  const base = loadKeyring({ dir }); const ext = env.OPS_UPDATE_KEYRING_DIR; if (!ext) return base;
  const edir = path.resolve(String(ext)); const rd = readExternalKeyring(edir, uid, { forcePathMode }); base.externalReadMode = rd.mode || null; base.externalDirIno = rd.dirIno ?? null;
  if (rd.problem) { base.blocked = 'BLOCKED: внешний keyring (OPS_UPDATE_KEYRING_DIR) отклонён — ' + rd.problem; base.problems.push(base.blocked); return base; }
  const x = loadKeyring({ dir: edir, ring: rd.ring }); /* keys come only from the fds read above (publicKeyPem), never re-opened by path */ x.problems.forEach(p => base.problems.push('OPS_UPDATE_KEYRING_DIR: ' + p));
  for (const id of x.revoked) base.revoked.add(id);
  for (const s of ['prod', 'test']) { for (const [id, k] of x[s]) base[s].set(id, k); if (!x.stubOnly[s]) base.stubOnly[s] = false; for (const id of [...base[s].keys()]) if (base.revoked.has(id)) base[s].delete(id); }
  return base;
}
// Fail-closed signature status for the set this build trusts. Empty prod set => BLOCKED (the rest of the app keeps working).
function signatureStatus(kr, flavor = 'prod') { if (kr.blocked) return { state: 'BLOCKED', set: flavor === 'test' ? 'test' : 'prod', message: kr.blocked, failClosed: true };
  const set = flavor === 'test' ? 'test' : 'prod'; const real = [...kr[set].values()].filter(k => !k.stub).length;
  if (!real) return { state: 'BLOCKED', set, message: BLOCKED_NO_KEY, detail: kr[set].size ? `в наборе «${set}» только ключ-заглушка` : `набор «${set}» пуст`, failClosed: true };
  return { state: 'READY', set, message: `ключей: ${real}`, failClosed: true }; }
const keyringSummary = kr => Object.fromEntries(['prod', 'test'].map(s => [s, { keys: [...kr[s].entries()].map(([id, k]) => ({ keyId: id, status: k.status, stub: k.stub })), stubOnly: kr.stubOnly[s] }]).concat([['revoked', [...kr.revoked]], ['problems', kr.problems]]));
// .sig = JSON {"v":1,"alg":"ed25519","keyId":"<16 hex>","sig":"<base64 of 64-byte Ed25519 signature over the exact manifest bytes>"}
function verifySig(manifestBuf, sigBuf, keyring, channel) {
  const set = setOfChannel(channel); if (!set) return { ok: false, reason: 'неизвестный канал manifest: ' + channel };
  let s; try { s = JSON.parse(String(sigBuf || '')); } catch { return { ok: false, reason: 'подпись не в формате {v,alg,keyId,sig} — подпись без keyId не принимается' }; }
  if (!s || s.v !== 1 || s.alg !== 'ed25519' || typeof s.keyId !== 'string' || !/^[0-9a-f]{16}$/.test(s.keyId)) return { ok: false, reason: 'подпись не указывает keyId/alg ed25519' };
  if (keyring.revoked.has(s.keyId)) return { ok: false, reason: `ключ ${s.keyId} отозван` };
  if (keyring.blocked) return { ok: false, blocked: true, reason: keyring.blocked };
  if (![...keyring[set].values()].some(x => !x.stub)) return { ok: false, blocked: true, reason: BLOCKED_NO_KEY };
  const k = keyring[set].get(s.keyId); if (!k) return { ok: false, reason: `ключ ${s.keyId} не входит в доверенный набор «${set}» (канал ${channel})` };
  const sig = Buffer.from(String(s.sig || ''), 'base64'); if (sig.length !== 64) return { ok: false, reason: 'подпись неверной длины' };
  let ok = false; try { ok = crypto.verify(null, manifestBuf, k.key, sig); } catch {}
  return ok ? { ok: true, keyId: s.keyId, set, stub: k.stub } : { ok: false, reason: `подпись не прошла проверку ключом ${s.keyId}` };
}

// Exact format: docs/RELEASE_MANIFEST.md @ feat/v1.2.2-test-isolated f2440e1 (manifestVersion 1). Unknown extra fields are ignored.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
function validateManifest(m) {
  const p = []; const str = (k, re) => { if (typeof m[k] !== 'string' || !re.test(m[k])) p.push(k); };
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['manifest не объект'];
  if (m.manifestVersion !== 1) p.push('manifestVersion (ожидается 1)');
  if (typeof m.version !== 'string' || !parseVer(m.version)) p.push('version'); if (!['test', 'preview', 'stable'].includes(m.channel)) p.push('channel');
  str('sourceCommit', /^[0-9a-f]{7,40}$/); if (m.branch != null && typeof m.branch !== 'string') p.push('branch');
  if (m.arch !== 'arm64') p.push('arch'); if (m.platform !== 'darwin') p.push('platform');
  str('bundleId', /^[A-Za-z0-9][A-Za-z0-9.-]{2,100}$/); str('appName', NAME_RE); str('dataDirName', NAME_RE); str('launchdLabel', /^[A-Za-z0-9][A-Za-z0-9.-]{2,120}$/); str('keychainServicePrefix', NAME_RE);
  for (const k of ['dataDirName', 'appName']) if (typeof m[k] === 'string' && m[k].includes('..')) p.push(k);
  for (const k of ['dataDir', 'logDir']) if (m[k] != null && (typeof m[k] !== 'string' || m[k].includes('..'))) p.push(k);
  if (m.keychainItems != null && (!Array.isArray(m.keychainItems) || m.keychainItems.some(i => !i || typeof i.service !== 'string' || typeof i.account !== 'string'))) p.push('keychainItems');
  if (m.defaultPort != null && !(Number.isInteger(m.defaultPort) && m.defaultPort > 0 && m.defaultPort < 65536)) p.push('defaultPort');
  if (!Number.isInteger(m.dbSchemaVersion) || m.dbSchemaVersion < 1) p.push('dbSchemaVersion');
  if (m.minUpgradeFrom !== null && (typeof m.minUpgradeFrom !== 'string' || !parseVer(m.minUpgradeFrom))) p.push('minUpgradeFrom');
  if (typeof m.isolated !== 'boolean') p.push('isolated'); if (!Array.isArray(m.isolatedFrom) || m.isolatedFrom.some(x => typeof x !== 'string')) p.push('isolatedFrom');
  if (typeof m.builtAt !== 'string' || !Number.isFinite(Date.parse(m.builtAt))) p.push('builtAt (обязательная подписанная дата сборки, QA-UC-006)');
  if (typeof m.signing !== 'string') p.push('signing'); if (typeof m.notarized !== 'boolean') p.push('notarized');
  if (!Array.isArray(m.assets) || !m.assets.length) p.push('assets');
  else for (const a of m.assets) if (!a || typeof a.name !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(a.name) || a.name.includes('..') || !/^[0-9a-f]{64}$/.test(a.sha256 || '') || !(Number.isSafeInteger(a.size) && a.size > 0 && a.size <= MAX_ARCHIVE)) p.push('asset ' + (a && a.name));
  return p;
}

// ---------- zip inspection (central directory, zip64 aware) ----------
function inspectZip(file, { appName = APP_NAME } = {}) {
  const fd = fs.openSync(file, 'r'); const r = { ok: false, entries: 0, symlinks: 0, problems: [] };
  try {
    const size = fs.fstatSync(fd).size; if (size < 22) { r.problems.push('архив обрезан/пуст'); return r; }
    const tailLen = Math.min(size, 65557); const tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let e = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) { r.problems.push('нет End Of Central Directory — архив обрезан или повреждён'); return r; }
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
      const loc = e - 20; if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) { r.problems.push('zip64 locator отсутствует'); return r; }
      const z64 = Number(tail.readBigUInt64LE(loc + 8)); const b = Buffer.alloc(56); if (z64 + 56 > size) { r.problems.push('zip64 обрезан'); return r; }
      fs.readSync(fd, b, 0, 56, z64); if (b.readUInt32LE(0) !== 0x06064b50) { r.problems.push('zip64 EOCD повреждён'); return r; }
      count = Number(b.readBigUInt64LE(32)); cdSize = Number(b.readBigUInt64LE(40)); cdOff = Number(b.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size || cdSize > 512 * 1024 * 1024) { r.problems.push('central directory за пределами файла — архив обрезан'); return r; }
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff); let p = 0; const tops = new Set();
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) { r.problems.push('central directory повреждён'); return r; }
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32), attr = cd.readUInt32LE(p + 38), lho = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl; r.entries++;
      if (lho !== 0xffffffff && lho >= size) { r.problems.push('запись за пределами файла: ' + name); continue; }
      if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) { r.problems.push('опасный путь в архиве: ' + JSON.stringify(name)); continue; }
      if (((attr >>> 16) & 0o170000) === 0o120000) { r.symlinks++; // QA-UC-002: read the link target; refuse absolute/escaping targets
        const t = readLinkTarget(fd, lho, size); const top = name.split('/')[0];
        if (t === null) { r.problems.push('не удалось прочитать цель симлинка: ' + name); continue; }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), t));
        if (!t || t.startsWith('/') || t.includes('\0') || t.includes('\\') || resolved === '..' || resolved.startsWith('../') || resolved.split('/')[0] !== top) { r.problems.push(`симлинк ведёт за пределы приложения: ${name} -> ${t}`); continue; } }
      if (!name.startsWith('__MACOSX/')) tops.add(name.split('/')[0]);
    }
    r.top = [...tops]; if (!tops.has(appName + '.app')) r.problems.push(`в архиве нет «${appName}.app»`);
    r.ok = !r.problems.length; return r;
  } finally { fs.closeSync(fd); }
}

function readLinkTarget(fd, lho, size) {
  try { const h = Buffer.alloc(30); if (lho + 30 > size) return null; fs.readSync(fd, h, 0, 30, lho); if (h.readUInt32LE(0) !== 0x04034b50) return null;
    const method = h.readUInt16LE(8), csize = h.readUInt32LE(18), nl = h.readUInt16LE(26), xl = h.readUInt16LE(28); if (csize > 4096) return null;
    const start = lho + 30 + nl + xl; if (start + csize > size) return null; const d = Buffer.alloc(csize); fs.readSync(fd, d, 0, csize, start);
    const raw = method === 0 ? d : method === 8 ? require('zlib').inflateRawSync(d) : null; return raw ? raw.toString('utf8') : null; } catch { return null; }
}
// ---------- gate: may this release be installed over what is installed? ----------
// QA-UC-001/003/005: channel+identity bound to the RUNNING app; install target derived from manifest appName+bundleId;
// approval bound to the signed manifest bytes; schema support cap enforced.
function manifestProfileProblems(m) { const p = AI.profileByChannel(m.channel); if (!p) return { prof: null, diff: ['channel'] };
  const diff = AI.ID_KEYS.filter(k => m[k] !== p[k]); if (m.isolated !== (p.flavor === 'test')) diff.push('isolated'); return { prof: p, diff }; }
function tagMatches(tag, m) { return tag === 'v' + m.version || (m.channel === 'preview' && tag === `v${m.version}-mac-preview`); }
function gate({ manifest, verified, current, installed, compat, backup, approval = null, manifestSha256 = null, tag = null, publishedAt = null, now = Date.now(), maxAgeDays = MAX_RELEASE_AGE_DAYS }) {
  const reasons = [], warnings = []; const add = (ok, msg) => { if (!ok) reasons.push(msg); };
  add(verified, 'релиз не подписан/подпись не проверена — только ручная проверка, установка запрещена');
  if (!manifest) return { allowed: false, mode: 'blocked', reasons: reasons.length ? reasons : ['нет release-manifest.json'], warnings };
  if (!installed || !installed.known) return { allowed: false, mode: 'blocked', reasons: [...reasons, 'идентичность запущенного приложения не определена: ' + ((installed && installed.problems) || []).join('; ')], warnings };
  const { prof, diff } = manifestProfileProblems(manifest);
  add(prof && !diff.length, `идентичность в manifest не соответствует профилю канала «${manifest.channel}» (расходятся: ${diff.join(', ')}) — например test-manifest с prod-идентификаторами`);
  if (tag) add(tagMatches(tag, manifest), `тег ${tag} не соответствует версии/каналу manifest (${manifest.version}, ${manifest.channel})`);
  const vt = parseVer(manifest.version); if (vt) add((manifest.channel === 'test') === /(^|[.-])test([.-]|$)/.test(vt.pre), `версия ${manifest.version} не соответствует каналу ${manifest.channel}`);
  const target = prof ? AI.appPathOf(prof) : null; let mode = 'blocked';
  if (prof && prof.bundleId === installed.bundleId) {
    mode = 'replace';
    add(installed.channels.includes(manifest.channel), `канал ${manifest.channel} не разрешён для запущенной сборки (${installed.flavor})`);
    add(target === installed.appPath, `путь установки ${target} не совпадает с запущенным приложением ${installed.appPath}`);
    let c = null; try { c = cmpVer(manifest.version, current); } catch (e) { reasons.push(e.message); }
    add(c === null || c > 0, `версия ${manifest.version} не новее текущей ${current} — откат/downgrade через Update Center запрещён`);
    if (manifest.minUpgradeFrom === null) reasons.push('minUpgradeFrom = null: сборка не обновляет существующие данные (только свежая установка)');
    else if (manifest.minUpgradeFrom) { try { add(cmpVer(current, manifest.minUpgradeFrom) >= 0, `обновление поддерживается только с ${manifest.minUpgradeFrom}`); } catch (e) { reasons.push(e.message); } }
    const dates = [manifest.builtAt, publishedAt].map(d => Date.parse(d)).filter(Number.isFinite); // QA-UC-006: signed builtAt counts (oldest date wins)
    if (dates.length) { const age = (now - Math.min(...dates)) / 86400000; add(!(age > maxAgeDays), `релиз опубликован ${Math.round(age)} дн. назад (> ${maxAgeDays}) — возможен replay старой подписи`); }
    add(compat && compat.ok, 'проверка совместимости БД/миграций не пройдена' + (compat && compat.detail ? ': ' + compat.detail : ''));
    add(backup && backup.verified, 'нет проверенного бэкапа (checksum + тест-восстановление)');
    if (installed.working) add(approval && manifestSha256 && approval.manifestSha256 === manifestSha256, `поверх рабочей сборки с тем же bundleId (${installed.bundleId}) — только с явного согласия владельца на ЭТОТ подписанный manifest`);
  } else {
    const differ = AI.ID_KEYS.filter(k => manifest[k] !== installed[k]);
    const isolated = manifest.isolated === true && differ.length === AI.ID_KEYS.length && (manifest.isolatedFrom || []).includes(installed.bundleId) && target !== installed.appPath;
    add(isolated, `другой канал/сборка (${manifest.channel}, ${manifest.bundleId}) — замена запущенной (${installed.bundleId}) запрещена; рядом можно только полностью изолированную сборку`);
    if (isolated) { mode = 'side-by-side'; warnings.push(`изолированная сборка ставится рядом: ${target}; текущая (${installed.appPath}) не затрагивается`); }
  }
  return { allowed: !reasons.length, mode: reasons.length ? 'blocked' : mode, reasons, warnings, isolated: mode === 'side-by-side', target };
}
function compatCheck(manifest, schema, installed) {
  const { prof } = manifest ? manifestProfileProblems(manifest) : {};
  if (manifest && installed && prof && prof.bundleId !== installed.bundleId) return { ok: true, isolated: true, current: schema && schema.schemaVersion, target: manifest.dbSchemaVersion, detail: `другая (изолированная) сборка: своя БД (схема ${manifest.dbSchemaVersion}), текущая БД не затрагивается` };
  const cur = schema && Number.isInteger(schema.schemaVersion) && schema.schemaVersion > 0 ? schema.schemaVersion : null; const want = manifest && manifest.dbSchemaVersion;
  if (cur === null) return { ok: false, detail: 'текущая схема БД не определена (нет таблицы items)' };
  if (schema.tables && !(schema.tables.includes('items') && schema.tables.includes('meta'))) return { ok: false, current: cur, detail: 'текущая БД повреждена (нет items/meta)' };
  if (schema.ok === false) return { ok: false, current: cur, detail: `текущая БД (схема ${cur}) не поддерживается запущенным кодом (поддерживается ≤ ${schema.supported ?? '?'}) — обновление поверх неё запрещено` }; // QA-UC-005
  if (!Number.isInteger(want)) return { ok: false, current: cur, target: null, detail: 'dbSchemaVersion не указан в manifest — только ручная установка' };
  if (!KNOWN_SCHEMAS.includes(want)) return { ok: false, current: cur, target: want, detail: `неизвестная версия схемы ${want} (известны ${KNOWN_SCHEMAS.join(', ')})` };
  if (want < cur) return { ok: false, current: cur, target: want, detail: `схема релиза (${want}) старше текущей (${cur}) — откат схемы невозможен без восстановления бэкапа` };
  const src = schema.source === 'meta' ? 'из meta.schemaVersion' : 'определена по таблицам';
  return { ok: true, current: cur, target: want, source: schema.source, migration: want > cur, detail: want > cur ? `миграция схемы ${cur} → ${want} (текущая ${src}; откат только восстановлением бэкапа)` : `схема без изменений (${cur}, ${src})` };
}

// ---------- MOONKATTY NODE per-device compatibility ----------
function nodeCompat(info = {}, req = {}) {
  const p = []; const arch = String(info.arch || ''); const osv = (/(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(info.os || '')) || []).slice(1, 4).map(x => +(x || 0));
  if (!arch) p.push('архитектура неизвестна'); else if (req.arch && !req.arch.includes(arch)) p.push(`архитектура ${arch} не поддерживается (${req.arch.join(', ')})`);
  if (!/macos|darwin/i.test(String(info.os || ''))) p.push('ОС не macOS/неизвестна: ' + (info.os || '—'));
  else if (req.minMacOS && !osv.length) p.push('версия macOS неизвестна');
  else if (req.minMacOS) { const m = req.minMacOS.split('.').map(Number); const lt = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); return false; }; if (lt(osv, m)) p.push(`macOS ${osv.join('.')} < ${req.minMacOS}`); }
  const nv = parseVer(String(info.node || '').replace(/^v/, '')); if (req.minNode) { if (!nv) p.push('версия Node неизвестна'); else if (cmpVer(nv.n.join('.'), req.minNode) < 0) p.push(`Node ${info.node} < ${req.minNode}`); }
  return { ok: !p.length, problems: p, device: { arch, os: info.os || null, node: info.node || null } };
}

function createUpdateCenter({ dir, current, repos = DEFAULT_REPOS, fetchImpl = globalThis.fetch, keyring, identity = AI.resolveIdentity(), update, backups, db, nodes, env = {}, exec, platform = process.platform,
  healthUrl, log = () => {}, keyringUid, hardGateOverrideForTests = false, currentBuiltAt = readBuildInfoBuiltAt(), packaged = isPackagedPath(), maxClockSkewMs = 5 * 60000, now = Date.now, maxAgeDays = MAX_RELEASE_AGE_DAYS } = {}) {
  healthUrl = safeHealthUrl(healthUrl, identity); if (!keyring) keyring = loadKeyrings({ env, ...(keyringUid !== undefined ? { uid: keyringUid } : {}) });
  const sigStatus = () => signatureStatus(keyring, identity.flavor);
  function mechanismStatus() { const reasons = [];
    if (HARD_GATE.closed && !hardGateOverrideForTests) reasons.push(HARD_GATE.reason);
    if (env.OPS_UPDATE_DOWNLOAD_ENABLED !== '1' && !hardGateOverrideForTests) reasons.push('нет явного разрешения владельца OPS_UPDATE_DOWNLOAD_ENABLED=1');
    return { downloadEnabled: !reasons.length, installEnabled: !reasons.length, reasons, hardGate: HARD_GATE.closed && !hardGateOverrideForTests, keyringReadMode: keyring.externalReadMode || null }; }
  const assertMechanism = () => { const m = mechanismStatus(); if (!m.downloadEnabled) throw err('UPDATE_DISABLED', 'Update Center: ' + m.reasons.join('; ')); };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const dlDir = path.join(dir, 'downloads'); fs.mkdirSync(dlDir, { recursive: true, mode: 0o700 });
  const st = stateFile(path.join(dir, 'update-center.json'), { releases: [], downloads: {}, backup: null, lastCheck: null, approvals: {} }); const S = st.load(); const save = () => st.save(S);
  // All auto-install flags default OFF: only the exact string '1' enables one.
  const flags = { autoInstall: env.OPS_UPDATE_AUTO_INSTALL === '1', signatureReady: env.OPS_UPDATE_SIGNATURE_READY === '1', backupReady: env.OPS_UPDATE_BACKUP_VERIFIED_READY === '1', rollbackTestedOnRealMac: env.OPS_UPDATE_ROLLBACK_TESTED_ON_MAC === '1', nodeUpdates: env.OPS_UPDATE_NODES === '1' };
  const sf = (u, o = {}) => safeFetch(u, { fetchImpl, repos, ...o });
  const schema = () => { try { return update && db ? update.schemaCheck(db) : null; } catch (e) { return { ok: false, detail: e.message }; } };
  // in-flight progress (memory) — persisted state is written atomically at milestones
  const progress = {};
  const sha256File = f => { const h = crypto.createHash('sha256'), fd = fs.openSync(f, 'r'), b = Buffer.alloc(1 << 20); try { let n; while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0, n)); } finally { fs.closeSync(fd); } return h.digest('hex'); };
  const gateFor = rel => gate({ manifest: rel.manifest, verified: rel.verified, current, installed: identity, compat: rel.manifest ? compatCheck(rel.manifest, schema(), identity) : null, backup: S.backup,
    approval: S.approvals[rel.tag] || null, manifestSha256: rel.manifestSha256, tag: rel.tag, publishedAt: rel.publishedAt, now: now(), maxAgeDays });

  async function check({ includePrerelease = true } = {}) {
    const out = [];
    for (const repo of repos) {
      checkRepo(repo, repos);
      let r; try { r = await sf(`https://${API_HOST}/repos/${repo}/releases?per_page=20`, { headers: { accept: 'application/vnd.github+json' } }); } catch (e) { throw err(e.code || 'NETWORK', 'сеть: ' + e.message); }
      if (!r.ok) throw err('HTTP_' + r.status, `GitHub API ответил ${r.status}`);
      let list; try { list = JSON.parse(await readSmall(r, 4 * 1024 * 1024)); } catch (e) { throw err('BAD_RESPONSE', 'ответ GitHub не JSON'); }
      for (const rel of Array.isArray(list) ? list : []) {
        if (rel.draft || (!includePrerelease && rel.prerelease)) continue;
        const item = { repo, tag: String(rel.tag_name || ''), name: String(rel.name || ''), prerelease: !!rel.prerelease, publishedAt: rel.published_at || null, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(rel.tag_name || '')}`,
          changelog: String(rel.body || '').slice(0, 20000), assets: (rel.assets || []).map(a => ({ name: String(a.name), size: a.size })), verified: false, problems: [] };
        const asset = n => (rel.assets || []).find(a => a.name === n);
        const ma = asset('release-manifest.json'), sa = asset('release-manifest.json.sig');
        if (!ma) item.problems.push('нет release-manifest.json — релиз считается непроверенным (только вручную)');
        else try {
          const mb = await readSmall(await okOr(sf(ma.browser_download_url)));
          let m; try { m = JSON.parse(mb); } catch { throw err('BAD_MANIFEST', 'release-manifest.json не JSON'); }
          const bad = validateManifest(m); if (bad.length) item.problems.push('manifest: неверные поля ' + bad.join(', '));
          item.manifest = m; item.version = m.version;
          if (!sa) item.problems.push('нет release-manifest.json.sig — подпись отсутствует');
          else { const v = verifySig(mb, await readSmall(await okOr(sf(sa.browser_download_url)), 4096), keyring, m.channel); if (!v.ok) item.problems.push(v.reason); else if (!bad.length) { item.verified = true; item.keyId = v.keyId; item.keySet = v.set; } }
          item.manifestSha256 = sha(mb);
          if (item.verified && !tagMatches(item.tag, m)) { item.verified = false; item.problems.push(`тег ${item.tag} не соответствует версии/каналу manifest ${m.version}/${m.channel}`); }
          const vw = []; if (item.verified) for (const p of signedVersionProblems(m, vw)) { item.verified = false; item.problems.push(p); } if (vw.length) item.warnings = vw;
        } catch (e) { item.problems.push(e.message); }
        if (!item.version) { const pv = parseVer(item.tag); item.version = pv ? pv.n.join('.') : null; }
        item.knownIssues = (item.manifest && Array.isArray(item.manifest.knownIssues) ? item.manifest.knownIssues.map(String) : sectionLines(item.changelog, /known issues|известные проблемы/i)).slice(0, 30);
        try { item.newer = item.version ? cmpVer(item.version, current) > 0 : false; } catch { item.newer = false; }
        item.compat = item.manifest ? compatCheck(item.manifest, schema(), identity) : { ok: false, detail: 'нет manifest' };
        if (S.approvals[item.tag] && S.approvals[item.tag].manifestSha256 !== item.manifestSha256) { delete S.approvals[item.tag]; item.problems.push('manifest изменился — прежнее согласие владельца аннулировано'); }
        item.gate = gateFor(item);
        out.push(item);
      }
    }
    S.releases = out; S.lastCheck = { at: new Date(now()).toISOString(), ok: true }; save(); return status();
  }
  // Signed-version policy (anti-rollback): every check uses ONLY signed manifest fields.
  function signedVersionProblems(m, warn = []) { const p = [];
    let c = null; try { c = cmpVer(m.version, current); } catch (e) { p.push(e.message); }
    if (c !== null && c <= 0) p.push(`anti-rollback: подписанная версия ${m.version} ${c === 0 ? 'равна' : 'старше'} текущей ${current} — отклонено`);
    for (const a of m.assets || []) if (/\.zip$/.test(a.name) && !a.name.includes(m.version)) p.push(`пакет ${a.name} не соответствует подписанной версии ${m.version}`);
    const b = Date.parse(m.builtAt);
    if (Number.isFinite(b) && b > now() + maxClockSkewMs) p.push(`подписанный builtAt ${m.builtAt} в будущем (допуск ${Math.round(maxClockSkewMs / 60000)} мин) — отклонено`);
    const cb = Date.parse(currentBuiltAt); if (!Number.isFinite(cb)) { if (packaged) p.push(BUILD_INFO_BLOCKED); else warn.push(BUILD_AGE_NA); } if (Number.isFinite(b) && Number.isFinite(cb) && b < cb) p.push(`подписанный builtAt ${m.builtAt} старше сборки текущего приложения (${currentBuiltAt}) — отклонено`);
    return p; }
  async function okOr(p) { const r = await p; if (!r.ok) throw err('HTTP_' + r.status, 'загрузка ассета: HTTP ' + r.status); return r; }
  const sectionLines = (md, re) => { const L = md.split('\n'); const i = L.findIndex(l => /^#+\s/.test(l) && re.test(l)); if (i < 0) return []; const o = []; for (const l of L.slice(i + 1)) { if (/^#+\s/.test(l)) break; const t = l.replace(/^\s*[-*]\s*/, '').trim(); if (t) o.push(t); } return o; };
  const findRel = tag => { const r = S.releases.find(x => x.tag === tag); if (!r) throw err('NOT_FOUND', 'релиз не найден — сначала «Проверить обновления»'); return r; };
  const archiveAsset = rel => (rel.manifest.assets || []).find(a => /-arm64-mac\.zip$/.test(a.name));

  // download with resume; temp file + atomic state; SHA-256 against the SIGNED manifest
  function prepareDownload(tag) { assertMechanism(); const rel = findRel(tag); if (!rel.verified) throw err('UNVERIFIED', 'релиз без проверенной подписи — загрузка через Update Center запрещена (только вручную)');
    const a = archiveAsset(rel); if (!a) throw err('NO_ASSET', 'в подписанном manifest нет .zip ассета'); return { rel, a }; }
  async function download(tag, { signal } = {}) {
    const { rel, a } = prepareDownload(tag);
    const url = `https://github.com/${rel.repo}/releases/download/${encodeURIComponent(rel.tag)}/${encodeURIComponent(a.name)}`;
    const vdir = path.join(dlDir, rel.tag.replace(/[^A-Za-z0-9._-]/g, '_')); fs.mkdirSync(vdir, { recursive: true, mode: 0o700 });
    const final = path.join(vdir, a.name), part = final + '.partial';
    const D = S.downloads[tag] = { tag, name: a.name, size: a.size, sha256: a.sha256, status: 'downloading', received: fs.existsSync(part) ? fs.statSync(part).size : 0, startedAt: new Date(now()).toISOString(), error: null }; save();
    if (fs.existsSync(final)) fs.rmSync(final, { force: true });
    if (D.received > a.size) { fs.rmSync(part, { force: true }); D.received = 0; }
    progress[tag] = D;
    try {
      if (D.received < a.size) {
        const r = await sf(url, { headers: D.received ? { range: `bytes=${D.received}-` } : {}, timeoutMs: 30 * 60000, signal });
        if (r.status === 200 && D.received) { D.received = 0; fs.rmSync(part, { force: true }); } // server ignored Range → restart clean
        else if (r.status === 416) { fs.rmSync(part, { force: true }); throw err('RANGE', 'сервер отклонил докачку — временный файл удалён, повторите'); }
        else if (!(r.status === 200 || r.status === 206)) throw err('HTTP_' + r.status, 'загрузка: HTTP ' + r.status);
        const fh = fs.openSync(part, D.received ? 'a' : 'w', 0o600);
        try { for await (const chunk of r.body) { D.received += chunk.length; if (D.received > a.size) throw err('TOO_LARGE', 'файл больше заявленного в подписанном manifest'); fs.writeSync(fh, chunk); } } finally { fs.closeSync(fh); }
      }
      if (D.received !== a.size) throw err('INCOMPLETE', `загрузка прервана: ${D.received} из ${a.size} байт (докачка при повторе)`);
      D.status = 'verifying'; save();
      const h = await new Promise((res, rej) => { const x = crypto.createHash('sha256'); fs.createReadStream(part).on('error', rej).on('data', d => x.update(d)).on('end', () => res(x.digest('hex'))); });
      if (h !== a.sha256) { fs.rmSync(part, { force: true }); throw err('HASH_MISMATCH', 'SHA-256 не совпадает с подписанным manifest — файл удалён'); }
      const z = inspectZip(part, { appName: rel.manifest.appName || APP_NAME }); if (!z.ok) { fs.rmSync(part, { force: true }); throw err('BAD_ARCHIVE', 'архив отклонён: ' + z.problems.slice(0, 3).join('; ')); }
      fs.renameSync(part, final); Object.assign(D, { status: 'verified', file: final, manifestSha256: rel.manifestSha256, zip: { entries: z.entries, symlinks: z.symlinks }, verifiedAt: new Date(now()).toISOString() }); save();
      log('info', 'update', `Обновление ${tag} загружено и проверено (подпись+SHA-256)`); return D;
    } catch (e) {
      const keep = ['NETWORK', 'INCOMPLETE'].includes(e.code) || (!e.code && fs.existsSync(part));
      Object.assign(D, { status: keep ? 'interrupted' : 'failed', error: e.message, received: fs.existsSync(part) ? fs.statSync(part).size : 0 }); save(); throw e;
    } finally { delete progress[tag]; }
  }
  function cleanTemp(tag) { const D = S.downloads[tag]; const vdir = path.join(dlDir, String(tag).replace(/[^A-Za-z0-9._-]/g, '_')); if (!vdir.startsWith(dlDir + path.sep)) throw err('BAD', 'bad tag');
    if (fs.existsSync(vdir)) for (const f of fs.readdirSync(vdir)) if (f.endsWith('.partial')) fs.rmSync(path.join(vdir, f), { force: true }); if (D && D.status !== 'verified') { delete S.downloads[tag]; save(); } return { ok: true }; }
  // on start: any "downloading/verifying" left by a crash becomes "interrupted"
  for (const D of Object.values(S.downloads)) if (D.status === 'downloading' || D.status === 'verifying') { D.status = 'interrupted'; D.error = 'прервано (перезапуск сервера)'; } save();

  // ---------- pre-install ----------
  function preBackup({ passphrase } = {}) {
    if (!backups) throw err('NO_BACKUP', 'Backup & Recovery выключен (STUDIO_OPS_BACKUP=1)');
    const b = backups.create({ passphrase, note: 'pre-update' }); const v = backups.verify(b.id); const t = backups.testRestore(b.id, { passphrase });
    S.backup = { id: b.id, at: new Date(now()).toISOString(), checksum: v.ok, testRestore: t.ok, integrity: t.integrity || null, verified: !!(v.ok && t.ok), problems: [...(v.problems || []), ...(t.error ? [t.error] : [])] }; save();
    log(S.backup.verified ? 'info' : 'error', 'update', `Бэкап перед обновлением ${b.id}: ${S.backup.verified ? 'проверен' : 'НЕ прошёл проверку'}`); return S.backup;
  }
  function servicesPlan(label = identity.launchdLabel) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501; const plist = `~/Library/LaunchAgents/${label}.plist`;
    return { dryRun: true, label, stop: [`launchctl print gui/${uid}/${label}`, `launchctl bootout gui/${uid}/${label}`, `дождаться, пока 127.0.0.1:${identity.defaultPort} перестанет отвечать`],
      start: [`launchctl bootstrap gui/${uid} ${plist}`, `launchctl kickstart -k gui/${uid}/${label}`],
      untouched: ['Ollama (homebrew.mxcl.ollama / Ollama.app, ~/.ollama) — не останавливается', 'OpenCode (127.0.0.1:4096) — не трогается', 'Связка ключей (Keychain) — не изменяется', `Папка данных «${identity.dataDirName}» — никогда не удаляется`, 'Узлы MOONKATTY NODE — не трогаются'] };
  }
  async function healthCheck({ expectVersion, url = healthUrl, tries = 1, delayMs = 2000 } = {}) {
    let last = null;
    for (let i = 0; i < tries; i++) { try { const r = await fetchImpl(url, { signal: AbortSignal.timeout(5000) }); const j = await r.json(); last = { ok: r.ok && j.app === 'moonkatty-ai-studio' && j.db !== false && (!expectVersion || j.version === expectVersion), status: r.status, body: j }; if (last.ok) return last; }
      catch (e) { last = { ok: false, error: e.message }; } if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs)); }
    return last;
  }
  // QA-UC-003: re-hash + re-inspect the archive every time a plan/install is computed; bound to the signed manifest
  function reverify(rel) {
    const D = S.downloads[rel.tag]; if (!D || D.status !== 'verified' || !D.file) return { ok: false, reason: 'архив не загружен/не проверен' };
    const a = archiveAsset(rel); if (!a || D.manifestSha256 !== rel.manifestSha256 || D.sha256 !== a.sha256) return { ok: false, reason: 'загруженный архив относится к другому manifest — загрузите заново' };
    if (!fs.existsSync(D.file)) { D.status = 'failed'; save(); return { ok: false, reason: 'файл архива отсутствует' }; }
    const h = sha256File(D.file); if (h !== a.sha256) { D.status = 'tampered'; D.error = 'SHA-256 архива изменился после проверки'; save(); return { ok: false, reason: 'SHA-256 архива изменился после загрузки — установка запрещена' }; }
    const z = inspectZip(D.file, { appName: rel.manifest.appName }); if (!z.ok) { D.status = 'tampered'; save(); return { ok: false, reason: 'архив отклонён: ' + z.problems.slice(0, 3).join('; ') }; }
    return { ok: true, sha256: h };
  }
  function installPlan(tag) {
    const rel = findRel(tag); const D = S.downloads[tag]; const g = rel.manifest ? gateFor(rel) : gate({ manifest: null, verified: false });
    const rv = rel.manifest ? reverify(rel) : { ok: false, reason: 'нет manifest' }; if (!rv.ok) g.reasons.push(rv.reason); g.allowed = g.allowed && rv.ok;
    const mech = mechanismStatus(); if (!mech.installEnabled) { g.reasons.push(...mech.reasons); g.allowed = false; } if (!g.allowed) g.mode = 'blocked';
    const tgt = g.target || identity.appPath, app = tgt, prev = tgt.replace(/\.app$/, '-previous.app'), sp = servicesPlan(); const appName = rel.manifest ? rel.manifest.appName : identity.appName;
    const steps = !g.allowed ? ['Установка ЗАПРЕЩЕНА: ' + g.reasons.join('; ')] : g.mode === 'side-by-side' ? [
      `Распакуйте проверенный архив двойным щелчком в Finder: ${D.file}`, `Перетащите «${appName}.app» в «Программы» → ${tgt} (РЯДОМ с ${identity.appPath}, текущая не заменяется)`,
      'Откройте через Finder (правый клик → «Открыть»). Если Gatekeeper отказывает — НЕ обходите (не используйте xattr/spctl), сообщите владельцу', `Проверьте health тестовой сборки: curl -s http://127.0.0.1:${rel.manifest.defaultPort || '<порт>'}/api/health`] : [
      `Бэкап проверен: ${S.backup.id} (checksum + тест-восстановление)`, ...sp.stop.map(s => 'Остановить сервис: ' + s), 'Закройте приложение (Cmd+Q)',
      `Сохраните текущую версию: mv "${app}" "${prev}"`, `Распакуйте проверенный архив в Finder (${D.file}) и перетащите «${appName}.app» в «Программы» → ${tgt}`,
      'Откройте через Finder (правый клик → «Открыть»). Gatekeeper НЕ обходить', ...sp.start.map(s => 'Запустить сервис: ' + s), `Проверка: curl -s ${healthUrl} → app=moonkatty-ai-studio, version=${rel.version}`];
    return { tag, allowed: g.allowed, mode: g.mode, reasons: g.reasons, warnings: g.warnings, manual: true, steps, services: sp, autoInstall: autoInstallStatus(),
      rollback: g.mode === 'side-by-side' ? ['Удалите только тестовую .app; данные тестовой сборки лежат в своей папке'] : [...sp.stop, `mv "${app}" "${app.replace(/\.app$/, '-failed.app')}" && mv "${prev}" "${app}"`, `Если миграция схемы уже прошла — восстановите бэкап ${S.backup ? S.backup.id : '<id>'} в ПУСТУЮ папку: node ops/backup.js restore <id> --to <папка>, затем подмените папку данных (старую переименуйте, не удаляйте)`, ...sp.start, 'Проверка /api/health'],
      target: tgt, archiveSha256: rv.sha256 || null };
  }
  function approve(tag, { user } = {}) { assertMechanism(); const rel = findRel(tag); if (!rel.verified || !rel.manifestSha256) throw err('UNVERIFIED', 'согласие возможно только для проверенного подписанного manifest');
    S.approvals[tag] = { by: user || 'owner', at: new Date(now()).toISOString(), manifestSha256: rel.manifestSha256, assetSha256: (archiveAsset(rel) || {}).sha256 || null }; save(); log('warn', 'update', `Владелец разрешил установку ${tag} поверх текущей сборки`, user); return S.approvals[tag]; }
  const autoInstallStatus = () => { const missing = Object.entries({ OPS_UPDATE_AUTO_INSTALL: flags.autoInstall, OPS_UPDATE_SIGNATURE_READY: flags.signatureReady, OPS_UPDATE_BACKUP_VERIFIED_READY: flags.backupReady, OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: flags.rollbackTestedOnRealMac }).filter(([, v]) => !v).map(([k]) => k); return { enabled: !missing.length, missing }; };
  // Auto-install code path: disabled unless every readiness flag is set; same checks as the manual plan; rollback on failed health.
  // Auto-install (disabled): all 4 flags + gate + re-hash + Developer ID + notarized + spctl on a STAGED copy; quarantine never removed.
  async function autoInstall(tag, { dryRun = true } = {}) {
    const a = autoInstallStatus(); if (!a.enabled) throw err('AUTO_INSTALL_DISABLED', 'автоустановка выключена: не заданы ' + a.missing.join(', '));
    assertMechanism(); const ss = sigStatus(); if (ss.state !== 'READY') throw err('SIGNATURE_BLOCKED', ss.message + ' — автоустановка невозможна');
    if (!findRel(tag).verified) throw err('UNVERIFIED', 'неподписанный/непроверенный релиз никогда не устанавливается автоматически');
    const p = installPlan(tag); if (!p.allowed || p.mode !== 'replace') throw err('BLOCKED', 'установка запрещена: ' + p.reasons.join('; '));
    const m = findRel(tag).manifest; if (m.signing !== 'developer-id' || m.notarized !== true) throw err('NOT_NOTARIZED', `автоустановка только для Developer ID + нотаризации (manifest: signing=${m.signing}, notarized=${m.notarized})`);
    if (platform !== 'darwin' || !exec) throw err('NOT_MAC', 'автоустановка только на macOS');
    const D = S.downloads[tag], app = p.target, prev = app.replace(/\.app$/, '-previous.app'), uid = process.getuid(), label = identity.launchdLabel;
    const stage = path.join(dir, 'staging', tag.replace(/[^A-Za-z0-9._-]/g, '_')), staged = path.join(stage, m.appName + '.app');
    const pre = [['/usr/bin/ditto', ['-x', '-k', D.file, stage]], ['/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]], ['/usr/sbin/spctl', ['--assess', '--type', 'execute', staged]]];
    const cmds = [['/bin/launchctl', ['bootout', `gui/${uid}/${label}`]], ['/bin/mv', [app, prev]], ['/bin/mv', [staged, app]], ['/bin/launchctl', ['bootstrap', `gui/${uid}`, `${process.env.HOME}/Library/LaunchAgents/${label}.plist`]]];
    if (dryRun) return { dryRun: true, commands: [...pre, ['/usr/bin/codesign', ['-dv', '--verbose=4', staged]], ...cmds].map(c => c.flat().join(' ')) };
    if (fs.existsSync(stage)) throw err('STAGE_EXISTS', 'папка staging уже существует — проверьте вручную');
    for (const c of pre) await exec(c[0], c[1], 300000); // throws → nothing touched in /Applications
    const info = String(await exec('/usr/bin/codesign', ['-dv', '--verbose=4', staged], 60000).catch(e => String(e.message))); if (!/Authority=Developer ID Application/.test(info)) throw err('NOT_DEVELOPER_ID', 'подпись не Developer ID Application');
    try { for (const c of cmds) await exec(c[0], c[1], 300000); const h = await healthCheck({ expectVersion: m.version, tries: 15 }); if (!h.ok) throw err('HEALTH', 'health check после установки не прошёл'); return { ok: true, health: h }; }
    catch (e) { const rb = await rollback({ dryRun: false }).catch(x => ({ ok: false, error: x.message })); return { ok: false, error: e.message, rollback: rb }; }
  }
  async function rollback({ dryRun = true } = {}) {
    if (!identity.known) throw err('UNKNOWN_IDENTITY', 'идентичность запущенного приложения не определена');
    const app = identity.appPath, prev = app.replace(/\.app$/, '-previous.app'), failed = app.replace(/\.app$/, `-failed-${now()}.app`), uid = typeof process.getuid === 'function' ? process.getuid() : 501, label = identity.launchdLabel;
    const cmds = [['/bin/launchctl', ['bootout', `gui/${uid}/${label}`]], ['/bin/mv', [app, failed]], ['/bin/mv', [prev, app]], ['/bin/launchctl', ['bootstrap', `gui/${uid}`, `${process.env.HOME}/Library/LaunchAgents/${label}.plist`]]];
    if (dryRun) return { dryRun: true, commands: cmds.map(c => c.flat().join(' ')), note: 'неудачная версия переименовывается, а не удаляется; данные не трогаются' };
    if (!exec || platform !== 'darwin') throw err('NOT_MAC', 'откат выполняется только на macOS');
    if (!fs.existsSync(prev)) throw err('NO_PREVIOUS', 'нет сохранённой предыдущей версии');
    for (const [i, c] of cmds.entries()) { try { await exec(c[0], c[1], 120000); } catch (e) { if (i > 0) throw e; } }
    const h = await healthCheck({ tries: 15 }); return { ok: !!(h && h.ok), health: h };
  }
  // ---------- MOONKATTY NODE updates (disabled by default) ----------
  function nodeCheck(nodeId, tag) {
    if (!nodes) throw err('NO_NODES', 'Node Manager выключен'); const n = (nodes.status().nodes || []).find(x => x.id === nodeId); if (!n) throw err('NOT_FOUND', 'узел не найден');
    const rel = findRel(tag); const req = rel.manifest && rel.manifest.node; if (!rel.verified || !req) return { ok: false, problems: ['нет подписанного manifest с секцией node'], device: n.info };
    const c = nodeCompat(n.info || {}, req); const result = { ...c, nodeId, tag, checkedAt: new Date(now()).toISOString() }; (S.nodeChecks ||= {})[`${nodeId}@${tag}`] = result; save(); return result;
  }
  function nodeDeliver(nodeId, tag) {
    if (!flags.nodeUpdates) throw err('DISABLED', 'обновления узлов выключены (OPS_UPDATE_NODES=1)');
    const c = (S.nodeChecks || {})[`${nodeId}@${tag}`]; if (!c || !c.ok) throw err('NO_CHECK', 'сначала успешная проверка совместимости устройства');
    const rel = findRel(tag); const a = rel.manifest.node.asset; const ma = (rel.manifest.assets || []).find(x => x.name === a); if (!ma) throw err('NO_ASSET', 'нет ассета узла в подписанном manifest');
    return nodes.submit({ capability: 'node.update', preferNode: nodeId, safeToRetry: false, maxAttempts: 1, idempotencyKey: `node-update:${nodeId}:${tag}`, input: { tag, asset: ma.name, sha256: ma.sha256, size: ma.size, repo: rel.repo, mode: 'download-verify-manual' } });
  }
  function status() {
    const releases = S.releases.map(r => ({ ...r, download: S.downloads[r.tag] ? { ...S.downloads[r.tag], ...(progress[r.tag] || {}) } : null, approved: !!(S.approvals[r.tag] && S.approvals[r.tag].manifestSha256 === r.manifestSha256) }));
    const avail = releases.filter(r => r.newer).sort((a, b) => cmpVer(b.version, a.version))[0] || null;
    return { current, identity, repos, keyring: keyringSummary(keyring), signature: sigStatus(), mechanism: mechanismStatus(), buildAge: Number.isFinite(Date.parse(currentBuiltAt)) ? { available: true, packaged, builtAt: currentBuiltAt } : packaged ? { available: false, packaged, failClosed: true, message: BUILD_INFO_BLOCKED } : { available: false, packaged, message: BUILD_AGE_NA + ' (нет desktop/build-info.json — dev-запуск); версия и будущий builtAt проверяются' }, keysLoaded: keyring[identity.flavor === 'test' ? 'test' : 'prod'].size, lastCheck: S.lastCheck, available: avail ? avail.tag : null, releases, backup: S.backup, schema: schema(), autoInstall: autoInstallStatus(), nodeUpdates: flags.nodeUpdates, services: servicesPlan() };
  }
  return { check, prepareDownload, download, cleanTemp, reverify: tag => reverify(findRel(tag)), preBackup, installPlan, approve, autoInstall, rollback, healthCheck, servicesPlan, nodeCheck, nodeDeliver, status, flags, _state: S };
}
// QA-UC-008: the packaged server runs from Resources/app.asar.unpacked (plain Node, no asar support) → build-info.json is unpacked
// (package.json build.asarUnpack). Packaged mode = code path inside app.asar(.unpacked); there a missing build-info is fail-closed.
const BUILD_INFO = path.join(__dirname, '../../desktop/build-info.json');
const isPackagedPath = (p = __dirname) => /[\\/]app\.asar(\.unpacked)?([\\/]|$)/.test(p);
function readBuildInfoBuiltAt(file = BUILD_INFO) { try { const b = JSON.parse(fs.readFileSync(file, 'utf8')).builtAt; return Number.isFinite(Date.parse(b)) ? b : null; } catch { return null; } }
const BUILD_INFO_BLOCKED = 'BLOCKED: собранное приложение без читаемого desktop/build-info.json — проверка возраста сборки невозможна, релиз отклонён';
const BUILD_AGE_NA = 'проверка возраста сборки недоступна';
// Low (health URL): only loopback http://127.0.0.1|localhost:<port>/api/health
function safeHealthUrl(u, identity) { const def = `http://127.0.0.1:${(identity && identity.defaultPort) || 8787}/api/health`; if (!u) return def;
  let x; try { x = new URL(u); } catch { throw err('BAD_HEALTH_URL', 'неверный health URL'); }
  if (x.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(x.hostname) || x.pathname !== '/api/health' || x.username || x.password || x.search) throw err('BAD_HEALTH_URL', 'health URL только http://127.0.0.1:<порт>/api/health');
  return x.toString(); }
module.exports = { HARD_GATE, readExternalKeyring, readBuildInfoBuiltAt, isPackagedPath, BUILD_INFO_BLOCKED, BUILD_AGE_NA, createUpdateCenter, safeFetch, assertUrl, verifySig, loadKeyring, loadKeyrings, signatureStatus, BLOCKED_NO_KEY, PRIVATE_RE, keyIdOf, setOfChannel, validateManifest, inspectZip, gate, compatCheck, nodeCompat, cmpVer, parseVer, safeHealthUrl, tagMatches, KNOWN_SCHEMAS, ASSET_HOSTS, DEFAULT_REPOS };
