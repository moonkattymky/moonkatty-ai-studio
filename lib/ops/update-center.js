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
const KEY_FILE = path.join(__dirname, 'update-keys', 'release-ed25519.pub.pem');
const DEFAULT_REPOS = ['moonkattymky/moonkatty-ai-studio'];
const API_HOST = 'api.github.com';
const ASSET_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const MAX_SMALL = 512 * 1024, MAX_ARCHIVE = 2 * 1024 ** 3;
const APP_NAME = 'MOONKATTY AI STUDIO';
const CURRENT_IDENTITY = { bundleId: 'com.moonkatty.aistudio', dataDirName: 'MOONKATTY AI STUDIO', launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: 'MOONKATTY AI STUDIO', appName: 'MOONKATTY AI STUDIO', defaultPort: 8787 };
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
function loadKeys(files = [KEY_FILE]) { return files.filter(f => fs.existsSync(f)).map(f => crypto.createPublicKey(fs.readFileSync(f))); }
// .sig = base64 of a raw 64-byte Ed25519 detached signature over the exact release-manifest.json bytes
function verifySig(manifestBuf, sigBuf, keys) {
  const sig = Buffer.from(String(sigBuf || '').trim(), 'base64'); if (sig.length !== 64) return { ok: false, reason: 'подпись отсутствует или неверного формата' };
  for (const k of keys) { try { if (k.asymmetricKeyType === 'ed25519' && crypto.verify(null, manifestBuf, k, sig)) return { ok: true, keyId: crypto.createHash('sha256').update(k.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16) }; } catch {} }
  return { ok: false, reason: 'подпись не прошла проверку закреплённым ключом' };
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
      if (((attr >>> 16) & 0o170000) === 0o120000) r.symlinks++;
      if (!name.startsWith('__MACOSX/')) tops.add(name.split('/')[0]);
    }
    r.top = [...tops]; if (!tops.has(appName + '.app')) r.problems.push(`в архиве нет «${appName}.app»`);
    r.ok = !r.problems.length; return r;
  } finally { fs.closeSync(fd); }
}

