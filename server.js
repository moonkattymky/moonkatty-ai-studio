// MOONKATTY AI STUDIO — backend (Express + SQLite)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { open: openDb } = require('./lib/db.js');
const os = require('os');
global.MKSocial = require('./public/social.js');
const core = require('./public/core.js');
const S = MKSocial;
const crypto = require('crypto');
const sec = require('./lib/security.js');
const CFG = require('./lib/studio-config.js'); // build flavor: prod | isolated TEST (names, ports, Keychain, data dir)
if (!CFG.FLAVOR) { console.error(`ОТКАЗ: сборка не определена (flavor отсутствует, источник: ${CFG.FLAVOR_SOURCE}). Пакет должен содержать lib/flavor.baked.js / "studioFlavor"; для разработки: NODE_ENV=test STUDIO_FLAVOR=test|prod.`); process.exit(78); }
const egress = require('./lib/egress.js'), heavy = require('./lib/heavy-lock.js');

const PORT = +process.env.PORT || CFG.defaultPort;
const HOST = process.env.HOST || '127.0.0.1';
// v1.2.4: the main panel listens on loopback ONLY (never 0.0.0.0, LAN or a public address). Nodes use their own TLS listener.
if (!/^(127\.\d+\.\d+\.\d+|::1|localhost)$/.test(HOST)) { console.error(`ОТКАЗ: HOST=${HOST} — панель слушает только 127.0.0.1/::1`); process.exit(78); }
const DATA_DIR = process.env.STUDIO_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'studio.db');
// Startup guard: the TEST build refuses to open anything inside the production data folder (symlinks resolved).
try { CFG.assertTestPath(DATA_DIR, 'STUDIO_DATA_DIR'); CFG.assertTestPath(DB_PATH, 'DB_PATH'); } catch (e) { console.error(e.message); process.exit(78); }
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
// QA-DB-001: schema version + automatic SQLite backup (VACUUM INTO, SHA-256) BEFORE any migration of an existing DB.
const DB_SCHEMA_VERSION = 6; // 1 = items/meta (v1.0–v1.1.x) · 2 = jobs/job_events (v1.2.0) · 3 = jobs v1.2.0 extra cols + mig_120 · 4 = schemaVersion meta + v1.2.2 · 5 = world tables · 6 = ledger payout_id/currency/state (v1.3.0-test)
const PRE_MIG = require('./lib/db-backup.js');
const preMigration = PRE_MIG.backupBeforeMigration(DB_PATH, DB_SCHEMA_VERSION, openDb);
const db = openDb(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
         CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);

const q = {
  list: db.prepare('SELECT data FROM items WHERE col = ? ORDER BY rowid'),
  get: db.prepare('SELECT data FROM items WHERE col = ? AND id = ?'),
  put: db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data'),
  del: db.prepare('DELETE FROM items WHERE col = ? AND id = ?'),
  meta: db.prepare('SELECT v FROM meta WHERE k = ?'),
  setMeta: db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)')
};
const list = col => q.list.all(col).map(r => JSON.parse(r.data));
const get = (col, id) => { const r = q.get.get(col, id); return r ? JSON.parse(r.data) : null; };
// Publication seal: the ONLY way a queue item can be stored with status "published". sealPublication() is handed
// exclusively to the internal publisher (meta.js), which calls it only after a verified official platform API response.
// v1.2.3-test: the HMAC key lives ONLY in the macOS Keychain (flavor-specific service, account «publish-seal-key»,
// written via stdin of `security -i`, never argv) — never in studio.db. A legacy copy in meta.publishSealKey is moved to
// the Keychain and deleted from the DB. No Keychain → no key → publishing refused and no row can be (re)sealed.
const KS = require('./lib/keystore.js');
let SEAL_KEY;
function sealKey(create) {
  if (SEAL_KEY) return SEAL_KEY;
  let hex = KS.secretGet(KS.ACCOUNTS.publishSeal);
  if (!hex && create && KS.available()) { const h = crypto.randomBytes(32).toString('hex'); try { KS.secretSet(KS.ACCOUNTS.publishSeal, h); hex = h; } catch { hex = null; } }
  if (hex && /^[a-f0-9]{64}$/.test(hex)) SEAL_KEY = Buffer.from(hex, 'hex'); return SEAL_KEY || null;
}
{ const legacy = q.meta.get('publishSealKey')?.v; // migrate the v1.2.2-test DB copy of the key → Keychain, then remove it from the DB
  if (legacy) { let moved = false; if (/^[a-f0-9]{64}$/.test(legacy) && KS.available() && !KS.secretGet(KS.ACCOUNTS.publishSeal)) { try { KS.secretSet(KS.ACCOUNTS.publishSeal, legacy); moved = true; } catch {} }
    db.pragma('secure_delete = ON'); db.prepare("DELETE FROM meta WHERE k = 'publishSealKey'").run(); try { db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); } catch {} console.log(`[security] publishSealKey удалён из studio.db${moved ? ' (перенесён в Keychain)' : ' (Keychain недоступна или уже содержит ключ — старые печати недействительны)'}`); } }
