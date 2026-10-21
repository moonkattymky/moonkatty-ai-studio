'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { NAMESPACES } = require('./constants');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'screenshots', 'dist', 'out']);
const MAX_FILE_BYTES = 1_000_000;
const CHUNK = 1000;

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректный запрос', { retryable: false, details: { errors } });
}

/** Префиксный запрос FTS5. Слова короче двух символов отбрасываются. */
function buildFtsQuery(raw) {
  const tokens = String(raw || '').toLowerCase().match(/\p{L}[\p{L}\p{N}]{1,}|\p{N}{2,}/gu) || [];
  const unique = [...new Set(tokens)].slice(0, 12);
  if (!unique.length) throw new StudioError('VALIDATION', 'Пустой или слишком короткий запрос', { retryable: false });
  return unique.map(token => `"${token}"*`).join(' AND ');
}

/**
 * Документ без явного пространства: путь с «news» относится к MOONKATTY NEWS,
 * всё остальное — к MOONKATTY PROJECT. Вызывающий может передать namespace и перекрыть правило.
 */
function namespaceForPath(rel) {
  const norm = rel.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)news(\/|$)/.test(norm) || /(^|\/)[^/]*news[^/]*\.(md|txt)$/.test(norm)) return 'moonkatty_news';
  return 'moonkatty_project';
}

