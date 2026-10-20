'use strict';
const fs = require('fs');
const path = require('path');
const { NewsEngine } = require('../../media-automation/src/news');
const { StubHost3D } = require('../../media-automation/src/host3d');
const { REPUTABLE_SOURCES, orgById, isNewsLaunchPrompt } = require('./sources');
const { candidatesFromEngine, factCheckItems, selectStories } = require('./factcheck');
const { writeScript, extractiveVariants, assertGrounded } = require('./script');
const { ensureTts } = require('./tts');
const { assertSchema, SCHEMAS } = require('./schemas');
const { assertLaunchPaths, probeStudioJobs } = require('./studio-boundary');
const { HOST_NAME, testFixture, episodeFromScript, renderEpisode } = require('./factory-render');
const { findStill } = require('./stills');

const BRAND = { colors: ['0x1a3a5c', '0x1a4d3e', '0x3a2f6b'], textColor: 'white' };

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function episodeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function tag(script, llm) {
  return { ...script, scenes: script.scenes.map(s => ({ ...s })), llm };
}

async function chooseScript(selected, drafted) {
  const adapterLlm = {
    mode: 'temporary-adapter', model: null, adapter: 'TEMPORARY_ADAPTER:extractive-headlines',
    reason: drafted.llm.mode === 'ollama'
      ? `Ollama ${drafted.llm.model} draft failed the grounding check; headlines were used instead`
      : drafted.llm.reason,
  };
  if (drafted.llm.mode === 'ollama') {
    try { return assertGrounded(drafted, selected.stories); } catch { /* fall through */ }
  }
  for (const candidate of extractiveVariants(selected.stories)) {
    const tagged = tag(candidate, drafted.llm.mode === 'ollama' ? adapterLlm : drafted.llm);
    try { return assertGrounded(tagged, selected.stories); } catch { /* next variant */ }
  }
  throw new Error('script failed grounding check');
}

async function assetsFor(stories, outDir, opts) {
  if (opts.storyAssets) return opts.storyAssets;
  if ((opts.profile || 'episode') === 'test') return { '*': await testFixture(outDir) };
  const dir = path.join(outDir, 'media');
  const byId = {};
  for (const story of stories) {
    const q = String(story.claim || '').split(/\s+/).slice(0, 6).join(' ');
    const found = await findStill(story.storyId, [
      { provider: 'commons', q },
      { provider: 'nasa', q },
    ], dir);
    if (!found.asset) {
      throw new Error(`only ${Object.keys(byId).length} stories with licensed media`);
    }
    byId[story.storyId] = found.asset;
  }
  return byId;
}

function imageLicenseFile(assets, voiceover) {
  return {
    images: assets.map(a => ({
      id: a.id,
      origin: a.origin || a.provider || 'licensed',
      title: a.title || null,
      author: a.author || null,
      license: a.license,
      licenseUrl: a.licenseUrl || null,
      pageUrl: a.pageUrl || null,
      attribution: a.attribution || null,
      width: a.width,
      height: a.height,
      commercialUse: a.license !== 'test-fixture',
    })),
    music: null,
    tts: { engine: voiceover.engine, voice: voiceover.voice, license: voiceover.license, commercialUse: voiceover.commercialUse },
  };
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
  const host3d = opts.host3d || new StubHost3D();
  if (profile === 'episode' && host3d.name !== HOST_NAME) {
    throw new Error('This launch does not render a substitute host. See news-launch/HOST_3D_INTERFACE.md.');
  }
  const caps = host3d.capabilities();
  if (caps.available && !(caps.ownerApproval && caps.ownerApproval.approvedBy && caps.ownerApproval.modelHash)) {
    throw new Error('3D host refused: owner approval record is missing.');
  }

  const script = assertSchema(await chooseScript(selected, drafted), SCHEMAS.script, 'NewsScript');
  const assetsById = await assetsFor(selected.stories, outDir, { ...opts, profile });
  const dateLabel = new Date(opts.nowMs || Date.now()).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).toUpperCase();
  const episode = episodeFromScript(script, selected.stories, assetsById, dateLabel);
  const rendered = await renderEpisode({ episode, outDir, tts, episodeId: id, targetLufs: opts.targetLufs });
  const anchor = rendered.manifests[0] && rendered.manifests[0].files.anchorAudio;
  const voiceover = assertSchema({
    engine: tts.name, voice: tts.voiceId || null,
    license: tts.license || 'unspecified', commercialUse: tts.commercialUse !== false,
    segments: [{
      text: episode.stories.map(s => s.text).join(' '),
      file: anchor,
      durationSec: rendered.manifests[0].durationSec,
    }],
  }, SCHEMAS.voiceover, 'Voiceover');
  writeJson(path.join(outDir, '03-script.json'), script);
  fs.writeFileSync(path.join(outDir, 'script.txt'), script.scenes.map(s => (s.heading ? s.heading + '\n' : '') + s.text).join('\n\n'));
  writeJson(path.join(outDir, '04-voiceover.json'), voiceover);

  const sourceRows = selected.stories.flatMap(story => story.sources.map(src => ({
    storyId: story.storyId, claim: story.claim, publisher: src.publisher, org: src.org, url: src.url,
    title: src.title, published: src.published, category: story.category, method: story.method, adapter: story.adapter,
    primarySourceUrl: story.primarySourceUrl ?? null,
    primaryPublisher: story.primaryPublisher ?? null,
    primaryPublished: story.primaryPublished ?? null,
    editorialStatus: story.editorialStatus || 'confirmed-publishers',
  })));
  writeJson(path.join(outDir, 'sources.json'), sourceRows);
  const assets = episode.stories.map(s => s.asset);
  const imageLicenses = imageLicenseFile(assets, voiceover);
  writeJson(path.join(outDir, 'image-licenses.json'), imageLicenses);

  const jobs = rendered.jobs.map(job => assertSchema(job, SCHEMAS.renderJob, 'VideoRenderJob'));
  writeJson(path.join(outDir, '05-render-jobs.json'), jobs);
  const qc = rendered.qc.map(report => assertSchema(report, SCHEMAS.qc, 'QcResult'));
  writeJson(path.join(outDir, '06-qc.json'), qc);
  const failed = qc.filter(q => !q.ok);
  if (failed.length) throw new Error('QC failed: ' + failed.map(q => `${q.width}x${q.height} ${q.failures.join(', ')}`).join(' | '));

  const manifest = {
    episodeId: id, prompt, profile, outDir, script, voiceover, jobs, qc,
    sources: sourceRows, imageLicenses, selected: selected.stories, adapters: [
      script.llm.adapter, ...selected.stories.map(s => s.adapter),
    ].filter(Boolean),
    character3d: HOST_NAME, hostUsed: false, publish: false, ageWindowHours: selected.ageWindowHours,
    ingest,
    studioJobs: { mode: studioJobs.mode, connected: studioJobs.connected, error: studioJobs.error },
    blender: { invoked: false, pathWritten: false },
    factory: 'NewsVideoFactory',
    targetLufs: opts.targetLufs ?? -16,
    jobState: rendered.statePath,
  };
  writeJson(path.join(outDir, 'manifest.json'), manifest);
  return manifest;
}

module.exports = { runLaunch, BRAND };
