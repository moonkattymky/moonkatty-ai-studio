// Real Ollama check: GET /api/tags, then POST /api/generate for qwen3:8b.
// The prompt is a fixed literal. If the daemon or the model is absent → BLOCKED.
'use strict';
const heavy = require('../../../heavy-lock');

const HOST = '127.0.0.1';
const PORT = 11434;
const MODEL = 'qwen3:8b';
const PROMPT = 'Ответь одним словом: OK';

function baseUrl(opts) {
  if (opts.baseUrl) {
    const u = new URL(opts.baseUrl);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw Object.assign(new Error('Ollama только на 127.0.0.1'), { code: 'FORBIDDEN' });
    return u.origin;
  }
  return `http://${HOST}:${PORT}`;
}

async function tags(opts = {}) {
  const url = baseUrl(opts) + '/api/tags';
  const started = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs || 3000) });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: 'FAIL', http: r.status, ms: Date.now() - started, models: [] };
    const names = ((JSON.parse(text).models) || []).map(m => m.name);
    const has = names.some(n => n === MODEL || n.startsWith(MODEL + ':'));
    return { ok: has, status: has ? 'OK' : 'BLOCKED', http: r.status, ms: Date.now() - started, models: names, model: MODEL };
  } catch (e) {
    return { ok: false, status: 'BLOCKED', error: e.cause?.code || e.message, ms: Date.now() - started, models: [], model: MODEL };
  }
}

async function generate(opts = {}) {
  const present = await tags(opts);
  if (present.status === 'BLOCKED') {
    return { id: 'ollama', status: 'BLOCKED', summary: present.error ? 'Ollama недоступна: ' + present.error : `Модель ${MODEL} не установлена`, data: present };
  }
  const url = baseUrl(opts) + '/api/generate';
  const body = { model: MODEL, prompt: PROMPT, stream: false, options: { num_predict: 8 } };
  const run = async () => {
    const t0 = Date.now();
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs || 120000)
    });
    const text = await r.text();
    const latencyMs = Date.now() - t0;
    if (!r.ok) return { id: 'ollama', status: 'FAIL', summary: 'Ollama HTTP ' + r.status, data: { latencyMs, http: r.status } };
    const j = JSON.parse(text);
    return {
      id: 'ollama', status: 'OK', summary: `qwen3:8b ответила за ${latencyMs} мс`,
      data: {
        latencyMs, model: MODEL,
        totalDuration: j.total_duration ?? null,
        loadDuration: j.load_duration ?? null,
        evalDuration: j.eval_duration ?? null,
        response: String(j.response || '').slice(0, 80)
      }
    };
  };
  try {
    if (opts.skipLock) return await run();
    return await (opts.heavy || heavy).withHeavy('system-doctor:ollama', run);
  } catch (e) {
    return { id: 'ollama', status: 'FAIL', summary: e.message, data: { error: e.message } };
  }
}

module.exports = { tags, generate, MODEL, PROMPT, PORT };
