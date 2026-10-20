'use strict';
const fs = require('fs');
const path = require('path');
const { NewsEngine } = require('../../media-automation/src/news');
const { VideoFactory, RenderQueue, StubCharacter3D, getPreset } = require('../../media-automation/src/video');
const { REPUTABLE_SOURCES, orgById, isNewsLaunchPrompt } = require('./sources');
const { candidatesFromEngine, factCheckItems, selectStories } = require('./factcheck');
const { writeScript, extractiveVariants, assertGrounded } = require('./script');
const { ensureTts } = require('./tts');
const { normalizeLoudness } = require('./loudness');
const { qcFile } = require('./qc');
const { assertSchema, SCHEMAS } = require('./schemas');
const { assertLaunchPaths, probeStudioJobs } = require('./studio-boundary');

const BRAND = { colors: ['0x1a3a5c', '0x1a4d3e', '0x3a2f6b'], textColor: 'white' };

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function episodeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function measure(tts, script, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const segments = [];
  let speechSec = 0;
  for (const [i, scene] of script.scenes.entries()) {
    const file = path.join(dir, `scene-${i}.wav`);
    const rendered = await tts.synthesize(scene.text, file);
    segments.push({ text: scene.text, file, durationSec: rendered.durationSec });
    speechSec += rendered.durationSec;
  }
  const expectedVideoSec = script.scenes.reduce((sum, _, i) => sum + Math.max(1, segments[i].durationSec + 0.3), 0);
  return { segments, speechSec, expectedVideoSec };
}

function tag(script, llm) {
  return { ...script, scenes: script.scenes.map(s => ({ ...s })), llm };
}

