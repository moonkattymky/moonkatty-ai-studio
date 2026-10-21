// MOONKATTY AI CONTROL — tiny local static server (Stage 1).
// Binds to 127.0.0.1 ONLY. Serves the static build (dist/). No API, no proxying, no external calls.
//   node ai-control/server.mjs            → builds src/ → dist/ and serves on http://127.0.0.1:8690
//   PORT=8691 node ai-control/server.mjs  → another port   |   --no-build → serve existing dist/
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8690);
const FORBIDDEN_PORTS = new Set([8787, 8687, 4096, 4097]);
if (FORBIDDEN_PORTS.has(PORT)) { console.error(`Port ${PORT} is reserved for other MOONKATTY services; pick another.`); process.exit(1); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SEC = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

function send(res, code, body, headers = {}) { res.writeHead(code, { ...SEC, ...headers }); res.end(body); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    const url = new URL(req.url, `http://${HOST}`);
    let p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/') || p === '/api') return send(res, 404, JSON.stringify({ error: 'no API in stage 1 (DEMO)' }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(dist, p));
    if (!file.startsWith(dist + path.sep)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': ext === '.html' || p.endsWith('/sw.js') || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=3600' };
    if (p.endsWith('/sw.js')) headers['Service-Worker-Allowed'] = '/';
    if (req.method === 'HEAD') return send(res, 200, null, headers);
    send(res, 200, await readFile(file), headers);
  } catch (e) {
    send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain' });
  }
});

if (!process.argv.includes('--no-build')) await build();
server.listen(PORT, HOST, () => console.log(`MOONKATTY AI CONTROL (DEMO) → http://${HOST}:${PORT}/  (local only)`));
export default server;
