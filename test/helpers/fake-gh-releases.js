'use strict';
// E2E-UC: a fake GitHub Releases server on 127.0.0.1 (real HTTP; real zip archives; Range/resume; redirects; socket cuts).
// Routes: GET /repos/<owner>/<repo>/releases · GET /<owner>/<repo>/releases/download/<tag>/<name> → 302 → /assets/<tag>/<name>
const http = require('http'), zlib = require('zlib'), crypto = require('crypto');
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
// real deflate zip; entries: { name: string|Buffer } (name ending in / = dir); symlinks: { name: target }
function makeZip(entries, symlinks = {}) {
  const locals = [], cds = []; let off = 0;
  const all = [...Object.entries(entries).map(([n, d]) => [n, Buffer.from(d), false]), ...Object.entries(symlinks).map(([n, t]) => [n, Buffer.from(t), true])];
  for (const [n, data, link] of all) { const nb = Buffer.from(n), dir = n.endsWith('/'); const comp = dir || link ? data : zlib.deflateRawSync(data); const method = dir || link ? 0 : 8, crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(method, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28);
    c.writeUInt32LE(((link ? 0o120777 : dir ? 0o040755 : 0o100644) << 16) >>> 0, 38); c.writeUInt32LE(off, 42);
    locals.push(l, nb, comp); cds.push(c, nb); off += 30 + nb.length + comp.length; }
  const cd = Buffer.concat(cds), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(all.length, 8); e.writeUInt16LE(all.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
async function startFakeGitHub({ repo }) {
  const S = { releases: [], log: [], cutOnce: null, overrides: {} }; // overrides[path] = (req,res)=>bool
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); S.log.push({ method: req.method, path: u.pathname, range: req.headers.range || null });
    const ov = S.overrides[u.pathname]; if (ov && ov(req, res)) return;
    if (u.pathname === `/repos/${repo}/releases`) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(S.releases.map(r => r.api(base)))); }
    let m = new RegExp(`^/${repo}/releases/download/([^/]+)/([^/]+)$`).exec(u.pathname);
    if (m) { res.statusCode = 302; res.setHeader('location', `${base}/assets/${m[1]}/${m[2]}`); return res.end(); }
    m = /^\/assets\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    const r = m && S.releases.find(x => x.tag === decodeURIComponent(m[1])); const b = r && r.files[decodeURIComponent(m[2])];
    if (!b) { res.statusCode = 404; return res.end(); }
    let start = 0; const rg = /^bytes=(\d+)-$/.exec(req.headers.range || ''); if (rg) { start = +rg[1]; if (start >= b.length) { res.statusCode = 416; return res.end(); } res.statusCode = 206; res.setHeader('content-range', `bytes ${start}-${b.length - 1}/${b.length}`); }
    const body = b.subarray(start); res.setHeader('content-length', body.length);
    if (S.cutOnce && S.cutOnce.name === decodeURIComponent(m[2])) { const n = S.cutOnce.after; S.cutOnce = null; res.flushHeaders(); res.write(body.subarray(0, n), () => setTimeout(() => res.socket.destroy(), 30)); return; }
    res.end(body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, S, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
module.exports = { makeZip, startFakeGitHub, crc32, sha };
