'use strict';
const fs = require('fs'); const { call } = require('../http');
/** TikTok Content Posting API v2: direct post init (FILE_UPLOAD single chunk) -> PUT upload -> status/fetch. Unaudited apps can only post SELF_ONLY. */
class TikTokAdapter {
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.platform = 'tiktok'; }
  validate(p) { const e = []; if (!p.videoPath) e.push('videoPath required'); if ((p.title || '').length > 2200) e.push('caption > 2200'); return e; }
  preview(p) { return { platform: this.platform, caption: p.title, privacy: p.privacy || 'SELF_ONLY', file: p.videoPath }; }
  async publish(p, { token }) {
    const size = fs.statSync(p.videoPath).size; const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' };
    const init = await call(this.fetchFn, 'tiktok', 'https://open.tiktokapis.com/v2/post/publish/video/init/', { method: 'POST', headers: h, body: JSON.stringify({
      post_info: { title: p.title, privacy_level: p.privacy || 'SELF_ONLY', disable_comment: false, is_aigc: true },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } }) });
    const { publish_id, upload_url } = init.body.data;
    await call(this.fetchFn, 'tiktok', upload_url, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-range': `bytes 0-${size - 1}/${size}` }, body: fs.readFileSync(p.videoPath) });
    return { remoteId: publish_id, url: null };
  }
  async status(publishId, { token }) {
    const r = await call(this.fetchFn, 'tiktok', 'https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ publish_id: publishId }) });
    return { state: r.body.data?.status || 'unknown' };
  }
}
module.exports = { TikTokAdapter };
