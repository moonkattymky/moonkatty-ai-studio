'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const { NewsEngine, REVIEW, categorize, parseFeed, fetchWithRetry, HttpError } = require('../src/news');
const { tmp, rss, mockFetch } = require('./helpers');

const A = 'https://a.example/rss', B = 'https://b.example/rss', GOV = 'https://nasa.example/rss';
const feeds = () => ({
  [A]: [{ status: 200, body: rss([
    { title: 'NASA rocket launch sends new telescope into orbit', link: 'https://a.example/1?utm_source=x', desc: 'The telescope reached orbit on Tuesday. Scientists expect first images soon.', media: 'https://a.example/img.jpg', rights: 'CC BY 4.0' },
    { title: 'Central bank raises interest rate to fight inflation', link: 'https://a.example/2', desc: 'The bank raised rates by 0.25 points.' },
    { title: 'BREAKING: Protest turns violent after election vote', link: 'https://a.example/3', desc: 'Police reported clashes.' }]) }],
  [B]: [{ status: 200, body: rss([
    { title: 'Rocket launch sends NASA telescope into orbit', link: 'https://b.example/x', desc: 'A new space telescope is in orbit.' },
    { title: 'Football club wins championship cup final', link: 'https://b.example/y', desc: 'The league season ended with a final goal.' }]) }],
});
const mk = (dir, fetchFn, extra = {}) => new NewsEngine({ statePath: path.join(dir, 'news.json'), fetchFn, backoffMs: 1,
  sources: [{ id: 'a', name: 'A News', url: A }, { id: 'b', name: 'B Times', url: B }], ...extra });

test('categorize covers all categories', () => {
  assert.equal(categorize('Parliament vote on new law by prime minister'), 'politics');
  assert.equal(categorize('Inflation and stocks market slump'), 'economy');
  assert.equal(categorize('New AI chip from startup'), 'tech');
  assert.equal(categorize('Scientists publish study on species'), 'science');
  assert.equal(categorize('SpaceX rocket to Mars'), 'space');
  assert.equal(categorize('Tennis tournament final'), 'sports');
  assert.equal(categorize('Netflix movie tops box office'), 'entertainment');
  assert.equal(categorize('Weather is nice'), 'other');
});

test('RSS and Atom parsing incl. license', () => {
  const r = parseFeed(rss([{ title: 'X &amp; Y', link: 'https://x/1', desc: '<b>hi</b>', rights: 'CC0' }]));
  assert.equal(r.items[0].title, 'X & Y'); assert.equal(r.items[0].summary, 'hi'); assert.equal(r.items[0].license, 'CC0');
  const atom = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><rights>Public domain</rights><entry><title>Atom T</title><link href="https://x/a"/><id>urn:1</id><summary>S</summary></entry></feed>');
  assert.equal(atom.items[0].link, 'https://x/a'); assert.equal(atom.channelLicense, 'Public domain');
});

test('dedup + corroboration + review statuses', async () => {
  const e = mk(tmp(), mockFetch(feeds()));
  const rep = await e.run();
  assert.equal(rep.fetched, 5); assert.equal(rep.errors.length, 0);
  const st = e.stories(); assert.equal(st.length, 4, 'two rocket items merged');
  const rocket = st.find(s => s.category === 'space');
  assert.equal(rocket.sourceCount, 2); assert.equal(rocket.corroboration, 'confirmed'); assert.equal(rocket.reviewStatus, REVIEW.AUTO);
  assert.equal(rocket.lang, 'en'); assert.ok(rocket.headline && rocket.summary);
  assert.deepEqual(rocket.mediaLicense.find(m => m.source === 'a'), { source: 'a', url: 'https://a.example/img.jpg', license: 'CC BY 4.0', usable: null });
  const bank = st.find(s => s.category === 'economy'); assert.equal(bank.corroboration, 'unconfirmed'); assert.equal(bank.reviewStatus, REVIEW.PENDING);
  const prot = st.find(s => s.breaking); assert.ok(prot.controversial); assert.equal(prot.reviewStatus, REVIEW.PENDING);
  assert.ok(prot.reviewReasons.includes('breaking') && prot.reviewReasons.includes('controversial'));
  assert.equal(prot.headline.startsWith('BREAKING'), false);
  // second run: everything duplicate
  const rep2 = await e.run(); assert.equal(rep2.new, 0); assert.equal(rep2.duplicates, 5); assert.equal(e.stories().length, 4);
  assert.ok(!e.publishable().some(s => s.id === prot.id));
  assert.throws(() => e.approve(prot.id), /reviewer/);
  e.approve(prot.id, 'igor'); assert.ok(e.publishable().some(s => s.id === prot.id));
});

