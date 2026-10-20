#!/usr/bin/env node
'use strict';
/**
 * Renders the editor-written bulletin through NewsVideoFactory.
 * Does not re-run RSS selection. Does not lock the voice. Does not publish.
 * Does not write server/jobs or server/blender.
 */
const fs = require('fs');
const path = require('path');
const { editorialScript } = require('../src/editorial');
const { assertSchema, SCHEMAS } = require('../src/schemas');
const { assertLaunchPaths, probeStudioJobs } = require('../src/studio-boundary');
const { findStill } = require('../src/stills');
const {
  masterSpeech, episodeFromScript, renderEpisode, holdForApproval, licenseRecords,
} = require('../src/factory-render');

const ROOT = path.join(__dirname, '..');

const STORY_QUERIES = [
  {
    storyId: 'alberta-referendum-2026-10-19',
    category: 'politics',
    skip: /separatist|protest|rally|demonstration/i,
    queries: [
      { provider: 'commons', q: 'Alberta Legislature Building' },
      { provider: 'commons', q: 'Alberta Legislature Building Edmonton' },
    ],
  },
  {
    storyId: 'nigeria-ebola-2026-10-20',
    category: 'news',
    queries: [
      { provider: 'commons', q: 'Abuja Nigeria skyline' },
      { provider: 'commons', q: 'Abuja city Nigeria' },
    ],
  },
  {
    storyId: 'uk-saudi-typhoon-2026-10-20',
    category: 'politics',
    queries: [
      { provider: 'commons', q: 'Royal Air Force Typhoon' },
      { provider: 'commons', q: 'RAF Eurofighter Typhoon' },
    ],
  },
];

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
    primarySourceUrl: 'https://www.elections.ab.ca/resources/media/news-releases/2026-10-19-2/',
    primaryPublisher: 'Elections Alberta',
    primaryPublished: '2026-10-19',
    editorialStatus: 'confirmed-primary',
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
    primarySourceUrl: 'https://www.elections.ab.ca/elections/referendum/',
    primaryPublisher: 'Elections Alberta',
    primaryPublished: '2026-10-19',
    editorialStatus: 'confirmed-primary',
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
    primarySourceUrl: 'https://health.gov.ng/wp-content/uploads/2026/10/Immediate-Press-statememnt_confirmed-Ebola-in-Nigeria-1.pdf',
    primaryPublisher: 'Federal Ministry of Health and Social Welfare of Nigeria',
    primaryPublished: '2026-10-20',
    editorialStatus: 'confirmed-primary',
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
    primarySourceUrl: 'https://www.gov.uk/government/news/operational-update-20-october-uk-military-support-to-the-kingdom-of-saudi-arabia',
    primaryPublisher: 'UK Ministry of Defence',
    primaryPublished: '2026-10-20',
    editorialStatus: 'confirmed-primary',
  },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function main() {
  const outDir = path.resolve(arg('--out') || path.join(ROOT, 'artifacts', 'corrected-episode'));
  assertLaunchPaths([outDir]);
  fs.mkdirSync(outDir, { recursive: true });
  const script = assertSchema(editorialScript(), SCHEMAS.script, 'NewsScript');
  const mediaDir = path.join(outDir, 'media');
  const assetsById = {};
  const searches = [];
  for (const story of STORY_QUERIES) {
    const found = await findStill(story.storyId, story.queries, mediaDir, { skip: story.skip });
    searches.push({
      storyId: story.storyId,
      picked: found.asset && { id: found.asset.id, title: found.asset.title, license: found.asset.license, width: found.asset.width, height: found.asset.height, pageUrl: found.asset.pageUrl },
      rejected: found.rejections.filter(r => found.considered.every(a => a.pageUrl !== r.pageUrl)).slice(-8),
    });
    if (!found.asset) {
      writeJson(path.join(outDir, 'still-search.json'), searches);
      throw new Error(`no licensed still for ${story.storyId}`);
    }
    assetsById[story.storyId] = found.asset;
  }
  writeJson(path.join(outDir, 'still-search.json'), searches);
  if (process.argv.includes('--stills-only')) {
    console.log(JSON.stringify(searches, null, 2));
    return;
  }

  const { master, tts, approved } = masterSpeech();
  if (approved) throw new Error('MasterVoice is locked. This launch must not treat am_michael as owner-approved.');
  const stories = STORY_QUERIES.map(story => ({
    storyId: story.storyId,
    category: story.category,
    sources: PRIMARY_SOURCES.filter(s => s.storyId === story.storyId),
  }));
  const episode = episodeFromScript(script, stories, assetsById, 'TUESDAY 20 OCTOBER 2026');
  episode.rights.push('Edition status: awaits approval and is not published.');
  const episodeId = arg('--episode') || ('corr' + Date.now().toString(36));
  const rendered = await renderEpisode({ episode, outDir, tts, episodeId, targetLufs: -16 });
  const jobs = rendered.jobs.map(job => assertSchema(job, SCHEMAS.renderJob, 'VideoRenderJob'));
  const qc = rendered.qc.map(report => assertSchema(report, SCHEMAS.qc, 'QcResult'));
  const failed = qc.filter(q => !q.ok);
  if (failed.length) throw new Error('QC failed: ' + failed.map(q => `${q.width}x${q.height} ${(q.failures || []).join(', ')}`).join(' | '));

  const voiceover = assertSchema({
    engine: tts.name,
    voice: master.cfg.voice,
    license: 'Kokoro-82M model card apache-2.0. Candidate am_michael is not owner-approved.',
    commercialUse: true,
    provisional: true,
    locked: false,
    segments: [{
      text: episode.stories.map(s => s.text).join(' '),
      file: rendered.manifests[0].files.anchorAudio,
      durationSec: rendered.manifests[0].durationSec,
    }],
  }, SCHEMAS.voiceover, 'Voiceover');
  const assets = episode.stories.map(s => s.asset);
  const imageLicenses = {
    images: assets.map(a => ({
      id: a.id,
      origin: a.provider,
      title: a.title,
      author: a.author,
      credit: a.credit,
      license: a.license,
      licenseUrl: a.licenseUrl,
      pageUrl: a.pageUrl,
      sourceUrl: a.sourceUrl,
      attribution: a.attribution,
      width: a.width,
      height: a.height,
      sha256: a.sha256,
      commercialUse: true,
      storyId: a.newsId,
    })),
    music: null,
    excluded: ['GOV.UK Ministry of Defence building photograph on the primary page was not used. Rights were not cleared.'],
    tts: { engine: voiceover.engine, voice: voiceover.voice, license: voiceover.license, commercialUse: true, provisional: true, locked: false, loudnessLufs: master.cfg.loudnessLufs },
  };
  const summary = script.scenes.map(s => s.text).join(' ');
  const held = await holdForApproval({
    outDir,
    episodeId,
    title: 'MOONKATTY NEWS',
    summary,
    sources: PRIMARY_SOURCES.map(s => ({ name: s.publisher, url: s.url })),
    licenses: licenseRecords(assets),
    videos: {
      horizontal: jobs.find(j => j.preset === 'youtube').video,
      vertical: jobs.find(j => j.preset === 'shorts').video,
    },
  });
  if (held.item.status !== 'pending') throw new Error('Approval Center status is ' + held.item.status);
  if (held.posts.some(p => p.status !== 'dry_run')) throw new Error('Publisher left dry-run');
  const nowIso = new Date().toISOString();
  const approval = assertSchema({
    id: held.item.id,
    episodeId,
    status: 'pending',
    publish: false,
    requestedAt: nowIso,
    summary,
    sources: PRIMARY_SOURCES.map(s => s.url),
    taskId: '',
    queueIds: held.posts.map(p => p.id),
    licenses: held.item.licenses,
  }, SCHEMAS.approval, 'ApprovalRequest');
  writeJson(path.join(outDir, '03-script.json'), script);
  fs.writeFileSync(path.join(outDir, 'script.txt'), script.scenes.map(s => (s.heading ? s.heading + '\n' : '') + s.text).join('\n\n') + '\n');
  writeJson(path.join(outDir, '04-voiceover.json'), voiceover);
  writeJson(path.join(outDir, 'sources.json'), PRIMARY_SOURCES);
  writeJson(path.join(outDir, 'image-licenses.json'), imageLicenses);
  writeJson(path.join(outDir, '05-render-jobs.json'), jobs);
  writeJson(path.join(outDir, '06-qc.json'), qc);
  writeJson(path.join(outDir, 'approval-request.json'), approval);
  const studioJobs = await probeStudioJobs(null);
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
    character3d: 'host3d-stub',
    hostUsed: false,
    publish: false,
    factory: 'NewsVideoFactory',
    targetLufs: -16,
    mediaAutomation: '882cd398d191eea9dbaeef046562282ccd9a9d8c',
    provisionalVoice: { voice: master.cfg.voice, status: master.cfg.status, locked: false, rate: master.cfg.rate },
    publisher: held.posts.map(p => ({ id: p.id, accountId: p.accountId, status: p.status })),
    approval: { id: approval.id, status: approval.status, publish: false },
    producedBy: 'news-launch editor',
    studioJobs: { mode: studioJobs.mode, connected: studioJobs.connected, error: studioJobs.error },
    blender: { invoked: false, pathWritten: false },
  };
  writeJson(path.join(outDir, 'manifest.json'), manifest);
  writeJson(path.join(outDir, 'studio-boundary.json'), manifest.studioJobs);
  fs.rmSync(path.join(outDir, 'starfield.png'), { force: true });
  console.log(JSON.stringify({
    outDir,
    episodeId,
    voice: master.cfg.voice,
    voiceStatus: master.cfg.status,
    stills: searches.map(s => s.picked),
    publisher: manifest.publisher,
    approval: manifest.approval,
    qc: qc.map(q => ({ ok: q.ok, width: q.width, height: q.height, durationSec: q.durationSec, loudnessLUFS: q.loudnessLUFS, truePeakDb: q.truePeakDb, targetLufs: q.targetLufs })),
  }, null, 2));
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
