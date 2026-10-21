'use strict';
/**
 * Single shared EXPERIMENTAL flag (v1.3.0-test), DEFAULT OFF.
 * ON when env MA_EXPERIMENTAL=1 (or 'true'), or config experimental:true (passed in, or config/experimental.json {"experimental":true}).
 * An explicit option `experimental: true|false` on a factory/constructor overrides env/config (used by tests).
 * When OFF, the modules below are inert / not registered; everything else (video_render, news pipeline, Approval Center,
 * FB/IG/YouTube/TikTok dry-run) is unaffected.
 */
const fs = require('fs'); const path = require('path');
const CONFIG = path.join(__dirname, '..', 'config', 'experimental.json');
const EXPERIMENTAL_MODULES = [
  { id: 'major_event_pause', label: 'Major-event detection + schedule auto-pause', implemented: true },
  { id: 'corrections_desk', label: 'CorrectionsDesk', implemented: true },
  { id: 'brand_memory', label: 'Brand Memory', implemented: false },
  { id: 'cost_control', label: 'Cost Control', implemented: false },
  { id: 'x_adapter', label: 'X publish + analytics adapters', implemented: true },
  { id: 'telegram_adapter', label: 'Telegram publish + stats adapters', implemented: true },
];
function fileConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } }
function experimentalEnabled({ experimental, env = process.env, config } = {}) {
  if (typeof experimental === 'boolean') return experimental;
  if (env.MA_EXPERIMENTAL === '1' || env.MA_EXPERIMENTAL === 'true') return true;
  return (config || fileConfig()).experimental === true;
}
function moduleStatus(opts) { const on = experimentalEnabled(opts);
  return EXPERIMENTAL_MODULES.map(m => ({ ...m, enabled: on && m.implemented, reason: !on ? 'experimental' : m.implemented ? null : 'not implemented' })); }
class ExperimentalDisabledError extends Error { constructor(id) { super(`${id} is disabled (experimental; set MA_EXPERIMENTAL=1)`); this.code = 'EXPERIMENTAL_DISABLED'; this.reason = 'experimental'; } }
function requireExperimental(id, opts) { if (!experimentalEnabled(opts)) throw new ExperimentalDisabledError(id); }
module.exports = { EXPERIMENTAL_MODULES, experimentalEnabled, moduleStatus, requireExperimental, ExperimentalDisabledError };