const PUB_PLATFORMS = { facebook: /^\d{5,32}(_\d{5,32})?$/, instagram: /^\d{5,32}$/ };
const sealOf = (key, id, p) => crypto.createHmac('sha256', key).update([id, p.platform, p.responseId, p.at, p.callerModule].join('|')).digest('hex');
function sealPublication(item, prov, caller) {
  if (CFG.IS_TEST) throw new Error('publication: disabled in TEST build');
  if (caller !== 'meta-publisher') throw new Error('publication: caller not authorised');
  const re = PUB_PLATFORMS[prov && prov.platform]; const rid = String(prov && prov.responseId || '');
  if (!re || !re.test(rid)) throw new Error('publication: invalid platform response id');
  const key = sealKey(true); if (!key) throw new Error('publication: Keychain недоступна — публикация запрещена');
  const p = { platform: prov.platform, responseId: rid, at: core.now(), callerModule: caller }; p.seal = sealOf(key, item.id, p);
  return Object.assign(item, { status: 'published', externalId: rid, publishedAt: p.at, publication: p });
}
const validSeal = it => { const p = it && it.publication; if (!p || typeof p.seal !== 'string' || !/^[a-f0-9]{64}$/.test(p.seal) || p.callerModule !== 'meta-publisher' || it.status !== 'published' || it.externalId !== p.responseId || it.publishedAt !== p.at) return false;
  const re = PUB_PLATFORMS[p.platform]; if (!re || !re.test(String(p.responseId))) return false; const key = sealKey(false); if (!key) return false;
  const a = Buffer.from(sealOf(key, it.id, p), 'hex'), b = Buffer.from(p.seal, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
// Any published-looking queue row (status published, externalId or publication) is accepted ONLY with a valid seal.
// There is no "legacy" exception any more: unsealed rows are demoted at startup (see demoteUnsealed) and edits are refused.
const looksPublished = o => o && (o.status === 'published' || o.externalId || o.publication || o.publishedAt);
const put = (col, obj) => {
  if (col === 'queue' && looksPublished(obj) && !validSeal(obj)) { const e = new Error('Статус «опубликовано» ставит только модуль публикации после ответа платформы'); e.code = 'published_internal_only'; throw e; }
  q.put.run(col, obj.id, JSON.stringify(obj)); return obj; };
// Unsealed published rows (v1.1.x–v1.2.2 data, direct DB writes, keys lost) → historical_* (read-only, audit) + pending_approval.
function demoteRow(o0, event) { const o = Object.assign({}, o0);
  for (const k of ['status', 'externalId', 'publishedAt']) if (o[k] != null && o['historical_' + k] == null) o['historical_' + k] = o[k];
  delete o.externalId; delete o.publishedAt; delete o.publication; delete o.nextRetryAt; o.status = 'pending_approval';
  o.history = [...(Array.isArray(o.history) ? o.history : []), { at: core.now(), event, from: o0.status }]; return o; }
function demoteUnsealed(reason) { let n = 0;
  db.transaction(() => { for (const o of list('queue')) if (looksPublished(o) && !validSeal(o)) { put('queue', demoteRow(o, 'unsealed_published_demoted')); n++; } })();
  return n; }
function log(level, source, message, user) {
  put('logs', { id: core.uid(), at: core.now(), level, source, message: sec.redact(message), user: user || null });
  const logs = list('logs'); if (logs.length > 2000) { logs.sort((a, b) => a.at.localeCompare(b.at)); for (const l of logs.slice(0, logs.length - 2000)) q.del.run('logs', l.id); }
}

{ const n = demoteUnsealed('startup'); if (n) console.log(`[security] ${n} неподписанных «опубликованных» элементов очереди переведены в pending_approval (historical_* сохранены)`); }
if (!q.meta.get('seeded')) {
  db.transaction(() => { const s = core.seed(); for (const col of Object.keys(s)) for (const o of s[col]) put(col, o); q.setMeta.run('seeded', core.now()); })();
  log('info', 'system', 'База данных создана, начальные данные загружены');
}
{ const miss = core.missingSeed(Object.fromEntries(['agents', 'channels', 'workspaces', 'integrations'].map(c => [c, list(c)])));
  const n = Object.values(miss).reduce((a, x) => a + x.length, 0); if (n) { for (const c in miss) for (const o of miss[c]) put(c, o); log('info', 'system', 'Обновление: добавлены новые элементы — ' + n); } }

const app = express();
app.disable('x-powered-by');
app.use(sec.headers);
// v1.2.4: defence in depth — only loopback / Tailscale source addresses are served (the listener is loopback anyway).
app.use((req, res, next) => require('./lib/ops/nodes.js').isTailscaleOrLoopback(req.socket.remoteAddress) ? next() : res.status(403).end());
app.use(sec.hostCheck(PORT));          // DNS-rebinding protection (STUDIO_ALLOWED_HOSTS for a Tailscale name)
app.use('/api', sec.csrfCheck(PORT));  // Origin + X-Studio-Request on state-changing calls
const jsonSmall = express.json({ limit: '2mb' });
app.use((req, res, next) => req.path === '/api/restore' ? next() : jsonSmall(req, res, next));
const STARTED = Date.now();
if (preMigration) log('warn', 'backup', `Перед миграцией схемы ${preMigration.from} → ${DB_SCHEMA_VERSION} создана копия ${path.basename(preMigration.file)} (SHA-256 ${preMigration.sha256})`);


const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
fs.mkdirSync(FILES_DIR, { recursive: true }); fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---- Auth (scrypt hashed password, random session tokens) ----
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => { const [salt, h] = stored.split(':'); const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64); return crypto.timingSafeEqual(a, b); };
const getUsers = () => JSON.parse(q.meta.get('users')?.v || '{}');
const setUsers = u => q.setMeta.run('users', JSON.stringify(u));
if (process.env.STUDIO_ADMIN_PASSWORD && !Object.keys(getUsers()).length) setUsers({ [process.env.STUDIO_ADMIN_USER || 'igor']: hashPw(process.env.STUDIO_ADMIN_PASSWORD) });
const hashTok = t => 'h:' + crypto.createHash('sha256').update(String(t)).digest('hex');
const sessions = new Map(JSON.parse(q.meta.get('sessions')?.v || '[]').filter(([k]) => String(k).startsWith('h:'))); // only hashed session ids are stored
const getSession = req => { const t = tokenOf(req); const s = t && sessions.get(hashTok(t)); return s && s.exp > Date.now() ? s : null; };
const saveSessions = () => q.setMeta.run('sessions', JSON.stringify([...sessions]));
const SESSION_TTL = 30 * 86400000;
function tokenOf(req) { const m = /(?:^|;\s*)mk_session=([a-f0-9]+)/.exec(req.headers.cookie || ''); return m ? m[1] : (req.headers.authorization || '').replace(/^Bearer /, ''); }
function newSession(res, user) {
  q.setMeta.run('appTokenDisabled', '0'); const tok = crypto.randomBytes(32).toString('hex'); sessions.set(hashTok(tok), { user, exp: Date.now() + SESSION_TTL }); saveSessions();
  res.setHeader('Set-Cookie', `mk_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
}
const STARTED_AT = new Date().toISOString(); const BRAND = process.env.STUDIO_BRAND || 'MOONKATTY';
const metaCtx = { q, get, put, list, log, DB_PATH, express, db, sealPublication };
// TEST build: the publisher module is NOT loaded at all (no Graph API code, no scheduler, no /publish routes).
// The master key (Keychain «MOONKATTY AI STUDIO.test») is still created/loaded so key storage stays exercised.
const meta = CFG.IS_TEST ? (() => { metaCtx.keySource = require('./lib/keystore.js').loadKey(path.dirname(DB_PATH)).source; return { mountProtected() {}, tick: async () => ({ disabled: true }), disabled: true }; })()
  : (() => { try { return require('./meta.js')(app, metaCtx); } catch (e) { console.error('ОТКАЗ: модуль публикации недоступен для prod-сборки (' + e.message + ')'); process.exit(78); } })();
const nodeHooks = {}; // v1.2.4: Node Manager (lib/ops/nodes-server.js) is mounted after auth; runner reaches it late-bound
const worldHooks = {};
const runner = require('./runner.js')({ get, put, list, log, core, meta, dataDir: path.dirname(DB_PATH), brand: BRAND, onAgentStart: a => worldHooks.onAgentStart && worldHooks.onAgentStart(a), runViaNode: (a, t, s) => nodeHooks.runViaNode ? nodeHooks.runViaNode(a, t, s) : Promise.reject(Object.assign(new Error('Node Manager выключен'), { blocked: true })) });
// ---- v1.2.0: job engine + 3D DESIGN agent (OpenCode server + Blender) ----
const jobs = require('./lib/jobs.js')(db, { redact: s => sec.redact(s) });
const ws3d = require('./lib/workspace.js')(path.dirname(DB_PATH));
const blender = require('./lib/blender.js')();
const policy = require('./lib/policy.js'), SP = require('./lib/scene-params.js');
const design3d = require('./lib/executors/design3d.js')({ jobs, ws: ws3d, blender, get, put, log, sec, ollamaStatus: runner.ollamaStatus, ollamaJson: runner.ollamaJson });
runner.register('design3d', design3d.run);
const services = require('./lib/services.js')({ jobs, design3d, runner, blender, ws: ws3d, get, put, core, log, mediaRoot: path.join(DATA_DIR, 'media') }); app.locals.services = services; module.exports = { services };
// Studio 2 media-automation: real video_render executor (lazy factory — TTS is detected on first render, not at boot).
// Jobs backend adapter (MA_JOBS_BACKEND=jobsapi) is NOT wired here and stays off.
{ const { createVideoRenderExecutor } = require('./media-automation/src/jobs'); let vf = null;
  const factory = { async render(ep, o) { if (!vf) { const MV = require('./media-automation/src/video'); vf = new MV.NewsVideoFactory({ tts: await MV.detectTTS() }); } return vf.render(ep, o); } };
  const llm = null; /* no Ollama unload hook in this build */
  services.videoRender.setExecutor(createVideoRenderExecutor({ dataDir: DATA_DIR, factory, llm })); }
const world = require('./lib/world')({ db, q, get, put, list, log, core, runner, services, CFG, sec });
worldHooks.onAgentStart = world.onAgentStart; world.boot();
if (!q.meta.get('mig_120_design3d')) { const a = get('agents', 'design3d'); if (a) { Object.assign(a, { enabled: true, inDevelopment: false, status: a.status === 'dev' ? 'idle' : a.status, role: core.seed().agents.find(x => x.id === 'design3d').role }); put('agents', a); }
  q.setMeta.run('mig_120_design3d', core.now()); }
q.setMeta.run('schemaVersion', String(DB_SCHEMA_VERSION)); // all migrations above are done
if (CFG.IS_TEST && !q.meta.get('test_oc_url')) { const oc = get('integrations', 'opencode'); if (oc && oc.url === CFG.PROD.opencodeUrl) { oc.url = CFG.opencodeUrl; put('integrations', oc); } q.setMeta.run('test_oc_url', core.now()); }
// Local desktop-app token: lets the app window authenticate without a password. Accepted only from loopback.
const APP_TOKEN_FILE = path.join(path.dirname(DB_PATH), 'app-token');
if (!fs.existsSync(APP_TOKEN_FILE)) fs.writeFileSync(APP_TOKEN_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const APP_TOKEN = fs.readFileSync(APP_TOKEN_FILE, 'utf8').trim();
const isLoopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function appTokenUser(req) { const h = req.headers['x-studio-app-token']; const o = req.headers.origin; if (o && !sec.allowedHosts(PORT).has((() => { try { return new URL(o).host; } catch { return ''; } })())) return null; if (q.meta.get('appTokenDisabled')?.v === '1') return null; if (!h || !isLoopback(req) || h.length !== APP_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(APP_TOKEN))) return null; return Object.keys(getUsers())[0] || null; }
app.get('/api/auth/status', (req, res) => { const s = getSession(req); const au = appTokenUser(req); res.json({ needsSetup: !Object.keys(getUsers()).length, user: s && s.exp > Date.now() ? s.user : au, via: au && !(s && s.exp > Date.now()) ? 'app' : undefined }); });
app.post('/api/auth/setup', (req, res) => {
  if (Object.keys(getUsers()).length) return res.status(403).json({ error: 'Пользователь уже создан' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) return res.status(400).json({ error: 'Логин и пароль (мин. 8 символов) обязательны' });
  setUsers({ [username]: hashPw(password) }); newSession(res, username); log('info', 'auth', 'Создан администратор ' + username, username); res.json({ ok: true, user: username });
});
const fails = new Map();
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip, f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Слишком много попыток, подождите минуту' });
  const { username, password } = req.body || {}; const u = getUsers();
  if (u[username] && checkPw(String(password || ''), u[username])) { fails.delete(ip); newSession(res, username); log('info', 'auth', 'Вход: ' + username, username); return res.json({ ok: true, user: username }); }
  f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(ip, f);
  log('warn', 'auth', 'Неудачный вход: ' + String(username).slice(0, 40)); res.status(401).json({ error: 'Неверный логин или пароль' });
});
app.post('/api/auth/logout', (req, res) => { sessions.delete(hashTok(tokenOf(req))); saveSessions(); q.setMeta.run('appTokenDisabled', '1'); // «Выйти» also stops the desktop auto-login until the next password login
  log('info', 'auth', 'Выход', getSession(req)?.user || null); res.setHeader('Set-Cookie', 'mk_session=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  const s = getSession(req); if (!s || s.exp < Date.now()) { const au = appTokenUser(req); if (au) { req.user = au; return next(); } return res.status(401).json({ error: 'auth required' }); }
  req.user = s.user; next();
});
app.post('/api/auth/password', (req, res) => {
  const u = getUsers(); const { oldPassword, newPassword } = req.body || {};
  if (!checkPw(String(oldPassword || ''), u[req.user])) return res.status(400).json({ error: 'Старый пароль неверен' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Новый пароль: мин. 8 символов' });
  u[req.user] = hashPw(newPassword); setUsers(u); log('info', 'auth', 'Пароль изменён', req.user); res.json({ ok: true });
});

if (CFG.IS_TEST) app.use(['/api/queue/:id/publish', '/api/comments/:id/reply'], (req, res) => res.status(403).json({ error: 'Тестовая сборка: публикация отключена', code: 'publishing_disabled' })); // TEST build: no publishing at all
meta.mountProtected();
// v1.2.4: distributed nodes (Studio 3 Node Manager) — admin API here (owner session), node API on its own TLS listener.
{ const nodes = require('./lib/ops/nodes-server.js').mountNodes(app, { CFG, dataDir: path.dirname(DB_PATH), log, q, heavy, checkPassword: (user, pw) => { const h = getUsers()[user]; return !!h && checkPw(pw, h); } });
  nodeHooks.runViaNode = nodes.runViaNode; }
// v1.3.0-test: Update Center (download + verify + manual install plan; auto-install off) — only with STUDIO_OPS_UPDATE=1.
require('./lib/ops/update-center-mount.js').mountUpdateCenter(app, { CFG, dataDir: path.dirname(DB_PATH), db, openDb, log, version: require('./package.json').version, env: process.env, dbSchemaVersion: DB_SCHEMA_VERSION, port: PORT,
  checkPassword: (user, pw) => { const h = getUsers()[user]; return !!h && checkPw(pw, h); } });

// ---- Backup / restore ----
// QA-DB-001: the export also carries the jobs engine tables and the users (scrypt password HASHES only — never passwords/sessions).
const dump = () => ({ app: 'moonkatty-ai-studio', version: 2, flavor: CFG.flavor, schemaVersion: DB_SCHEMA_VERSION, exportedAt: core.now(), data: Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)])),
  jobs: db.prepare('SELECT * FROM jobs ORDER BY created_at').all(), jobEvents: db.prepare('SELECT * FROM job_events ORDER BY seq').all(), worldLedger: world.exportLedger(),
  users: Object.entries(getUsers()).map(([username, hash]) => ({ username, passwordHash: hash })),
  si: SIX.exportSi(db) }); // Studio 5: si_* tables (docs/studio-intelligence/patches/server-dump-include-si.md)
const SIX = require('./studio-intelligence/src/si-export');

function scheduledBackup() {
  const f = path.join(BACKUP_DIR, 'backup-' + core.now().replace(/[:.]/g, '-') + '.json'); fs.writeFileSync(f, JSON.stringify(dump()));
  const all = fs.readdirSync(BACKUP_DIR).filter(x => x.endsWith('.json')).sort(); for (const x of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(BACKUP_DIR, x));
  q.setMeta.run('lastBackup', core.now()); log('info', 'backup', 'Резервная копия: ' + path.basename(f));
}
app.get('/api/backup', (req, res) => { log('info', 'backup', 'Экспорт резервной копии', req.user); res.setHeader('Content-Disposition', 'attachment; filename="moonkatty-studio-backup.json"'); res.json(dump()); });
app.get('/api/backups', (req, res) => res.json(fs.readdirSync(BACKUP_DIR).filter(x => x.endsWith('.json')).sort().reverse()));
app.post('/api/backups/run', (req, res) => { scheduledBackup(); res.json({ ok: true }); });
// Risk fix (a): restore is two-step. 1) /api/restore/prepare uploads the file → server keeps it in memory and returns a
// one-time confirmation token (5 min) + a summary. 2) /api/restore with {token, confirm:"ЗАМЕНИТЬ"} → the server FIRST
// makes an automatic SQLite copy (VACUUM INTO, SHA-256 sidecar) and only then replaces the data.
// Restore never authorises publishing: every restored queue item enters pending_approval; its old status / externalId /
// publishedAt are kept read-only under historical_* for audit only (PROTECTED: cannot be written via CRUD either).
const sanitizeRestoredQueue = o0 => { const keep = ['pending_approval', 'rejected', 'draft'];
  if (keep.includes(o0.status) && !looksPublished(o0)) { if (!('nextRetryAt' in o0)) return o0; const o = Object.assign({}, o0); delete o.nextRetryAt; return o; }
  return demoteRow(o0, 'restored_pending_approval'); };
const DBB = require('./lib/db-backup.js'); const pendingRestore = new Map(); const RESTORE_TTL = 5 * 60000;
app.post('/api/restore/prepare', express.json({ limit: '50mb' }), (req, res) => {
  const d = req.body?.data; if (!d || typeof d !== 'object' || Array.isArray(d)) return res.status(400).json({ error: 'Неверный файл резервной копии' });
  for (const [k, v] of pendingRestore) if (v.exp < Date.now()) pendingRestore.delete(k);
  const token = crypto.randomBytes(24).toString('hex'); const counts = Object.fromEntries(core.COLLECTIONS.filter(c => Array.isArray(d[c])).map(c => [c, d[c].length]));
  pendingRestore.set(hashTok(token), { data: d, worldLedger: Array.isArray(req.body.worldLedger) ? req.body.worldLedger : null, si: req.body.si && typeof req.body.si === 'object' ? req.body.si : null, user: req.user, exp: Date.now() + RESTORE_TTL, sha256: crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex') });
  res.json({ token, expiresInSec: RESTORE_TTL / 1000, counts, confirm: 'ЗАМЕНИТЬ' });
});
app.post('/api/restore', express.json({ limit: '1mb' }), (req, res) => {
  const { token, confirm } = req.body || {}; if (req.body?.data) return res.status(400).json({ error: 'Восстановление в два шага: сначала /api/restore/prepare, затем подтверждение токеном', code: 'confirm_required' });
  const k = typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) ? hashTok(token) : null; const p = k && pendingRestore.get(k);
  if (!p || p.exp < Date.now() || p.user !== req.user) return res.status(403).json({ error: 'Нет действительного токена подтверждения', code: 'confirm_required' });
  if (confirm !== 'ЗАМЕНИТЬ') return res.status(400).json({ error: 'Подтвердите замену: confirm = «ЗАМЕНИТЬ»', code: 'confirm_required' });
  pendingRestore.delete(k);
  let bk; try { bk = DBB.snapshot(db, BACKUP_DIR, 'pre-restore'); } catch (e) { log('error', 'backup', 'Восстановление отменено: не удалось сделать копию — ' + e.message, req.user); return res.status(500).json({ error: 'Не удалось сделать резервную копию — данные НЕ заменены' }); }
  const d = p.data;
  let demoted = 0;
  db.transaction(() => { for (const c of core.COLLECTIONS) if (Array.isArray(d[c])) { db.prepare('DELETE FROM items WHERE col = ?').run(c); for (const o0 of d[c]) if (o0 && o0.id) { const o = c === 'queue' ? sanitizeRestoredQueue(o0) : o0; if (o !== o0) demoted++; put(c, o); } } if (Array.isArray(p.worldLedger)) world.replaceLedger(p.worldLedger); })();
  if (p.si) { try { SIX.importSi(db, p.si); } catch (e) { log('warn', 'backup', 'si_* не восстановлены: ' + e.message, req.user); } }
  if (demoted) log('warn', 'backup', `Восстановление: ${demoted} элемент(ов) очереди переведены в «На утверждении» (исторический статус сохранён только для аудита)`, req.user);
  log('info', 'backup', `Данные восстановлены из резервной копии (предварительная копия ${path.basename(bk.file)}, SHA-256 ${bk.sha256})`, req.user);
  res.json({ ok: true, backup: { file: path.basename(bk.file), sha256: bk.sha256, size: bk.size } });
});

// ---- Files (uploads for episodes/video) ----
app.post('/api/files/upload', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
  const name = String(req.query.name || 'file').replace(/[^\w.\-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[.\-]+/, '').slice(0, 120) || 'file'; const id = core.uid();
  fs.writeFileSync(path.join(FILES_DIR, id + '-' + name), req.body);
  const o = put('files', { id, name, size: req.body.length, mime: req.headers['content-type'] || '', url: `/files/${id}-${name}`, project: req.query.project || 'main', createdAt: core.now() });
  log('info', 'files', 'Загружен файл ' + name, req.user); res.status(201).json(o);
});
app.use('/files', (req, res, next) => { const s = getSession(req) || appTokenUser(req); if (!s) return res.status(401).end(); next(); }, sec.filesHeaders, express.static(FILES_DIR, { dotfiles: 'deny', index: false, redirect: false }));

// ---- Director chat ----
// Load control (v1.2.2): the Director's Ollama generation goes through the global heavy lock (same as Blender / video_render),
// so it never runs concurrently with a heavy job. The HTTP request waits at most STUDIO_CHAT_WAIT_MS for the lock; if it is
// still held, the answer is 202 {status:'busy_queued'} and the request stays queued in the background (bounded: at most
// STUDIO_CHAT_MAX_QUEUED waiting chats, at most STUDIO_CHAT_QUEUE_MS total) — the result appears in the chat later.
const CHAT_WAIT = () => +process.env.STUDIO_CHAT_WAIT_MS || 15000, CHAT_QUEUE = () => +process.env.STUDIO_CHAT_QUEUE_MS || 10 * 60000, CHAT_MAXQ = () => +process.env.STUDIO_CHAT_MAX_QUEUED || 3;
async function llmPlan(text, onStart) {
  const it = get('integrations', 'ollama'); const model = (it && it.model) || 'qwen3:8b';
  const agents = list('agents').filter(a => a.enabled).map(a => `${a.id}: ${a.role}`).join('\n');
  const prompt = `Ты Director студии MOONKATTY. Разбей запрос на задачи для агентов. Агенты:\n${agents}\nОтветь ТОЛЬКО JSON: {"summary":"...","tasks":[{"title":"...","agentId":"...","priority":"low|normal|high|urgent","description":"..."}]}\nЗапрос: ${text}`;
  const content = await heavy.tryHeavy('ollama:director', async () => { onStart && onStart();
    const r = await fetch(it.url.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) throw new Error('Ollama HTTP ' + r.status); return (await r.json()).message.content; }, { waitMs: CHAT_QUEUE(), maxWaiting: CHAT_MAXQ() });
  const j = JSON.parse(content); const ids = new Set(list('agents').map(a => a.id));
  return { planner: 'llm:' + model, summary: j.summary || '', tasks: (j.tasks || []).map(t => ({ ...t, agentId: ids.has(t.agentId) ? t.agentId : 'director' })) };
}
function finishPlan(text, user, plan, llmError) {
  const created = plan.tasks.map(t => put('tasks', { id: core.uid(), ...(t.agentId === 'design3d' ? { kind: '3d' } : {}), title: t.title, description: t.description || '', agentId: t.agentId, priority: t.priority || 'normal',
    status: 'queued', project: /новост|news/i.test(text) ? 'news' : 'main', schedule: { type: 'none' }, createdAt: core.now(), source: 'director' }));
  const msg = put('chat', { id: core.uid(), role: 'director', at: core.now(), planner: plan.planner, llmError, text: plan.summary, taskIds: created.map(t => t.id) });
  log('info', 'director', `Запрос разобран (${plan.planner}), задач: ${created.length}`, user); return { message: msg, tasks: created };
}
app.post('/api/director/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim(); if (!text) return res.status(400).json({ error: 'empty' });
  put('chat', { id: core.uid(), role: 'user', text, at: core.now(), user: req.user });
  const user = req.user; let started; const acquired = new Promise(r => started = r);
  const work = llmPlan(text, () => started({ acquired: true })).then(plan => ({ plan, llmError: null }), e => e.busy && e.code === 'queue_full' ? { full: e } : ({ plan: core.rulePlan(text), llmError: e.busy ? 'busy: ' + e.message : String(e.cause?.code || e.message) }));
  const timer = new Promise(r => setTimeout(() => r({ waiting: true }), CHAT_WAIT()));
  let first = await Promise.race([work, acquired, timer]); if (first.acquired) first = await work; // lock taken in time → wait for the answer
  if (first.full) { const hs = heavy.status(); res.setHeader('Retry-After', '30'); return res.status(429).json({ status: 'busy', code: 'queue_full', error: `Студия занята (${hs.holder || 'тяжёлая задача'}), очередь чата заполнена — повторите позже`, heavy: hs }); }
  if (first.waiting) { const hs = heavy.status();
    const note = put('chat', { id: core.uid(), role: 'director', at: core.now(), planner: 'queued', text: `Студия занята (${hs.holder || 'тяжёлая задача'}) — запрос поставлен в очередь, ответ появится здесь после её завершения.` });
    res.status(202).json({ status: 'busy_queued', message: note, heavy: hs, tasks: [] });
    const r = await work; if (r.full) return; finishPlan(text, user, r.plan, r.llmError); return; }
  res.json(finishPlan(text, user, first.plan, first.llmError));
});

app.get('/api/health', (req, res) => { let dbOk = true; try { db.prepare('SELECT 1').get(); } catch { dbOk = false; }
  res.json({ ok: dbOk, app: 'moonkatty-ai-studio', flavor: CFG.flavor, product: CFG.product, schemaVersion: DB_SCHEMA_VERSION, mode: 'server', version: require('./package.json').version, pid: process.pid, uptimeSec: Math.round(process.uptime()), db: dbOk ? 'ok' : 'error', dbDriver: db.driver || 'better-sqlite3', keySource: metaCtx.keySource, startedAt: STARTED_AT, lastTick: q.meta.get('lastTick')?.v || null }); });
app.get('/api/runtime', async (req, res) => res.json({ ollama: await runner.ollamaStatus(), blender: await blender.detect((get('integrations', 'blender') || {}).path), opencode: { path: runner.opencodePath(), enabled: runner.opencodeEnabled() }, heavy: heavy.status(), busy: [...runner.busy.entries()].map(([a, b]) => ({ agentId: a, taskId: b.taskId })), brand: BRAND, dataDir: DATA_DIR }));
app.post('/api/agents/:id/start', (req, res) => { try { res.json(runner.start(req.params.id, req.user)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/agents/:id/stop', (req, res) => { try { res.json(runner.stop(req.params.id, req.user)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/tasks/:id/approve-code', (req, res) => { const t = get('tasks', req.params.id); if (!t || t.kind !== 'code') return res.status(400).json({ error: 'Не задача OpenCode' });
  Object.assign(t, { codeApproved: true, codeApprovedBy: req.user, codeApprovedAt: core.now(), status: t.status === 'blocked' ? 'queued' : t.status }); put('tasks', t); log('info', 'opencode', 'Разрешён запуск OpenCode: ' + t.title, req.user); res.json(t); });

let cpuPrev = os.cpus(), cpuPct = null;
setInterval(() => { const c = os.cpus(); let idle = 0, tot = 0; c.forEach((x, i) => { const p = cpuPrev[i]?.times || x.times; for (const k in x.times) tot += x.times[k] - p[k]; idle += x.times.idle - p.idle; }); cpuPct = tot ? Math.round(100 * (1 - idle / tot)) : null; cpuPrev = c; }, 5000).unref();
app.get('/api/system', (req, res) => {
  const m = process.memoryUsage(); let disk = null;
  try { const st = fs.statfsSync(path.dirname(DB_PATH)); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch {}
  res.json({
    uptimeSec: Math.round((Date.now() - STARTED) / 1000), node: process.version, platform: `${os.platform()} ${os.arch()}`,
    cpuPct, cpus: os.cpus().length, disk, hostname: os.hostname(), loadavg: os.loadavg(), memTotal: os.totalmem(), memFree: os.freemem(), rss: m.rss,
    dbPath: DB_PATH, dbSize: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    counts: Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c).length])),
    lastSchedulerTick: q.meta.get('lastTick')?.v || null, lastBackup: q.meta.get('lastBackup')?.v || null
  });
});

// ---- OpenCode server Basic Auth (password only in macOS Keychain; see lib/opencode-auth.js) ----
const oca = require('./lib/opencode-auth.js');
const ocItem = () => get('integrations', 'opencode') || { id: 'opencode', name: 'OpenCode', url: CFG.opencodeUrl, testPath: '/global/health' };
const ocServe = require('./lib/opencode-serve.js').createOpencodeServe({ log: msg => log('info', 'integration:opencode', msg) });
process.on('exit', () => { try { ocServe.stop(); } catch {} });
async function ocView() { const it = ocItem(); const ks = oca.keychainStatus();
  return { url: it.url, username: it.username || oca.DEFAULT_USER, hasPassword: ks.available ? await oca.hasPassword() : false,
    keychain: { ...ks, service: oca.SERVICE, account: oca.ACCOUNT, label: oca.LABEL }, lastTest: it.lastTest || null,
    model: it.model || '', modelEffective: it.model || CFG.opencodeModel,
    serve: { allowed: !!CFG.IS_TEST, ...ocServe.status() },
    status: !ks.available ? 'Не подключено' : (it.lastTest?.ok ? 'Подключено' : 'Не подключено') }; }
app.get('/api/opencode/auth', async (req, res) => res.json(await ocView()));
app.put('/api/opencode/auth', async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {}; const allowed = ['url', 'username', 'password', 'clearPassword'];
  if (Object.keys(b).some(k => !allowed.includes(k))) return res.status(400).json({ error: 'Недопустимые поля' });
  const it = ocItem(); const changes = [];
  if ('url' in b) { const v = oca.validateUrl(b.url); if (v.error) return res.status(400).json({ error: v.error, code: v.code }); it.url = v.url; changes.push('url'); }
  if ('username' in b) { if (!oca.validUser(b.username)) return res.status(400).json({ error: 'Логин: 1–64 символа (латиница, цифры, . _ @ -)' }); it.username = b.username; changes.push('username'); }
  if ('password' in b && b.password !== '' && b.password != null) {
    if (!oca.validPw(b.password)) return res.status(400).json({ error: 'Пароль: 1–256 печатных ASCII-символов' });
    if (!oca.keychainStatus().available) return res.status(409).json({ error: 'Не подключено: Keychain недоступна, пароль не сохранён (запасного хранилища нет)' });
    try { await oca.setPassword(b.password); } catch (e) { return res.status(e.status || 500).json({ error: oca.scrub(e.message, b.password) }); }
    changes.push('password→Keychain');
  }
  if (b.clearPassword === true) { await oca.deletePassword(); changes.push('password удалён'); }
  delete it.password; delete it.authorization; it.lastTest = changes.length ? null : it.lastTest; put('integrations', it);
  log('info', 'integration:opencode', 'Настройки OpenCode изменены: ' + (changes.join(', ') || 'без изменений'), req.user); res.json(await ocView());
});
async function ocTest(req, res) {
  const it = ocItem(); const r = await oca.test({ url: it.url, username: it.username || oca.DEFAULT_USER, sec });
  if (r.code === 'non_loopback' || r.code === 'invalid_url') { log('warn', 'integration:opencode', 'Проверка OpenCode отклонена: ' + r.detail, req.user); return res.status(400).json({ ...r, error: r.detail }); }
  it.lastTest = r; put('integrations', it); log(r.ok ? 'info' : 'error', 'integration:opencode', `Проверка OpenCode (${r.url}): ${r.ok ? 'OK' : 'ошибка — ' + r.detail}`, req.user); res.json(r);
}
app.post('/api/opencode/test', ocTest);
app.get('/api/opencode/serve', (req, res) => {
  if (!CFG.IS_TEST) return res.status(403).json({ error: 'Запуск OpenCode из приложения есть только в тестовой сборке', allowed: false });
  res.json({ allowed: true, ...ocServe.status() });
});
app.post('/api/opencode/serve', async (req, res) => {
  if (!CFG.IS_TEST) return res.status(403).json({ error: 'Запуск OpenCode из приложения есть только в тестовой сборке. Рабочий порт не используется.', allowed: false });
  const it = ocItem();
  const r = await ocServe.start({ url: it.url, username: it.username || oca.DEFAULT_USER });
  log(r.ok ? 'info' : 'warn', 'integration:opencode', r.ok ? ('OpenCode запущен на ' + r.url + (r.already ? ' (уже работал)' : '')) : ('Запуск OpenCode отклонён: ' + r.detail), req.user);
  res.status(r.ok ? 200 : (r.status || 500)).json(r.ok ? r : { ...r, error: r.detail });
});
// Integration test — real HTTP request from the server.
// Risk fix (b): SSRF-safe integration test — per-integration host allowlist, DNS resolved + every address checked,
// connect pinned to the vetted address, private/link-local/metadata IPs blocked, redirects never followed (lib/egress.js).
app.post('/api/integrations/:id/test', async (req, res) => {
  if (req.params.id === 'opencode') return ocTest(req, res);
  const it = get('integrations', req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const url = String(it.url || '').replace(/\/$/, '') + (it.testPath || '/');
  const t0 = Date.now(); const r = await egress.safeGet(it.id, url, { timeoutMs: 5000 });
  if (r.code === 'blocked_url' || r.code === 'blocked_ip') { log('warn', 'integration:' + it.id, `Проверка заблокирована (SSRF-защита): ${r.error}`, req.user); return res.status(400).json({ error: r.error, code: r.code }); }
  let detail = r.text !== undefined ? String(r.text).slice(0, 300) : r.error;
  if (it.id === 'ollama' && r.ok) { try { detail = 'Модели: ' + (JSON.parse(r.text).models || []).map(m => m.name).join(', ') || 'нет моделей'; } catch {} }
  const result = { ok: !!r.ok, status: r.status ?? null, ms: Date.now() - t0, url, detail: sec.redact(String(detail || '')), code: r.code, at: core.now(), via: 'server' };
  it.lastTest = result; put('integrations', it);
  log(result.ok ? 'info' : 'error', 'integration:' + it.id, `Проверка ${it.name} (${url}): ${result.ok ? 'OK' : 'ошибка — ' + result.detail}`);
  res.json(result);
});

app.post('/api/reports/generate', (req, res) => {
  const data = Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)]));
  const rep = core.buildReport(data, +(req.body?.periodDays) || 3); rep.trigger = 'manual';
  put('reports', rep); log('info', 'analytics', 'Сформирован отчёт за ' + rep.periodDays + ' дн.');
  res.json(rep);
});

app.post('/api/demo/remove', (req, res) => {
  let n = 0; db.transaction(() => { for (const c of core.COLLECTIONS) for (const o of list(c)) if (o.demo) { q.del.run(c, o.id); n++; } })();
  for (const w of list('workspaces')) if (w.demoAnalytics || w.audiencePlanDemo) { delete w.demoAnalytics; put('workspaces', w); }
  log('info', 'system', 'Демо-данные удалены: ' + n, req.user); res.json({ removed: n });
});
app.post('/api/reset', (req, res) => {
  if (req.body?.confirm !== 'RESET') return res.status(400).json({ error: 'confirm required' });
  db.transaction(() => { db.exec('DELETE FROM items'); const s = core.seed(); for (const c of Object.keys(s)) for (const o of s[c]) put(c, o); })();
  log('info', 'system', 'Данные сброшены к начальным', req.user); res.json({ ok: true });
});

// ---- Jobs (action log, cancel, retry, confirm) and 3D Studio ----
const jobView = j => {
  if (!j) return j;
  const cp = j.checkpoint || {}; let outputs = null;
  if (cp.projectId && cp.version) {
    const rel = `projects3d/${cp.projectId}/${cp.version}`;
    const ready = name => { try { return !!(cp.vdir && fs.existsSync(path.join(cp.vdir, name))); } catch { return false; } };
    outputs = { sceneParams: rel + '/scene_params.json', sceneParamsReady: ready('scene_params.json'), blend: rel + '/scene.blend', blendReady: ready('scene.blend'), preview: rel + '/renders/preview.png', previewReady: ready('renders/preview.png') };
  }
  return { ...j, pid: undefined, outputs, publicStatus: services.PUBLIC[j.status], task: get('tasks', j.taskId), stages: design3d.STAGES.map(s => ({ id: s, label: design3d.STAGE_LABEL[s] })) };
};
app.get('/api/jobs', (req, res) => { const s = req.query.status; res.json(jobs.list(Math.min(+req.query.limit || 30, 200)).filter(j => !s || j.status === s || services.PUBLIC[j.status] === s).map(jobView)); });
app.post('/api/jobs', (req, res) => { const b = req.body || {}; try { const r = services.jobsApi.createJob({ type: b.type, agent: 'design3d', input: b.input && typeof b.input === 'object' ? b.input : {}, timeoutSec: +b.timeoutSec || undefined, maxAttempts: +b.maxAttempts || undefined, resourceClass: b.resourceClass, requiresNode: b.requiresNode, idempotencyKey: b.idempotencyKey, safeToRetry: b.safeToRetry }); res.status(201).json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: 'not found' }); res.json({ ...jobView(j), events: jobs.events(j.id, +req.query.after || 0) }); });
app.post('/api/jobs/:id/cancel', (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: 'not found' }); if (['blender_template', 'video_render'].includes(j.kind)) { jobs.update(j.id, { status: 'cancelled' }); services.jobsApi.cancelJob(j.id); return res.json(jobView(jobs.get(j.id))); }
  const t = get('tasks', j.taskId); if (t && !['done', 'cancelled'].includes(t.status)) { t.status = 'cancelled'; put('tasks', t); }
  design3d.cancelJob(j.id); runner.cancelTask(j.taskId); log('warn', 'design3d', 'Задание отменено: ' + (t?.title || j.id), req.user); res.json(jobView(jobs.get(j.id))); });
app.post('/api/jobs/:id/retry', (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: 'not found' });
  if (!['failed', 'blocked', 'cancelled'].includes(j.status)) return res.status(400).json({ error: 'Повтор возможен только для заданий с ошибкой, блокировкой или отменённых' });
  if (j.retries >= j.maxRetries) return res.status(400).json({ error: `Лимит повторов исчерпан (${j.maxRetries})` });
  jobs.update(j.id, { status: 'queued', retries: j.retries + 1, error: null }); jobs.event(j.id, 'info', j.stage, `Повтор запрошен человеком (${j.retries + 1}/${j.maxRetries})`);
  if (j.kind === 'video_render') { const t = get('tasks', j.taskId); if (t) { Object.assign(t, { status: 'in_progress', error: null }); put('tasks', t); } services.startVideoJob(j.id); return res.json(jobView(jobs.get(j.id))); }
  const t = get('tasks', j.taskId); Object.assign(t, { status: 'queued', retryRequested: true, blockedReason: null, error: null }); put('tasks', t);
  const a = get('agents', t.agentId); if (a && a.status !== 'working') runner.start(a.id, req.user); res.json(jobView(jobs.get(j.id))); });
app.post('/api/jobs/:id/confirm', (req, res) => { const ok = design3d.confirm(req.params.id, req.body?.approve === true); if (!ok) return res.status(409).json({ error: 'Задание не ждёт подтверждения' });
  log('info', 'design3d', `Подтверждение задания ${req.params.id}: ${req.body?.approve === true ? 'разрешено' : 'отклонено'}`, req.user); res.json({ ok: true }); });
app.post('/api/studio3d/run', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 1000); if (!text) return res.status(400).json({ error: 'Опишите, что создать' });
  const a = get('agents', 'design3d'); if (!a || !a.enabled) return res.status(409).json({ error: 'Агент 3D DESIGN выключен' });
  put('chat', { id: core.uid(), role: 'user', text, at: core.now(), user: req.user });
  const pid = req.body?.projectId; if (pid != null && (!PID.test(pid) || !ws3d.exists(pid))) return res.status(400).json({ error: 'Проект не найден' });
  const t = put('tasks', { id: core.uid(), kind: '3d', ...(pid ? { projectId3d: pid } : {}), title: text.slice(0, 120), description: text.length > 120 ? text : '', agentId: 'design3d', priority: 'normal', status: 'queued', project: 'main', schedule: { type: 'none' }, createdAt: core.now(), source: 'director' });
  put('chat', { id: core.uid(), role: 'director', at: core.now(), planner: 'studio3d', text: 'Director: задача назначена агенту 3D DESIGN', taskIds: [t.id] });
  log('info', 'director', 'Задача назначена агенту 3D DESIGN: ' + t.title, req.user);
  if (a.status !== 'working') runner.start('design3d', req.user); else runner.tick(); res.status(201).json(t); });
const SAFE_PATH = /^\/[^\0\n\r]{1,400}$/, SAFE_MODEL = /^[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._:\/-]{1,128}$/;
app.get('/api/studio3d/status', async (req, res) => { const bi = get('integrations', 'blender') || {}; const oc = get('integrations', 'opencode') || {};
  res.json({ blender: await blender.detect(bi.path, { force: req.query.refresh === '1' }), blenderPath: bi.path || '', opencode: await ocView(), opencodeModel: oc.model || '', agent: get('agents', 'design3d') }); });
app.put('/api/studio3d/settings', (req, res) => { const b = req.body || {};
  if ('blenderPath' in b) { if (b.blenderPath && !SAFE_PATH.test(b.blenderPath)) return res.status(400).json({ error: 'Путь к Blender: абсолютный путь' }); const it = get('integrations', 'blender') || { id: 'blender', name: 'Blender' }; it.path = b.blenderPath || ''; put('integrations', it); }
  if ('opencodeModel' in b) { if (b.opencodeModel && !SAFE_MODEL.test(b.opencodeModel)) return res.status(400).json({ error: 'Модель: provider/model, например ollama/qwen3:8b или ollama/qwen2.5-coder:7b' }); const it = ocItem(); it.model = b.opencodeModel || ''; put('integrations', it); }
  log('info', 'studio3d', 'Настройки 3D Studio изменены: ' + Object.keys(b).join(', '), req.user); res.json({ ok: true }); });
app.get('/api/projects3d/:pid/:ver/file', (req, res) => { if (!/^(scene\.blend|renders\/preview\.png|renders\/anim\/frame_\d{4}\.png|exports\/scene\.(glb|fbx))$/.test(String(req.query.name || ''))) return res.status(404).json({ error: 'not found' }); let f; try { f = ws3d.file(req.params.pid, req.params.ver, String(req.query.name || '')); } catch { f = null; }
  if (!f) return res.status(404).json({ error: 'not found' }); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  if (!/\.png$/i.test(f) || req.query.download === '1') res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(f).replace(/[^A-Za-z0-9._-]/g, '_') + '"'); res.sendFile(f); });
// Deleting a version is a dangerous action: two steps (policy → confirm:true).
app.delete('/api/projects3d/:pid/:ver', (req, res) => { let dir; try { dir = path.join(ws3d.projDir(req.params.pid), req.params.ver); } catch (e) { return res.status(400).json({ error: e.message }); }
  const d = policy.decide({ type: 'fs.delete', ws: ws3d.root, path: dir });
  if (d.decision === 'deny') return res.status(403).json({ error: d.reason, rule: d.rule });
  if (req.body?.confirm !== true) return res.status(409).json({ needsConfirmation: true, rule: d.rule, error: d.reason });
  if (jobs.list(500).some(j => j.checkpoint?.projectId === req.params.pid && j.checkpoint?.version === req.params.ver && ['running', 'queued', 'waiting_confirmation'].includes(j.status))) return res.status(409).json({ error: 'Версия используется выполняющимся заданием' });
  let backup; try { backup = ws3d.removeVersion(req.params.pid, req.params.ver); } catch (e) { return res.status(400).json({ error: e.message }); }
  const m = ws3d.manifest(req.params.pid); if (m.versions?.[req.params.ver]) { m.versions[req.params.ver].deleted = { at: core.now(), by: req.user, backup: path.relative(ws3d.root, backup) }; ws3d.manifest(req.params.pid, { versions: { [req.params.ver]: m.versions[req.params.ver] } }); }
  log('warn', 'studio3d', `Удалена версия ${req.params.pid}/${req.params.ver} (подтверждено, резервная копия ${path.relative(ws3d.root, backup)})`, req.user); res.json({ ok: true, backup: path.relative(ws3d.root, backup) }); });
// ---- Stage C: projects, references, versions, review, re-render ----
const PID = /^[A-Za-z0-9_-]{1,64}$/, VER = /^v\d{3}$/;
const projOk = (req, res) => { if (!PID.test(req.params.pid) || !ws3d.exists(req.params.pid)) { res.status(404).json({ error: 'Проект не найден' }); return false; } if (req.params.ver !== undefined && (!VER.test(req.params.ver) || !fs.existsSync(path.join(ws3d.projDir(req.params.pid), req.params.ver)))) { res.status(404).json({ error: 'Версия не найдена' }); return false; } return true; };
app.get('/api/projects3d', (req, res) => res.json(ws3d.list()));
app.post('/api/projects3d', (req, res) => { const id = 'p_' + core.uid(); fs.mkdirSync(ws3d.projDir(id), { recursive: true, mode: 0o700 }); ws3d.manifest(id, { title: String(req.body?.title || '').slice(0, 80) || id, createdAt: core.now(), createdBy: req.user }); log('info', 'studio3d', 'Создан 3D-проект ' + id, req.user); res.status(201).json({ id }); });
app.get('/api/projects3d/:pid', (req, res) => { if (!projOk(req, res)) return; const m = ws3d.manifest(req.params.pid);
  res.json({ id: req.params.pid, title: m.title, references: m.references || [], versions: ws3d.versions(req.params.pid).map(v => ws3d.versionInfo(req.params.pid, v)).reverse(), deleted: Object.entries(m.versions || {}).filter(([, x]) => x.deleted).map(([v, x]) => ({ version: v, ...x.deleted })) }); });
app.post('/api/projects3d/:pid/references', express.raw({ type: () => true, limit: ws3d.REF_MAX + 1024 }), (req, res) => { if (!projOk(req, res)) return;
  try { const r = ws3d.addReference(req.params.pid, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.query.name || '')); log('info', 'studio3d', `Референс ${r.duplicate ? '(уже был) ' : ''}${r.name} → ${req.params.pid} (sha256 ${r.sha256.slice(0, 12)}…)`, req.user); res.status(r.duplicate ? 200 : 201).json(r); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
app.get('/api/projects3d/:pid/references/:sha', (req, res) => { if (!projOk(req, res)) return; const f = ws3d.refFile(req.params.pid, req.params.sha); if (!f) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', f.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox"); res.setHeader('Cache-Control', 'no-store'); res.sendFile(f.path); });
function new3dTask(fields, user) { const a = get('agents', 'design3d'); if (!a || !a.enabled) throw Object.assign(new Error('Агент 3D DESIGN выключен'), { status: 409 });
  const t = put('tasks', { id: core.uid(), kind: '3d', agentId: 'design3d', priority: 'normal', status: 'queued', project: 'main', schedule: { type: 'none' }, createdAt: core.now(), source: 'director', ...fields });
  if (a.status !== 'working') runner.start('design3d', user); else runner.tick(); return t; }
// Human review of a finished 3D job. The ONLY way to approve/reject (generic CRUD cannot set status of 3D tasks).
app.post('/api/jobs/:id/review', (req, res) => { const j = jobs.get(req.params.id); if (!j || j.kind !== '3d') return res.status(404).json({ error: 'not found' });
  const action = req.body?.action, comment = String(req.body?.comment ?? '').trim();
  if (!['approve', 'rework', 'reject'].includes(action)) return res.status(400).json({ error: 'action: approve | rework | reject' });
  if (j.status !== 'waiting_approval') return res.status(409).json({ error: 'Задание не ждёт утверждения (статус ' + j.status + ')' });
  if (action === 'rework' && (comment.length < 3 || comment.length > 500)) return res.status(400).json({ error: 'Комментарий к доработке: 3–500 символов' });
  if (comment.length > 500) return res.status(400).json({ error: 'Комментарий: до 500 символов' });
  const cp = j.checkpoint, t = get('tasks', j.taskId); const review = { decision: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'rework', by: req.user, at: core.now(), comment: comment || null };
  const m = ws3d.manifest(cp.projectId); const ve = m.versions?.[cp.version] || {}; ws3d.manifest(cp.projectId, { versions: { [cp.version]: { ...ve, review } } });
  jobs.update(j.id, { status: action === 'approve' ? 'done' : 'rejected' }); jobs.event(j.id, 'info', 'verify', `Решение человека: ${review.decision}${comment ? ' — ' + comment : ''}`, 'review.' + action);
  if (t) { Object.assign(t, { status: action === 'approve' ? 'done' : 'cancelled', review }, action === 'approve' ? { completedAt: core.now() } : {}); put('tasks', t); }
  let next = null;
  if (action === 'rework') { try { next = new3dTask({ title: ('Доработка ' + cp.version + ': ' + comment).slice(0, 120), description: comment, projectId3d: cp.projectId, reworkOf: j.id, comment, baseParams: cp.params, baseVersion: cp.version }, req.user); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); } }
  log('info', 'studio3d', `Версия ${cp.projectId}/${cp.version}: ${review.decision}${comment ? ' — ' + comment : ''}`, req.user); res.json({ ok: true, review, nextTask: next }); });
// Re-run the vetted template with new lighting/camera/animation/render params (no agent; new version from the chosen one).
app.post('/api/projects3d/:pid/:ver/rerender', (req, res) => { if (!projOk(req, res)) return; const info = ws3d.versionInfo(req.params.pid, req.params.ver); if (!info.params) return res.status(400).json({ error: 'У версии нет проверенных параметров' });
  const b = req.body || {}; const allowed = ['lighting', 'camera', 'animation', 'render', 'exports', 'background']; const bad = Object.keys(b).filter(k => !allowed.includes(k)); if (bad.length) return res.status(400).json({ error: 'Недопустимые поля: ' + bad.join(', ') });
  const p = JSON.parse(JSON.stringify(info.params)); for (const k of allowed) if (k in b) p[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? { ...p[k], ...b[k] } : b[k];
  const v = SP.validate(p); if (!v.ok) return res.status(400).json({ error: 'Параметры: ' + v.errors.join('; '), errors: v.errors });
  try { const t = new3dTask({ title: `Перерендер ${req.params.ver}: свет ${v.params.lighting}, кадров ${v.params.animation.frames}`, projectId3d: req.params.pid, presetParams: v.params, skipAgent: true, baseVersion: req.params.ver }, req.user);
    log('info', 'studio3d', `Перерендер ${req.params.pid}/${req.params.ver}`, req.user); res.status(201).json(t); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });


world.mount(app); // v1.3.0-test: mission, CEO, QC, revenue, growth. Social publisher is not mounted here.
// Generic CRUD
const okCol = (req, res, next) => core.COLLECTIONS.includes(req.params.col) ? next() : res.status(404).json({ error: 'unknown collection' });
app.get('/api/:col', okCol, (req, res) => res.json(list(req.params.col)));
app.get('/api/:col/:id', okCol, (req, res) => { const o = get(req.params.col, req.params.id); o ? res.json(o) : res.status(404).json({ error: 'not found' }); });
// Server-managed fields that must never be set through generic CRUD (approval bypass / audit tampering).
const PROTECTED = { integrations: ['password', 'authorization', 'lastTest'], tasks: ['codeApproved', 'codeApprovedBy', 'codeApprovedAt', 'startedAt', 'finishedAt'], agents: ['actionLog'], queue: ['history', 'publishedAt', 'externalId', 'publication', 'historical_status', 'historical_externalId', 'historical_publishedAt'], comments: ['repliedAt', 'replyId'] };
const stripProtected = (col, b) => { const o = Object.assign({}, b); for (const k of PROTECTED[col] || []) delete o[k]; if (col === 'tasks' && 'kind' in o) o.codeApproved = false; return o; };
// QA-APR-001/002: publishing queue status rules (server-enforced; the UI cannot bypass them).
//  • new items always start as pending_approval (POST cannot create approved/retry/published items);
//  • approved/retry only via PUT, and only after fact-check guardrails + daily limits pass;
//  • published ONLY via the internal publisher (sealPublication) after a verified platform response; any HTTP attempt → 403.
//  • TEST build: publishing is disabled entirely (no meta.tick, no /publish, no reply).
const QUEUE_ENTRY = 'pending_approval', QUEUE_GATED = ['approved', 'retry'];
// v1.2.4 (Studio 4): a new comment can never arrive 'approved'/'replied' — approval is a separate owner action (PUT, UI button).
app.post('/api/comments', (req, res, next) => { if (req.body && typeof req.body === 'object' && !['new', 'drafted'].includes(req.body.status)) req.body.status = 'new'; next(); });
app.use('/api/queue', (req, res, next) => { if (!['POST', 'PUT'].includes(req.method) || !req.body || typeof req.body !== 'object') return next();
  if (req.method === 'POST' && req.path === '/') { req.body.status = QUEUE_ENTRY; delete req.body.nextRetryAt; return next(); }
  // Security recheck v1.2.2-test: NO HTTP route can set "published"/externalId — on every flavor.
  if (req.method === 'PUT' && (req.body.status === 'published' || 'externalId' in req.body || 'publishedAt' in req.body || 'publication' in req.body)) return res.status(403).json({ error: 'Статус «опубликовано» и externalId ставит только модуль публикации после ответа платформы', code: 'published_internal_only' });
  next(); });
app.use('/api/:col', (req, res, next) => { if (['POST', 'PUT'].includes(req.method) && req.body && typeof req.body === 'object' && PROTECTED[req.params.col]) req.body = stripProtected(req.params.col, req.body); next(); });
// OpenCode URL must pass the same loopback validation when written through generic CRUD.
app.use('/api/integrations', (req, res, next) => { if (!['POST', 'PUT'].includes(req.method) || !req.body || typeof req.body !== 'object') return next();
  const id = req.path.split('/')[1] || req.body.id; if (id !== 'opencode') return next();
  for (const k of ['username']) if (k in req.body && !oca.validUser(req.body[k])) return res.status(400).json({ error: 'Неверный логин' });
  if ('url' in req.body) { const v = oca.validateUrl(req.body.url); if (v.error) return res.status(400).json({ error: v.error, code: v.code }); req.body.url = v.url; } next(); });
// 3D tasks: status/approval only through /api/jobs/:id/review|cancel|retry; pipeline fields are server-managed.
const T3D = ['jobId', 'review', 'reworkOf', 'baseParams', 'presetParams', 'skipAgent', 'projectId3d', 'baseVersion', 'retryRequested', 'result'];
app.use('/api/tasks', (req, res, next) => { if (!['POST', 'PUT'].includes(req.method) || !req.body || typeof req.body !== 'object') return next();
  const id = req.path.split('/')[1]; const cur = id ? get('tasks', id) : null; const is3d = (cur && (cur.kind === '3d' || cur.agentId === 'design3d')) || req.body.kind === '3d' || req.body.agentId === 'design3d';
  if (!is3d) return next(); for (const k of T3D) delete req.body[k];
  if (req.method === 'PUT' && 'status' in req.body && req.body.status !== cur?.status) return res.status(403).json({ error: 'Статус 3D-задачи меняется только через 3D Studio (утверждение/отмена/повтор)' });
  if (req.method === 'PUT' && ('kind' in req.body || 'agentId' in req.body)) return res.status(403).json({ error: 'Нельзя менять тип/агента 3D-задачи' });
  if (req.method === 'POST') req.body.status = 'queued'; next(); });
app.post('/api/:col', okCol, (req, res) => {
  const o = Object.assign({}, req.body, { id: req.body.id || core.uid(), createdAt: core.now() });
  if (req.params.col === 'tasks' && o.schedule && o.schedule.type !== 'none') o.nextRunAt = core.nextRun(o.schedule);
  put(req.params.col, o); if (req.params.col !== 'logs') log('info', req.params.col, `Создано: ${o.title || o.name || o.id}`, req.user);
  res.status(201).json(o);
});
app.put('/api/:col/:id', okCol, (req, res) => {
  const cur = get(req.params.col, req.params.id); if (!cur) return res.status(404).json({ error: 'not found' });
  if (req.params.col === 'queue' && QUEUE_GATED.includes(req.body.status)) {
    const cand = Object.assign({}, cur, req.body); const data = { queue: list('queue'), episodes: list('episodes') };
    const issues = [...S.guardrails(cand, data), ...S.dailyCheck(cand, data.queue, list('workspaces'))];
    if (issues.length) { log('warn', 'publishing', `Утверждение заблокировано «${cur.title}»: ${issues.join('; ')}`, req.user); return res.status(400).json({ error: issues.join('; '), issues }); }
  }
  if (req.params.col === 'queue' && req.body.status && req.body.status !== cur.status) req.body.history = [...(cur.history || []), { at: core.now(), event: req.body.status, user: req.user }];
  const o = Object.assign(cur, req.body, { id: cur.id, updatedAt: core.now() });
  if (req.params.col === 'tasks') {
    if (req.body.status === 'done' && !o.completedAt) o.completedAt = core.now();
    if ('schedule' in req.body) o.nextRunAt = core.nextRun(o.schedule);
  }
  put(req.params.col, o); if (req.params.col !== 'logs') log('info', req.params.col, `Изменено: ${o.title || o.name || o.id} (${Object.keys(req.body).join(', ')})`, req.user); res.json(o);
});
app.delete('/api/:col/:id', okCol, (req, res) => {
  const r = q.del.run(req.params.col, req.params.id);
  if (r.changes && req.params.col !== 'logs') log('info', req.params.col, `Удалено: ${req.params.id}`, req.user);
  res.json({ ok: r.changes > 0 });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => { // body-parser messages can quote the request body (e.g. a password) — never log/return them
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') { log('warn', 'http', `${req.method} ${req.path}: неверное тело запроса (${err.type})`); return res.status(400).json({ error: 'Неверное тело запроса' }); }
  if (err.code === 'published_internal_only') return res.status(403).json({ error: err.message, code: err.code });
  log('error', 'http', `${req.method} ${req.path}: ${err.message}`); res.status(500).json({ error: sec.redact(err.message) }); });

// Scheduler: every 30s; auto-report every 3 days.
function tick() {
  try {
    for (const ch of core.schedulerTick(list('tasks'))) {
      const t = get('tasks', ch.id); Object.assign(t, ch.changes); put('tasks', t); if (ch.log) log(ch.log.level, ch.log.source, ch.log.message);
    }
    const last = q.meta.get('lastAutoReport')?.v;
    if (!last || Date.now() - new Date(last) >= 3 * 86400000) {
      const data = Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)]));
      const rep = core.buildReport(data, 3); rep.trigger = 'auto'; put('reports', rep);
      q.setMeta.run('lastAutoReport', rep.createdAt); log('info', 'analytics', 'Автоматический отчёт за 3 дня сформирован');
    }
    if (!CFG.IS_TEST) meta.tick().catch(e => log('error', 'publishing', e.message)); // TEST build never publishes
    runner.tick();
    const lb = q.meta.get('lastBackup')?.v; if (!lb || Date.now() - new Date(lb) >= 86400000) scheduledBackup();
    q.setMeta.run('lastTick', core.now());
  } catch (e) { log('error', 'scheduler', e.message); }
}
function startBackground() { const rj = jobs.recover(); if (rj.length) log('warn', 'jobs', 'Восстановлено после перезапуска заданий: ' + rj.length); runner.recover(); world.recover(); services.resume(); setInterval(tick, 30000); tick(); setInterval(() => runner.tick(), 5000); }

process.on('uncaughtException', e => { try { log('error', 'process', e.stack || e.message); } catch {} console.error(e); });
// Single instance: if the port is taken by our own server, exit cleanly (launchd will not restart on success).
const PID_FILE = path.join(path.dirname(DB_PATH), 'server.pid');
const srv = app.listen(PORT, HOST, err => { if (err) return; startBackground(); fs.writeFileSync(PID_FILE, String(process.pid)); console.log(`${CFG.product}: http://${HOST}:${PORT} (pid ${process.pid}, db ${db.driver || 'better-sqlite3'})`); });
srv.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  let ours = false; try { ours = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) })).json()).app === 'moonkatty-ai-studio'; } catch {}
  console.error(ours ? `Сервер уже запущен на порту ${PORT} — второй экземпляр не нужен` : `Порт ${PORT} занят другим процессом`); process.exit(ours ? 0 : 3);
});
const shutdown = sig => { console.log('Остановка по ' + sig); srv.close(); try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {} try { db.close(); } catch {} process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
