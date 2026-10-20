'use strict';
/**
 * Host3D — unified interface to the studio's 3D host (Blender etc., owned by the other developer). We do NOT run Blender.
 *   capabilities() -> { available, aspects:[...] }
 *   async renderSegment({ script, audioPath, durationSec, aspect:'16:9'|'9:16', outPath }) -> { videoPath } | null
 * QueuedHost3D enqueues job type 'render_segment' on a JobQueuePort and waits; it never calls Blender directly.
 */
class StubHost3D {
  constructor() { this.name = 'host3d-stub'; this.calls = []; }
  capabilities() { return { available: false, aspects: [] }; }
  async renderSegment(req) { this.calls.push(req); return null; }
}
class QueuedHost3D {
  constructor({ jobQueue, agent = 'video-factory', timeoutSec = 1800, maxAttempts = 1 }) { if (!jobQueue) throw new Error('jobQueue required'); Object.assign(this, { jobQueue, agent, timeoutSec, maxAttempts }); this.name = 'host3d-queued'; }
  capabilities() { return { available: true, aspects: ['16:9', '9:16'] }; }
  async renderSegment({ script, audioPath, durationSec, aspect, outPath }) {
    const r = await this.jobQueue.runExclusive({ type: 'render_segment', agent: this.agent, input: { script, audioPath, durationSec, aspect, outPath }, timeoutSec: this.timeoutSec, maxAttempts: this.maxAttempts });
    return r && r.videoPath ? { videoPath: r.videoPath } : null;
  }
}
/**
 * Host3D contract v2 (PROPOSAL, see INTEGRATION.md): the Studio's original master cat — we never build our own character.
 * buildRequestV2(...) -> {
 *   contract:'host3d.render_segment/v2', script, audioPath (48 kHz mono WAV), durationSec, aspect, outPath,
 *   voice:{ voiceProfileId, voiceId, modelSha256 }, visemes:[{t,d,viseme,phoneme}], cues:[{t, emotion?, gaze?, ears?, head?}],
 *   costumeId, character:{ id:'moonkatty-master-cat', modelVersion (pinned) }, output:{ alpha:true, fps:30 } }
 */
const EMOTIONS = ['neutral', 'serious', 'warm', 'curious', 'concerned', 'upbeat'];
function cuesFor(story, durationSec) {
  const tone = story.controversial || story.breaking ? 'serious' : ['space', 'science', 'tech'].includes(story.category) ? 'curious' : 'neutral';
  return [{ t: 0, emotion: 'warm', gaze: 'camera', ears: 'up', head: 'nod_small' }, { t: 0.6, emotion: tone, gaze: 'camera', ears: tone === 'serious' ? 'back_slight' : 'up' },
    { t: Math.max(0.7, durationSec * 0.55), gaze: 'graphic_right', head: 'tilt_small' }, { t: Math.max(0.8, durationSec - 0.8), gaze: 'camera', emotion: tone === 'serious' ? 'serious' : 'warm' }];
}
function buildRequestV2({ script, audioPath, durationSec, aspect, outPath, voice, visemes, story = {}, costumeId = 'news-anchor-default', modelVersion }) {
  if (!modelVersion) throw new Error('host3d v2: pinned character modelVersion required');
  return { contract: 'host3d.render_segment/v2', script, audioPath, durationSec, aspect, outPath, voice, visemes, cues: cuesFor(story, durationSec), costumeId,
    character: { id: 'moonkatty-master-cat', modelVersion }, output: { alpha: true, fps: 30, format: 'mov-prores4444' } };
}
class QueuedHost3DV2 extends QueuedHost3D {
  constructor(o) { super(o); this.modelVersion = o.modelVersion; this.costumeId = o.costumeId || 'news-anchor-default'; this.voice = o.voice; this.name = 'host3d-queued-v2'; }
  async renderSegment(req) { const input = buildRequestV2({ ...req, voice: this.voice, modelVersion: this.modelVersion, costumeId: this.costumeId });
    const r = await this.jobQueue.runExclusive({ type: 'render_segment', agent: this.agent, input, timeoutSec: this.timeoutSec, maxAttempts: this.maxAttempts }); return r && r.videoPath ? { videoPath: r.videoPath } : null; }
}
module.exports = { StubHost3D, QueuedHost3D, QueuedHost3DV2, buildRequestV2, cuesFor, EMOTIONS, ...require('./visemes') };
