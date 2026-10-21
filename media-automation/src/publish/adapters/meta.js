'use strict';
const { call } = require('../http');
/**
 * Meta Graph (same concepts as repo meta.js: graph.facebook.com/<version>, page token per page — meta.js itself is NOT imported/modified).
 * Instagram Reels: POST /{ig-user-id}/media (REELS, video_url public) -> poll status_code -> POST /media_publish.
 * Facebook Reels: POST /{page-id}/video_reels start -> upload (rupload, file_url) -> finish.
 */
class MetaAdapter {
  constructor({ fetchFn = globalThis.fetch, graphVersion = process.env.META_GRAPH_VERSION || 'v26.0', pollMs = 3000, maxPolls = 40, kind = 'instagram' } = {}) {
    Object.assign(this, { fetchFn, graphVersion, pollMs, maxPolls, kind }); this.platform = kind === 'instagram' ? 'instagram' : 'facebook';
  }
  G(p) { return `https://graph.facebook.com/${this.graphVersion}${p}`; }
  validate(p) { const e = []; if (!p.targetId) e.push('targetId (ig-user-id/page-id) required'); if (!p.videoUrl) e.push('videoUrl (public HTTPS) required'); if ((p.caption || '').length > 2200) e.push('caption > 2200'); return e; }
  preview(p) { return { platform: this.platform, targetId: p.targetId, caption: p.caption, videoUrl: p.videoUrl }; }
  async _post(path, params, token) { const b = new URLSearchParams({ ...params, access_token: token }); return (await call(this.fetchFn, this.platform, this.G(path), { method: 'POST', body: b })).body; }
  async publish(p, { token }) {
    if (this.kind === 'instagram') {
      const c = await this._post(`/${p.targetId}/media`, { media_type: 'REELS', video_url: p.videoUrl, caption: p.caption || '', share_to_feed: 'true' }, token);
      for (let i = 0; i < this.maxPolls; i++) {
        const s = (await call(this.fetchFn, this.platform, this.G(`/${c.id}?fields=status_code&access_token=${encodeURIComponent(token)}`))).body;
        if (s.status_code === 'FINISHED') break; if (s.status_code === 'ERROR') throw new Error('instagram: container processing ERROR');
        if (i === this.maxPolls - 1) { const e = new Error('instagram: container not ready'); e.transient = true; throw e; } await new Promise(r => setTimeout(r, this.pollMs));
      }
      const pub = await this._post(`/${p.targetId}/media_publish`, { creation_id: c.id }, token); return { remoteId: pub.id, url: null };
    }
    const start = await this._post(`/${p.targetId}/video_reels`, { upload_phase: 'start' }, token);
    await call(this.fetchFn, this.platform, `https://rupload.facebook.com/video-upload/${this.graphVersion}/${start.video_id}`, { method: 'POST', headers: { authorization: `OAuth ${token}`, file_url: p.videoUrl } });
    await this._post(`/${p.targetId}/video_reels`, { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: p.caption || '' }, token);
    return { remoteId: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
  }
  async status(id, { token }) { const r = await call(this.fetchFn, this.platform, this.G(`/${id}?fields=${this.kind === 'instagram' ? 'id,permalink' : 'status'}&access_token=${encodeURIComponent(token)}`)); return { state: r.body.status?.video_status || (r.body.permalink ? 'published' : 'unknown'), url: r.body.permalink || null }; }
}
module.exports = { MetaAdapter };
