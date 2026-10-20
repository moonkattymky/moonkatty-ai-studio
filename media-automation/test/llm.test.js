'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { OllamaProvider, NewsEditor, EditorSummaryProvider, extractFacts, checkAgainstSources } = require('../src/llm');
const SRC = ['NASA launches Europa probe on October 14', 'The probe will travel 2.9 billion km. NASA said the launch from Florida went well.'];
const ollamaMock = (responses, calls = []) => async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); const r = responses.length > 1 ? responses.shift() : responses[0];
  if (r === 'neterr') throw new Error('ECONNREFUSED'); if (r.status) return { ok: false, status: r.status, text: async () => '' };
  return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'm', response: r }) }; };

test('extractFacts finds numbers, names, dates', () => {
  const f = extractFacts('NASA launched it on October 14, travelling 2.9 billion km with SpaceX.');
  assert.deepEqual(f.numbers, ['14', '2.9']); assert.deepEqual(f.dates, ['october']); assert.ok(f.names.includes('NASA') && f.names.includes('SpaceX'));
});
test('fact-check rejects invented number/name/date', () => {
  assert.equal(checkAgainstSources('NASA launches Europa probe from Florida', SRC).ok, true);
  const bad = checkAgainstSources('NASA and ESA launch probe on November 3 for 5 billion dollars', SRC);
  assert.equal(bad.ok, false); assert.deepEqual(bad.unsupported.map(u => u.value).sort(), ['3', '5', 'ESA', 'november'].sort());
});
test('Ollama adapter: /api/generate request shape and model config', async () => {
  const calls = []; const p = new OllamaProvider({ baseUrl: 'http://x:1', model: 'llama3.2:3b', fetchFn: ollamaMock(['hi'], calls) });
  const r = await p.generate({ prompt: 'P', system: 'S' });
  assert.equal(r.text, 'hi'); assert.equal(calls[0].url, 'http://x:1/api/generate');
  assert.equal(calls[0].body.model, 'llama3.2:3b'); assert.equal(calls[0].body.stream, false); assert.equal(calls[0].body.system, 'S');
});
test('Ollama adapter: retries 503 then succeeds; 404 model missing not retried', async () => {
  const c1 = []; const p = new OllamaProvider({ fetchFn: ollamaMock([{ status: 503 }, 'ok'], c1), retries: 2 }); p.generate = p.generate.bind(p);
  assert.equal((await p.generate({ prompt: 'x' })).text, 'ok'); assert.equal(c1.length, 2);
  const c2 = []; const p2 = new OllamaProvider({ fetchFn: ollamaMock([{ status: 404 }], c2), retries: 2 });
  await assert.rejects(p2.generate({ prompt: 'x' }), /404/); assert.equal(c2.length, 1);
});
test('editor: accepts grounded LLM headline', async () => {
  const ed = new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['"Headline: NASA launches Europa probe from Florida"']) }) });
  const r = await ed.headline({ title: SRC[0], texts: [SRC[1]] }); assert.equal(r.text, 'NASA launches Europa probe from Florida'); assert.match(r.provider, /^ollama/);
});
test('editor: hallucinated output rejected -> deterministic fallback', async () => {
  const ed = new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['NASA and ESA launch probe on November 3']) }) });
  const r = await ed.headline({ title: SRC[0], texts: [SRC[1]] });
  assert.equal(r.provider, 'local-deterministic'); assert.equal(r.text, SRC[0]); assert.ok(r.rejected.unsupported.length >= 2);
  const r2 = await new NewsEditor().headline({ title: SRC[0], texts: [SRC[1]] }); assert.equal(r2.text, r.text, 'deterministic');
});
test('editor: API down -> fallback with error', async () => {
  const ed = new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['neterr']), retries: 1 }) });
  const r = await ed.summary({ title: SRC[0], texts: [SRC[1]] }); assert.equal(r.provider, 'local-deterministic'); assert.match(r.error, /ECONNREFUSED/);
});
test('editor: video script + translation number preservation', async () => {
  const ed = new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['NASA launched the Europa probe from Florida. It will travel 2.9 billion km.']) }) });
  const s = await ed.videoScript({ issueTitle: 'MOONKATTY NEWS', stories: [{ id: 's1', headline: SRC[0], texts: [SRC[1]], category: 'space' }] });
  assert.equal(s.scenes.length, 3); assert.equal(s.scenes[1].heading, 'SPACE'); assert.match(s.scenes[1].provider, /ollama/);
  const tGood = new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['Зонд пролетит 2.9 млрд км']) }) });
  assert.equal((await tGood.translate('The probe will travel 2.9 billion km', 'Russian')).translated, true);
  const tBad = new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['Зонд пролетит 3 млрд км']) }) });
  const r = await tBad.translate('The probe will travel 2.9 billion km', 'Russian'); assert.equal(r.translated, false); assert.equal(r.text, 'The probe will travel 2.9 billion km');
});
test('EditorSummaryProvider plugs into NewsEngine fallback chain', async () => {
  const p = new EditorSummaryProvider(new NewsEditor({ llm: new OllamaProvider({ fetchFn: ollamaMock(['Invented Person says 99']) }) }));
  await assert.rejects(p.summarize({ title: SRC[0], texts: [SRC[1]] }), /rejected/);
});
