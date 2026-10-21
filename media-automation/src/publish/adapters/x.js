'use strict';
const fs = require('fs'); const { call } = require('../http');
/** X API v2: media upload (v2 /2/media/upload, simple image upload) + POST /2/tweets. Token: OAuth2 user token (tweet.write, media.write). */
class XAdapter {
  constructor({ fetchFn = globalThis.fetch, base = 'https://api.x.com' } = {}) { this.fetchFn = fetchFn; this.base = base; this.platform = 'x'; }
  validate(p) { const e = []; if (!p.text) e.push('text required'); if ((p.text || '').length > 280) e.push('text > 280 chars'); return e; }
  preview(p) { return { platform: this.platform, text: p.text, chars: (p.text || '').length, image: p.imagePath || null }; }
  async publish(p, { token }) {
    const auth = { authorization: `Bearer ${token}` }; let media;
    if (p.imagePath) {
      const fd = new FormData(); fd.set('media', new Blob([fs.readFileSync(p.imagePath)])); fd.set('media_category', 'tweet_image');
      const up = await call(this.fetchFn, 'x', `${this.base}/2/media/upload`, { method: 'POST', headers: auth, body: fd });
      media = { media_ids: [String(up.body.data?.id || up.body.id)] };
    }
    const r = await call(this.fetchFn, 'x', `${this.base}/2/tweets`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ text: p.text, ...(media ? { media } : {}) }) });
    return { remoteId: r.body.data.id, url: `https://x.com/i/web/status/${r.body.data.id}` };
  }
  async status(id, { token }) { const r = await call(this.fetchFn, 'x', `${this.base}/2/tweets/${id}`, { headers: { authorization: `Bearer ${token}` } }); return { state: r.body.data ? 'live' : 'not_found' }; }
}
module.exports = { XAdapter };
