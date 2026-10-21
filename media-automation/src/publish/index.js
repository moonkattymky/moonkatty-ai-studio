'use strict';
const { YouTubeAdapter } = require('./adapters/youtube'); const { TelegramAdapter } = require('./adapters/telegram'); const { XAdapter } = require('./adapters/x');
const { TikTokAdapter } = require('./adapters/tiktok'); const { MetaAdapter } = require('./adapters/meta');
function defaultAdapters(opts = {}) { return { youtube: new YouTubeAdapter(opts), telegram: new TelegramAdapter(opts), x: new XAdapter(opts), tiktok: new TikTokAdapter(opts),
  instagram: new MetaAdapter({ ...opts, kind: 'instagram' }), facebook: new MetaAdapter({ ...opts, kind: 'facebook' }) }; }
module.exports = { ...require('./publisher'), ...require('./http'), YouTubeAdapter, TelegramAdapter, XAdapter, TikTokAdapter, MetaAdapter, defaultAdapters };
