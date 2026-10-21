#!/usr/bin/env node
'use strict';
// Real pipeline (nothing is published: Publisher stays DRY-RUN unless owner enables live per platform).
// Usage:
//   node media-automation/bin/orchestrate.js issue <runId> [stateDir]     run/resume one video issue (stops at Approval Center)
//   node media-automation/bin/orchestrate.js text <runId> [stateDir]      one text post -> Approval Center
//   node media-automation/bin/orchestrate.js publish <runId> [stateDir]   after approval: dry-run publish
//   node media-automation/bin/orchestrate.js daemon [stateDir]            scheduler loop (09:00/19:00 issues, daytime text; Asia/Jerusalem)
const path = require('path'); const fs = require('fs');
const { NewsEngine } = require('../src/news'); const { OllamaProvider, NewsEditor } = require('../src/llm');
const { NewsVideoFactory, MasterVoice, SpeechComposer, generateAmbientBed } = require('../src/video');
const { MediaLibrary, NasaImagesProvider, CommonsProvider } = require('../src/media'); const { LocalJobQueue } = require('../src/jobs');
const { ApprovalCenter } = require('../src/approval'); const { Publisher, DEFAULT_ACCOUNTS, defaultAdapters } = require('../src/publish');
const { Scheduler, NEWS_PLANS } = require('../src/schedule'); const { Orchestrator } = require('../src/orchestrator');
const SOURCES = [
  { id: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', kind: 'official', primary: true, owner: 'NASA' },
  { id: 'esa', name: 'ESA', url: 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', kind: 'official', primary: true, owner: 'ESA' },
  { id: 'bbc-sci', name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', owner: 'BBC' },
  { id: 'bbc-tech', name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', owner: 'BBC' },
];
async function build(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const llm = new OllamaProvider(); const llmOk = await llm.health();
  const mv = new MasterVoice(); const tts = new SpeechComposer({ tts: mv.createTTS() }); // throws if master voice unavailable
  const bed = path.join(stateDir, 'ambient-bed.wav'); const music = fs.existsSync(bed + '.license.json') ? JSON.parse(fs.readFileSync(bed + '.license.json')) : await generateAmbientBed(bed, { durationSec: 90 });
  const jobQueue = new LocalJobQueue({ statePath: path.join(stateDir, 'jobs.json'), beforeHeavy: async t => { if (t === 'video_render' && llmOk) await llm.unload().catch(() => {}); } });
  const mediaLib = new MediaLibrary({ dir: path.join(stateDir, 'media'), providers: { nasa: new NasaImagesProvider(), commons: new CommonsProvider() } });
  const panelFallback = require('../src/media/panel').panelFallbackFactory({ library: mediaLib, dir: path.join(stateDir, 'media', 'panels') });
  const orch = new Orchestrator({ panelFallback, stateDir, news: new NewsEngine({ statePath: path.join(stateDir, 'news.json'), sources: SOURCES }), editor: new NewsEditor({ llm: llmOk ? llm : null }),
    media: mediaLib,
    factory: new NewsVideoFactory({ tts, workRoot: path.join(stateDir, 'work') }), jobQueue, approval: new ApprovalCenter({ statePath: path.join(stateDir, 'approval.json') }),
    publisher: new Publisher({ statePath: path.join(stateDir, 'publisher.json'), adapters: defaultAdapters(), accounts: DEFAULT_ACCOUNTS }), music, voice: mv.exportForLipSync(), storyCount: +(process.env.MA_STORY_COUNT || 4) });
  return { orch, llmOk };
}
(async () => {
  const [cmd, a1, a2] = process.argv.slice(2); const stateDir = path.resolve((cmd === 'daemon' ? a1 : a2) || path.join(__dirname, '..', 'state'));
  const { orch, llmOk } = await build(stateDir); console.log('LLM', llmOk ? 'ollama' : 'deterministic fallback', '| state', stateDir);
  if (cmd === 'issue') { const r = await orch.runIssue(a1); console.log(JSON.stringify({ status: r.status, approvalIds: r.approvalIds, dir: r.dir }, null, 2)); }
  else if (cmd === 'text') console.log(JSON.stringify(await orch.runText(a1), null, 2));
  else if (cmd === 'publish') console.log(JSON.stringify((await orch.publishApproved(a1)).status));
  else if (cmd === 'daemon') { const s = new Scheduler({ statePath: path.join(stateDir, 'schedule.json'), handlers: { news_video_issue: ({ slot }) => orch.runIssue(slot.key.replace(/[|:]/g, '_')).then(r => r.status), news_text_post: ({ slot }) => orch.runText(slot.key.replace(/[|:]/g, '_')).then(i => i?.id || null) } });
    for (const p of NEWS_PLANS) s.upsertPlan(p); s.start(); console.log('scheduler running; next:', s.nextRuns(4).map(x => x.local)); }
  else { console.error('usage: issue|text|publish <runId> [stateDir] | daemon [stateDir]'); process.exit(2); }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
