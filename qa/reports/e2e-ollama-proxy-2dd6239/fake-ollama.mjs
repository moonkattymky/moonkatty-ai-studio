// Fake Ollama on a TEST port. Records every request; never talks to 11434.
import http from 'http'; import fs from 'fs';
const PORT = Number(process.env.FAKE_PORT || 19134), LOG = process.env.FAKE_LOG || '/tmp/fake-ollama.log';
const hits = [];
const srv = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const rec = { t: Date.now(), method: req.method, url: req.url, host: req.headers.host, headers: req.headers, body: body.slice(0, 500), len: Buffer.byteLength(body) };
    hits.push(rec); fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'evil:1b' }, { name: 'qwen2.5-coder:7b' }] }));
    if (req.url === '/api/pull' || req.url === '/api/delete' || req.url === '/api/create' || req.url === '/api/push') {
      return res.end(JSON.stringify({ ok: true, side: 'upstream executed ' + req.url })); }
    if (req.headers['x-smuggled'] || /[\r\n]/.test(JSON.stringify(req.headers))) {
      return res.end(JSON.stringify({ smuggled: true, headers: req.headers })); }
    // streaming-ish chat
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'qwen3:8b', message: { role: 'assistant', content: 'ok' }, done: true }));
  });
});
srv.listen(PORT, '127.0.0.1', () => { console.log('fake ollama', PORT); fs.writeFileSync('/tmp/fake-ollama.pid', String(process.pid)); });
process.on('SIGTERM', () => process.exit(0));