function chunkMarkdown(text) {
  const parts = String(text).split(/\n(?=#{1,3} )/);
  const chunks = [];
  for (const part of parts) {
    const heading = (part.match(/^#{1,3}[ \t]+(.+)/) || [])[1];
    const body = part.trim();
    if (!body) continue;
    const title = (heading || body.split('\n')[0] || 'Документ').trim().slice(0, 300);
    if (body.length <= CHUNK + 200) {
      chunks.push({ title, body });
      continue;
    }
    for (let i = 0, n = 1; i < body.length; i += CHUNK, n++) {
      chunks.push({ title: `${title} (${n})`.slice(0, 300), body: body.slice(i, i + CHUNK) });
    }
  }
  return chunks;
}

function walk(dir, root, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, root, acc);
    else if (ent.isFile() && /\.(md|txt)$/i.test(ent.name)) acc.push(full);
  }
  return acc;
}

function docDigest(rel) {
  return crypto.createHash('sha256').update(rel).digest('hex').slice(0, 32);
}

function docKey(ns, rel, index) {
  return `doc:${ns}:${docDigest(rel)}:${index}`;
}

function createRetrieval(db, { memory, permissions, transaction, now }) {
  const clock = now || (() => new Date().toISOString());
  const keysForFile = db.prepare(`SELECT key, record_id FROM si_idempotency WHERE namespace = ? AND key LIKE ? ESCAPE '\\'`);

  function searchableNamespaces(principal, namespace) {
    const actor = permissions.normalize(principal);
    if (namespace) {
      permissions.assertPermission(actor, 'read', { namespace });
      return [namespace];
    }
    const allowed = NAMESPACES.filter(ns => permissions.canReadNamespace(actor, ns));
    if (!allowed.length) throw new StudioError('PERMISSION_DENIED', 'Нет доступа ни к одному пространству', { retryable: false });
    return allowed;
  }

  function search({ principal, query, namespace = null, limit = 8, includeDrafts = false }) {
    const actor = permissions.normalize(principal);
    const namespaces = searchableNamespaces(actor, namespace);
    const match = buildFtsQuery(query);
    const lim = Math.min(20, Math.max(1, limit | 0));
    const statuses = actor.role === 'owner' && includeDrafts ? ['approved', 'draft'] : ['approved'];
    // Пространство и статус — закрытые константы, не пользовательский текст.
    // Плюс перед колонкой не даёт планировщику начать со скана si_records: иначе MATCH считается для каждой строки.
    if (namespaces.some(ns => !NAMESPACES.includes(ns)) || statuses.some(status => status !== 'approved' && status !== 'draft')) {
      throw new StudioError('VALIDATION', 'Некорректный фильтр поиска', { retryable: false });
    }
    const sql = `
      SELECT r.id, r.namespace, r.version, r.title, r.source_path, r.status, r.created_by,
             snippet(si_records_fts, 1, '«', '»', '…', 12) AS snippet
      FROM si_records AS r
      JOIN si_records_fts ON si_records_fts.rowid = r.rowid
      WHERE si_records_fts MATCH ?
        AND +r.namespace IN (${namespaces.map(ns => `'${ns}'`).join(', ')})
        AND +r.status IN (${statuses.map(status => `'${status}'`).join(', ')})
      ORDER BY rank
      LIMIT ?`;
    const rows = db.prepare(sql).all(match, lim);
    const citations = [];
    for (const row of rows) {
      const rec = {
        id: row.id,
        namespace: row.namespace,
        version: row.version,
        title: row.title,
        status: row.status,
        sourcePath: row.source_path,
        createdBy: row.created_by
      };
      if (!memory.canSee(actor, rec, { history: includeDrafts, direct: includeDrafts })) continue;
      citations.push({
        recordId: row.id,
        filePath: row.source_path,
        version: row.version,
        namespace: row.namespace,
        title: row.title,
        snippet: row.snippet || row.title
      });
    }
    const result = {
      query: String(query),
      namespaces,
      answer: citations.length
        ? citations.map((item, i) => `[${i + 1}] ${item.title}: ${item.snippet}`).join('\n')
        : 'В разрешённой области ничего не найдено.',
      citations
    };
    const errors = validate('retrieval-result', result);
    if (errors.length) validation(errors);
    return result;
  }

  function indexDocs({ principal, root, namespace = null }) {
    const actor = permissions.normalize(principal);
    permissions.assertPermission(actor, 'index', { namespace: namespace || 'moonkatty_project' });
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new StudioError('VALIDATION', 'Каталог документов не найден', { retryable: false });
    }
    const files = walk(root, root, []);
    const report = { indexed: 0, updated: 0, unchanged: 0, superseded: 0, skipped: [] };
    transaction(() => {
      for (const file of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        let text;
        let size;
        try {
          size = fs.statSync(file).size;
          if (size > MAX_FILE_BYTES) {
            report.skipped.push({ path: rel, reason: 'too_large' });
            continue;
          }
          text = fs.readFileSync(file, 'utf8');
        } catch (err) {
          report.skipped.push({ path: rel, reason: err.code || 'read_error' });
          continue;
        }
        const ns = namespace || namespaceForPath(rel);
        const chunks = chunkMarkdown(text);
        const seen = new Set();
        chunks.forEach((chunk, index) => {
          const key = docKey(ns, rel, index);
          seen.add(key);
          if (containsSecret(chunk.body) || containsSecret(chunk.title)) {
            report.skipped.push({ path: rel, reason: 'secret' });
            return;
          }
          const before = db.prepare('SELECT record_id, request_hash FROM si_idempotency WHERE namespace = ? AND key = ?').get(ns, key);
          const saved = memory.put({
            principal: actor,
            versionPolicy: 'bump',
            record: {
              namespace: ns,
              kind: 'document',
              title: chunk.title,
              body: chunk.body,
              status: 'approved',
              sourcePath: rel,
              idempotencyKey: key,
              payload: { chunk: index }
            }
          });
          if (!before) report.indexed++;
          else if (before.record_id === saved.id) report.unchanged++;
          else report.updated++;
        });
        const stale = keysForFile.all(ns, `doc:${ns}:${docDigest(rel)}:%`);
        for (const row of stale) {
          if (seen.has(row.key)) continue;
          const current = db.prepare('SELECT status FROM si_records WHERE id = ?').get(row.record_id);
          if (current && current.status !== 'superseded') {
            db.prepare(`UPDATE si_records SET status = 'superseded', updated_at = ? WHERE id = ?`).run(clock(), row.record_id);
            report.superseded++;
          }
        }
      }
    });
    return report;
  }

  return { search, indexDocs, buildFtsQuery, namespaceForPath, chunkMarkdown };
}

module.exports = { createRetrieval, buildFtsQuery, namespaceForPath, chunkMarkdown };
