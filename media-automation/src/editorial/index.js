'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { JsonStore } = require('../store');
const PROFILE = path.join(__dirname, '..', '..', 'config', 'anchor-profile.json');
/** Anchor speech profile: opening/closing lines honoring catchphrase rules. */
function anchorLines({ daypart = 'evening', breaking = false, file = PROFILE } = {}) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (breaking) return { opening: 'This is MOONKATTY NEWS with a breaking update.', closing: 'We will update this story as verified information comes in.', profile: p.id };
  return { opening: p.catchphrases.opening[0].replace('{daypart}', daypart), closing: p.catchphrases.closing[0], profile: p.id };
}
/**
 * Major-event / breaking detection: a breaking (or controversial) CONFIRMED story with >= minOrigins independent origins.
 * Action: pause regular schedule (scheduler.pauseAll) with reason; breaking items go to Approval Center ONLY (never auto-publish).
 */
function detectMajorEvent(stories, { minOrigins = 3 } = {}) {
  return stories.filter(s => s.breaking && s.corroboration === 'confirmed' && (s.verification?.independentOrigins || 0) >= minOrigins);
}
function applyMajorEventPolicy({ stories, scheduler, log = () => {} }) {
  const ev = detectMajorEvent(stories); if (!ev.length) return null;
  const st = scheduler.settings(); if (!st.paused) { scheduler.store.update('settings', s => ({ ...s, paused: true, pausedReason: `major event: ${ev[0].headline}`, pausedAt: new Date().toISOString() })); log('schedule_paused_major_event', { storyId: ev[0].id }); }
  return ev;
}
/**
 * Corrections / retractions.
 * Interfaces for teammates: VerificationPort (Studio 4): async verifyCorrection(correction) -> { verdict:'confirmed_error'|'no_error'|'inconclusive', notes, verifiedBy }
 *                           CorrectionLogPort (Studio 5): async append(entry) ; async list({episodeId})
 * Flow: reported -> verifying -> (confirmed_error -> correction_drafted -> owner_approved -> published_correction) | dismissed
 */
class CorrectionsDesk {
  constructor({ statePath, verifier = null, logPort = null, approval = null }) { this.store = new JsonStore(statePath); Object.assign(this, { verifier, logPort, approval }); }
  async _log(e) { this.store.update('log', l => [...(l || []), e], []); if (this.logPort) await this.logPort.append(e); }
  async report({ episodeId, storyId, claim, reportedBy, evidenceUrl }) {
    if (!episodeId || !claim || !reportedBy) throw new Error('episodeId, claim, reportedBy required');
    const c = { id: crypto.randomUUID(), episodeId, storyId: storyId || null, claim, evidenceUrl: evidenceUrl || null, reportedBy, status: 'reported', at: new Date().toISOString(), history: [] };
    this.store.update('items', x => ({ ...x, [c.id]: c }), {}); await this._log({ type: 'correction_reported', id: c.id, episodeId, claim }); return c;
  }
  get(id) { return this.store.get('items', {})[id]; }
  _put(c) { this.store.update('items', x => ({ ...x, [c.id]: c }), {}); return c; }
  async verify(id) {
    const c = this.get(id); if (!this.verifier) throw new Error('VerificationPort (Studio 4) not connected'); c.status = 'verifying'; this._put(c);
    const v = await this.verifier.verifyCorrection(c); c.verdict = v; c.status = v.verdict === 'confirmed_error' ? 'confirmed_error' : v.verdict === 'no_error' ? 'dismissed' : 'reported'; this._put(c);
    await this._log({ type: 'correction_verified', id, verdict: v.verdict, by: v.verifiedBy }); return c;
  }
  /** Draft on-air/description correction; it goes to the Approval Center (owner must approve; never auto-published). */
  async draft(id, { text, retract = false }) {
    const c = this.get(id); if (c.status !== 'confirmed_error') throw new Error('only confirmed errors can be corrected');
    c.status = 'correction_drafted'; c.correction = { text, retract }; this._put(c);
    if (this.approval) this.approval.submit({ id: `correction-${id}`, kind: 'text', title: `${retract ? 'RETRACTION' : 'CORRECTION'}: ${c.episodeId}`, headline: text.slice(0, 140), text, sources: c.evidenceUrl ? [{ name: 'evidence', url: c.evidenceUrl }] : [], publish: { status: 'awaiting_approval' }, meta: { correctionId: id } });
    await this._log({ type: retract ? 'retraction_drafted' : 'correction_drafted', id }); return c;
  }
}
module.exports = { anchorLines, detectMajorEvent, applyMajorEventPolicy, CorrectionsDesk };
