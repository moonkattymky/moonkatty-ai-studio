'use strict';
const fs = require('fs');
const path = require('path');
const { NewsVideoFactory, getPreset, SpeechComposer, MasterVoice } = require('../../media-automation/src/video');
const { StubHost3D } = require('../../media-automation/src/host3d');
const { run } = require('../../media-automation/src/video/exec');
const { LocalJobQueue } = require('../../media-automation/src/jobs/local');
const { ApprovalCenter } = require('../../media-automation/src/approval');
const { Publisher, DEFAULT_ACCOUNTS } = require('../../media-automation/src/publish/publisher');
const { defaultAdapters } = require('../../media-automation/src/publish');
const { layoutFor } = require('../../media-automation/src/media/library');
const { assertLaunchPaths } = require('./studio-boundary');

const HOST_NAME = 'host3d-stub';
const KOKORO_MODEL = path.join(__dirname, '..', 'models', 'kokoro', 'kokoro-v1.0.onnx');
const KOKORO_VOICES = path.join(__dirname, '..', 'models', 'kokoro', 'voices-v1.0.bin');

function kokoroEnv() {
  process.env.MA_KOKORO_MODEL = KOKORO_MODEL;
  process.env.MA_KOKORO_VOICES = KOKORO_VOICES;
}

/** Their candidate. Does not call MasterVoice.lock. */
function masterSpeech() {
  kokoroEnv();
  const master = new MasterVoice();
  if (master.cfg.voice !== 'am_michael') {
    throw new Error(`MasterVoice voice is ${master.cfg.voice}. This launch uses the am_michael candidate and does not substitute another voice.`);
  }
  return { master, tts: new SpeechComposer({ tts: master.createTTS() }), approved: master.locked === true };
}

function qcFromManifest(manifest) {
  const loud = manifest.qa.checks.find(c => c.name === 'loudness_lufs');
  const peak = manifest.qa.checks.find(c => c.name === 'true_peak');
  const black = manifest.qa.checks.find(c => c.name === 'no_black_frames');
  return {
    file: manifest.files.video,
    ok: manifest.qa.ok,
    width: manifest.width,
    height: manifest.height,
    durationSec: manifest.durationSec,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioPresent: true,
    loudnessLUFS: loud ? loud.actual : null,
    truePeakDb: peak ? peak.actual : null,
    clipping: peak ? !peak.ok : false,
    blackFrames: black && Array.isArray(black.actual) ? black.actual.map(b => `${b.start}-${b.end}`) : [],
    subtitleFile: manifest.files.subtitles,
    subtitleCues: manifest.subtitles && manifest.subtitles.cues,
    failures: manifest.qa.checks.filter(c => !c.ok).map(c => `${c.name}=${JSON.stringify(c.actual)}`),
    checkedAt: manifest.createdAt,
    targetLufs: manifest.loudnessLufs,
  };
}

async function testFixture(dir) {
  const file = path.join(dir, 'test-fixture.png');
  if (!fs.existsSync(file)) {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=2400x2400:rate=1:duration=1', '-frames:v', '1', file]);
  }
  return {
    id: 'test-fixture',
    localPath: file,
    width: 2400,
    height: 2400,
    title: 'pipeline test pattern',
    author: 'news-launch test',
    license: 'test-fixture',
    licenseUrl: null,
    pageUrl: null,
    attribution: 'Test fixture generated for the pipeline test. Not a licensed photograph.',
    origin: 'test-fixture',
  };
}

function episodeFromScript(script, stories, assetsById, dateLabel) {
  const scenes = script.scenes.filter(s => s.kind === 'story');
  const built = scenes.map(scene => {
    const story = (stories || []).find(s => s.storyId === scene.storyId);
    const asset = (assetsById && (assetsById[scene.storyId] || assetsById['*'])) || null;
    if (!asset) throw new Error(`no licensed still for ${scene.storyId}`);
    return {
      id: scene.storyId,
      category: (story && story.category) || scene.category || 'news',
      headline: (scene.heading || scene.storyId).slice(0, 90),
      text: scene.text,
      asset,
    };
  });
  const sources = [];
  for (const story of stories || []) {
    for (const src of story.sources || []) sources.push({ name: src.publisher || src.name, url: src.url });
  }
  if (!sources.length) {
    for (const src of script.sources || []) sources.push({ name: src.publisher || src.name, url: src.url });
  }
  return {
    title: script.title,
    dateLabel: dateLabel || '',
    stories: built,
    sources,
    rights: built.map(s => s.asset.attribution).filter(Boolean),
  };
}

