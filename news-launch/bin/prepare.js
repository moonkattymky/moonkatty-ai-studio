#!/usr/bin/env node
'use strict';
const path = require('path');
const { runLaunch } = require('../src/pipeline');
const { saveToStudio, openStudio } = require('../src/studio-save');
const { KokoroTTS, PROVISIONAL } = require('../src/kokoro');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const prompt = arg('--prompt') || 'Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях';
const outDir = path.resolve(arg('--out') || path.join(__dirname, '..', 'artifacts', 'test-episode'));
const stopAfter = process.argv.includes('--dry-run') ? 'factcheck' : (arg('--stop-after') || null);

(async () => {
  const ttsName = arg('--tts');
  let tts;
  if (ttsName === 'kokoro') {
    const voice = arg('--voice') || PROVISIONAL.defaultVoice;
    if (!PROVISIONAL.candidates.includes(voice)) throw new Error(`Voice ${voice} is not a provisional Kokoro candidate`);
    tts = new KokoroTTS({ voice });
  } else if (ttsName) {
    throw new Error('Supported --tts values: kokoro. Omit --tts to use Piper en_US-ljspeech-high.');
  }
  const manifest = await runLaunch({
    prompt, outDir, stopAfter, profile: arg('--profile') || 'episode',
    skipOllama: process.argv.includes('--skip-ollama'),
    tts,
  });
  if (stopAfter) {
    const stories = (manifest.selected && manifest.selected.stories) || [];
    console.log(JSON.stringify({
      stage: manifest.stage,
      ingest: manifest.ingest,
      confirmed: (manifest.checks || []).filter(r => r.status === 'confirmed').length,
      stories: stories.map(s => ({
        claim: s.claim, category: s.category, method: s.method, adapter: s.adapter,
        controversial: s.controversial, publishedAt: s.publishedAt,
        sources: s.sources.map(x => ({ org: x.org, publisher: x.publisher, url: x.url, title: x.title })),
      })),
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    outDir, episodeId: manifest.episodeId, llm: manifest.script.llm, adapters: manifest.adapters,
    qc: manifest.qc.map(q => ({ ok: q.ok, width: q.width, height: q.height, durationSec: q.durationSec, loudnessLUFS: q.loudnessLUFS, truePeakDb: q.truePeakDb })),
  }, null, 2));
  const db = arg('--db');
  if (db) {
    const studio = openStudio(path.resolve(db));
    const saved = saveToStudio({ ...studio, user: 'news-launch' }, manifest);
    console.log('saved episode', saved.episode.id);
    studio.db.close();
  }
})().catch(err => { console.error(err.stack || err.message); process.exit(1); });
