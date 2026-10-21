// REFERENCE ONLY — Studio wires setExecutor in server.js itself (dataDir=DATA_DIR). FOR STUDIO REVIEW: proposed wiring of the media-automation `video_render` executor into the Studio server.
// NOT applied anywhere — media-automation is not part of v1.2.4-test; integration is deferred.
// Place (when Studio decides): server.js after `app.locals.services` is created. Requires feat/media-automation checked out
// at ./media-automation (or MA_ROOT). Studio's heavy lock already serializes the call; the executor additionally unloads Ollama.
const path = require('path');
const MA = process.env.MA_ROOT || path.join(__dirname, 'media-automation');
if (process.env.MA_VIDEO_RENDER === 'on') {                       // opt-in; default off
  const { createVideoRenderExecutor } = require(path.join(MA, 'src/jobs/video-render-executor'));
  const { NewsVideoFactory } = require(path.join(MA, 'src/video/factory2'));
  const { OllamaProvider } = require(path.join(MA, 'src/llm'));                // only .unload() is used
  const services = app.locals.services;
  services.videoRender.setExecutor(createVideoRenderExecutor({
    dataDir: DATA_DIR,                 // Studio data dir; artifacts are written directly into outDir (<DATA_DIR>/media)
    factory: new NewsVideoFactory({}),
    llm: new OllamaProvider({}),
    log: (ev, msg) => log('info', 'video_render', ev + (msg ? ': ' + msg : '')),
  }));
}
// Contract (docs/JOBS_API.md, feat/v1.2.0): fn({runId, preset, episodeRef, jobId, outDir, signal}) -> {artifacts:[mp4,srt,jpg]}.
// Verified only against test/fixtures/studio-jobs-mock.js (contract-faithful mock), NOT against the real Studio server.