function assertLayouts(episode) {
  for (const name of ['youtube', 'shorts']) {
    const preset = getPreset(name);
    for (const story of episode.stories) {
      const lay = layoutFor(story.asset, preset.width, preset.height);
      if (lay.mode === 'reject') throw new Error(`asset ${story.asset.id} rejected for ${name}: ${lay.reason}`);
    }
  }
}

async function renderEpisode({ episode, outDir, tts, episodeId, targetLufs = -16 }) {
  assertLaunchPaths([outDir]);
  const statePath = path.join(outDir, 'jobs-local.json');
  assertLaunchPaths([statePath]);
  assertLayouts(episode);
  const host3d = new StubHost3D();
  const factory = new NewsVideoFactory({ tts, host3d, targetLufs, workRoot: outDir });
  const queue = new LocalJobQueue({ statePath });
  const jobs = [];
  const manifests = [];
  for (const [presetName, basename] of [['youtube', 'horizontal'], ['shorts', 'vertical']]) {
    const preset = getPreset(presetName);
    const idempotencyKey = `${episodeId}:${presetName}`.slice(0, 128);
    const manifest = await queue.runExclusive({
      type: 'video_render',
      agent: 'news-launch',
      input: { episodeId, preset: presetName, basename },
      timeoutSec: 1800,
      maxAttempts: 1,
      resourceClass: 'gpu_heavy',
      idempotencyKey,
      safeToRetry: true,
    }, () => factory.render(episode, { preset, outDir, music: null, basename }));
    const stored = await queue.getJob((await queue.listJobs({})).find(j => j.idempotencyKey === idempotencyKey).jobId);
    jobs.push({
      id: stored.jobId,
      preset: presetName,
      status: stored.status,
      scriptTitle: episode.title,
      width: preset.width,
      height: preset.height,
      character3d: HOST_NAME,
      music: null,
      video: manifest.files.video,
      subtitles: manifest.files.subtitles,
      resourceClass: stored.resourceClass,
      idempotencyKey: stored.idempotencyKey,
      safeToRetry: stored.safeToRetry,
    });
    manifests.push(manifest);
  }
  return { jobs, manifests, host3d: host3d.name, statePath, qc: manifests.map(qcFromManifest) };
}

async function holdForApproval({ outDir, episodeId, title, summary, sources, licenses, videos }) {
  assertLaunchPaths([outDir]);
  const approvalCenter = new ApprovalCenter({ statePath: path.join(outDir, 'approval-center.json') });
  const publisher = new Publisher({
    statePath: path.join(outDir, 'publisher.json'),
    adapters: defaultAdapters(),
    accounts: DEFAULT_ACCOUNTS,
    liveFlags: {},
  });
  const item = approvalCenter.submit({
    id: `approval-${episodeId}`,
    kind: 'video',
    title: String(title || 'MOONKATTY NEWS').slice(0, 100),
    headline: String(title || 'MOONKATTY NEWS').slice(0, 150),
    text: summary,
    description: String(summary || '').slice(0, 5000),
    videoPath: videos.horizontal,
    sources,
    licenses,
    publish: { status: 'awaiting_approval' },
  }, 'news-launch');
  publisher.enqueue({
    accountId: 'youtube-news',
    contentId: `${episodeId}:youtube`,
    payload: {
      videoPath: videos.horizontal,
      title: String(title || 'MOONKATTY NEWS').slice(0, 100),
      description: String(summary || '').slice(0, 5000),
    },
    content: { reviewStatus: 'pending', storyId: episodeId },
  });
  publisher.enqueue({
    accountId: 'tiktok-news',
    contentId: `${episodeId}:shorts`,
    payload: {
      videoPath: videos.vertical,
      title: String(title || 'MOONKATTY NEWS').slice(0, 100),
    },
    content: { reviewStatus: 'pending', storyId: episodeId },
  });
  const posts = await publisher.processDue();
  return { item, posts };
}

function licenseRecords(assets) {
  return assets.map(a => ({
    title: a.title || a.id,
    author: a.author || null,
    license: a.license,
    licenseUrl: a.licenseUrl || null,
    pageUrl: a.pageUrl || null,
    attribution: a.attribution || null,
  }));
}

module.exports = {
  HOST_NAME, KOKORO_MODEL, KOKORO_VOICES, kokoroEnv, masterSpeech, qcFromManifest,
  testFixture, episodeFromScript, renderEpisode, holdForApproval, licenseRecords,
};
