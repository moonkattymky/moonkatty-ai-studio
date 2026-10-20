#!/usr/bin/env node
'use strict';
/**
 * Renders the editor-written bulletin. Does not re-run RSS selection.
 * Provisional Kokoro voice. Does not publish. Does not write server/jobs or server/blender.
 */
const fs = require('fs');
const path = require('path');
const { PiperTTS } = require('../../media-automation/src/video/tts');
const { VideoFactory, RenderQueue, StubCharacter3D, getPreset } = require('../../media-automation/src/video');
const { editorialScript, SAMPLE_TEXT } = require('../src/editorial');
const { applyLexicon } = require('../src/lexicon');
const { KokoroTTS, synthesizeBatch, prewarm, PROVISIONAL, MODEL, VOICES } = require('../src/kokoro');
const { measure, BRAND } = require('../src/pipeline');
const { normalizeLoudness } = require('../src/loudness');
const { qcFile } = require('../src/qc');
const { assertSchema, SCHEMAS } = require('../src/schemas');
const { assertLaunchPaths, probeStudioJobs } = require('../src/studio-boundary');

const ROOT = path.join(__dirname, '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const PRIMARY_SOURCES = [
  {
    storyId: 'alberta-referendum-2026-10-19',
    claim: 'Elections Alberta held a referendum on 19 October 2026. Question 10 asked whether Alberta should remain in Canada or start the legal process for a binding separation referendum. Official results are published on 29 October 2026. This edition does not call a winner.',
    publisher: 'Elections Alberta',
    org: 'elections-alberta',
    url: 'https://www.elections.ab.ca/resources/media/news-releases/2026-10-19-2/',
    title: 'Unofficial Referendum Results Reporting Process',
    published: '2026-10-19',
    role: 'primary',
  },
  {
    storyId: 'alberta-referendum-2026-10-19',
    claim: 'Question 10, set by O.C. 160/2026, is not binding. Option 1 is remain. Option 2 is to commence the legal process for a binding provincial referendum on separation.',
    publisher: 'Elections Alberta',
    org: 'elections-alberta',
    url: 'https://www.elections.ab.ca/elections/referendum/',
    title: 'Referendum',
    published: '2026-10-19',
    role: 'primary',
  },
  {
    storyId: 'nigeria-ebola-2026-10-20',
    claim: 'Nigeria confirmed one Ebola disease case in the FCT on 20 October 2026. The patient is a woman who arrived on a flight from Uganda and is in isolation. Forty-four close contacts were identified. Coordinating Minister Muhammad Ali Pate issued the statement.',
    publisher: 'Federal Ministry of Health and Social Welfare of Nigeria',
    org: 'health.gov.ng',
    url: 'https://health.gov.ng/wp-content/uploads/2026/10/Immediate-Press-statememnt_confirmed-Ebola-in-Nigeria-1.pdf',
    title: 'FG CONFIRMS EBOLA DISEASE CASE IN FCT, ACTIVATES PUBLIC HEALTH RESPONSE',
    published: '2026-10-20',
    role: 'primary',
  },
  {
    storyId: 'uk-saudi-typhoon-2026-10-20',
    claim: 'The UK Ministry of Defence said on 20 October 2026 that RAF Typhoon jets will fly defensive missions to protect Saudi cities and infrastructure and will not conduct offensive strikes against the Houthis. Defence Secretary Wes Streeting approved the support.',
    publisher: 'UK Ministry of Defence',
    org: 'gov.uk',
    url: 'https://www.gov.uk/government/news/operational-update-20-october-uk-military-support-to-the-kingdom-of-saudi-arabia',
    title: 'Operational update 20 October – UK military support to the Kingdom of Saudi Arabia',
    published: '2026-10-20',
    role: 'primary',
  },
];

