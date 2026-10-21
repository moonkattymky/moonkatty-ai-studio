#!/usr/bin/env node
'use strict';
// End-to-end: REAL public RSS -> NewsEngine (verify) -> NewsEditor (Ollama if reachable, fact-checked) -> real TTS -> 16:9 + 9:16 MP4 with QA.
// Nothing is published. Usage: node media-automation/bin/news-video.js <outDir> [maxStories=3]
const path = require('path'); const fs = require('fs');
const { NewsEngine } = require('../src/news'); const { OllamaProvider, NewsEditor } = require('../src/llm');
const { VideoFactory, detectTTS, generateAmbientBed } = require('../src/video');
const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'news-video')); const maxStories = +process.argv[3] || 3;
const SOURCES = [
  { id: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', kind: 'official', primary: true, owner: 'NASA' },
  { id: 'esa', name: 'ESA', url: 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', kind: 'official', primary: true, owner: 'ESA' },
  { id: 'bbc-sci', name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', owner: 'BBC' },
  { id: 'bbc-tech', name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', owner: 'BBC' },
];
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const engine = new NewsEngine({ statePath: path.join(outDir, 'news-state.json'), sources: SOURCES, retries: 2 });
  const rep = await engine.run(); console.log('fetch report', JSON.stringify(rep));
  const pick = engine.stories().filter(s => s.reviewStatus === 'auto_approved' && s.corroboration === 'confirmed' && s.summary && s.summary.length > 60).slice(0, maxStories);
  if (!pick.length) throw new Error('no auto-approved confirmed stories to render');
  const llm = new OllamaProvider(); const useLlm = await llm.health(); console.log('LLM:', useLlm ? llm.name : 'unavailable -> deterministic');
  const editor = new NewsEditor({ llm: useLlm ? llm : null });
  const script = await editor.videoScript({ issueTitle: 'MOONKATTY NEWS', stories: pick.map(s => ({ id: s.id, category: s.category, headline: s.headline, texts: s.items.map(i => i.summary || i.title) })) });
  script.sources = [...new Map(pick.flatMap(s => s.items).map(i => [i.sourceName, { name: i.sourceName, url: i.link }])).values()];
  if (useLlm) await llm.unload().catch(() => {}); // free RAM before rendering (heavy-job rule)
  const tts = await detectTTS(); console.log('TTS:', tts.name);
  const bed = path.join(outDir, 'ambient-bed.wav'); const music = fs.existsSync(bed + '.license.json') ? JSON.parse(fs.readFileSync(bed + '.license.json')) : await generateAmbientBed(bed, { durationSec: 90 });
  const factory = new VideoFactory({ tts }); const results = {};
  for (const preset of ['youtube', 'shorts']) { results[preset] = await factory.render(script, { preset, outDir, basename: `moonkatty-news-${preset}`, music }); console.log(preset, results[preset].files.video, 'QA', results[preset].qa.ok); }
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify({ report: rep, stories: pick.map(s => ({ id: s.id, headline: s.headline, corroboration: s.corroboration, verification: s.verification.reasons, sources: s.items.map(i => i.link) })),
    script, editorLog: editor.log, published: false, note: 'Sample render only. Not reviewed, not published.' }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
