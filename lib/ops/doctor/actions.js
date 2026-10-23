// Owner actions. The approval hash is stored in si_approvals.subject_id (the only
// existing column). The schema caps subjectId at 64 characters, which is exactly
// one sha256 hex digest, so subject_id IS that digest. The preimage is
// { actionId, params, nonce, expiresAt }. Verification recomputes it.
// Approvals core (studio-intelligence/src/approval.js) is only called via request/decide.
'use strict';
const crypto = require('crypto');
const fs = require('fs'), path = require('path');
const { doctorError } = require('./paths');
const exec = require('./exec');
const host = require('./checks/host');
const dbcheck = require('./checks/db');
const DBB = require('../../db-backup');

const TTL_MS = 10 * 60 * 1000;
const NAMESPACE = 'moonkatty_shared';
const SUBJECT_TYPE = 'project_change';

const FORBIDDEN = Object.freeze([
  'sudo', 'su', 'keychain', 'security', 'gatekeeper', 'spctl', 'xattr',
  'tailscale-up', 'tailscale-down', 'tailscale-set', 'tailscale-serve', 'tailscale-funnel',
  'opencode-auth', 'port-4096', 'kill-8787', 'kill-8687', 'kill-4096',
  'rm-rf', 'update-install', 'update-rollback', 'news-publish', 'video-publish', 'paid-api'
]);

const OWNER = {
  'svc-restart': { password: true, params: { target: ['opencode', 'ollama', 'both'] } },
  'ollama-pull': { password: true, params: { model: ['qwen3:8b'] } },
  'db-restore': { password: true, params: { backup: 'name', mode: ['verify', 'apply'] } },
  'db-vacuum': { password: true, params: {} },
  'db-reindex': { password: true, params: {} },
  'backup-prune': { password: true, params: { keep: ['7', '14', '30'] } },
  'proc-kill': { password: true, params: { pid: 'pid', name: ['ollama', 'blender', 'opencode'] } },
  'lock-reset': { password: true, params: {} },
  'server-restart': { password: true, params: { mode: ['plan', 'apply'] } }
};

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function normalize(actionId, raw) {
  if (FORBIDDEN.includes(actionId)) throw doctorError('FORBIDDEN', 'Действие запрещено: ' + actionId, 403);
  const spec = OWNER[actionId];
  if (!spec) throw doctorError('BAD_PARAMS', 'Неизвестное действие', 400);
  const input = raw && typeof raw === 'object' ? raw : {};
  const clean = {};
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(spec.params, key)) throw doctorError('BAD_PARAMS', 'Лишний параметр ' + key, 400);
  }
  for (const [key, rule] of Object.entries(spec.params)) {
    if (Array.isArray(rule)) {
      if (!rule.includes(String(input[key] ?? ''))) throw doctorError('BAD_PARAMS', 'Параметр вне списка: ' + key, 400);
      clean[key] = String(input[key]);
    } else if (rule === 'pid') {
      const pid = String(input[key] ?? '');
      if (!/^[1-9]\d{0,6}$/.test(pid)) throw doctorError('BAD_PARAMS', 'Плохой PID', 400);
      clean.pid = pid;
    } else if (rule === 'name') {
      const name = path.basename(String(input[key] ?? ''));
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name.includes('..')) throw doctorError('BAD_PARAMS', 'Плохое имя копии', 400);
      clean.backup = name;
    }
  }
  return clean;
}