test('official single source counts as confirmed; manual controversial flag forces approval', async () => {
  const f = mockFetch({ [GOV]: [{ status: 200, body: rss([{ title: 'NASA announces Mars rover sample results', link: 'https://nasa.example/p1', desc: 'Official statement.' }]) }] });
  const e = new NewsEngine({ statePath: path.join(tmp(), 's.json'), fetchFn: f, sources: [{ id: 'nasa', url: GOV, kind: 'official' }] });
  await e.run(); const [s] = e.stories(); assert.equal(s.corroboration, 'confirmed'); assert.equal(s.reviewStatus, REVIEW.AUTO);
  const s2 = await e.flag(s.id, { controversial: true }); assert.equal(s2.reviewStatus, REVIEW.PENDING);
});

test('API error: 4xx not retried, other sources still processed', async () => {
  const f = mockFetch({ [A]: [{ status: 403, body: '' }], [B]: feeds()[B] });
  const e = mk(tmp(), f); const rep = await e.run();
  assert.equal(rep.errors.length, 1); assert.match(rep.errors[0].error, /HTTP 403/);
  assert.equal(f.calls.filter(u => u === A).length, 1, 'no retry on 403');
  assert.equal(e.stories().length, 2);
  assert.equal(e.store.get('sourceHealth').a.ok, false);
});

test('retry: network error and 503 then success', async () => {
  const f = mockFetch({ [A]: ['neterr', { status: 503, body: '' }, feeds()[A][0]] });
  const txt = await fetchWithRetry(A, { fetchFn: f, retries: 3, backoffMs: 1 });
  assert.match(txt, /telescope/); assert.equal(f.calls.length, 3);
  const f2 = mockFetch({ [A]: [{ status: 500, body: '' }] });
  await assert.rejects(fetchWithRetry(A, { fetchFn: f2, retries: 2, backoffMs: 1 }), e => e instanceof HttpError && e.status === 500);
  assert.equal(f2.calls.length, 3);
});

test('summary provider failure falls back to deterministic local', async () => {
  const bad = { name: 'llm', summarize: async () => { throw new Error('API 500'); } };
  const e1 = mk(tmp(), mockFetch(feeds()), { provider: bad }); await e1.run();
  const e2 = mk(tmp(), mockFetch(feeds())); await e2.run();
  const s1 = e1.stories().map(s => [s.headline, s.summary]); const s2 = e2.stories().map(s => [s.headline, s.summary]);
  assert.deepEqual(s1, s2, 'deterministic');
  assert.equal(e1.stories()[0].summaryProvider, 'local-extractive'); assert.equal(e1.stories()[0].summaryFallbackReason, 'API 500');
  const good = { name: 'llm', summarize: async ({ title }) => ({ headline: 'H:' + title, summary: 'S' }) };
  const e3 = mk(tmp(), mockFetch(feeds()), { provider: good }); await e3.run(); assert.equal(e3.stories()[0].summaryProvider, 'llm');
});

test('translation hook is applied', async () => {
  const tr = { translate: async (t, from, to) => `[${to}] ${t}` };
  const e = mk(tmp(), mockFetch(feeds()), { translator: tr }); await e.run();
  assert.ok(e.stories().every(s => s.headline.startsWith('[en] ')));
});

test('restart recovery: state survives, approvals kept, no duplicates', async () => {
  const dir = tmp();
  const e1 = mk(dir, mockFetch(feeds())); await e1.run();
  const pend = e1.stories().find(s => s.reviewStatus === REVIEW.PENDING); e1.reject(pend.id, 'igor', 'unverified');
  // simulate crash mid-run: a fresh engine with partially failing source then recovering
  const e2 = mk(dir, mockFetch(feeds())); assert.equal(e2.stories().length, 4);
  const rep = await e2.run(); assert.equal(rep.new, 0);
  assert.equal(e2.story(pend.id).reviewStatus, REVIEW.REJECTED); assert.equal(e2.story(pend.id).review.reason, 'unverified');
  // a new corroborating item for a rejected story must not reset the decision
  const extra = { [A]: [{ status: 200, body: rss([{ title: 'Central bank raises interest rate to fight inflation again', link: 'https://c.example/9' }]) }], [B]: [{ status: 200, body: rss([]) }] };
  const e3 = mk(dir, mockFetch(extra)); await e3.run();
  assert.ok(Object.keys(e3.store.get('seen')).length >= 6);
});