async function runLaunch(opts = {}) {
  const prompt = String(opts.prompt || '').trim();
  if (!isNewsLaunchPrompt(prompt)) {
    throw new Error('Prompt refused. Example: Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях');
  }
  if (!opts.outDir) throw new Error('outDir required');
  const outDir = opts.outDir;
  assertLaunchPaths([outDir, opts.studioJobsPath, opts.blenderPath]);
  fs.mkdirSync(outDir, { recursive: true });
  const studioJobs = await probeStudioJobs(opts.studioJobClient);
  const profile = opts.profile || 'episode';
  const sources = opts.sources || REPUTABLE_SOURCES;
  const nowIso = opts.now || (() => new Date().toISOString());
  const id = opts.episodeId || episodeId();

  const engine = new NewsEngine({
    statePath: path.join(outDir, 'news-engine-state.json'),
    sources: sources.map(s => ({ id: s.id, name: s.name, url: s.url, kind: s.kind || 'rss', trust: s.trust })),
    fetchFn: opts.fetchFn, retries: opts.retries ?? 1, backoffMs: opts.backoffMs ?? 250, outputLang: 'en', now: nowIso,
  });
  const ingest = await engine.run();
  const candidates = candidatesFromEngine(engine, orgById(sources)).map(c => assertSchema(c, SCHEMAS.storyCandidate, 'StoryCandidate'));
  writeJson(path.join(outDir, '01-story-candidates.json'), { ingest, candidates });
  if (opts.stopAfter === 'ingest') return { stage: 'ingest', candidates, ingest, episodeId: id };

  const checks = factCheckItems(candidates.flatMap(c => c.items), { now: nowIso });
  writeJson(path.join(outDir, '02-fact-check.json'), { results: checks });
  const selected = selectStories(checks, {
    count: opts.storyCount || 3, maxAgeHours: opts.maxAgeHours ?? 96, now: opts.nowMs || Date.now(),
  });
  if (opts.stopAfter === 'factcheck') {
    return { stage: 'factcheck', checks, selected, candidates, ingest, episodeId: id };
  }

  const ollamaUrl = opts.ollamaUrl === undefined ? (process.env.OLLAMA_URL || 'http://127.0.0.1:11434') : opts.ollamaUrl;
  const drafted = await writeScript(selected.stories, {
    ollamaUrl, fetchFn: opts.ollamaFetch, skipOllama: !!opts.skipOllama, prefer: opts.ollamaModel || 'qwen3:8b',
  });
  const tts = opts.tts || await ensureTts();
  if (profile === 'episode' && tts.name === 'stub') throw new Error('Episode profile refuses StubTTS. Real speech is required.');
  const character3d = opts.character3d || new StubCharacter3D();
  if (profile === 'episode' && character3d.name !== 'stub-3d') {
    throw new Error('This launch does not render a substitute host. See news-launch/HOST_3D_INTERFACE.md.');
  }
  const caps = character3d.capabilities();
  if (caps.available && !(caps.ownerApproval && caps.ownerApproval.approvedBy && caps.ownerApproval.modelHash)) {
    throw new Error('3D host refused: owner approval record is missing.');
  }

  const minDuration = profile === 'episode' ? 30 : 0;
  const maxDuration = profile === 'episode' ? 60 : 9999;
  const adapterLlm = {
    mode: 'temporary-adapter', model: null, adapter: 'TEMPORARY_ADAPTER:extractive-headlines',
    reason: drafted.llm.mode === 'ollama' ? `Ollama ${drafted.llm.model} draft did not fit 30–60s; headlines were used instead` : drafted.llm.reason,
  };
  const variants = [];
  const seen = new Set();
  for (const candidate of [drafted, ...extractiveVariants(selected.stories).map(s => tag(s, drafted.llm.mode === 'ollama' ? adapterLlm : drafted.llm))]) {
    const key = candidate.scenes.map(s => s.text).join('\n');
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(candidate);
  }

  let script = null;
  let voice = null;
  const voiceDir = path.join(outDir, 'voiceover');
  let last = null;
  for (const candidate of variants) {
    assertGrounded(candidate, selected.stories);
    const measured = await measure(tts, candidate, voiceDir);
    last = measured;
    if (measured.expectedVideoSec >= minDuration && measured.expectedVideoSec <= maxDuration) {
      script = candidate;
      voice = measured;
      break;
    }
  }
  if (!script) {
    throw new Error(`Duration ${last ? last.expectedVideoSec.toFixed(1) : '?'}s is outside ${minDuration}-${maxDuration}s. Refusing to pad the script with invented copy.`);
  }
  script = assertSchema(script, SCHEMAS.script, 'NewsScript');
  const voiceover = assertSchema({
    engine: tts.name, voice: tts.voiceId || null,
    license: tts.license || 'unspecified', commercialUse: tts.commercialUse !== false,
    segments: voice.segments,
  }, SCHEMAS.voiceover, 'Voiceover');
  writeJson(path.join(outDir, '03-script.json'), script);
  fs.writeFileSync(path.join(outDir, 'script.txt'), script.scenes.map(s => (s.heading ? s.heading + '\n' : '') + s.text).join('\n\n'));
  writeJson(path.join(outDir, '04-voiceover.json'), voiceover);

  const sourceRows = selected.stories.flatMap(story => story.sources.map(src => ({
    storyId: story.storyId, claim: story.claim, publisher: src.publisher, org: src.org, url: src.url,
    title: src.title, published: src.published, category: story.category, method: story.method, adapter: story.adapter,
  })));
  writeJson(path.join(outDir, 'sources.json'), sourceRows);
  const imageLicenses = {
    images: [{
      id: 'generated-color-cards', origin: 'generated',
      generator: 'ffmpeg lavfi color + drawtext via Video Factory v0',
      license: 'Original graphics produced by this pipeline. No third-party photograph or footage.',
      thirdPartyAssets: [{ name: 'DejaVu Sans', license: 'Bitstream Vera / DejaVu, free for commercial use' }],
    }],
    music: null,
    tts: { engine: voiceover.engine, voice: voiceover.voice, license: voiceover.license, commercialUse: voiceover.commercialUse },
  };
  writeJson(path.join(outDir, 'image-licenses.json'), imageLicenses);

  const factory = new VideoFactory({ tts, character3d, brand: BRAND });
  const queue = new RenderQueue({
    statePath: path.join(outDir, 'render-queue.json'), concurrency: 1, maxAttempts: 1,
    worker: payload => factory.render(script, {
      preset: getPreset(payload.preset, { crf: 23 }), outDir, basename: payload.basename, music: null,
    }),
  });
  for (const [preset, basename] of [['youtube', 'horizontal'], ['shorts', 'vertical']]) {
    queue.add({ preset, basename }, { id: `news-${basename}` });
  }
  queue.start();
  await queue.onIdle();
  const jobs = [];
  for (const job of queue.jobs()) {
    if (job.status !== 'done') throw new Error(`Render ${job.id} ${job.status}: ${job.error}`);
    const preset = getPreset(job.payload.preset);
    jobs.push(assertSchema({
      id: job.id, preset: job.payload.preset, status: 'done', scriptTitle: script.title,
      width: preset.width, height: preset.height, character3d: 'stub-3d', music: null,
      video: job.result.files.video, subtitles: job.result.files.subtitles,
    }, SCHEMAS.renderJob, 'VideoRenderJob'));
  }
  writeJson(path.join(outDir, '05-render-jobs.json'), jobs);
  if (character3d.name !== 'stub-3d' && profile === 'episode') {
    throw new Error('3D segment refused: episode profile has no owner-approved host');
  }

  for (const job of jobs) await normalizeLoudness(job.video);
  const qc = [];
  for (const job of jobs) {
    const report = await qcFile(job.video, {
      expectWidth: job.width, expectHeight: job.height, minDuration, maxDuration, subtitleFile: job.subtitles, now: nowIso,
    });
    qc.push(report);
  }
  writeJson(path.join(outDir, '06-qc.json'), qc);
  const failed = qc.filter(q => !q.ok);
  if (failed.length) throw new Error('QC failed: ' + failed.map(q => `${q.width}x${q.height} ${q.failures.join(', ')}`).join(' | '));

  const manifest = {
    episodeId: id, prompt, profile, outDir, script, voiceover, jobs, qc,
    sources: sourceRows, imageLicenses, selected: selected.stories, adapters: [
      script.llm.adapter, ...selected.stories.map(s => s.adapter),
    ].filter(Boolean),
    character3d: character3d.name, hostUsed: false, publish: false, ageWindowHours: selected.ageWindowHours,
    ingest,
    studioJobs: { mode: studioJobs.mode, connected: studioJobs.connected, error: studioJobs.error },
    blender: { invoked: false, pathWritten: false },
  };
  writeJson(path.join(outDir, 'manifest.json'), manifest);
  return manifest;
}

module.exports = { runLaunch, BRAND, measure };
