'use strict';
const fs = require('fs'); const { call } = require('../http');
/** YouTube Data API v3: resumable upload (videos.insert) + status (videos.list). Token: OAuth2 user access token for the given channel. */
class YouTubeAdapter {
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.platform = 'youtube'; }
  validate(p) { const e = []; if (!p.videoPath) e.push('videoPath required'); if (!p.title || p.title.length > 100) e.push('title 1..100 chars'); if ((p.description || '').length > 5000) e.push('description > 5000'); return e; }
  preview(p) { return { platform: this.platform, title: p.title, description: p.description, tags: p.tags || [], privacy: p.privacy || 'private', file: p.videoPath, shorts: !!p.shorts }; }
  async publish(p, { token }) {
    const meta = { snippet: { title: p.title, description: (p.description || '') + (p.shorts ? '\n#Shorts' : ''), tags: p.tags || [], categoryId: p.categoryId || '25' },
      status: { privacyStatus: p.privacy || 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
    const size = fs.statSync(p.videoPath).size;
    const init = await call(this.fetchFn, 'youtube', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(size) }, body: JSON.stringify(meta) });
    const loc = init.headers.get('location'); if (!loc) throw new Error('youtube: no upload location');
    const up = await call(this.fetchFn, 'youtube', loc, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(size) }, body: fs.readFileSync(p.videoPath) });
    return { remoteId: up.body.id, url: `https://www.youtube.com/watch?v=${up.body.id}` };
  }
  async status(remoteId, { token }) {
    const r = await call(this.fetchFn, 'youtube', `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(remoteId)}`, { headers: { authorization: `Bearer ${token}` } });
    const v = r.body.items?.[0]; return v ? { state: v.status.uploadStatus, privacy: v.status.privacyStatus, processing: v.processingDetails?.processingStatus } : { state: 'not_found' };
  }
}
module.exports = { YouTubeAdapter };
