'use strict';
/**
 * Character3DAdapter interface (to be implemented by the 3D studio / Blender integration, separately):
 *   capabilities() -> { available:boolean, formats:string[], alpha:boolean }
 *   async renderSegment({ sceneId, text, audioFile, durationSec, preset:{width,height,fps}, outFile }) -> { file, alpha } | null
 * Returning null means "no 3D segment" and the factory falls back to the 2D background.
 */
class StubCharacter3D {
  constructor() { this.calls = []; this.name = 'stub-3d'; }
  capabilities() { return { available: false, formats: [], alpha: false }; }
  async renderSegment(req) { this.calls.push(req); return null; }
}
module.exports = { StubCharacter3D };
