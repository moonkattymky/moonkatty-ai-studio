// Security test for /api/newsvideo/* against a RUNNING test-flavor server (does not start one).
// Usage: STUDIO_URL=http://127.0.0.1:8687 STUDIO_USER=igor PW_FILE=<file with password> node scripts/newsvideo-security-test.mjs
import fs from 'fs';
const B = process.env.STUDIO_URL || 'http://127.0.0.1:8687'; const U = process.env.STUDIO_USER || 'igor';
if (!process.env.PW_FILE) { console.log('SKIP: set PW_FILE (and STUDIO_URL) to run against a live server'); process.exit(0); }
const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim(); const H = { 'content-type': 'application/json', 'x-studio-request': '1', origin: B };
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ' — ' + x : '')); };
const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ username: U, password: PW }) });
const cookie = (lr.headers.get('set-cookie') || '').split(';')[0]; t('login', lr.status === 200 && !!cookie);
const A = { ...H, cookie };
const routes = [['GET', '/api/newsvideo/status'], ['POST', '/api/newsvideo/search'], ['GET', '/api/newsvideo/stories'], ['GET', '/api/newsvideo/drafts'], ['POST', '/api/newsvideo/drafts'], ['GET', '/api/newsvideo/drafts/abcdef0123456789'], ['PUT', '/api/newsvideo/drafts/abcdef0123456789'], ['POST', '/api/newsvideo/drafts/abcdef0123456789/approve'], ['POST', '/api/newsvideo/drafts/abcdef0123456789/render'], ['GET', '/api/newsvideo/drafts/abcdef0123456789/file?kind=mp4']];
for (const [m, p] of routes) { const r = await fetch(B + p, { method: m, headers: H, body: m === 'GET' ? undefined : '{}' }); t(`401 without auth ${m} ${p}`, r.status === 401, r.status); }
for (const [m, p] of routes.filter(r => r[0] !== 'GET')) { const r = await fetch(B + p, { method: m, headers: { ...A, origin: 'https://evil.example.com' }, body: '{}' }); t(`403 cross-origin ${m} ${p}`, r.status === 403, r.status); }
const g = async (p, o = {}) => (await fetch(B + p, { headers: A, ...o })).status;
t('bogus draft id → 400/404', [400, 404].includes(await g('/api/newsvideo/drafts/..%2f..%2fetc%2fpasswd')));
t('traversal in file id → 400/404', [400, 404].includes(await g('/api/newsvideo/drafts/..%2F..%2F..%2Fetc/file?kind=mp4')));
t('kind injection → 400/404', [400, 404].includes(await g('/api/newsvideo/drafts/abcdef0123456789/file?kind=mp4;rm%20-rf')));
const d = await (await fetch(B + '/api/newsvideo/drafts', { headers: A })).json(); const any = (d.drafts || d)[0];
if (any) { t('existing draft: bad kind → 400', (await g(`/api/newsvideo/drafts/${any.id}/file?kind=../../.pw`)) === 400);
  t('shell metachar in preset refused', (await fetch(`${B}/api/newsvideo/drafts/${any.id}/render`, { method: 'POST', headers: A, body: JSON.stringify({ preset: 'youtube;touch /tmp/pwn' }) })).status >= 400 && !fs.existsSync('/tmp/pwn')); }
const s = await fetch(B + '/api/newsvideo/search', { method: 'POST', headers: A, body: JSON.stringify({ sources: [{ url: 'http://169.254.169.254/latest/meta-data' }], url: 'http://127.0.0.1:22' }) });
const sj = await s.json().catch(() => ({})); t('search ignores client-supplied URLs (fixed allowlist)', s.status === 200 && !JSON.stringify(sj.run || {}).includes('169.254'));
const st = await (await fetch(B + '/api/newsvideo/status', { headers: A })).json(); t('status leaks no secrets', !/password|token|secret/i.test(JSON.stringify(st)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
