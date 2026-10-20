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

const PORT = +process.env.PORT || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.STUDIO_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'studio.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
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
const put = (col, obj) => { q.put.run(col, obj.id, JSON.stringify(obj)); return obj; };
function log(level, source, message, user) {
  put('logs', { id: core.uid(), at: core.now(), level, source, message: sec.redact(message), user: user || null });
  const logs = list('logs'); if (logs.length > 2000) { logs.sort((a, b) => a.at.localeCompare(b.at)); for (const l of logs.slice(0, logs.length - 2000)) q.del.run('logs', l.id); }
}

if (!q.meta.get('seeded')) {
  db.transaction(() => { const s = core.seed(); for (const col of Object.keys(s)) for (const o of s[col]) put(col, o); q.setMeta.run('seeded', core.now()); })();
  log('info', 'system', 'База данных создана, начальные данные загружены');
}
{ const miss = core.missingSeed(Object.fromEntries(['agents', 'channels', 'workspaces', 'integrations'].map(c => [c, list(c)])));
  const n = Object.values(miss).reduce((a, x) => a + x.length, 0); if (n) { for (const c in miss) for (const o of miss[c]) put(c, o); log('info', 'system', 'Обновление: добавлены новые элементы — ' + n); } }

const app = express();
app.disable('x-powered-by');
app.use(sec.headers);
app.use(sec.hostCheck(PORT));          // DNS-rebinding protection (STUDIO_ALLOWED_HOSTS for a Tailscale name)
app.use('/api', sec.csrfCheck(PORT));  // Origin + X-Studio-Request on state-changing calls
const jsonSmall = express.json({ limit: '2mb' });
app.use((req, res, next) => req.path === '/api/restore' ? next() : jsonSmall(req, res, next));
const STARTED = Date.now();


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
const metaCtx = { q, get, put, list, log, DB_PATH, express, db };
const meta = require('./meta.js')(app, metaCtx);
// ---- Studio Operations (feature flags, off by default; see docs/ops/) ----
const ops = require('./lib/ops/index.js')({ env: process.env, dataDir: path.dirname(DB_PATH), log, q });
const runner = require('./runner.js')({ get, put, list, log, core, meta, dataDir: path.dirname(DB_PATH), brand: BRAND, admit: ops.admit, release: ops.release, runViaNode: ops.runViaNode, can: ops.can, wrapUntrusted: ops.wrapUntrusted });
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
const mobile = ops.mountMobile(app, { q, get, put, list, log, sec, core, S, runner, filesDir: FILES_DIR, ownerUser: req => getSession(req)?.user || appTokenUser(req), memory: () => memSampler.last }); // before main auth: own scoped token
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  const s = getSession(req); if (!s || s.exp < Date.now()) { const au = appTokenUser(req); if (au) { req.user = au; return next(); } return res.status(401).json({ error: 'auth required' }); }
  req.user = s.user; next();
});
if (mobile) mobile.mountAdmin();
app.get('/api/ops/status', (req, res) => res.json(ops.status()));
ops.mountProtected(app, { q, get, put, list, log, sec, core, runner, db, openDb, filesDir: FILES_DIR, version: require('./package.json').version, memory: () => memSampler.last,
  checkPassword: (user, pw) => { const h = getUsers()[user]; return !!h && checkPw(pw, h); } });
