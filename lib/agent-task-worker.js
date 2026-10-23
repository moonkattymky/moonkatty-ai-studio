'use strict';
// Runs inside bwrap. Reads /work/job.json. Talks only to the Ollama unix socket.
// The only process it may spawn is `node --test` on the owner's test files.
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const G = require('/opt/studio-node/guard.js');

function out(obj, code) { process.stdout.write(JSON.stringify(obj)); process.exit(code); }

async function chat(sock, model, prompt) {
  const body = Buffer.from(JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: prompt }] }));
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock, method: 'POST', path: '/api/chat', headers: { 'content-type': 'application/json', 'content-length': body.length } }, res => {
      const b = []; res.on('data', c => b.push(c)); res.on('end', () => {
        const text = Buffer.concat(b).toString('utf8');
        if (res.statusCode !== 200) return reject(Object.assign(new Error('llm http ' + res.statusCode), { code: 'llm_unavailable' }));
        try { resolve(JSON.parse(text).message.content); } catch (e) { reject(e); }
      });
    });
    req.on('error', e => reject(Object.assign(e, { code: 'llm_unavailable' })));
    req.setTimeout(90000, () => req.destroy(new Error('llm timeout')));
    req.end(body);
  });
}

async function main() {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const editable = job.editable;
  const tests = job.tests;
  const prompt = [
    'Reply with a unified diff only (diff --git). No shell commands.',
    'You may modify only: ' + editable.join(', '),
    'Do not modify tests: ' + tests.join(', '),
    'Task: ' + job.prompt,
    'Files:',
    ...editable.map(p => '----- ' + p + '\n' + fs.readFileSync(p, 'utf8'))
  ].join('\n');
  let reply;
  if (typeof job.stub === 'string') reply = job.stub;
  else reply = await chat(job.sock, job.model, prompt);
  const original = Object.fromEntries(editable.map(p => [p, fs.readFileSync(p, 'utf8')]));
  let next;
  try { next = G.applyUnified(original, reply, editable); }
  catch (e) {
    if (e.code === 'diff_rejected' && !String(reply).includes('diff --git')) return out({ ok: false, code: 'no_diff' }, 3);
    return out({ ok: false, code: e.code || 'diff_rejected', message: e.message }, 2);
  }
  for (const [p, text] of next) if (text !== original[p]) fs.writeFileSync(p, text);
  const args = G.assertTestArgv('/opt/studio-node/node', ['--test', ...tests], tests);
  const child = spawn('/opt/studio-node/node', args, { cwd: '/work', shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  let output = '';
  child.stdout.on('data', d => { output = (output + d).slice(-8000); });
  child.stderr.on('data', d => { output = (output + d).slice(-8000); });
  const code = await new Promise(res => child.on('close', res));
  out({ ok: true, testCode: code, testOutput: output.slice(-4000) }, 0);
}

main().catch(e => out({ ok: false, code: e.code || 'worker_error', message: e.message }, 2));
