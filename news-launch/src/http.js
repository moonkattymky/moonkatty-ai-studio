'use strict';
const path = require('path');
const { runLaunch } = require('./pipeline');
const { saveToStudio } = require('./studio-save');

function mountNewsLaunch(app, deps) {
  app.post('/api/news/prepare', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'auth required' });
    const text = String((req.body && req.body.text) || '').trim();
    const outDir = path.join(path.dirname(deps.filesDir), 'news-launch', Date.now().toString(36));
    try {
      const launch = deps.runLaunch || runLaunch;
      const manifest = await launch({ prompt: text, outDir, profile: deps.profile || 'episode', ...(deps.launchOpts || {}) });
      const saved = await saveToStudio({ ...deps, user: req.user }, manifest);
      res.json({
        episodeId: saved.episode.id,
        approval: saved.approval,
        publisher: (saved.publisherPosts || []).map(p => ({ id: p.id, accountId: p.accountId, status: p.status })),
        llm: manifest.script.llm,
        publish: false,
        qc: manifest.qc.map(q => ({
          width: q.width, height: q.height, ok: q.ok, durationSec: q.durationSec, loudnessLUFS: q.loudnessLUFS,
        })),
      });
    } catch (e) {
      if (deps.log) deps.log('error', 'news-launch', e.message, req.user);
      const status = /Prompt refused|Refusing to invent/.test(e.message) ? 422 : 500;
      res.status(status).json({ error: e.message });
    }
  });
}

module.exports = { mountNewsLaunch };