app.post('/api/auth/password', (req, res) => {
  const u = getUsers(); const { oldPassword, newPassword } = req.body || {};
  if (!checkPw(String(oldPassword || ''), u[req.user])) return res.status(400).json({ error: 'Старый пароль неверен' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Новый пароль: мин. 8 символов' });
  u[req.user] = hashPw(newPassword); setUsers(u); log('info', 'auth', 'Пароль изменён', req.user); res.json({ ok: true });
});

meta.mountProtected();

// ---- Backup / restore ----
const dump = () => ({ app: 'moonkatty-ai-studio', version: 1, exportedAt: core.now(), data: Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)])) });
function scheduledBackup() {
  const f = path.join(BACKUP_DIR, 'backup-' + core.now().replace(/[:.]/g, '-') + '.json'); fs.writeFileSync(f, JSON.stringify(dump()));
  const all = fs.readdirSync(BACKUP_DIR).filter(x => x.endsWith('.json')).sort(); for (const x of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(BACKUP_DIR, x));
  q.setMeta.run('lastBackup', core.now()); log('info', 'backup', 'Резервная копия: ' + path.basename(f));
}
app.get('/api/backup', (req, res) => { log('info', 'backup', 'Экспорт резервной копии', req.user); res.setHeader('Content-Disposition', 'attachment; filename="moonkatty-studio-backup.json"'); res.json(dump()); });
app.get('/api/backups', (req, res) => res.json(fs.readdirSync(BACKUP_DIR).filter(x => x.endsWith('.json')).sort().reverse()));
app.post('/api/backups/run', (req, res) => { scheduledBackup(); res.json({ ok: true }); });
app.post('/api/restore', express.json({ limit: '50mb' }), (req, res) => {
  const d = req.body?.data; if (!d || typeof d !== 'object') return res.status(400).json({ error: 'Неверный файл резервной копии' });
  db.transaction(() => { for (const c of core.COLLECTIONS) if (Array.isArray(d[c])) { db.prepare('DELETE FROM items WHERE col = ?').run(c); for (const o of d[c]) if (o && o.id) put(c, o); } })();
  log('info', 'backup', 'Данные восстановлены из резервной копии', req.user); res.json({ ok: true });
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
async function llmPlan(text) {
  const it = get('integrations', 'ollama'); const model = (it && it.model) || 'qwen3:8b';
  const agents = list('agents').filter(a => a.enabled).map(a => `${a.id}: ${a.role}`).join('\n');
  const prompt = `Ты Director студии MOONKATTY. Разбей запрос на задачи для агентов. Агенты:\n${agents}\nОтветь ТОЛЬКО JSON: {"summary":"...","tasks":[{"title":"...","agentId":"...","priority":"low|normal|high|urgent","description":"..."}]}\nЗапрос: ${text}`;
  const r = await fetch(it.url.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
  const j = JSON.parse((await r.json()).message.content); const ids = new Set(list('agents').map(a => a.id));
  return { planner: 'llm:' + model, summary: j.summary || '', tasks: (j.tasks || []).map(t => ({ ...t, agentId: ids.has(t.agentId) ? t.agentId : 'director' })) };
}
app.post('/api/director/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim(); if (!text) return res.status(400).json({ error: 'empty' });
  put('chat', { id: core.uid(), role: 'user', text, at: core.now(), user: req.user });
  let plan, llmError = null;
  try { plan = await llmPlan(text); } catch (e) { llmError = String(e.cause?.code || e.message); plan = core.rulePlan(text); }
  const created = plan.tasks.map(t => put('tasks', ops.guardPlannedTask({ id: core.uid(), title: t.title, description: t.description || '', agentId: t.agentId, priority: t.priority || 'normal',
    status: 'queued', project: /новост|news/i.test(text) ? 'news' : 'main', schedule: { type: 'none' }, createdAt: core.now(), source: 'director' }, plan.planner)));
  const msg = put('chat', { id: core.uid(), role: 'director', at: core.now(), planner: plan.planner, llmError, text: plan.summary, taskIds: created.map(t => t.id) });
  log('info', 'director', `Запрос разобран (${plan.planner}), задач: ${created.length}`, req.user); res.json({ message: msg, tasks: created });
});

app.get('/api/health', (req, res) => { let dbOk = true; try { db.prepare('SELECT 1').get(); } catch { dbOk = false; }
  res.json({ ok: dbOk, app: 'moonkatty-ai-studio', mode: 'server', version: require('./package.json').version, pid: process.pid, uptimeSec: Math.round(process.uptime()), db: dbOk ? 'ok' : 'error', dbDriver: db.driver || 'better-sqlite3', keySource: metaCtx.keySource, startedAt: STARTED_AT, lastTick: q.meta.get('lastTick')?.v || null }); });
app.get('/api/runtime', async (req, res) => res.json({ ollama: await runner.ollamaStatus(), opencode: { path: runner.opencodePath(), enabled: runner.opencodeEnabled() }, busy: [...runner.busy.entries()].map(([a, b]) => ({ agentId: a, taskId: b.taskId })), brand: BRAND, dataDir: DATA_DIR }));
app.post('/api/agents/:id/start', (req, res) => { try { res.json(runner.start(req.params.id, req.user)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/agents/:id/stop', (req, res) => { try { res.json(runner.stop(req.params.id, req.user)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/tasks/:id/approve-code', (req, res) => { const t = get('tasks', req.params.id); if (!t || t.kind !== 'code') return res.status(400).json({ error: 'Не задача OpenCode' });
  Object.assign(t, { codeApproved: true, codeApprovedBy: req.user, codeApprovedAt: core.now(), status: t.status === 'blocked' ? 'queued' : t.status }); put('tasks', t); log('info', 'opencode', 'Разрешён запуск OpenCode: ' + t.title, req.user); res.json(t); });

let cpuPrev = os.cpus(), cpuPct = null;
setInterval(() => { const c = os.cpus(); let idle = 0, tot = 0; c.forEach((x, i) => { const p = cpuPrev[i]?.times || x.times; for (const k in x.times) tot += x.times[k] - p[k]; idle += x.times.idle - p.idle; }); cpuPct = tot ? Math.round(100 * (1 - idle / tot)) : null; cpuPrev = c; }, 5000).unref();
// Activity-Monitor-compatible memory (vm_stat + sysctl on macOS, MemAvailable on Linux); os.freemem() kept for compatibility.
const memSampler = require('./lib/ops/memory.js').createMemorySampler(); memSampler.sample(); setInterval(() => memSampler.sample(), 5000).unref();
app.get('/api/system', (req, res) => {
  const m = process.memoryUsage(); let disk = null;
  try { const st = fs.statfsSync(path.dirname(DB_PATH)); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch {}
  res.json({
    uptimeSec: Math.round((Date.now() - STARTED) / 1000), node: process.version, platform: `${os.platform()} ${os.arch()}`,
    cpuPct, cpus: os.cpus().length, disk, memory: memSampler.last, hostname: os.hostname(), loadavg: os.loadavg(), memTotal: os.totalmem(), memFree: os.freemem(), rss: m.rss,
    dbPath: DB_PATH, dbSize: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    counts: Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c).length])),
    lastSchedulerTick: q.meta.get('lastTick')?.v || null, lastBackup: q.meta.get('lastBackup')?.v || null
  });
});

// ---- OpenCode server Basic Auth (password only in macOS Keychain; see lib/opencode-auth.js) ----
const oca = require('./lib/opencode-auth.js');
const ocItem = () => get('integrations', 'opencode') || { id: 'opencode', name: 'OpenCode', url: 'http://127.0.0.1:4096', testPath: '/global/health' };
async function ocView() { const it = ocItem(); const ks = oca.keychainStatus();
  return { url: it.url, username: it.username || oca.DEFAULT_USER, hasPassword: ks.available ? await oca.hasPassword() : false, keychain: ks, lastTest: it.lastTest || null, status: !ks.available ? 'Не подключено' : (it.lastTest?.ok ? 'Подключено' : 'Не подключено') }; }
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
// Integration test — real HTTP request from the server.
app.post('/api/integrations/:id/test', async (req, res) => {
  if (req.params.id === 'opencode') return ocTest(req, res);
  const it = get('integrations', req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const url = String(it.url || '').replace(/\/$/, '') + (it.testPath || '/');
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Разрешены только http(s) URL' });
  const t0 = Date.now(); let result;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await r.text();
    let detail = text.slice(0, 300);
    if (it.id === 'ollama' && r.ok) { try { detail = 'Модели: ' + (JSON.parse(text).models || []).map(m => m.name).join(', ') || 'нет моделей'; } catch {} }
    result = { ok: r.ok, status: r.status, ms: Date.now() - t0, url, detail, at: core.now(), via: 'server' };
  } catch (e) {
    result = { ok: false, status: null, ms: Date.now() - t0, url, detail: String(e.cause?.code || e.name || e.message), at: core.now(), via: 'server' };
  }
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

// Generic CRUD
const okCol = (req, res, next) => core.COLLECTIONS.includes(req.params.col) ? next() : res.status(404).json({ error: 'unknown collection' });
app.get('/api/:col', okCol, (req, res) => res.json(list(req.params.col)));
app.get('/api/:col/:id', okCol, (req, res) => { const o = get(req.params.col, req.params.id); o ? res.json(o) : res.status(404).json({ error: 'not found' }); });
// Server-managed fields that must never be set through generic CRUD (approval bypass / audit tampering).
const PROTECTED = { integrations: ['password', 'authorization', 'lastTest'], tasks: ['codeApproved', 'codeApprovedBy', 'codeApprovedAt', 'startedAt', 'finishedAt'], agents: ['actionLog'], queue: ['history', 'publishedAt', 'externalId'], comments: ['repliedAt', 'replyId'] };
const stripProtected = (col, b) => { const o = Object.assign({}, b); for (const k of PROTECTED[col] || []) delete o[k]; if (col === 'tasks' && 'kind' in o) o.codeApproved = false; return o; };
app.use('/api/:col', (req, res, next) => { if (['POST', 'PUT'].includes(req.method) && req.body && typeof req.body === 'object' && PROTECTED[req.params.col]) req.body = stripProtected(req.params.col, req.body); next(); });
// OpenCode URL must pass the same loopback validation when written through generic CRUD.
app.use('/api/integrations', (req, res, next) => { if (!['POST', 'PUT'].includes(req.method) || !req.body || typeof req.body !== 'object') return next();
  const id = req.path.split('/')[1] || req.body.id; if (id !== 'opencode') return next();
  for (const k of ['username']) if (k in req.body && !oca.validUser(req.body[k])) return res.status(400).json({ error: 'Неверный логин' });
  if ('url' in req.body) { const v = oca.validateUrl(req.body.url); if (v.error) return res.status(400).json({ error: v.error, code: v.code }); req.body.url = v.url; } next(); });
app.post('/api/:col', okCol, (req, res) => {
  const o = Object.assign({}, req.body, { id: req.body.id || core.uid(), createdAt: core.now() });
  if (req.params.col === 'tasks' && o.schedule && o.schedule.type !== 'none') o.nextRunAt = core.nextRun(o.schedule);
  put(req.params.col, o); if (req.params.col !== 'logs') log('info', req.params.col, `Создано: ${o.title || o.name || o.id}`, req.user);
  res.status(201).json(o);
});
app.put('/api/:col/:id', okCol, (req, res) => {
  const cur = get(req.params.col, req.params.id); if (!cur) return res.status(404).json({ error: 'not found' });
  if (req.params.col === 'queue' && req.body.status === 'approved') {
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
  const pub = ops.publicError(err); if (pub) return res.status(500).json(pub); // Security Center: generic message + ref
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
    if (!ops.can || ops.can('publishing', 'publish')) meta.tick().catch(e => log('error', 'publishing', e.message)); // Security Center: publish capability
    runner.tick();
    const lb = q.meta.get('lastBackup')?.v; if (!lb || Date.now() - new Date(lb) >= 86400000) scheduledBackup();
    q.setMeta.run('lastTick', core.now());
  } catch (e) { log('error', 'scheduler', e.message); }
}
function startBackground() { ops.start(); runner.recover(); setInterval(tick, 30000); tick(); setInterval(() => runner.tick(), 5000); }

process.on('uncaughtException', e => { try { log('error', 'process', e.stack || e.message); } catch {} console.error(e); });
// Single instance: if the port is taken by our own server, exit cleanly (launchd will not restart on success).
const PID_FILE = path.join(path.dirname(DB_PATH), 'server.pid');
const srv = app.listen(PORT, HOST, err => { if (err) return; startBackground(); fs.writeFileSync(PID_FILE, String(process.pid)); console.log(`MOONKATTY AI STUDIO: http://${HOST}:${PORT} (pid ${process.pid}, db ${db.driver || 'better-sqlite3'})`); });
srv.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  let ours = false; try { ours = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) })).json()).app === 'moonkatty-ai-studio'; } catch {}
  console.error(ours ? `Сервер уже запущен на порту ${PORT} — второй экземпляр не нужен` : `Порт ${PORT} занят другим процессом`); process.exit(ours ? 0 : 3);
});
const shutdown = sig => { console.log('Остановка по ' + sig); srv.close(); try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {} try { db.close(); } catch {} process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
