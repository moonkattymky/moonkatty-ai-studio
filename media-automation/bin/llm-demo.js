#!/usr/bin/env node
'use strict';
// One REAL run against local Ollama. Usage: MA_OLLAMA_MODEL=qwen2.5:1.5b node media-automation/bin/llm-demo.js [out.json]
const fs = require('fs');
const { OllamaProvider, NewsEditor } = require('../src/llm');
const story = { id: 'demo', category: 'space', headline: 'NASA launches Europa Clipper probe from Florida',
  texts: ['NASA launched the Europa Clipper spacecraft on a SpaceX Falcon Heavy rocket from Kennedy Space Center in Florida.', 'The probe will travel 2.9 billion km and arrive at Jupiter in 2030 to study the moon Europa.'] };
(async () => {
  const llm = new OllamaProvider(); if (!(await llm.health())) throw new Error('Ollama not reachable at ' + llm.baseUrl);
  const ed = new NewsEditor({ llm }); const t0 = Date.now();
  const out = { model: llm.model, headline: await ed.headline({ title: story.headline, texts: story.texts }), summary: await ed.summary({ title: story.headline, texts: story.texts }),
    script: await ed.videoScript({ issueTitle: 'MOONKATTY NEWS', stories: [story] }), translationRu: await ed.translate(story.texts[1], 'Russian'), rejections: ed.log, ms: Date.now() - t0 };
  console.log(JSON.stringify(out, null, 2)); if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
