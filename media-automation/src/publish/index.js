'use strict';
const { YouTubeAdapter } = require('./adapters/youtube'); const { TelegramAdapter } = require('./adapters/telegram'); const { XAdapter } = require('./adapters/x');
const { TikTokAdapter } = require('./adapters/tiktok'); const { MetaAdapter } = require('./adapters/meta');
const { experimentalEnabled } = require('../experimental');
/** X + Telegram are experimental: registered only when MA_EXPERIMENTAL is on. */
function defaultAdapters(opts = {}) { const exp = experimentalEnabled(opts); return { youtube: new YouTubeAdapter(opts), ...(exp ? { telegram: new TelegramAdapter(opts), x: new XAdapter(opts) } : {}), tiktok: new TikTokAdapter(opts),
  instagram: new MetaAdapter({ ...opts, kind: 'instagram' }), facebook: new MetaAdapter({ ...opts, kind: 'facebook' }) }; }
module.exports = { ...require('./publisher'), ...require('./http'), YouTubeAdapter, TelegramAdapter, XAdapter, TikTokAdapter, MetaAdapter, defaultAdapters };
