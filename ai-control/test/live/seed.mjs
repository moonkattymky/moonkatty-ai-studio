// globalSetup: seeds the SEEDED test Studio directly (test setup, NOT through AI CONTROL — the proxy is read-only).
import { SEEDED, TEST_USER, TEST_PASSWORD, url } from './fixture.mjs';
export const SEED = { confirmed: 125.5, estimate: 40, accrued: 10, demo: 99 };
export default async function seed() {
  const B = (p) => url(SEEDED.studio, p);
  const H = { 'content-type': 'application/json', 'x-studio-request': '1' };
  const r = await fetch(B('/api/auth/login'), { method: 'POST', headers: H, body: JSON.stringify({ username: TEST_USER, password: TEST_PASSWORD }) });
  if (!r.ok) throw new Error('seed login ' + r.status);
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const A = { ...H, cookie };
  const day = new Date().toISOString().slice(0, 10);
  const entries = [
    { date: day, stream: 'news', platform: 'yt-main', kind: 'income', amount_usd: SEED.confirmed, currency: 'USD', payout_id: 'TEST-PAYOUT-1', state: 'confirmed', confirmation_source: 'test:payout-report' },
    { date: day, stream: 'news', platform: 'yt-news', kind: 'income', amount_usd: SEED.estimate, currency: 'USD', payout_id: 'TEST-EST-1', state: 'estimate', confirmation_source: 'test:estimate' },
    { date: day, stream: 'news', platform: 'tiktok', kind: 'income', amount_usd: SEED.accrued, currency: 'USD', payout_id: 'TEST-ACC-1', state: 'accrued', confirmation_source: 'test:accrued' },
    { date: day, stream: 'news', platform: 'x', kind: 'income', amount_usd: SEED.demo, currency: 'USD', payout_id: 'TEST-DEMO-1', state: 'confirmed', confirmation_source: 'test:demo', demo: true },
  ];
  const imp = await fetch(B('/api/world/import'), { method: 'POST', headers: A, body: JSON.stringify({ entries }) });
  if (!imp.ok && imp.status !== 409) throw new Error('seed import ' + imp.status + ' ' + await imp.text());
  const tk = await fetch(B('/api/tasks'), { method: 'POST', headers: A, body: JSON.stringify({ title: 'TEST: проверить выпуск', agentId: 'news', status: 'waiting_approval', priority: 'normal' }) });
  if (!tk.ok) throw new Error('seed task ' + tk.status);
  const ep = await fetch(B('/api/episodes'), { method: 'POST', headers: A, body: JSON.stringify({ title: 'TEST выпуск #1', project: 'news', status: 'draft', scripts: { ru: 'Тестовый сценарий выпуска' } }) });
  if (!ep.ok) throw new Error('seed episode ' + ep.status + ' ' + await ep.text());
  await fetch(B('/api/auth/logout'), { method: 'POST', headers: A });
}
