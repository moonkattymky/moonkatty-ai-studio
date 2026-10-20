'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');

/** Память результатов технической проверки. Сам ролик не открывает и ffmpeg не вызывает. */
function createQaMemory(db, { now, permissions, assets }) {
  const insert = db.prepare(`INSERT INTO si_qa_findings (
      id, namespace, publication_id, publication_version, check_name, ok, detail, at, actor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  function recordFinding({ principal, finding }) {
    const actor = permissions.normalize(principal);
    const input = {
      namespace: finding.namespace,
      publicationId: finding.publicationId ?? null,
      publicationVersion: finding.publicationVersion ?? null,
      checkName: finding.checkName,
      ok: finding.ok,
      detail: finding.detail ?? null
    };
    const errors = validate('qa-finding', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (actor.role !== 'owner') {
      permissions.assertPermission(actor, 'write', { namespace: input.namespace, agentId: actor.agentId });
    }
    const rowId = crypto.randomBytes(12).toString('hex');
    const at = now();
    insert.run(rowId, input.namespace, input.publicationId, input.publicationVersion, input.checkName, input.ok ? 1 : 0, input.detail, at, actor.role === 'agent' ? actor.agentId : actor.id);
    return { id: rowId, namespace: input.namespace, checkName: input.checkName, ok: !!input.ok, at, executed: false };
  }

  function rightsForPublication({ principal, namespace, publicationId, assetIds }) {
    return assets.rightsLookup({ principal, namespace, publicationId, assetIds });
  }

  return { recordFinding, rightsForPublication };
}

module.exports = { createQaMemory };
