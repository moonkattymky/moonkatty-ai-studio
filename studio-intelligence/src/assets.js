'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');
const { MASTER_CHARACTER_ID, SHARED_NAMESPACE } = require('./constants');

const BRAND_KIND = {
  cat_image: 'image',
  master_model: 'model',
  texture: 'texture',
  animation: 'animation',
  logo: 'logo',
  color: 'other',
  style_rule: 'other'
};

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректный актив', { retryable: false, details: { errors } });
}

function id() {
  return crypto.randomBytes(12).toString('hex');
}

function normUrl(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].filter(key => key.startsWith('utm_')).forEach(key => url.searchParams.delete(key));
    return (url.hostname.replace(/^www\./, '') + url.pathname).replace(/\/$/, '') + url.search;
  } catch {
    return String(value || '').trim();
  }
}

function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    namespace: row.namespace,
    kind: row.kind,
    brandRole: row.brand_role,
    title: row.title,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    storagePath: row.storage_path,
    contentHash: row.content_hash,
    dedupKey: row.dedup_key,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRights(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    basis: row.basis,
    license: row.license,
    licenseUrl: row.license_url,
    holder: row.holder,
    territory: row.territory,
    expiresAt: row.expires_at,
    attributionRequired: !!row.attribution_required,
    attributionText: row.attribution_text,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at
  };
}

function mapUsage(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    namespace: row.namespace,
    usedAt: row.used_at,
    whereUsed: row.where_used,
    publicationId: row.publication_id,
    publicationVersion: row.publication_version,
    context: row.context,
    actorId: row.actor_id,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload_json || '{}')
  };
}

