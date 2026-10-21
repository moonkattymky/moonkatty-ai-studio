'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ma-test-'));
const rss = (items, extra = '') => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${extra}${items.map(i =>
  `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><description>${i.desc || ''}</description>${i.media ? `<media:content url="${i.media}"/>` : ''}${i.rights ? `<dc:rights>${i.rights}</dc:rights>` : ''}</item>`).join('')}</channel></rss>`;
/** Mock fetch: routes map url -> array of responses (status/body or 'neterr'), consumed in order; last one repeats. */
function mockFetch(routes) {
  const calls = [];
  const fn = async url => { calls.push(url); const q = routes[url]; if (!q) return { ok: false, status: 404, text: async () => '' };
    const r = q.length > 1 ? q.shift() : q[0]; if (r === 'neterr') throw new Error('ECONNRESET');
    return { ok: r.status < 400, status: r.status, text: async () => r.body }; };
  fn.calls = calls; return fn;
}
/** TEST-ONLY tone stub (not speech). Not exported from src/. */
class StubTTS {
  constructor() { this.name = 'test-stub-tone'; }
  async synthesize(text, outWav) {
    const { run } = require('../src/video/exec'); const d = Math.max(1.5, String(text).split(/\s+/).length / 2.6).toFixed(2);
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}:sample_rate=22050`, '-af', 'volume=0.05', '-ac', '1', outWav]);
    return { file: outWav, durationSec: +d };
  }
}
module.exports = { tmp, rss, mockFetch, StubTTS };
