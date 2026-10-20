'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
/**
 * createApprovalRouter({ center, token, mediaRoots }) -> express.Router  (standalone; NOT wired into server.js)
 * Auth: every request needs the approval token: header `Authorization: Bearer <token>` or `?token=` (for <video src>). Constant-time compare.
 * Media: only files under mediaRoots are served (realpath check), Range supported via sendFile.
 */
function createApprovalRouter({ center, token, mediaRoots = [], express = require('express') }) {
  if (!token || token.length < 24) throw new Error('approval token (>=24 chars) required');
  const r = express.Router(); const want = Buffer.from(token);
  const roots = mediaRoots.map(p => fs.realpathSync(p));
  r.use((req, res, next) => {
    const h = req.get('authorization') || ''; const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : String(req.query.token || ''));
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    res.set('cache-control', 'no-store'); res.set('x-content-type-options', 'nosniff'); res.set('referrer-policy', 'no-referrer'); next();
  });
  r.use(express.json({ limit: '64kb' }));
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  const pub = it => it && { ...it, videoUrl: it.videoPath ? `media/${it.id}/video` : null, thumbUrl: it.thumbPath ? `media/${it.id}/thumb` : null, videoPath: undefined, thumbPath: undefined };
  r.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  r.get('/api/items', wrap(req => center.list({ status: req.query.status || undefined }).map(pub)));
  r.get('/api/items/:id', wrap(req => { const it = center.get(req.params.id); if (!it) { const e = new Error('not found'); e.status = 404; throw e; } return pub(it); }));
  r.post('/api/items/:id/edit', wrap(req => pub(center.edit(req.params.id, { headline: req.body.headline, text: req.body.text }, req.body.by))));
  r.post('/api/items/:id/approve', wrap(async req => pub(await center.approve(req.params.id, req.body.by, req.body.note))));
  r.post('/api/items/:id/reject', wrap(req => pub(center.reject(req.params.id, req.body.by, req.body.reason))));
  r.post('/api/items/:id/send-back', wrap(req => pub(center.sendBack(req.params.id, req.body.by, req.body.note))));
  r.get('/api/items/:id/history', wrap(req => (center.get(req.params.id) || { history: [] }).history));
  r.get('/media/:id/:kind', (req, res) => {
    if (!['video', 'thumb'].includes(req.params.kind)) return res.status(404).end();
    const it = center.get(req.params.id); const f = it && (req.params.kind === 'video' ? it.videoPath : it.thumbPath);
    if (!f || !fs.existsSync(f)) return res.status(404).end();
    const real = fs.realpathSync(f); if (!roots.some(root => real === root || real.startsWith(root + path.sep))) return res.status(403).end();
    res.sendFile(real);
  });
  return r;
}
module.exports = { createApprovalRouter };
