#!/usr/bin/env node
'use strict';
// Renders sample videos for 16:9 (youtube) and 9:16 (shorts..fb_reels) via the render queue.
// Usage: node media-automation/bin/sample-render.js [outDir]   (engine: MA_TTS=say|piper|espeak, MA_PIPER_MODEL, MA_PIPER_BIN)
const path = require('path');
const fs = require('fs');
const { VideoFactory, RenderQueue, detectTTS, run } = require('../src/video');
const outDir = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'out', 'sample'));
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const tts = await detectTTS(); // throws if no real engine
  console.log('TTS engine:', tts.name);
  const music = path.join(outDir, 'music-cc0-generated.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', '-filter_complex', 'amix=inputs=2', music]);
  const script = { title: 'MOONKATTY NEWS', scenes: [
    { text: 'Good evening. Here are the top confirmed stories of the day.' },
    { heading: 'Space', text: 'A new telescope image reveals a distant galaxy cluster in remarkable detail.' },
    { heading: 'Tech', text: 'Researchers present a faster local AI model that runs on a laptop.' } ] };
  const factory = new VideoFactory({ tts });
  const q = new RenderQueue({ statePath: path.join(outDir, 'queue.json'), concurrency: 1,
    worker: p => factory.render(script, { preset: p.preset, outDir, basename: `sample-${p.preset}`,
      music: { file: music, title: 'Generated tones', artist: 'MOONKATTY test', license: 'CC0-1.0 (self-generated)' } }) });
  for (const preset of ['youtube', 'shorts']) q.add({ preset }, { id: `sample-${preset}` });
  q.start(); await q.onIdle();
  for (const j of q.jobs()) console.log(j.id, j.status, j.status === 'done' ? JSON.stringify(j.result.files) : j.error);
})().catch(e => { console.error(e); process.exit(1); });
