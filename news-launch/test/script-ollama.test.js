'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { writeScript, groundingProblems } = require('../src/script');
const { assertLoopback, chooseModel } = require('../src/ollama');

const stories = [{
  storyId: 's1', claim: 'City council approves river bridge budget', category: 'other',
  sources: [
    { org: 'bbc', publisher: 'BBC News', url: 'https://www.bbc.com/bridge', title: 'City council approves river bridge budget', summary: 'The council approved the river bridge budget.' },
    { org: 'guardian', publisher: 'The Guardian', url: 'https://www.theguardian.com/bridge', title: 'Council approves the river bridge budget', summary: 'The river bridge budget was approved.' },
  ],
}];

test('chooseModel prefers qwen3:8b and loopback is required', () => {
  assert.equal(chooseModel(['llama3.2:1b', 'qwen3:8b']), 'qwen3:8b');
  assert.equal(chooseModel(['qwen2.5:0.5b']), 'qwen2.5:0.5b');
  assert.throws(() => assertLoopback('https://example.com'), /loopback/);
});

test('extractive adapter copies headlines and rejects invented numbers', async () => {
  const script = await writeScript(stories, { skipOllama: true });
  assert.equal(script.llm.mode, 'temporary-adapter');
  assert.match(script.llm.adapter, /TEMPORARY_ADAPTER/);
  assert.match(script.scenes.find(s => s.kind === 'story').text, /BBC News/);
  assert.match(script.scenes.find(s => s.kind === 'story').text, /The Guardian/);
  const bad = { scenes: [{ kind: 'story', text: 'BBC News reports the budget rose by 9999 percent.' }] };
  assert.ok(groundingProblems(bad, stories).some(p => /9999/.test(p)));
});

test('Ollama draft that adds a fact is discarded for the extractive adapter', async () => {
  const script = await writeScript(stories, {
    ollamaUrl: 'http://127.0.0.1:9',
    fetchFn: async (url) => {
      if (String(url).endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen3:8b' }] }) };
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ scenes: [{ storyId: 's1', text: 'BBC News reports a secret treaty signed by 4000 generals.' }] }) } }) };
    },
  });
  assert.equal(script.llm.mode, 'temporary-adapter');
  assert.match(script.llm.reason, /grounding|4000|generals|word/i);
  assert.equal(groundingProblems(script, stories).length, 0);
});

test('a grounded Ollama reply is kept', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      res.end(JSON.stringify({ message: { content: JSON.stringify({ scenes: [{ storyId: 's1', text: 'BBC News reports: City council approves river bridge budget. The Guardian reports: Council approves the river bridge budget.' }] }) } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const script = await writeScript(stories, { ollamaUrl: `http://127.0.0.1:${port}` });
    assert.equal(script.llm.mode, 'ollama');
    assert.equal(script.llm.model, 'qwen2.5:0.5b');
    assert.match(script.scenes.find(s => s.kind === 'story').text, /river bridge budget/);
  } finally { server.close(); }
});
