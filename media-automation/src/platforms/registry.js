'use strict';
/** Platform registry: every channel the studio runs. Live mode = per-platform owner flag AND an approved 'live_mode' Approval Center item. */
const { capabilitiesFor } = require('./capabilities'); const { experimentalEnabled } = require('../experimental');
const PLATFORMS = [
  { id: 'youtube-news', kind: 'youtube', label: 'YouTube — MOONKATTY NEWS', accountIds: ['youtube-news'], formats: ['yt-video', 'yt-short'], scheduling: 'native' },
  { id: 'youtube-project', kind: 'youtube', label: 'YouTube — MOONKATTY PROJECT', accountIds: ['youtube-project'], formats: ['yt-video'], scheduling: 'native' },
  { id: 'tiktok', kind: 'tiktok', label: 'TikTok — news', accountIds: ['tiktok-news'], formats: ['tt-video'], scheduling: 'own' },
  { id: 'x', kind: 'x', label: 'X — news', accountIds: ['x-news'], formats: ['x-post'], scheduling: 'own', experimental: 'x_adapter' },
  { id: 'telegram', kind: 'telegram', label: 'Telegram — news channel', accountIds: ['telegram-news'], formats: ['tg-post'], scheduling: 'own', experimental: 'telegram_adapter' },
  { id: 'moonkatty-web', kind: 'web', label: 'moonkatty.com', accountIds: [], formats: ['web-article'], scheduling: 'own', implemented: false },
  { id: 'instagram', kind: 'instagram', label: 'Instagram — news', accountIds: ['instagram-news'], formats: ['ig-reel', 'ig-image', 'ig-carousel'], scheduling: 'own' },
  { id: 'facebook', kind: 'facebook', label: 'Facebook — news page', accountIds: ['facebook-news'], formats: ['fb-reel', 'fb-video', 'fb-post'], scheduling: 'native' },
];
const getPlatform = id => PLATFORMS.find(p => p.id === id) || null;
/** enabled + disabledReason ('experimental' | 'not implemented' | null) */
function platformState(p, opts = {}) { if (p.implemented === false) return { enabled: false, disabledReason: 'not implemented' };
  if (p.experimental && !experimentalEnabled(opts)) return { enabled: false, disabledReason: 'experimental' }; return { enabled: true, disabledReason: null }; }
const envKey = p => `MA_PUBLISH_LIVE_${p.kind.toUpperCase()}`;
/** Live requires BOTH. Never bypasses Approval Center. */
function liveMode(platformId, { liveFlags = {}, env = {}, approvals = null, experimental } = {}) {
  const p = getPlatform(platformId); if (!p) return { live: false, reason: 'not implemented' }; const st = platformState(p, { experimental, env });
  if (!st.enabled) return { live: false, reason: st.disabledReason };
  const flag = liveFlags[p.kind] === true || env[envKey(p)] === 'owner-approved';
  const item = approvals ? approvals.get(`live_mode:${platformId}`) : null; const approved = item?.status === 'approved';
  return { live: flag && approved, ownerFlag: flag, approval: item ? item.status : 'missing', reason: flag && approved ? 'owner flag + approval' : !flag ? 'owner flag off' : 'live_mode approval not approved' };
}
const requestLiveMode = (approvals, platformId, by) => approvals.submit({ id: `live_mode:${platformId}`, kind: 'live_mode', title: `Enable LIVE publishing on ${platformId}` }, by);
module.exports = { PLATFORMS, getPlatform, platformState, liveMode, requestLiveMode, capabilitiesFor };
