'use strict';
const crypto = require('crypto');
const { MASTER_CHARACTER_ID } = require('./constants');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

/**
 * Реестр версий мастер-модели. Хранит хеш, статус, права на референсы и ссылку на голос.
 * Файл .blend, риг и сетку создаёт основная студия. Здесь файл не пишется и не генерируется.
 */
function createCharacterRegistry(db, { now, permissions, transaction, voices }) {
  const latest = db.prepare(`SELECT * FROM si_character_versions WHERE character_id = ? ORDER BY version DESC LIMIT 1`);
  const lockedStmt = db.prepare(`SELECT * FROM si_character_versions WHERE character_id = ? AND locked = 1 AND status = 'approved' LIMIT 1`);
  const getStmt = db.prepare('SELECT * FROM si_character_versions WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM si_character_versions WHERE character_id = ? ORDER BY version');
  const insert = db.prepare(`INSERT INTO si_character_versions (
      id, character_id, version, file, sha256, created_at, status, locked, voice_profile_id, source_refs_json, approved_by, approved_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, NULL, NULL, ?)`);
  const approveStmt = db.prepare(`UPDATE si_character_versions
      SET status = 'approved', locked = 1, approved_by = ?, approved_at = ?, voice_profile_id = ?, source_refs_json = ?
      WHERE id = ? AND status = 'draft'`);
  const unlockPrev = db.prepare(`UPDATE si_character_versions
      SET status = 'superseded', locked = 0 WHERE character_id = ? AND status = 'approved' AND id != ?`);

  function map(row) {
    return {
      id: row.id,
      characterId: row.character_id,
      version: row.version,
      file: row.file,
      sha256: row.sha256,
      createdAt: row.created_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      status: row.status,
      locked: row.locked === 1,
      voiceProfileId: row.voice_profile_id,
      sourceRefs: JSON.parse(row.source_refs_json || '[]'),
      createdBy: row.created_by
    };
  }

  function assertOwner(principal) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') {
      throw new StudioError('PERMISSION_DENIED', 'Версию мастер-модели записывает только владелец', { retryable: false });
    }
    permissions.assertPermission(actor, 'approve', { namespace: 'moonkatty_shared' });
    return actor;
  }

  function registerVersion({ principal, version }) {
    const actor = assertOwner(principal);
    const input = {
      characterId: MASTER_CHARACTER_ID,
      file: version.file,
      sha256: version.sha256,
      voiceProfileId: version.voiceProfileId ?? null,
      sourceRefs: version.sourceRefs || [],
      status: 'draft',
      locked: false
    };
    const errors = validate('character-version', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В реестр версии нельзя записывать секреты', { retryable: false });
    return transaction(() => {
      const prev = latest.get(MASTER_CHARACTER_ID);
      const next = prev ? prev.version + 1 : 1;
      const rowId = crypto.randomBytes(12).toString('hex');
      insert.run(rowId, MASTER_CHARACTER_ID, next, input.file, input.sha256, now(), input.voiceProfileId, JSON.stringify(input.sourceRefs), actor.id);
      return map(getStmt.get(rowId));
    });
  }

  function approve({ principal, id, voiceProfileId }) {
    const actor = assertOwner(principal);
    return transaction(() => {
      const row = getStmt.get(id);
      if (!row || row.character_id !== MASTER_CHARACTER_ID) throw new StudioError('NOT_FOUND', 'Версия мастер-модели не найдена', { retryable: false });
      if (row.status === 'approved' && row.locked === 1) return { version: map(row), executed: false };
      const link = voiceProfileId === undefined ? row.voice_profile_id : voiceProfileId;
      if (link) {
        const voice = voices.approved({ principal: actor });
        if (voice.voiceProfileId !== link || voice.approved !== true) {
          throw new StudioError('VALIDATION', 'К версии можно привязать только утверждённый профиль голоса', { retryable: false });
        }
      }
      unlockPrev.run(MASTER_CHARACTER_ID, id);
      const result = approveStmt.run(actor.id, now(), link || null, row.source_refs_json, id);
      if (!result.changes) throw new StudioError('INVALID_STATE', 'Версия уже не черновик', { retryable: false });
      return { version: map(getStmt.get(id)), executed: false };
    });
  }

  function approved({ principal }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'read', { namespace: 'moonkatty_shared' });
    const row = lockedStmt.get(MASTER_CHARACTER_ID);
    if (!row) throw new StudioError('NOT_FOUND', 'Заблокированная версия мастер-модели не записана', { retryable: false });
    return map(row);
  }

  /** Поля, которые основная студия сверяет перед мимикой. Байтов модели здесь нет. */
  function forStudio({ principal }) {
    const row = approved({ principal });
    return {
      characterId: row.characterId,
      version: row.version,
      file: row.file,
      sha256: row.sha256,
      createdAt: row.createdAt,
      approvedBy: row.approvedBy,
      sourceRefs: row.sourceRefs,
      locked: true,
      voiceProfileId: row.voiceProfileId
    };
  }

  function history({ principal }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'read', { namespace: 'moonkatty_shared' });
    return listStmt.all(MASTER_CHARACTER_ID).map(map);
  }

  return { registerVersion, approve, approved, forStudio, history };
}

module.exports = { createCharacterRegistry };
