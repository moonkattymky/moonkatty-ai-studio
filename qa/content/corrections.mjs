/**
 * Re-check a correction to an already-published item.
 * Studio 5 keeps the log. This module only returns a verification record.
 */
import { reviewScript } from './review.mjs';

export const PROCEDURE = [
  'Studio 5 stores the published snapshot as before and the replacement as after, with the sources that were stored at publication.',
  'Copy the finding ids from the original QC verdict into addresses. Those are the defects this correction claims to fix.',
  'QA runs the same checker on before and confirms every addressed id is present. An id that is absent does not match the published defect.',
  'QA runs the checker on after. Every addressed id must be gone, unless Studio 5 attached a waiver with a note of at least 10 characters.',
  'after must not introduce a new blocker or major finding.',
  'before and after must differ in body, claims, or images. An unchanged package is not a correction.',
  'The corrections log keeper must be studio-5. QA returns a verification record and does not write the log.',
  'Only a verified result may be marked corrected. not_verified stays open. QA does not publish or unpublish.'
];

function packageChanged(before, after) {
  return JSON.stringify(before.body || '') !== JSON.stringify(after.body || '')
    || JSON.stringify(before.claims || []) !== JSON.stringify(after.claims || [])
    || JSON.stringify(before.images || []) !== JSON.stringify(after.images || []);
}

function waivedIds(record) {
  const ids = new Set();
  for (const waiver of record.waivers || []) {
    if (waiver && waiver.id && String(waiver.note || '').trim().length >= 10) ids.add(waiver.id);
  }
  return ids;
}

export function verifyCorrection(record, reviewFn = reviewScript) {
  if (!record || typeof record !== 'object') throw new Error('invalid correction: expected an object');
  if (!record.before || !record.after) throw new Error('invalid correction: before and after are required');
  const errors = [];
  if (!record.log || record.log.keeper !== 'studio-5') errors.push('log.keeper must be studio-5');
  if (!record.correctedBy) errors.push('correctedBy is required');
  if (!Array.isArray(record.addresses) || record.addresses.length === 0) errors.push('addresses must list finding ids from the published item');
  const sources = record.sources || record.before.sources;
  const beforeInput = { ...record.before, id: record.before.id || record.itemId, sources };
  const afterInput = { ...record.after, id: record.after.id || record.itemId, sources };
  const beforeVerdict = reviewFn(beforeInput);
  const afterVerdict = reviewFn(afterInput);
  const beforeIds = new Set(beforeVerdict.findings.map(item => item.id));
  const afterIds = new Set(afterVerdict.findings.map(item => item.id));
  const addresses = record.addresses || [];
  const missingFromBefore = addresses.filter(id => !beforeIds.has(id));
  const waived = waivedIds(record);
  const remaining = addresses.filter(id => afterIds.has(id) && !waived.has(id));
  const introduced = afterVerdict.findings
    .filter(item => !beforeIds.has(item.id) && (item.severity === 'blocker' || item.severity === 'major'))
    .map(item => item.id);
  if (!packageChanged(record.before, record.after)) errors.push('before and after are identical');
  const verified = errors.length === 0
    && missingFromBefore.length === 0
    && remaining.length === 0
    && introduced.length === 0
    && afterVerdict.decision !== 'hold';
  return {
    contract: 'moonkatty.qa.content.correction-verification/1',
    correctionId: record.id || null,
    itemId: record.itemId || beforeInput.id,
    verified,
    decision: verified ? 'verified' : 'not_verified',
    beforeDecision: beforeVerdict.decision,
    afterDecision: afterVerdict.decision,
    addressed: addresses,
    missingFromBefore,
    remaining,
    introduced,
    errors,
    afterVerdict,
    procedure: PROCEDURE,
    note: 'QA does not write the Studio 5 corrections log and does not publish.'
  };
}
