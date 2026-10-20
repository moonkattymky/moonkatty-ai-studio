'use strict';
const fs = require('fs');
const path = require('path');
const { assertSchema, SCHEMAS } = require('./schemas');
const { assertLaunchPaths } = require('./studio-boundary');

function registerFile(deps, abs, name, mime) {
  const id = deps.core.uid();
  const safe = String(name).replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const destName = `${id}-${safe}`;
  fs.mkdirSync(deps.filesDir, { recursive: true });
  fs.copyFileSync(abs, path.join(deps.filesDir, destName));
  const size = fs.statSync(path.join(deps.filesDir, destName)).size;
  return deps.put('files', {
    id, name: safe, size, mime, url: `/files/${destName}`, project: 'news', createdAt: deps.core.now(),
  });
}

function saveToStudio(deps, manifest) {
  assertLaunchPaths([deps.filesDir, deps.dbPath]);
  const { core, social, put, log } = deps;
  const user = deps.user || 'news-launch';
  const horizontal = manifest.jobs.find(j => j.preset === 'youtube');
  const vertical = manifest.jobs.find(j => j.preset === 'shorts');
  const video = registerFile(deps, horizontal.video, 'moonkatty-news-16x9.mp4', 'video/mp4');
  const videoVertical = registerFile(deps, vertical.video, 'moonkatty-news-9x16.mp4', 'video/mp4');
  const subs = registerFile(deps, horizontal.subtitles, 'moonkatty-news-16x9.srt', 'application/x-subrip');
  const subsVertical = registerFile(deps, vertical.subtitles, 'moonkatty-news-9x16.srt', 'application/x-subrip');
  const narration = manifest.voiceover.segments[0];
  const audio = narration ? registerFile(deps, narration.file, 'moonkatty-news-narration.wav', 'audio/wav') : null;
  const urls = [...new Set(manifest.sources.map(s => s.url))];
  const scriptText = manifest.script.scenes.map(s => s.text).join('\n\n');
  const durationSec = manifest.qc.find(q => q.width === 1920)?.durationSec || manifest.qc[0].durationSec;
  const ep = core.newEpisode({
    id: manifest.episodeId,
    title: `MOONKATTY NEWS — ${manifest.script.title}`,
    project: 'news',
    durationMin: null,
    durationSec,
    sources: urls,
    notes: `EN short bulletin. LLM: ${manifest.script.llm.mode}${manifest.script.llm.model ? ' ' + manifest.script.llm.model : ''}. Not published. Technical QC passed. Human approval is still required.`,
    scripts: { EN: scriptText },
  });
  ep.title = 'MOONKATTY NEWS';
  for (const key of ['search', 'factcheck', 'script', 'translate', 'voice', 'visuals', 'edit']) ep.versions.EN[key] = 'done';
  ep.versions.EN.review = 'progress';
  ep.versions.EN.publish = 'todo';
  ep.media = { EN: { video: video.id, videoVertical: videoVertical.id, subs: subs.id, subsVertical: subsVertical.id, audio: audio && audio.id } };
  ep.approvalStatus = 'pending_approval';
  ep.qc = manifest.qc;
  ep.factCheck = manifest.selected;
  ep.newsLaunch = { llm: manifest.script.llm, adapters: manifest.adapters, hostUsed: false, publish: false };
  put('episodes', ep);

  const task = put('tasks', {
    id: core.uid(), title: 'Утвердить выпуск MOONKATTY NEWS',
    description: 'Редакционное утверждение короткого выпуска EN. Публикация не выполняется этим шагом. Источники указаны в выпуске.',
    agentId: 'director', priority: 'high', status: 'waiting_approval', project: 'news',
    schedule: { type: 'none' }, episodeId: ep.id, source: 'news-launch', createdAt: core.now(),
  });

  const materialId = core.uid();
  const src = {
    id: materialId, brand: 'news', kind: 'news', title: 'MOONKATTY NEWS',
    text: scriptText + '\n\nSources:\n' + urls.join('\n'),
    sourceUrl: urls[0], episodeId: ep.id, hashtags: ['moonkatty', 'news'],
    mediaUrl: '', mediaType: 'none', imageRights: 'generated', link: '', scheduledAt: null,
  };
  const queueIds = [];
  for (const channelId of ['fb-news', 'yt-news']) {
    const adapted = social.adapt(src, channelId);
    const item = put('queue', {
      ...src, ...adapted, id: core.uid(), materialId, status: 'pending_approval', factCheck: 'passed',
      attempts: 0, scheduledAt: null, demo: false, publish: false,
      history: [{ at: core.now(), event: 'created', user, note: 'held for approval; not published' }],
      createdAt: core.now(),
    });
    queueIds.push(item.id);
  }
  put('posts', {
    id: core.uid(), title: 'MOONKATTY NEWS', text: scriptText, channelId: 'yt-news',
    status: 'pending', episodeId: ep.id, scheduledAt: null, createdAt: core.now(),
  });

  const approval = assertSchema({
    id: task.id, episodeId: ep.id, status: 'pending_approval', publish: false,
    requestedAt: core.now(), summary: src.text.slice(0, 500), sources: urls, taskId: task.id, queueIds,
  }, SCHEMAS.approval, 'ApprovalRequest');
  if (manifest.outDir) fs.writeFileSync(path.join(manifest.outDir, 'approval-request.json'), JSON.stringify(approval, null, 2));
  if (log) log('info', 'news-launch', `Выпуск ${ep.id} собран и ждёт утверждения. Не опубликован.`, user);
  return { episode: ep, task, approval, files: { video, videoVertical, subs, subsVertical, audio } };
}

function openStudio(dbPath) {
  assertLaunchPaths([dbPath]);
  const Database = require('better-sqlite3');
  const core = require('../../public/core.js');
  const social = require('../../public/social.js');
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
           CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);
  const q = {
    list: db.prepare('SELECT data FROM items WHERE col = ? ORDER BY rowid'),
    get: db.prepare('SELECT data FROM items WHERE col = ? AND id = ?'),
    put: db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data'),
    meta: db.prepare('SELECT v FROM meta WHERE k = ?'),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)'),
  };
  const list = col => q.list.all(col).map(r => JSON.parse(r.data));
  const put = (col, obj) => { q.put.run(col, obj.id, JSON.stringify(obj)); return obj; };
  if (!q.meta.get('seeded')) {
    db.transaction(() => {
      const seed = core.seed();
      for (const col of Object.keys(seed)) for (const row of seed[col]) put(col, row);
      q.setMeta.run('seeded', core.now());
    })();
  }
  const filesDir = path.join(path.dirname(path.resolve(dbPath)), 'files');
  const log = (level, source, message, user) => put('logs', { id: core.uid(), at: core.now(), level, source, message, user: user || null });
  return { db, core, social, list, put, log, filesDir, get: (col, id) => { const r = q.get.get(col, id); return r ? JSON.parse(r.data) : null; } };
}

module.exports = { saveToStudio, openStudio, registerFile };
