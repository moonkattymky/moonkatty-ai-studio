#!/usr/bin/env node
// TEST-ONLY mock of an OpenAI-compatible chat API (stands in for Ollama's /v1 endpoint when no real model is available).
// It does NOT think: it deterministically turns the studio's 3D DESIGN prompt (FILE: … CONTENT: ```json … ```) into a
// real `write` tool call, which the REAL opencode server then executes (with permission asks). Scenario keywords in the
// task text: MOCK_OUTSIDE (write outside the workspace), MOCK_PROTECTED (write a .png inside), MOCK_BASH (call bash),
// MOCK_BADPARAMS (write params that violate the schema), MOCK_SLOW (delay every reply by 3 s).
import http from 'http';
const port = +process.argv[2] || 11600;
const txt = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : JSON.stringify(c);
http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', async () => {
  if (q.url.endsWith('/models')) { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ data: [{ id: 'mock-coder', object: 'model' }] })); }
  let j = {}; try { j = JSON.parse(b); } catch {}
  if (process.env.MOCK_LLM_LOG) (await import('fs')).appendFileSync(process.env.MOCK_LLM_LOG, b + '\n');
  const msgs = j.messages || []; const last = msgs[msgs.length - 1] || {}; const user = msgs.filter(m => m.role === 'user').map(m => txt(m.content)).join('\n');
  if (/MOCK_SLOW/.test(user)) await new Promise(res => setTimeout(res, 3000));
  // v1.2.3-test.1: the studio grants NO tools at the agent step and expects JSON text. Forbidden-tool scenarios force a
  // tool call anyway (as a misbehaving model would); OpenCode must refuse it and the studio must reject the job.
  let tool = null, content = null; const tools = (j.tools || []).map(t => t.function?.name);
  const lastUser = txt([...msgs].reverse().find(m => m.role === 'user')?.content || '');
  const file = (/FILE: (.+)/.exec(user) || [])[1], cjson = (/CONTENT:\n```json\n([\s\S]*?)\n```/.exec(lastUser) || /CONTENT:\n```json\n([\s\S]*?)\n```/.exec(user) || [])[1];
  if (last.role !== 'tool' && /MOCK_BASH/.test(user)) tool = { name: 'bash', args: { command: 'touch /tmp/mk-pwned-by-agent', description: 'x' } };
  else if (last.role !== 'tool' && /MOCK_OUTSIDE/.test(user)) tool = { name: 'write', args: { filePath: '/tmp/mk-outside-by-agent.txt', content: 'x' } };
  else if (last.role !== 'tool' && /MOCK_PROTECTED/.test(user)) tool = { name: 'write', args: { filePath: file ? file.replace('scene_params.json', 'scene.blend') : 'scene.blend', content: 'not a blend' } };
  else if (file && cjson && tools.length && last.role !== 'tool') tool = { name: 'write', args: { filePath: file.trim(), content: cjson } }; // legacy (pre-1.2.3.1) prompt
  else if (/MOCK_NOJSON/.test(user)) content = 'Я создал файл scene_params.json, всё готово!';
  else if (/MOCK_FIXRETRY/.test(user) && !/не прошёл проверку/.test(lastUser)) content = '{"subject": "cat", "render": {"samples": ';
  else if (cjson) { let c = cjson; if (/MOCK_BADPARAMS/.test(user)) { const o = JSON.parse(c); o.subject = 'import os'; o.render.samples = 99999; c = JSON.stringify(o); }
    content = /MOCK_FENCE/.test(user) ? 'Вот параметры сцены:\n```json\n' + c + '\n```\nГотово.' : c; }
  r.setHeader('content-type', 'text/event-stream');
  const send = o => r.write('data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-coder', ...o }) + '\n\n');
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  if (tool) { send({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage }); }
  else { send({ choices: [{ index: 0, delta: { role: 'assistant', content: content ?? (last.role === 'tool' ? 'Готово.' : '3D task') }, finish_reason: null }] }); send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }); }
  r.write('data: [DONE]\n\n'); r.end();
}); }).listen(port, '127.0.0.1', () => console.log('mock-llm on ' + port));
