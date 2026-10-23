import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { externalHref, NEWS_HOSTS } = require('../desktop/external-hosts.js');
const NVmod = require('../lib/news-video.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
for (const h of ['www.nasa.gov', 'science.nasa.gov', 'www.esa.int', 'esa.int', 'www.bbc.co.uk', 'feeds.bbci.co.uk', 'www.npr.org', 'www.theguardian.com', 'www.sciencedaily.com']) {
  t('open ' + h, externalHref('https://' + h + '/news/1') === 'https://' + h + '/news/1');
  t('feed allow ' + h, NVmod.ALLOWED_HOSTS.has(h) || NEWS_HOSTS.includes(h));
}
t('http nasa blocked', externalHref('http://www.nasa.gov/a') === null);
t('userinfo blocked', externalHref('https://user:pw@www.nasa.gov/a') === null);
t('evil host blocked', externalHref('https://evil.example.com/nasa') === null);
t('javascript blocked', externalHref('javascript:alert(1)') === null);
t('facebook still allowed', externalHref('https://www.facebook.com/pages/create') != null);
const nasa = 'https://www.nasa.gov/news-release/feed/';
const fb = await NVmod.fetchFeed(nasa, {}, async u => {
  if (u === nasa) return { ok: false, status: 404, text: async () => '<html>missing</html>' };
  if (u === 'https://www.nasa.gov/feed/') return { ok: true, status: 200, text: async () => '<rss version="2.0"><channel></channel></rss>' };
  throw new Error('unexpected ' + u);
});
t('NASA feed falls back when primary is not RSS', fb.fetchedUrl === 'https://www.nasa.gov/feed/' && fb.ok);
let threw = false; try { await NVmod.fetchFeed('https://www.esa.int/rssfeed/Our_Activities/Space_News', {}, async () => { throw new Error('down'); }); } catch { threw = true; }
t('ESA fallbacks exhausted surface the error', threw);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
