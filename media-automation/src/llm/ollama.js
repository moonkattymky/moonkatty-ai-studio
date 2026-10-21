'use strict';
const { fetchWithRetry } = require('../news/http');
/**
 * LLMProvider interface: name; async generate({ prompt, system?, temperature?, maxTokens?, json? }) -> { text, model }
 * OllamaProvider talks to local Ollama HTTP API POST /api/generate (stream:false).
 */
class OllamaProvider {
  constructor({ baseUrl = process.env.MA_OLLAMA_URL || 'http://127.0.0.1:11434', model = process.env.MA_OLLAMA_MODEL || 'qwen2.5:1.5b',
    fetchFn = globalThis.fetch, timeoutMs = 120000, retries = 1, keepAlive = '5m', jobQueue = null } = {}) {
    Object.assign(this, { baseUrl: baseUrl.replace(/\/$/, ''), model, fetchFn, timeoutMs, retries, keepAlive, jobQueue }); this.name = `ollama:${model}`;
  }
  async _post(pathname, body) {
    const wrapped = async (url, opts) => this.fetchFn(url, { ...opts, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return JSON.parse(await fetchWithRetry(this.baseUrl + pathname, { fetchFn: wrapped, retries: this.retries, backoffMs: 500, timeoutMs: this.timeoutMs }));
  }
  async generate({ prompt, system, temperature = 0.1, maxTokens = 400, json = false, seed = 42 }) {
    const body = { model: this.model, prompt, system, stream: false, keep_alive: this.keepAlive, options: { temperature, num_predict: maxTokens, seed } };
    if (json) body.format = 'json';
    const call = async () => { const r = await this._post('/api/generate', body); if (typeof r.response !== 'string') throw new Error('ollama: bad response'); return { text: r.response.trim(), model: r.model || this.model }; };
    // Heavy generations go through the shared heavy-job queue when one is configured (see INTEGRATION.md).
    return this.jobQueue ? this.jobQueue.runExclusive({ type: 'llm_generate', agent: 'news-editor', input: { model: this.model } }, call) : call();
  }
  /** Unload model from RAM (keep_alive:0) — used before heavy renders on 24 GB Mac. */
  async unload() { return this._post('/api/generate', { model: this.model, keep_alive: 0 }); }
  async health() { try { const r = await this.fetchFn(this.baseUrl + '/api/tags'); return r.ok; } catch { return false; } }
}
module.exports = { OllamaProvider };
