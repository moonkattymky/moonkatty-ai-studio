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
module.exports = { tmp, rss, mockFetch };