async function renderSamples(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const spoken = applyLexicon(SAMPLE_TEXT);
  fs.writeFileSync(path.join(dir, 'sample.txt'), SAMPLE_TEXT + '\n');
  fs.writeFileSync(path.join(dir, 'sample-spoken.txt'), spoken + '\n');
  if (!fs.existsSync(MODEL)) throw new Error('Kokoro model missing');
  const items = PROVISIONAL.candidates.map(voice => ({
    text: spoken,
    voice,
    speed: PROVISIONAL.speed,
    out: path.join(dir, `kokoro-${voice}.wav`),
  }));
  const kokoro = await synthesizeBatch(items);
  const piperModel = path.join(ROOT, 'models', 'piper', 'en_US-ljspeech-high.onnx');
  const piperOut = path.join(dir, 'piper-en_US-ljspeech-high.wav');
  if (!fs.existsSync(piperModel)) throw new Error('Piper LJ Speech model missing');
  const piper = new PiperTTS({ model: piperModel, bin: path.join(ROOT, 'bin', 'piper-wrapper') });
  await piper.synthesize(spoken, piperOut);
  const rows = [];
  for (const item of items) {
    const { probeDuration } = require('../../media-automation/src/video/exec');
    rows.push({ engine: 'kokoro', voice: item.voice, file: item.out, durationSec: await probeDuration(item.out), provisional: true, locked: false });
  }
  const { probeDuration } = require('../../media-automation/src/video/exec');
  rows.push({
    engine: 'piper', voice: 'en_US-ljspeech-high', file: piperOut,
    durationSec: await probeDuration(piperOut), comparisonOnly: true, fit: false,
  });
  writeJson(path.join(dir, 'samples.json'), {
    text: SAMPLE_TEXT,
    spoken,
    lexicon: 'applied to every sample, including the Piper comparison',
    model: MODEL,
    voices: VOICES,
    kokoroVoices: kokoro.voices,
    locked: false,
    provisionalDefault: PROVISIONAL.defaultVoice,
    rows,
  });
  return rows;
}