// ---------- gate: may this release be installed over what is installed? ----------
function gate({ manifest, verified, current, installed = { ...CURRENT_IDENTITY, working: true }, compat, backup, ownerApproval = false }) {
  const reasons = [], warnings = []; const add = (ok, msg) => { if (!ok) reasons.push(msg); };
  add(verified, 'релиз не подписан/подпись не проверена — только ручная проверка, установка запрещена');
  if (!manifest) return { allowed: false, mode: 'blocked', reasons: reasons.length ? reasons : ['нет release-manifest.json'], warnings };
  let c = null; try { c = cmpVer(manifest.version, current); } catch (e) { reasons.push(e.message); }
  add(c === null || c > 0, `версия ${manifest.version} не новее текущей ${current} — откат/downgrade через Update Center запрещён`);
  if (!isolated0(manifest, installed) && manifest.minUpgradeFrom) { try { add(cmpVer(current, manifest.minUpgradeFrom) >= 0, `обновление поддерживается только с ${manifest.minUpgradeFrom}`); } catch (e) { reasons.push(e.message); } }
  const keys = ['bundleId', 'dataDirName', 'launchdLabel', 'keychainServicePrefix'];
  const differ = keys.filter(k => manifest[k] !== installed[k]);
  const isolated = differ.length === keys.length && manifest.isolated === true && (manifest.isolatedFrom || []).includes(installed.bundleId);
  const partial = !isolated && differ.length > 0;
  add(!partial, `идентичность сборки частично совпадает с установленной (различаются: ${differ.join(', ') || '—'}; isolated=${manifest.isolated}) — конфликт, установка запрещена`);
  if (manifest.isolated === true && !isolated && !differ.length) reasons.push('manifest помечен isolated, но совпадает с установленной сборкой');
  if (!isolated && manifest.minUpgradeFrom === null) reasons.push('minUpgradeFrom = null: сборка не обновляет существующие данные (только свежая установка)');
  let mode = 'blocked';
  if (isolated) { mode = 'side-by-side'; warnings.push('изолированная тестовая сборка: ставится рядом, текущая не затрагивается'); }
  else {
    add(compat && compat.ok, 'проверка совместимости БД/миграций не пройдена' + (compat && compat.detail ? ': ' + compat.detail : ''));
    add(backup && backup.verified, 'нет проверенного бэкапа (checksum + тест-восстановление)');
    if (installed.working) add(ownerApproval, `поверх рабочей сборки с тем же bundleId (${installed.bundleId}) — только с явного согласия владельца`);
    mode = 'replace';
  }
  return { allowed: !reasons.length, mode: reasons.length ? 'blocked' : mode, reasons, warnings, isolated };
}
const isolated0 = (m, i) => m.isolated === true && ['bundleId', 'dataDirName', 'launchdLabel', 'keychainServicePrefix'].every(k => m[k] !== i[k]) && (m.isolatedFrom || []).includes(i.bundleId);
function compatCheck(manifest, schema, installed = CURRENT_IDENTITY) {
  if (manifest && isolated0(manifest, installed)) return { ok: true, isolated: true, current: schema && schema.schemaVersion, target: manifest.dbSchemaVersion, detail: `изолированная сборка: своя БД (схема ${manifest.dbSchemaVersion}), текущая БД не затрагивается` };
  const cur = schema && Number.isInteger(schema.schemaVersion) && schema.schemaVersion > 0 ? schema.schemaVersion : null; const want = manifest && manifest.dbSchemaVersion;
  if (cur === null) return { ok: false, detail: 'текущая схема БД не определена (нет таблицы items)' };
  if (schema.tables && !(schema.tables.includes('items') && schema.tables.includes('meta'))) return { ok: false, current: cur, detail: 'текущая БД повреждена (нет items/meta)' };
  if (!Number.isInteger(want)) return { ok: false, current: cur, target: null, detail: 'dbSchemaVersion не указан в manifest — только ручная установка' };
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

function createUpdateCenter({ dir, current, repos = DEFAULT_REPOS, fetchImpl = globalThis.fetch, keys = loadKeys(), update, backups, db, nodes, env = {}, exec, platform = process.platform,
  healthUrl = 'http://127.0.0.1:8787/api/health', log = () => {}, now = Date.now } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const dlDir = path.join(dir, 'downloads'); fs.mkdirSync(dlDir, { recursive: true, mode: 0o700 });
  const st = stateFile(path.join(dir, 'update-center.json'), { releases: [], downloads: {}, backup: null, lastCheck: null, approvals: {} }); const S = st.load(); const save = () => st.save(S);
  const flags = { autoInstall: env.OPS_UPDATE_AUTO_INSTALL === '1', signatureReady: env.OPS_UPDATE_SIGNATURE_READY === '1', backupReady: env.OPS_UPDATE_BACKUP_VERIFIED_READY === '1', rollbackTestedOnRealMac: env.OPS_UPDATE_ROLLBACK_TESTED_ON_MAC === '1', nodeUpdates: env.OPS_UPDATE_NODES === '1' };
  const sf = (u, o = {}) => safeFetch(u, { fetchImpl, repos, ...o });
  const schema = () => { try { return update && db ? update.schemaCheck(db) : null; } catch (e) { return { ok: false, detail: e.message }; } };
  // in-flight progress (memory) — persisted state is written atomically at milestones
  const progress = {};

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
          else { const v = verifySig(mb, await readSmall(await okOr(sf(sa.browser_download_url)), 4096), keys); if (!v.ok) item.problems.push(v.reason); else if (!bad.length) { item.verified = true; item.keyId = v.keyId; } }
          if (item.verified) { const tv = parseVer(item.tag); if (!tv || cmpVer(item.tag, m.version) !== 0) { item.verified = false; item.problems.push(`тег ${item.tag} не совпадает с версией в manifest ${m.version}`); } }
        } catch (e) { item.problems.push(e.message); }
        if (!item.version) { const pv = parseVer(item.tag); item.version = pv ? pv.n.join('.') : null; }
        item.knownIssues = (item.manifest && Array.isArray(item.manifest.knownIssues) ? item.manifest.knownIssues.map(String) : sectionLines(item.changelog, /known issues|известные проблемы/i)).slice(0, 30);
        try { item.newer = item.version ? cmpVer(item.version, current) > 0 : false; } catch { item.newer = false; }
        item.compat = item.manifest ? compatCheck(item.manifest, schema()) : { ok: false, detail: 'нет manifest' };
        item.gate = gate({ manifest: item.manifest, verified: item.verified, current, compat: item.compat, backup: S.backup, ownerApproval: !!S.approvals[item.tag] });
        out.push(item);
      }
    }
    S.releases = out; S.lastCheck = { at: new Date(now()).toISOString(), ok: true }; save(); return status();
  }
  async function okOr(p) { const r = await p; if (!r.ok) throw err('HTTP_' + r.status, 'загрузка ассета: HTTP ' + r.status); return r; }
  const sectionLines = (md, re) => { const L = md.split('\n'); const i = L.findIndex(l => /^#+\s/.test(l) && re.test(l)); if (i < 0) return []; const o = []; for (const l of L.slice(i + 1)) { if (/^#+\s/.test(l)) break; const t = l.replace(/^\s*[-*]\s*/, '').trim(); if (t) o.push(t); } return o; };
  const findRel = tag => { const r = S.releases.find(x => x.tag === tag); if (!r) throw err('NOT_FOUND', 'релиз не найден — сначала «Проверить обновления»'); return r; };
  const archiveAsset = rel => (rel.manifest.assets || []).find(a => /-mac\.zip$/.test(a.name));

  // download with resume; temp file + atomic state; SHA-256 against the SIGNED manifest
  async function download(tag, { signal } = {}) {
    const rel = findRel(tag); if (!rel.verified) throw err('UNVERIFIED', 'релиз без проверенной подписи — загрузка через Update Center запрещена (только вручную)');
    const a = archiveAsset(rel); if (!a) throw err('NO_ASSET', 'в подписанном manifest нет .zip ассета');
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
      fs.renameSync(part, final); Object.assign(D, { status: 'verified', file: final, zip: { entries: z.entries, symlinks: z.symlinks }, verifiedAt: new Date(now()).toISOString() }); save();
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
  function servicesPlan(label = CURRENT_IDENTITY.launchdLabel) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501; const plist = `~/Library/LaunchAgents/${label}.plist`;
    return { dryRun: true, label, stop: [`launchctl print gui/${uid}/${label}`, `launchctl bootout gui/${uid}/${label}`, 'дождаться, пока 127.0.0.1:8787 перестанет отвечать'],
      start: [`launchctl bootstrap gui/${uid} ${plist}`, `launchctl kickstart -k gui/${uid}/${label}`],
      untouched: ['Ollama (homebrew.mxcl.ollama / Ollama.app, ~/.ollama) — не останавливается', 'OpenCode (127.0.0.1:4096) — не трогается', 'Связка ключей (Keychain) — не изменяется', `Папка данных «${CURRENT_IDENTITY.dataDirName}» — никогда не удаляется`, 'Узлы MOONKATTY NODE — не трогаются'] };
  }
  async function healthCheck({ expectVersion, url = healthUrl, tries = 1, delayMs = 2000 } = {}) {
    let last = null;
    for (let i = 0; i < tries; i++) { try { const r = await fetchImpl(url, { signal: AbortSignal.timeout(5000) }); const j = await r.json(); last = { ok: r.ok && j.app === 'moonkatty-ai-studio' && j.db !== false && (!expectVersion || j.version === expectVersion), status: r.status, body: j }; if (last.ok) return last; }
      catch (e) { last = { ok: false, error: e.message }; } if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs)); }
    return last;
  }
  function installPlan(tag) {
    const rel = findRel(tag); const D = S.downloads[tag]; const g = gate({ manifest: rel.manifest, verified: rel.verified, current, compat: compatCheck(rel.manifest, schema()), backup: S.backup, ownerApproval: !!S.approvals[tag] });
    if (!D || D.status !== 'verified') g.reasons.push('архив не загружен/не проверен'); g.allowed = g.allowed && D && D.status === 'verified'; if (!g.allowed) g.mode = 'blocked';
    const app = `/Applications/${APP_NAME}.app`, prev = `/Applications/${APP_NAME}-previous.app`, sp = servicesPlan(); const base = update && update.plan ? update.plan({ report: [{ ok: g.allowed }], backupId: S.backup && S.backup.id }) : null;
    const steps = !g.allowed ? ['Установка ЗАПРЕЩЕНА: ' + g.reasons.join('; ')] : g.mode === 'side-by-side' ? [
      `Распакуйте проверенный архив двойным щелчком в Finder: ${D.file}`, `Переименуйте распакованную .app по имени тестового канала и перетащите в «Программы» РЯДОМ с текущей (текущая не заменяется)`,
      'Откройте через Finder (правый клик → «Открыть»). Если Gatekeeper отказывает — НЕ обходите (не используйте xattr/spctl), сообщите владельцу', `Проверьте health тестовой сборки: curl -s http://127.0.0.1:${rel.manifest.defaultPort || '<порт>'}/api/health`] : [
      `Бэкап проверен: ${S.backup.id} (checksum + тест-восстановление)`, ...sp.stop.map(s => 'Остановить сервис: ' + s), 'Закройте приложение (Cmd+Q)',
      `Сохраните текущую версию: mv "${app}" "${prev}"`, `Распакуйте проверенный архив в Finder (${D.file}) и перетащите «${APP_NAME}.app» в «Программы»`,
      'Откройте через Finder (правый клик → «Открыть»). Gatekeeper НЕ обходить', ...sp.start.map(s => 'Запустить сервис: ' + s), `Проверка: curl -s ${healthUrl} → app=moonkatty-ai-studio, version=${rel.version}`];
    return { tag, allowed: g.allowed, mode: g.mode, reasons: g.reasons, warnings: g.warnings, manual: true, steps, services: sp, autoInstall: autoInstallStatus(),
      rollback: g.mode === 'side-by-side' ? ['Удалите только тестовую .app; данные тестовой сборки лежат в своей папке'] : [...sp.stop, `mv "${app}" "${APP_NAME}-failed.app" (в «Программах») && mv "${prev}" "${app}"`, `Если миграция схемы уже прошла — восстановите бэкап ${S.backup ? S.backup.id : '<id>'} в ПУСТУЮ папку: node ops/backup.js restore <id> --to <папка>, затем подмените папку данных (старую переименуйте, не удаляйте)`, ...sp.start, 'Проверка /api/health'],
      legacy: base && base.rollback };
  }
  function approve(tag, { user } = {}) { findRel(tag); S.approvals[tag] = { by: user || 'owner', at: new Date(now()).toISOString() }; save(); log('warn', 'update', `Владелец разрешил установку ${tag} поверх текущей сборки`, user); return S.approvals[tag]; }
  const autoInstallStatus = () => { const missing = Object.entries({ OPS_UPDATE_AUTO_INSTALL: flags.autoInstall, OPS_UPDATE_SIGNATURE_READY: flags.signatureReady, OPS_UPDATE_BACKUP_VERIFIED_READY: flags.backupReady, OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: flags.rollbackTestedOnRealMac }).filter(([, v]) => !v).map(([k]) => k); return { enabled: !missing.length, missing }; };
  // Auto-install code path: disabled unless every readiness flag is set; same checks as the manual plan; rollback on failed health.
  async function autoInstall(tag, { dryRun = true } = {}) {
    const a = autoInstallStatus(); if (!a.enabled) throw err('AUTO_INSTALL_DISABLED', 'автоустановка выключена: не заданы ' + a.missing.join(', '));
    const p = installPlan(tag); if (!p.allowed || p.mode !== 'replace') throw err('BLOCKED', 'установка запрещена: ' + p.reasons.join('; '));
    if (platform !== 'darwin' || !exec) throw err('NOT_MAC', 'автоустановка только на macOS');
    const D = S.downloads[tag], app = `/Applications/${APP_NAME}.app`, prev = `/Applications/${APP_NAME}-previous.app`, uid = process.getuid(), label = CURRENT_IDENTITY.launchdLabel;
    const cmds = [['/bin/launchctl', ['bootout', `gui/${uid}/${label}`]], ['/bin/mv', [app, prev]], ['/usr/bin/ditto', ['-x', '-k', D.file, '/Applications']], ['/usr/bin/codesign', ['--verify', '--deep', '--strict', app]], ['/bin/launchctl', ['bootstrap', `gui/${uid}`, `${process.env.HOME}/Library/LaunchAgents/${label}.plist`]]];
    if (dryRun) return { dryRun: true, commands: cmds.map(c => c.flat().join(' ')) };
    const done = [];
    try { for (const c of cmds) { await exec(c[0], c[1], 300000); done.push(c); } const h = await healthCheck({ expectVersion: findRel(tag).version, tries: 15 }); if (!h.ok) throw err('HEALTH', 'health check после установки не прошёл'); return { ok: true, health: h }; }
    catch (e) { const rb = await rollback({ dryRun: false }).catch(x => ({ ok: false, error: x.message })); return { ok: false, error: e.message, rollback: rb }; }
  }
  async function rollback({ dryRun = true } = {}) {
    const app = `/Applications/${APP_NAME}.app`, prev = `/Applications/${APP_NAME}-previous.app`, failed = `/Applications/${APP_NAME}-failed-${now()}.app`, uid = typeof process.getuid === 'function' ? process.getuid() : 501, label = CURRENT_IDENTITY.launchdLabel;
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
    const releases = S.releases.map(r => ({ ...r, download: S.downloads[r.tag] ? { ...S.downloads[r.tag], ...(progress[r.tag] || {}) } : null, approved: !!S.approvals[r.tag] }));
    const avail = releases.filter(r => r.newer).sort((a, b) => cmpVer(b.version, a.version))[0] || null;
    return { current, identity: CURRENT_IDENTITY, repos, keysLoaded: keys.length, lastCheck: S.lastCheck, available: avail ? avail.tag : null, releases, backup: S.backup, schema: schema(), autoInstall: autoInstallStatus(), nodeUpdates: flags.nodeUpdates, services: servicesPlan() };
  }
  return { check, download, cleanTemp, preBackup, installPlan, approve, autoInstall, rollback, healthCheck, servicesPlan, nodeCheck, nodeDeliver, status, flags, _state: S };
}
module.exports = { createUpdateCenter, safeFetch, assertUrl, verifySig, validateManifest, inspectZip, gate, compatCheck, nodeCompat, cmpVer, parseVer, loadKeys, CURRENT_IDENTITY, ASSET_HOSTS, DEFAULT_REPOS };
