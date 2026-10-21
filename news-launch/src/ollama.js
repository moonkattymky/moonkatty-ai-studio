'use strict';

const PREFERRED = ['qwen3:8b', 'qwen3:4b', 'qwen2.5:7b', 'qwen2.5:3b', 'qwen2.5:1.5b', 'qwen2.5:0.5b'];

function assertLoopback(url) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error('Ollama URL is invalid'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Ollama URL must be loopback. This launch will not call a remote model.');
  }
}

async function listModels(baseUrl, fetchFn = globalThis.fetch) {
  assertLoopback(baseUrl);
  const r = await fetchFn(baseUrl.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
  const j = await r.json();
  return (j.models || []).map(m => m.name).filter(Boolean);
}

function chooseModel(names, prefer = 'qwen3:8b') {
  if (names.includes(prefer)) return prefer;
  for (const p of PREFERRED) if (names.includes(p)) return p;
  const qwen = names.find(n => /^qwen/i.test(n));
  return qwen || names[0] || null;
}

async function chatJson({ baseUrl, model, prompt, fetchFn = globalThis.fetch, timeoutMs = 120000 }) {
  assertLoopback(baseUrl);
  const r = await fetchFn(baseUrl.replace(/\/$/, '') + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model, stream: false, format: 'json',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
  const body = await r.json();
  const content = body?.message?.content;
  if (!content) throw new Error('Ollama returned an empty message');
  return JSON.parse(content);
}

module.exports = { assertLoopback, listModels, chooseModel, chatJson, PREFERRED };
