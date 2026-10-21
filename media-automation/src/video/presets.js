'use strict';
const H = { width: 1920, height: 1080, aspect: '16:9' };
const V = { width: 1080, height: 1920, aspect: '9:16' };
const base = { fps: 30, vcodec: 'libx264', crf: 21, abitrate: '160k', pixfmt: 'yuv420p', targetLufs: -16 };
const PRESETS = {
  youtube: { ...base, ...H, platform: 'YouTube', maxDurationSec: null },
  shorts: { ...base, ...V, platform: 'YouTube Shorts', maxDurationSec: 180 },
  tiktok: { ...base, ...V, platform: 'TikTok', maxDurationSec: 600 },
  reels: { ...base, ...V, platform: 'Instagram Reels', maxDurationSec: 180 },
  fb_reels: { ...base, ...V, platform: 'Facebook Reels', maxDurationSec: 90 },
};
// Apple Silicon hardware encoder option: set vcodec 'h264_videotoolbox' (macOS only).
function getPreset(name, overrides = {}) { const p = PRESETS[name]; if (!p) throw new Error(`unknown preset ${name}`); return { name, ...p, ...overrides }; }
module.exports = { PRESETS, getPreset };