async function main() {
  const outDir = path.resolve(arg('--out') || path.join(ROOT, 'artifacts', 'corrected-episode'));
  const sampleDir = path.resolve(arg('--samples') || path.join(ROOT, 'artifacts', 'voice-samples'));
  assertLaunchPaths([outDir, sampleDir]);
  const script = assertSchema(editorialScript(), SCHEMAS.script, 'NewsScript');
  const samples = process.argv.includes('--skip-samples') ? null : await renderSamples(sampleDir);
  if (samples) {
    const bad = samples.filter(r => r.engine === 'kokoro' && (r.durationSec < 15 || r.durationSec > 20));
    if (bad.length) {
      console.error(JSON.stringify({ sampleOutOfRange: bad }, null, 2));
      process.exitCode = 2;
      if (!process.argv.includes('--continue-samples')) return;
    }
  }
  const tts = new KokoroTTS({ voice: arg('--voice') || PROVISIONAL.defaultVoice });
  await prewarm(tts.voiceId, tts.speed, script.scenes.map(s => s.text));
  const voiceDir = path.join(outDir, 'voiceover');
  const measured = await measure(tts, script, voiceDir);
  console.log(JSON.stringify({
    speechSec: measured.speechSec,
    expectedVideoSec: measured.expectedVideoSec,
    scenes: measured.segments.map(s => s.durationSec),
    samples,
  }, null, 2));
  if (measured.expectedVideoSec < 30 || measured.expectedVideoSec > 60) {
    throw new Error(`Duration ${measured.expectedVideoSec.toFixed(1)}s is outside 30-60s. Refusing to pad.`);
  }
  if (process.argv.includes('--measure-only')) return;

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, '03-script.json'), script);
  fs.writeFileSync(path.join(outDir, 'script.txt'), script.scenes.map(s => (s.heading ? s.heading + '\n' : '') + s.text).join('\n\n') + '\n');
  const voiceover = assertSchema({
    engine: tts.name,
    voice: tts.voiceId,
    license: tts.license,
    commercialUse: true,
    provisional: true,
    locked: false,
    segments: measured.segments,
  }, SCHEMAS.voiceover, 'Voiceover');
  writeJson(path.join(outDir, '04-voiceover.json'), voiceover);
  writeJson(path.join(outDir, 'sources.json'), PRIMARY_SOURCES);
  const imageLicenses = {
    images: [{
      id: 'generated-color-cards',
      origin: 'generated',
      generator: 'ffmpeg lavfi color + drawtext via Video Factory v0',
      license: 'Original graphics produced for this edition. No third-party photograph or footage.',
      commercialUse: true,
      attribution: 'None required for the cards. DejaVu Sans is named below.',
      frames: script.scenes.map((scene, i) => ({
        scene: scene.id,
        heading: scene.heading,
        background: 'solid brand color, generated',
        color: BRAND.colors[i % BRAND.colors.length],
        thirdPartyImage: null,
      })),
      thirdPartyAssets: [{ name: 'DejaVu Sans Bold', license: 'Bitstream Vera / DejaVu, free for commercial use', attributionRequired: false }],
    }],
    music: null,
    excluded: ['GOV.UK Ministry of Defence building photograph on the primary page was not used. Rights were not cleared.'],
    tts: { engine: voiceover.engine, voice: voiceover.voice, license: voiceover.license, commercialUse: true, provisional: true, locked: false },
  };
  writeJson(path.join(outDir, 'image-licenses.json'), imageLicenses);

  const character3d = new StubCharacter3D();
  const factory = new VideoFactory({ tts, character3d, brand: BRAND });
  const queue = new RenderQueue({
    statePath: path.join(outDir, 'render-queue.json'),
    concurrency: 1,
    maxAttempts: 1,
    worker: payload => factory.render(script, {
      preset: getPreset(payload.preset, { crf: 23 }),
      outDir,
      basename: payload.basename,
      music: null,
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
  for (const job of jobs) await normalizeLoudness(job.video);
  const nowIso = new Date().toISOString();
  const qc = [];
  for (const job of jobs) {
    qc.push(await qcFile(job.video, {
      expectWidth: job.width, expectHeight: job.height, minDuration: 30, maxDuration: 60,
      subtitleFile: job.subtitles, now: () => nowIso,
    }));
  }
  writeJson(path.join(outDir, '06-qc.json'), qc);
  const failed = qc.filter(q => !q.ok);
  if (failed.length) throw new Error('QC failed: ' + failed.map(q => `${q.width}x${q.height} ${q.failures.join(', ')}`).join(' | '));

  const studioJobs = await probeStudioJobs(null);
  const episodeId = arg('--episode') || ('corr' + Date.now().toString(36));
  const approval = assertSchema({
    id: 'approval-' + episodeId,
    episodeId,
    status: 'pending_approval',
    publish: false,
    requestedAt: nowIso,
    summary: script.scenes.map(s => s.text).join(' '),
    sources: PRIMARY_SOURCES.map(s => s.url),
    taskId: '',
    queueIds: [],
  }, SCHEMAS.approval, 'ApprovalRequest');
  writeJson(path.join(outDir, 'approval-request.json'), approval);
  const manifest = {
    episodeId,
    profile: 'corrected-editorial',
    outDir,
    script,
    voiceover,
    jobs,
    qc,
    sources: PRIMARY_SOURCES,
    imageLicenses,
    character3d: 'stub-3d',
    hostUsed: false,
    publish: false,
    provisionalVoice: { voice: tts.voiceId, locked: false },
    producedBy: 'news-launch editor',
    studioJobs: { mode: studioJobs.mode, connected: studioJobs.connected, error: studioJobs.error },
    blender: { invoked: false, pathWritten: false },
  };
  writeJson(path.join(outDir, 'manifest.json'), manifest);
  writeJson(path.join(outDir, 'studio-boundary.json'), manifest.studioJobs);
  console.log(JSON.stringify({
    outDir,
    episodeId,
    qc: qc.map(q => ({ ok: q.ok, width: q.width, height: q.height, durationSec: q.durationSec, loudnessLUFS: q.loudnessLUFS, truePeakDb: q.truePeakDb, subtitleCues: q.subtitleCues })),
  }, null, 2));
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
