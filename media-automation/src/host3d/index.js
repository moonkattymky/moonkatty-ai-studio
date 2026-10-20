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
module.exports = { StubHost3D, QueuedHost3D };
