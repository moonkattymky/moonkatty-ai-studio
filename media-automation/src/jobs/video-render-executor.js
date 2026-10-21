'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
/**
 * Executor for Studio job type `video_render` (feat/v1.2.0 @a991e93 docs/JOBS_API.md).
 * Studio wiring: services.videoRender.setExecutor(createVideoRenderExecutor({ dataDir, factory, llm }))
 * fn({runId, preset, episodeRef, jobId, outDir, signal}) -> { artifacts: [mp4, srt, jpg] each {name, path, size, sha256, kind} }, paths inside <dataDir>/media.
 * Studio already holds the heavy lock; we unload Ollama ourselves before rendering.
 */
const RUN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/; const PRESETS = ['youtube', 'shorts'];
function validateInput(i) {
  const keys = Object.keys(i || {}).filter(k => !['jobId', 'outDir', 'signal'].includes(k)); const extra = keys.filter(k => !['runId', 'preset', 'episodeRef'].includes(k));
  if (extra.length) throw new Error('video_render: unknown input fields ' + extra.join(','));
  if (!RUN_RE.test(i.runId || '') || i.runId.includes('..')) throw new Error('video_render: bad runId');
  if (!PRESETS.includes(i.preset)) throw new Error('video_render: preset must be youtube|shorts');
  if (!REF_RE.test(i.episodeRef || '') || i.episodeRef.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('video_render: bad episodeRef');
}
const mediaRoot = dataDir => path.join(dataDir, 'media');
function inside(root, p) { const r = fs.realpathSync(root); const q = fs.realpathSync(p); return q === r || q.startsWith(r + path.sep); }
/** Episode JSON lives at <dataDir>/media/episodes/<episodeRef>.json (written by our orchestrator). */
function writeEpisode(dataDir, episodeRef, episode) { const f = path.join(mediaRoot(dataDir), 'episodes', episodeRef + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(episode, null, 2)); fs.renameSync(f + '.tmp', f); return f; }
function readEpisode(dataDir, episodeRef) { const f = path.join(mediaRoot(dataDir), 'episodes', episodeRef + '.json'); if (!fs.existsSync(f) || !inside(mediaRoot(dataDir), f)) throw new Error('video_render: episode not found: ' + episodeRef); return JSON.parse(fs.readFileSync(f, 'utf8')); }
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function artifact(file, kind) { if (path.extname(file).toLowerCase() !== '.' + kind) throw new Error(`video_render: ${kind} artifact has wrong extension: ${file}`); const st = fs.statSync(file);
  return { name: path.basename(file), path: fs.realpathSync(file), size: st.size, sha256: sha256(file), kind }; }
function createVideoRenderExecutor({ dataDir, factory, llm = null, music = null, loadEpisode = readEpisode, log = () => {} }) {
  if (!dataDir || !factory) throw new Error('createVideoRenderExecutor: dataDir and factory required');
  return async function videoRenderExecutor(args) {
    const { runId, preset, episodeRef, outDir = mediaRoot(dataDir), signal } = args; validateInput(args);
    fs.mkdirSync(outDir, { recursive: true }); if (!inside(mediaRoot(dataDir), outDir)) throw new Error('video_render: outDir must be inside <dataDir>/media');
    if (signal?.aborted) throw new Error('video_render: cancelled');
    if (llm && typeof llm.unload === 'function') { try { await llm.unload(); log('ollama_unloaded'); } catch (e) { log('ollama_unload_failed', e.message); } }
    const episode = await loadEpisode(dataDir, episodeRef); const dir = path.join(outDir, runId); fs.mkdirSync(dir, { recursive: true });
    const m = await factory.render(episode, { preset, outDir: dir, basename: `${runId}-${preset}`, music, signal });
    if (signal?.aborted) throw new Error('video_render: cancelled');
    const artifacts = [artifact(m.files.video, 'mp4'), artifact(m.files.subtitles, 'srt'), artifact(m.files.thumbnail, 'jpg')];
    for (const a of artifacts) if (!inside(mediaRoot(dataDir), a.path)) throw new Error('video_render: artifact outside <dataDir>/media');
    return { artifacts };
  };
}
module.exports = { createVideoRenderExecutor, validateInput, writeEpisode, readEpisode, RUN_RE, REF_RE };