function createAssets(db, { now, permissions, transaction, approval, voices, character }) {
  const byId = db.prepare('SELECT * FROM si_assets WHERE id = ?');
  const byDedup = db.prepare('SELECT * FROM si_assets WHERE namespace = ? AND dedup_key = ?');
  const byHash = db.prepare('SELECT * FROM si_assets WHERE namespace = ? AND content_hash = ? ORDER BY created_at LIMIT 1');
  const byHashAny = db.prepare("SELECT * FROM si_assets WHERE content_hash = ? ORDER BY created_at, id");
  const byUrl = db.prepare('SELECT * FROM si_assets WHERE namespace = ? AND source_url = ? ORDER BY created_at LIMIT 1');
  const insertAsset = db.prepare(`INSERT INTO si_assets (
      id, namespace, kind, brand_role, title, source_name, source_url, storage_path, content_hash,
      dedup_key, status, version, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
  const insertRights = db.prepare(`INSERT INTO si_asset_rights (
      id, asset_id, basis, license, license_url, holder, territory, expires_at,
      attribution_required, attribution_text, recorded_by, recorded_at, superseded
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`);
  const currentRightsStmt = db.prepare(`SELECT * FROM si_asset_rights
      WHERE asset_id = ? AND superseded = 0 ORDER BY recorded_at DESC LIMIT 1`);
  const supersedeRights = db.prepare('UPDATE si_asset_rights SET superseded = 1 WHERE asset_id = ? AND superseded = 0');
  const insertUsage = db.prepare(`INSERT INTO si_asset_usage (
      id, asset_id, namespace, used_at, where_used, publication_id, publication_version, context, actor_id, idempotency_key, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const usageByKey = db.prepare('SELECT * FROM si_asset_usage WHERE namespace = ? AND idempotency_key = ?');
  const usageByAsset = db.prepare('SELECT * FROM si_asset_usage WHERE asset_id = ? ORDER BY used_at, id');
  const usageByPub = db.prepare('SELECT * FROM si_asset_usage WHERE namespace = ? AND publication_id = ? ORDER BY used_at, id');
  const approvedModel = db.prepare(`SELECT * FROM si_assets
      WHERE id = ? AND namespace = ? AND brand_role = 'master_model' AND status = 'approved'`);
  const approvedCat = db.prepare(`SELECT * FROM si_assets
      WHERE namespace = ? AND brand_role = 'cat_image' AND status = 'approved' LIMIT 1`);
  const insertEvent = db.prepare(`INSERT INTO si_asset_events (id, asset_id, at, action, actor_id, version, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const eventsByAsset = db.prepare('SELECT * FROM si_asset_events WHERE asset_id = ? ORDER BY at, id');
  const insertLink = db.prepare(`INSERT INTO si_asset_tasks (asset_id, task_id, namespace, linked_at, actor_id)
    VALUES (?, ?, ?, ?, ?)`);
  const findLink = db.prepare('SELECT * FROM si_asset_tasks WHERE asset_id = ? AND task_id = ?');
  const linksByAsset = db.prepare('SELECT * FROM si_asset_tasks WHERE asset_id = ? ORDER BY linked_at, task_id');
  const countLinks = db.prepare('SELECT COUNT(*) AS n FROM si_asset_tasks WHERE asset_id = ?');
  const countUsage = db.prepare('SELECT COUNT(*) AS n FROM si_asset_usage WHERE asset_id = ?');
  const deleteLinks = db.prepare('DELETE FROM si_asset_tasks WHERE asset_id = ? AND task_id = ?');
  const insertFile = db.prepare(`INSERT INTO si_asset_files (id, asset_id, role, path, checksum, recorded_at, actor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const findFile = db.prepare('SELECT * FROM si_asset_files WHERE asset_id = ? AND role = ? AND path = ?');
  const filesByAsset = db.prepare('SELECT * FROM si_asset_files WHERE asset_id = ? ORDER BY recorded_at, id');
  const markDeleted = db.prepare(`UPDATE si_assets SET status = 'deleted', version = version + 1, updated_at = ? WHERE id = ? AND status != 'deleted'`);
  const markRestored = db.prepare(`UPDATE si_assets SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'deleted'`);
  const deleteAsset = db.prepare('DELETE FROM si_assets WHERE id = ?');
  const deleteRights = db.prepare('DELETE FROM si_asset_rights WHERE asset_id = ?');
  const deleteFiles = db.prepare('DELETE FROM si_asset_files WHERE asset_id = ?');
  const bumpVersion = db.prepare('UPDATE si_assets SET version = version + 1, updated_at = ? WHERE id = ?');

  function actorId(principal) {
    return principal.role === 'agent' ? principal.agentId : principal.id;
  }

  function assertRead(principal, namespace) {
    permissions.assertPermission(principal, 'read', { namespace });
  }

  function visible(principal, asset) {
    if (!asset) return false;
    if (asset.status === 'deleted' && principal.role !== 'owner') return false;
    if (principal.role === 'owner') return true;
    return permissions.canReadNamespace(principal, asset.namespace);
  }

  function recordEvent(assetId, action, actor, version, detail) {
    insertEvent.run(id(), assetId, now(), action, actor, version || null, JSON.stringify(detail || {}));
  }

  function rememberFile(assetId, role, filePath, checksum, actor) {
    if (!filePath) return null;
    const prev = findFile.get(assetId, role, filePath);
    if (prev) return prev;
    insertFile.run(id(), assetId, role, filePath, checksum || null, now(), actor);
    return findFile.get(assetId, role, filePath);
  }

  function writeRights(assetId, rights, actor) {
    const clean = Object.assign({
      basis: rights.basis,
      license: rights.license ?? null,
      licenseUrl: rights.licenseUrl ?? null,
      holder: rights.holder ?? null,
      territory: rights.territory ?? null,
      expiresAt: rights.expiresAt ?? null,
      attributionRequired: !!rights.attributionRequired,
      attributionText: rights.attributionText ?? null
    });
    const errors = validate('asset-rights', clean);
    if (errors.length) validation(errors);
    if (containsSecret(clean)) throw new StudioError('SECRET_REJECTED', 'В права нельзя записывать секреты', { retryable: false });
    supersedeRights.run(assetId);
    const rowId = id();
    insertRights.run(rowId, assetId, clean.basis, clean.license, clean.licenseUrl, clean.holder, clean.territory, clean.expiresAt, clean.attributionRequired ? 1 : 0, clean.attributionText, actor, now());
    return mapRights(currentRightsStmt.get(assetId));
  }

  function register({ principal, asset }) {
    const actor = permissions.normalize(principal);
    const input = {
      namespace: asset.namespace,
      kind: asset.kind,
      title: asset.title,
      sourceName: asset.sourceName ?? null,
      sourceUrl: asset.sourceUrl ? normUrl(asset.sourceUrl) : null,
      storagePath: asset.storagePath ?? null,
      contentHash: asset.contentHash ?? null,
      status: asset.status || 'draft',
      idempotencyKey: asset.idempotencyKey
    };
    const errors = validate('asset-record', input);
    if (errors.length) validation(errors);
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В карточку актива нельзя записывать секреты', { retryable: false });
    if (input.status === 'approved' && actor.role !== 'owner') {
      throw new StudioError('PERMISSION_DENIED', 'Утвердить актив может только владелец', { retryable: false });
    }
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: input.namespace, agentId: actor.agentId });
    const dedupKey = input.contentHash ? `hash:${input.contentHash}` : (input.sourceUrl ? `url:${input.sourceUrl}` : `key:${input.idempotencyKey}`);
    return transaction(() => {
      const hashed = input.contentHash
        ? byHashAny.all(input.contentHash).find(row => visible(actor, mapAsset(row)))
        : null;
      const existing = hashed
        || (input.sourceUrl && byUrl.get(input.namespace, input.sourceUrl))
        || byDedup.get(input.namespace, dedupKey);
      if (existing) {
        if (!visible(actor, mapAsset(existing))) {
          throw new StudioError('IDEMPOTENCY_CONFLICT', 'Такой файл уже учтён', { retryable: false });
        }
        return { asset: mapAsset(existing), rights: mapRights(currentRightsStmt.get(existing.id)), reused: true, approval: null };
      }
      const assetId = id();
      const at = now();
      insertAsset.run(assetId, input.namespace, input.kind, null, input.title, input.sourceName, input.sourceUrl, input.storagePath, input.contentHash, dedupKey, input.status, actorId(actor), at, at);
      recordEvent(assetId, 'created', actorId(actor), 1, { kind: input.kind, checksum: input.contentHash });
      if (input.storagePath) rememberFile(assetId, 'source', input.storagePath, input.contentHash, actorId(actor));
      let rights = null;
      if (asset.rights) rights = writeRights(assetId, asset.rights, actorId(actor));
      let approvalRow = null;
      if (input.status === 'approved') {
        approvalRow = approval.recordGranted({
          principal: actor, namespace: input.namespace, subjectType: 'asset', subjectId: assetId, comment: input.title
        });
      }
      return { asset: mapAsset(byId.get(assetId)), rights, reused: false, approval: approvalRow ? approvalRow.approval : null };
    });
  }

  function registerBrand({ principal, asset }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Реестр бренда заполняет только владелец', { retryable: false });
    const kind = BRAND_KIND[asset.kind];
    if (!kind) throw new StudioError('VALIDATION', 'Неизвестный вид бренда', { retryable: false });
    const dedupKey = `brand:${asset.kind}:${asset.id}`;
    if (asset.kind === 'master_model' && asset.id !== MASTER_CHARACTER_ID) {
      throw new StudioError('VALIDATION', 'Постоянный id мастер-модели — MOONKATTY_MASTER_CHARACTER', { retryable: false });
    }
    return transaction(() => {
      if (asset.kind === 'cat_image') {
        const cat = approvedCat.get(SHARED_NAMESPACE);
        if (cat && cat.dedup_key !== dedupKey) {
          throw new StudioError('IDEMPOTENCY_CONFLICT', 'Оригинал кота уже утверждён и не подменяется', { retryable: false });
        }
      }
      const existing = byDedup.get(SHARED_NAMESPACE, dedupKey);
      if (existing) {
        if (existing.storage_path && asset.filePath && existing.storage_path !== asset.filePath) {
          throw new StudioError('IDEMPOTENCY_CONFLICT', 'Утверждённый файл бренда не подменяется', { retryable: false });
        }
        return { asset: mapAsset(existing), rights: mapRights(currentRightsStmt.get(existing.id)), reused: true, approval: null };
      }
      const assetId = asset.kind === 'master_model' ? MASTER_CHARACTER_ID : id();
      const at = now();
      insertAsset.run(
        assetId, SHARED_NAMESPACE, kind, asset.kind, asset.filePath.split('/').pop() || asset.kind,
        'MOONKATTY', null, asset.filePath, asset.sha256 || null, dedupKey, 'approved', actor.id, at, at
      );
      recordEvent(assetId, 'created', actor.id, 1, { brandRole: asset.kind, checksum: asset.sha256 || null });
      rememberFile(assetId, asset.kind === 'master_model' ? 'model' : 'source', asset.filePath, asset.sha256 || null, actor.id);
      const rights = writeRights(assetId, {
        basis: 'own', license: 'owned-by-studio', holder: 'MOONKATTY', attributionRequired: false
      }, actor.id);
      const granted = approval.recordGranted({
        principal: actor, namespace: SHARED_NAMESPACE, subjectType: asset.kind === 'master_model' ? 'model' : 'asset', subjectId: assetId,
        comment: `brand:${asset.kind}`
      });
      return { asset: mapAsset(byId.get(assetId)), rights, reused: false, approval: granted.approval };
    });
  }

  function get({ principal, id: assetId }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row || !visible(actor, mapAsset(row))) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    return mapAsset(row);
  }

  function findReusable({ principal, namespace, contentHash, sourceUrl }) {
    const actor = permissions.normalize(principal);
    assertRead(actor, namespace);
    const url = sourceUrl ? normUrl(sourceUrl) : null;
    const row = (contentHash && byHash.get(namespace, contentHash)) || (url && byUrl.get(namespace, url)) || null;
    if (!row || !visible(actor, mapAsset(row))) return { reusable: false, asset: null, usages: [] };
    const asset = mapAsset(row);
    return { reusable: true, asset, usages: usageByAsset.all(asset.id).map(mapUsage), match: contentHash && row.content_hash === contentHash ? 'content_hash' : 'source_url' };
  }

  function addRights({ principal, assetId, rights }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Менять права может только владелец', { retryable: false });
    const row = byId.get(assetId);
    if (!row) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    permissions.assertPermission(actor, 'approve', { namespace: row.namespace });
    return transaction(() => {
      const saved = writeRights(assetId, rights, actor.id);
      bumpVersion.run(now(), assetId);
      const fresh = byId.get(assetId);
      recordEvent(assetId, 'rights_changed', actor.id, fresh.version, { basis: saved.basis, license: saved.license });
      return saved;
    });
  }

  function search({ principal, namespace, kind = null, status = null, text = null, includeDeleted = false, limit = 50 }) {
    const actor = permissions.normalize(principal);
    assertRead(actor, namespace);
    const showDeleted = includeDeleted && actor.role === 'owner';
    const needle = text ? `%${String(text).replace(/[%_]/g, '')}%` : null;
    const lim = Math.min(100, Math.max(1, limit | 0));
    const rows = db.prepare(`SELECT * FROM si_assets
      WHERE namespace = ?
        AND (? IS NULL OR kind = ?)
        AND (? IS NULL OR status = ?)
        AND (? = 1 OR status != 'deleted')
        AND (? IS NULL OR title LIKE ? OR IFNULL(source_name,'') LIKE ? OR IFNULL(source_url,'') LIKE ?)
      ORDER BY updated_at DESC, id LIMIT ?`).all(
      namespace, kind, kind, status, status, showDeleted ? 1 : 0, needle, needle, needle, needle, lim
    );
    return rows.map(mapAsset).filter(asset => visible(actor, asset) || (showDeleted && asset.status === 'deleted'));
  }

  function linkTask({ principal, assetId, taskId, namespace }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row || !visible(actor, mapAsset(row))) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    if (!taskId || String(taskId).length > 64) throw new StudioError('VALIDATION', 'Нужен идентификатор задачи', { retryable: false });
    const ns = namespace || row.namespace;
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: ns, agentId: actor.agentId });
    return transaction(() => {
      const prev = findLink.get(assetId, taskId);
      if (prev) return { assetId, taskId, namespace: prev.namespace, linkedAt: prev.linked_at };
      const at = now();
      insertLink.run(assetId, taskId, ns, at, actorId(actor));
      recordEvent(assetId, 'task_linked', actorId(actor), row.version, { taskId, namespace: ns });
      return { assetId, taskId, namespace: ns, linkedAt: at };
    });
  }

  function addFileRef({ principal, assetId, role, path: filePath, checksum = null }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row || !visible(actor, mapAsset(row))) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    if (!role || !filePath) throw new StudioError('VALIDATION', 'Нужны роль и путь файла', { retryable: false });
    if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) throw new StudioError('VALIDATION', 'Контрольная сумма — SHA-256', { retryable: false });
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: row.namespace, agentId: actor.agentId });
    return transaction(() => {
      const saved = rememberFile(assetId, role, filePath, checksum, actorId(actor));
      recordEvent(assetId, 'file_referenced', actorId(actor), row.version, { role, path: filePath });
      return { id: saved.id, assetId, role, path: saved.path, checksum: saved.checksum };
    });
  }

  function fileRefs({ principal, assetId }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row || !visible(actor, mapAsset(row))) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    return filesByAsset.all(assetId).map(item => ({ id: item.id, role: item.role, path: item.path, checksum: item.checksum, recordedAt: item.recorded_at }));
  }

  function history({ principal, assetId }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    if (actor.role !== 'owner' && !visible(actor, mapAsset(row))) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    return eventsByAsset.all(assetId).map(item => ({
      id: item.id, at: item.at, action: item.action, actorId: item.actor_id, version: item.version, detail: JSON.parse(item.detail_json || '{}')
    }));
  }

  function softDelete({ principal, assetId }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row || !visible(actor, mapAsset(row))) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    if (row.status === 'approved' && actor.role !== 'owner') {
      throw new StudioError('PERMISSION_DENIED', 'Утверждённый актив снимает только владелец', { retryable: false });
    }
    if (actor.role !== 'owner' && row.created_by !== actor.agentId) {
      throw new StudioError('PERMISSION_DENIED', 'Чужой черновик нельзя снять', { retryable: false });
    }
    const result = markDeleted.run(now(), assetId);
    if (!result.changes) throw new StudioError('INVALID_STATE', 'Актив уже снят', { retryable: false });
    const fresh = byId.get(assetId);
    recordEvent(assetId, 'soft_deleted', actorId(actor), fresh.version, {});
    return mapAsset(fresh);
  }

  function restore({ principal, assetId }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Вернуть актив может только владелец', { retryable: false });
    const row = byId.get(assetId);
    if (!row) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    const result = markRestored.run('draft', now(), assetId);
    if (!result.changes) throw new StudioError('INVALID_STATE', 'Актив не был снят', { retryable: false });
    const fresh = byId.get(assetId);
    recordEvent(assetId, 'restored', actor.id, fresh.version, {});
    return mapAsset(fresh);
  }

  function hardDelete({ principal, assetId }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Безвозвратно удаляет только владелец', { retryable: false });
    const row = byId.get(assetId);
    if (!row) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    if (row.status !== 'deleted') throw new StudioError('INVALID_STATE', 'Сначала мягкое удаление', { retryable: false });
    if (row.id === MASTER_CHARACTER_ID) throw new StudioError('INVALID_STATE', 'Мастер-модель с постоянным id не удаляется', { retryable: false });
    const usages = countUsage.get(assetId).n;
    const links = countLinks.get(assetId).n;
    if (Number(usages) || Number(links)) {
      throw new StudioError('INVALID_STATE', 'На актив есть ссылки: использование или задачи', { retryable: false });
    }
    recordEvent(assetId, 'hard_deleted', actor.id, row.version, {});
    deleteFiles.run(assetId);
    deleteRights.run(assetId);
    deleteAsset.run(assetId);
    return { id: assetId, deleted: true };
  }

  function canRecordUsage(actor, asset, namespace) {
    if (actor.role === 'owner') return true;
    if (!permissions.hasGrant(actor.agentId, namespace, 'write')) return false;
    if (asset.namespace === namespace) return true;
    return asset.namespace === SHARED_NAMESPACE && asset.id === MASTER_CHARACTER_ID && asset.brandRole === 'master_model' && asset.status === 'approved' && (namespace === 'moonkatty_news' || namespace === 'moonkatty_project');
  }

  function recordUsage({ principal, usage }) {
    const actor = permissions.normalize(principal);
    const input = {
      assetId: usage.assetId,
      namespace: usage.namespace,
      whereUsed: usage.whereUsed,
      publicationId: usage.publicationId ?? null,
      publicationVersion: usage.publicationVersion ?? null,
      context: usage.context ?? null,
      idempotencyKey: usage.idempotencyKey,
      payload: usage.payload || {}
    };
    const errors = validate('asset-usage', input);
    if (errors.length) validation(errors);
    const row = byId.get(input.assetId);
    if (!row) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    const asset = mapAsset(row);
    if (!canRecordUsage(actor, asset, input.namespace)) {
      throw new StudioError('PERMISSION_DENIED', 'Нет права записать использование актива', { retryable: false });
    }
    return transaction(() => {
      const prev = usageByKey.get(input.namespace, input.idempotencyKey);
      if (prev) {
        if (prev.asset_id !== input.assetId || prev.where_used !== input.whereUsed) {
          throw new StudioError('IDEMPOTENCY_CONFLICT', 'Ключ использования уже занят', { retryable: false });
        }
        return mapUsage(prev);
      }
      insertUsage.run(id(), input.assetId, input.namespace, now(), input.whereUsed, input.publicationId, input.publicationVersion, input.context, actorId(actor), input.idempotencyKey, JSON.stringify(input.payload));
      recordEvent(input.assetId, 'usage_recorded', actorId(actor), asset.version, { whereUsed: input.whereUsed, publicationId: input.publicationId, publicationVersion: input.publicationVersion });
      return mapUsage(usageByKey.get(input.namespace, input.idempotencyKey));
    });
  }

  function usageOf({ principal, assetId }) {
    const actor = permissions.normalize(principal);
    const row = byId.get(assetId);
    if (!row) throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    const asset = mapAsset(row);
    if (!visible(actor, asset) && !(asset.brandRole === 'master_model' && asset.status === 'approved' && permissions.canReadNamespace(actor, 'moonkatty_news'))) {
      throw new StudioError('NOT_FOUND', 'Актив не найден', { retryable: false });
    }
    return usageByAsset.all(assetId).map(mapUsage).filter(item => actor.role === 'owner' || permissions.canReadNamespace(actor, item.namespace) || item.namespace === 'moonkatty_news' && permissions.canReadNamespace(actor, 'moonkatty_news'));
  }

  function approvedCharacterModel({ principal }) {
    const actor = permissions.normalize(principal);
    const allowed = actor.role === 'owner' || permissions.canReadNamespace(actor, SHARED_NAMESPACE);
    if (!allowed) throw new StudioError('PERMISSION_DENIED', 'Нет доступа к утверждённой модели персонажа', { retryable: false });
    const row = approvedModel.get(MASTER_CHARACTER_ID, SHARED_NAMESPACE);
    if (!row) throw new StudioError('NOT_FOUND', 'Утверждённая мастер-модель кота не зарегистрирована', { retryable: false });
    return { asset: mapAsset(row), rights: mapRights(currentRightsStmt.get(row.id)) };
  }

  function judgeRights(rights) {
    if (!rights || !rights.license || rights.basis === 'unknown') {
      return { present: false, blocking: true, reason: rights && rights.basis === 'unknown' ? 'unknown_basis' : 'missing', basis: rights ? rights.basis : null, license: rights ? rights.license : null, expiresAt: rights ? rights.expiresAt : null, attributionRequired: !!(rights && rights.attributionRequired) };
    }
    if (rights.expiresAt && rights.expiresAt < now()) {
      return { present: true, blocking: true, reason: 'expired', basis: rights.basis, license: rights.license, expiresAt: rights.expiresAt, attributionRequired: rights.attributionRequired };
    }
    return { present: true, blocking: false, reason: null, basis: rights.basis, license: rights.license, expiresAt: rights.expiresAt, attributionRequired: rights.attributionRequired };
  }

  function rightsLookup({ principal, namespace, assetIds = [], publicationId = null }) {
    const actor = permissions.normalize(principal);
    assertRead(actor, namespace);
    const ids = new Set(assetIds);
    if (publicationId) {
      for (const row of usageByPub.all(namespace, publicationId)) ids.add(row.asset_id);
    }
    const assets = [];
    for (const assetId of ids) {
      const row = byId.get(assetId);
      if (!row || row.namespace !== namespace && row.id !== MASTER_CHARACTER_ID) continue;
      const judged = judgeRights(mapRights(currentRightsStmt.get(assetId)));
      assets.push(Object.assign({ assetId }, judged));
    }
    const result = {
      namespace,
      publicationId,
      blocking: assets.some(item => item.blocking),
      warning: assets.length ? null : 'no_assets_recorded',
      assets
    };
    const errors = validate('rights-lookup', result);
    if (errors.length) validation(errors);
    return result;
  }

  function validateFacialRequest(request) {
    const errors = validate('facial-animation-request', request);
    if (errors.length) validation(errors);
    return request;
  }

  /**
   * Проверяет, что мимика ссылается на утверждённую мастер-модель, и пишет использование.
   * Кадры не считает и Blender не вызывает.
   */
  function prepareFacialUse({ principal, request }) {
    const clean = validateFacialRequest(request);
    const model = approvedCharacterModel({ principal });
    if (clean.characterModelAssetId !== model.asset.id) {
      throw new StudioError('VALIDATION', 'Нужна утверждённая мастер-модель кота из реестра бренда', { retryable: false });
    }
    const master = character.approved({ principal });
    if (!master.locked || master.status !== 'approved' || master.sha256 !== model.asset.contentHash) {
      throw new StudioError('VALIDATION', 'Хеш заблокированной версии не совпадает с карточкой модели', { retryable: false });
    }
    const known = character.history({ principal }).find(row => row.version === clean.masterAssetVersion);
    if (!known) {
      throw new StudioError('NOT_FOUND', 'Версия мастер-модели не найдена в реестре', { retryable: false });
    }
    if (known.locked !== true || known.status !== 'approved' || known.version !== master.version) {
      throw new StudioError('VALIDATION', 'Нужна заблокированная утверждённая версия мастер-модели, подстановка запрещена', { retryable: false });
    }
    const voice = voices.approved({ principal });
    if (voice.approved !== true || clean.voiceProfileId !== voice.voiceProfileId) {
      throw new StudioError('VALIDATION', 'Нужен утверждённый профиль голоса ведущего', { retryable: false });
    }
    const audio = get({ principal, id: clean.audioAssetId });
    if (audio.namespace !== 'moonkatty_news' || audio.kind !== 'audio') {
      throw new StudioError('VALIDATION', 'Аудио мимики должно быть активом moonkatty_news', { retryable: false });
    }
    const usage = recordUsage({
      principal,
      usage: {
        assetId: model.asset.id,
        namespace: 'moonkatty_news',
        whereUsed: 'facial_animation',
        publicationId: clean.publicationId ?? null,
        publicationVersion: clean.publicationVersion ?? null,
        context: clean.channels.join(','),
        idempotencyKey: clean.idempotencyKey,
        payload: { channels: clean.channels, audioAssetId: audio.id, voiceProfileId: voice.voiceProfileId }
      }
    });
    return { executed: false, model: model.asset, master, audio, voice, usage };
  }

  return {
    register, registerBrand, get, findReusable, addRights, recordUsage, usageOf,
    search, linkTask, addFileRef, fileRefs, history, softDelete, restore, hardDelete,
    approvedCharacterModel, rightsLookup, validateFacialRequest, prepareFacialUse, normUrl
  };
}

module.exports = { createAssets, normUrl };
