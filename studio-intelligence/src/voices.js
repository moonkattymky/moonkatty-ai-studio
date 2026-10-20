'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

/** Профиль голоса ведущего. Задаёт студия 2, для мимики читает основная студия. Синтез здесь не вызывается. */
function createVoices(db, { now, permissions, transaction }) {
  const getStmt = db.prepare('SELECT * FROM si_voice_profiles WHERE voice_profile_id = ?');
  const approvedStmt = db.prepare(`SELECT * FROM si_voice_profiles WHERE namespace = 'moonkatty_news' AND status = 'approved' LIMIT 1`);
  const insert = db.prepare(`INSERT INTO si_voice_profiles (
      voice_profile_id, namespace, label, note, sample_asset_id, status, defined_by, defined_at, approved_by, approved_at,
      sample_rate, recognizer, gain, mouth_scale
    ) VALUES (?, 'moonkatty_news', ?, ?, ?, 'draft', ?, ?, NULL, NULL, ?, ?, ?, ?)`);
  const supersede = db.prepare(`UPDATE si_voice_profiles SET status = 'superseded' WHERE namespace = 'moonkatty_news' AND status = 'approved'`);
  const approveStmt = db.prepare(`UPDATE si_voice_profiles SET status = 'approved', approved_by = ?, approved_at = ? WHERE voice_profile_id = ? AND status = 'draft'`);

  function map(row) {
    if (!row) return null;
    return {
      voiceProfileId: row.voice_profile_id,
      namespace: row.namespace,
      label: row.label,
      note: row.note,
      sampleAssetId: row.sample_asset_id,
      status: row.status,
      definedBy: row.defined_by,
      definedAt: row.defined_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      id: row.voice_profile_id,
      approved: row.status === 'approved',
      sampleRate: row.sample_rate == null ? null : row.sample_rate,
      recognizer: row.recognizer,
      gain: row.gain == null ? null : row.gain,
      mouthScale: row.mouth_scale == null ? null : row.mouth_scale
    };
  }

  function define({ principal, profile }) {
    const actor = permissions.normalize(principal);
    const input = {
      voiceProfileId: profile.voiceProfileId,
      namespace: 'moonkatty_news',
      label: profile.label,
      note: profile.note ?? null,
      sampleAssetId: profile.sampleAssetId ?? null,
      status: 'draft',
      sampleRate: profile.sampleRate ?? null,
      recognizer: profile.recognizer ?? null,
      gain: profile.gain ?? null,
      mouthScale: profile.mouthScale ?? null
    };
    const errors = validate('voice-profile', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (input.recognizer && input.recognizer !== 'phonetic' && input.recognizer !== 'pocketSphinx') {
      throw new StudioError('VALIDATION', 'Распознаватель: phonetic или pocketSphinx', { retryable: false });
    }
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В профиль голоса нельзя записывать секреты', { retryable: false });
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: 'moonkatty_news', agentId: actor.agentId });
    return transaction(() => {
      const prev = getStmt.get(input.voiceProfileId);
      if (prev) return map(prev);
      const who = actor.role === 'agent' ? actor.agentId : actor.id;
      insert.run(input.voiceProfileId, input.label, input.note, input.sampleAssetId, who, now(), input.sampleRate, input.recognizer, input.gain, input.mouthScale);
      return map(getStmt.get(input.voiceProfileId));
    });
  }

  function approve({ principal, voiceProfileId }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Голос ведущего утверждает только владелец', { retryable: false });
    permissions.assertPermission(actor, 'approve', { namespace: 'moonkatty_news' });
    return transaction(() => {
      const row = getStmt.get(voiceProfileId);
      if (!row) throw new StudioError('NOT_FOUND', 'Профиль голоса не найден', { retryable: false });
      if (row.status === 'approved') return { profile: map(row), executed: false };
      supersede.run();
      const result = approveStmt.run(actor.id, now(), voiceProfileId);
      if (!result.changes) throw new StudioError('INVALID_STATE', 'Профиль уже не черновик', { retryable: false });
      return { profile: map(getStmt.get(voiceProfileId)), executed: false };
    });
  }

  function approved({ principal }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'read', { namespace: 'moonkatty_news' });
    const row = approvedStmt.get();
    if (!row) throw new StudioError('NOT_FOUND', 'Утверждённый голос ведущего не задан', { retryable: false });
    return map(row);
  }

  /** Форма, которую основная студия читает перед мимикой. Синтез отсюда не вызывается. */
  function forStudio({ principal }) {
    const row = approved({ principal });
    const shape = {
      id: row.id,
      approved: true,
      sampleRate: row.sampleRate,
      recognizer: row.recognizer,
      gain: row.gain,
      mouthScale: row.mouthScale
    };
    const errors = validate('voice-profile-for-studio', shape);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    return shape;
  }

  return { define, approve, approved, forStudio };
}

module.exports = { createVoices };