function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sd_bindings (
    approval_id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    params_json TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sd_executions (
    approval_id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    at TEXT NOT NULL,
    result_json TEXT NOT NULL
  );`);
}

function createActions(ctx) {
  const db = ctx.db;
  const now = ctx.now || (() => Date.now());
  const iso = t => new Date(t).toISOString();
  ensureTables(db);
  const approvals = ctx.approvals;
  if (!approvals || typeof approvals.request !== 'function' || typeof approvals.decide !== 'function') {
    throw doctorError('BLOCKED', 'Approval Center не подключён');
  }

  function principal(user) {
    const id = String(user || '').slice(0, 64);
    if (!id) throw doctorError('FORBIDDEN', 'Нет владельца', 403);
    return { id, role: 'owner', user: id };
  }

  function request({ user, actionId, params, ttlMs }) {
    const clean = normalize(actionId, params);
    const ttl = ttlMs == null ? TTL_MS : ttlMs;
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = iso(now() + ttl);
    const requestedAt = iso(now());
    const hash = sha256(canon({ actionId, params: clean, nonce, expiresAt }));
    if (hash.length !== 64) throw doctorError('FAIL', 'Хеш не длиной 64');
    const id = 'sd' + crypto.randomBytes(8).toString('hex');
    db.prepare('INSERT INTO sd_bindings (approval_id, action_id, params_json, nonce, expires_at, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, actionId, JSON.stringify(clean), nonce, expiresAt, hash, requestedAt);
    try {
      approvals.request({
        principal: principal(user),
        request: {
          id, namespace: NAMESPACE, subjectType: SUBJECT_TYPE, subjectId: hash,
          requiredRole: 'owner', status: 'pending', autoExecute: false,
          requestedBy: principal(user).id, requestedAt,
          comment: 'system-doctor ' + actionId
        }
      });
    } catch (e) {
      db.prepare('DELETE FROM sd_bindings WHERE approval_id = ?').run(id);
      throw e;
    }
    return { approvalId: id, actionId, subjectId: hash, binding: actionId + ':' + hash, expiresAt, namespace: NAMESPACE, subjectType: SUBJECT_TYPE };
  }

  async function execute({ user, approvalId, password }) {
    if (!/^sd[a-f0-9]{16}$/.test(String(approvalId || ''))) throw doctorError('BAD_PARAMS', 'Плохой approvalId', 400);
    const binding = db.prepare('SELECT * FROM sd_bindings WHERE approval_id = ?').get(approvalId);
    if (!binding) throw doctorError('BAD_PARAMS', 'Нет привязки действия', 400);
    const row = db.prepare('SELECT id, subject_id, status, auto_execute, namespace, subject_type FROM si_approvals WHERE id = ?').get(approvalId);
    if (!row) throw doctorError('BAD_PARAMS', 'Утверждение не найдено', 404);
    const params = JSON.parse(binding.params_json);
    const expect = sha256(canon({ actionId: binding.action_id, params, nonce: binding.nonce, expiresAt: binding.expires_at }));
    if (!same(expect, binding.hash) || !same(row.subject_id, binding.hash) || row.subject_id.length !== 64) {
      throw doctorError('TAMPERED', 'Хеш параметров не совпал с subject_id', 409);
    }
    if (Date.parse(binding.expires_at) <= now()) throw doctorError('EXPIRED', 'Срок подтверждения истёк', 409);
    if (db.prepare('SELECT 1 AS n FROM sd_executions WHERE approval_id = ?').get(approvalId)) {
      throw doctorError('REPLAY', 'Действие уже выполнялось', 409);
    }
    const spec = OWNER[binding.action_id];
    if (spec.password) {
      if (typeof ctx.checkPassword !== 'function' || !ctx.checkPassword(user, String(password || ''))) {
        throw doctorError('BAD_PASSWORD', 'Неверный пароль владельца', 403);
      }
    }
    if (row.status === 'pending') {
      approvals.decide({ principal: principal(user), approvalId, action: 'approved', comment: 'system-doctor' });
    }
    const after = db.prepare('SELECT status, auto_execute, subject_id FROM si_approvals WHERE id = ?').get(approvalId);
    if (!after || after.status !== 'approved' || after.auto_execute !== 0 || !same(after.subject_id, binding.hash)) {
      throw doctorError('FORBIDDEN', 'Утверждение не в статусе approved', 403);
    }
    const claimAt = iso(now());
    try {
      db.prepare('INSERT INTO sd_executions (approval_id, action_id, at, result_json) VALUES (?, ?, ?, ?)').run(approvalId, binding.action_id, claimAt, '{"pending":true}');
    } catch { throw doctorError('REPLAY', 'Действие уже выполнялось', 409); }
    let result;
    try { result = await HANDLERS[binding.action_id](params, ctx); }
    catch (e) {
      result = { ok: false, status: e.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'FAIL', summary: e.message };
    }
    db.prepare('UPDATE sd_executions SET result_json = ? WHERE approval_id = ?').run(JSON.stringify(result).slice(0, 4000), approvalId);
    if (ctx.log) ctx.log(result && result.ok === false ? 'warn' : 'info', 'doctor', `действие ${binding.action_id} выполнено (${approvalId})`, user);
    return { ok: result.ok !== false, approvalId, actionId: binding.action_id, result };
  }

  function pending() {
    return db.prepare(`SELECT b.approval_id AS approvalId, b.action_id AS actionId, b.expires_at AS expiresAt, b.hash AS subjectId, a.status AS status
      FROM sd_bindings b LEFT JOIN si_approvals a ON a.id = b.approval_id
      ORDER BY b.created_at DESC LIMIT 50`).all();
  }

  return { request, execute, pending, canon, sha256 };
}

async function restartOpencode(ctx) {
  try {
    const serve = ctx.opencodeServe || require('../../opencode-serve').createOpencodeServe({ log: () => {} });
    const r = await serve.start({ url: 'http://127.0.0.1:4097' });
    if (!r.ok) return { ok: false, status: 'BLOCKED', summary: r.detail || 'OpenCode не перезапущен', port: 4097 };
    return { ok: true, status: 'OK', summary: 'OpenCode на 4097: ' + (r.already ? 'уже запущен' : 'запущен'), port: 4097 };
  } catch (e) {
    return { ok: false, status: 'BLOCKED', summary: e.message, port: 4097 };
  }
}

async function restartOllama() {
  const r = await exec.run('ollama.restart', { platform: 'darwin' });
  if (process.platform !== 'darwin' || r.status === 'BLOCKED') {
    return { ok: false, status: 'BLOCKED', summary: 'Перезапуск Ollama через brew services доступен на Mac. sudo и systemctl не используются.' };
  }
  return { ok: r.ok, status: r.ok ? 'OK' : 'FAIL', summary: r.ok ? 'brew services restart ollama' : 'Код ' + r.code };
}

const HANDLERS = {
  async 'svc-restart'(params, ctx) {
    const out = {};
    if (params.target === 'opencode' || params.target === 'both') out.opencode = await restartOpencode(ctx);
    if (params.target === 'ollama' || params.target === 'both') out.ollama = await restartOllama();
    const ok = Object.values(out).some(x => x && x.ok);
    const blocked = Object.values(out).every(x => x && x.status === 'BLOCKED');
    return { ok, status: blocked ? 'BLOCKED' : (ok ? 'OK' : 'FAIL'), summary: Object.values(out).map(x => x.summary).join(' · '), services: out };
  },
  async 'ollama-pull'(params) {
    if (params.model !== 'qwen3:8b') throw doctorError('FORBIDDEN', 'Модель вне списка', 403);
    const r = await exec.run('ollama.pull', { platform: 'darwin', timeoutMs: 5000 });
    if (process.platform !== 'darwin' || r.status === 'BLOCKED') {
      return { ok: false, status: 'BLOCKED', summary: 'ollama pull qwen3:8b не запускался: бинарник ollama не найден (модель не скачивается)' };
    }
    return { ok: r.ok, status: r.timedOut ? 'TIMEOUT' : (r.ok ? 'OK' : 'FAIL'), summary: 'ollama pull qwen3:8b' };
  },
  async 'db-restore'(params, ctx) {
    const dir = path.resolve(ctx.backupDir || '');
    if (!ctx.backupDir) throw doctorError('BLOCKED', 'Каталог копий не задан');
    const file = path.resolve(dir, params.backup);
    if (path.dirname(file) !== dir || !fs.existsSync(file)) throw doctorError('BAD_PARAMS', 'Копия не найдена', 400);
    const side = file + '.sha256';
    if (fs.existsSync(side)) {
      const want = fs.readFileSync(side, 'utf8').trim().split(/\s+/)[0];
      const got = DBB.sha256File(file);
      if (want !== got) return { ok: false, status: 'FAIL', summary: 'SHA-256 копии не совпал' };
    }
    const checked = dbcheck.integrityOn(ctx.openDb, file);
    if (params.mode === 'verify') return { ok: checked.status === 'OK', status: checked.status, summary: 'Проверка копии: ' + checked.summary, live: false };
    const preview = path.join(require('./paths').makeTemp(), 'restored.db');
    fs.copyFileSync(file, preview);
    const again = dbcheck.integrityOn(ctx.openDb, preview);
    return { ok: again.status === 'OK', status: again.status, summary: 'Копия восстановлена во временный файл, живая база не заменялась', live: false, preview: path.basename(path.dirname(preview)) };
  },
  async 'db-vacuum'(_params, ctx) {
    ctx.db.exec('VACUUM');
    return { ok: true, status: 'OK', summary: 'VACUUM выполнен' };
  },
  async 'db-reindex'(_params, ctx) {
    ctx.db.exec('REINDEX');
    return { ok: true, status: 'OK', summary: 'REINDEX выполнен' };
  },
  async 'backup-prune'(params, ctx) {
    const dir = ctx.backupDir;
    const keep = +params.keep;
    const names = fs.readdirSync(dir).filter(n => /^(sd-|pre-|backup-)[A-Za-z0-9._-]+\.(db|json)$/.test(n)).sort();
    const drop = names.slice(0, Math.max(0, names.length - keep));
    for (const name of drop) {
      const full = path.join(dir, name);
      if (path.dirname(full) !== dir) throw doctorError('FORBIDDEN', 'Выход из каталога копий', 403);
      fs.rmSync(full, { force: true });
      fs.rmSync(full + '.sha256', { force: true });
    }
    return { ok: true, status: 'OK', summary: 'Удалено старых копий: ' + drop.length, removed: drop.length };
  },
  async 'proc-kill'(params, ctx) {
    const pid = +params.pid;
    const ps = await exec.run('proc.ps', ctx);
    const rows = host.parsePs(ps.stdout);
    const hit = rows.find(r => r.pid === pid && r.comm === params.name);
    if (!hit) throw doctorError('FORBIDDEN', 'PID не из списка ollama/blender/opencode', 403);
    for (const port of host.PROTECTED_PORTS) {
      const pids = await host.pidsOnPort(port, ctx);
      if (pids.includes(pid)) throw doctorError('FORBIDDEN', 'Нельзя завершать процесс порта ' + port, 403);
    }
    process.kill(pid, 'SIGTERM');
    return { ok: true, status: 'OK', summary: 'SIGTERM отправлен ' + params.name + ' ' + pid, pid };
  },
  async 'lock-reset'(_params, ctx) {
    const st = ctx.heavy && ctx.heavy.status ? ctx.heavy.status() : { holder: null };
    if (st.holder) return { ok: false, status: 'BLOCKED', summary: 'Замок занят (' + st.holder + '). Ядро heavy-lock не изменяется.' };
    return { ok: true, status: 'OK', summary: 'Замок свободен, сбрасывать нечего' };
  },
  async 'server-restart'(params, ctx) {
    if (params.mode !== 'apply') return { ok: true, status: 'OK', summary: 'План: SIGTERM процессу сервера', planned: true, signal: 'SIGTERM' };
    const kill = ctx.killFn || ((pid, sig) => process.kill(pid, sig));
    const timer = setTimeout(() => { try { kill(process.pid, 'SIGTERM'); } catch { /* process already leaving */ } }, 200);
    if (timer.unref) timer.unref();
    return { ok: true, status: 'OK', summary: 'Перезапуск запланирован (SIGTERM)', scheduled: true };
  }
};

function createBackup(ctx) {
  fs.mkdirSync(ctx.backupDir, { recursive: true, mode: 0o700 });
  const snap = DBB.snapshot(ctx.db, ctx.backupDir, 'sd-manual');
  const got = DBB.sha256File(snap.file);
  const integrity = dbcheck.integrityOn(ctx.openDb, snap.file);
  const ok = got === snap.sha256 && integrity.status === 'OK';
  return { id: 'backup', status: ok ? 'OK' : 'FAIL', summary: ok ? 'Снимок создан и проверен' : 'Снимок не прошёл проверку', data: { file: path.basename(snap.file), sha256: snap.sha256, verified: got === snap.sha256, integrity: integrity.data } };
}

module.exports = { createActions, createBackup, normalize, canon, sha256, FORBIDDEN, OWNER, TTL_MS, NAMESPACE, SUBJECT_TYPE, HANDLERS };
