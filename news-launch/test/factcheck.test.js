'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { factCheckItems, selectStories, related } = require('../src/factcheck');

const now = '2026-10-20T12:00:00.000Z';
const recent = 'Tue, 20 Oct 2026 09:00:00 GMT';

function item(over) {
  return {
    org: 'bbc', publisher: 'BBC News', url: 'https://www.bbc.com/news/1', title: 'City council approves river bridge budget',
    summary: 'The council approved the river bridge budget.', published: recent, sourceId: 'bbc', engineStoryId: 's1',
    controversial: false, breaking: false, ...over,
  };
}

test('two organisations confirm a story; one organisation and a lone official source do not', () => {
  const results = factCheckItems([
    item({}),
    item({ org: 'guardian', publisher: 'The Guardian', url: 'https://www.theguardian.com/bridge', sourceId: 'g', title: 'City council approves river bridge budget' }),
    item({ org: 'bbc', url: 'https://www.bbc.com/news/2', title: 'Only the BBC has this warehouse fire story', engineStoryId: 'solo', summary: 'A warehouse fire was reported.' }),
    item({ org: 'nasa', publisher: 'NASA', url: 'https://www.nasa.gov/moon-photo', kind: 'official', title: 'NASA posts a photo of the moon', summary: 'The agency posted a lunar photograph.', engineStoryId: 'nasa', sourceId: 'nasa' }),
  ], { now: () => now });
  const bridge = results.find(r => /bridge/i.test(r.claim));
  assert.equal(bridge.status, 'confirmed');
  assert.equal(bridge.editorialStatus, 'confirmed-publishers');
  assert.equal(bridge.primarySourceUrl, null);
  assert.equal(bridge.primaryPublisher, null);
  assert.equal(bridge.primaryPublished, null);
  assert.equal(bridge.independentPublishers, 2);
  assert.equal(new Set(bridge.sources.map(s => s.org)).size, 2);
  assert.ok(bridge.sources.every(s => /^https:/.test(s.url)));
  const solo = results.find(r => /warehouse/i.test(r.claim));
  assert.equal(solo.status, 'rejected');
  assert.equal(solo.editorialStatus, 'dropped-unconfirmed');
  assert.equal(solo.rejectionReason, 'fewer_than_two_independent_publishers');
  const nasa = results.find(r => /moon/i.test(r.claim));
  assert.equal(nasa.status, 'rejected');
});

test('two feeds from the same organisation are not independent', () => {
  const a = item({ url: 'https://www.bbc.com/a', engineStoryId: 'x' });
  const b = item({ url: 'https://www.bbc.co.uk/b', sourceId: 'bbc2', engineStoryId: 'y', title: 'City council approves river bridge budget today' });
  assert.equal(related(a, b), false);
  const [only] = factCheckItems([a, b], { now: () => now });
  assert.equal(only.status, 'rejected');
  assert.equal(only.independentPublishers, 1);
});

test('selectStories refuses to invent a third story', () => {
  const results = factCheckItems([
    item({}),
    item({ org: 'guardian', publisher: 'The Guardian', url: 'https://www.theguardian.com/bridge', sourceId: 'g' }),
  ], { now: () => now });
  assert.throws(() => selectStories(results, { count: 3, now: Date.parse(now) }), /Refusing to invent news/);
});

test('temporary adapter links close paraphrases and rejects a contradictory URL', () => {
  const a = item({
    engineStoryId: 'a', url: 'https://www.bbc.com/news/astronomers-find-comet-borrelly-nine-kepler',
    title: 'Astronomers find comet Borrelly-Nine in the Kepler archive',
    summary: 'The comet Borrelly-Nine was identified in old Kepler frames.',
  });
  const b = item({
    org: 'npr', publisher: 'NPR', url: 'https://www.npr.org/astronomers-identify-comet-borrelly-nine-kepler', sourceId: 'npr', engineStoryId: 'b',
    title: 'Astronomers identify comet Borrelly-Nine in the Kepler archive',
    summary: 'NPR reports that comet Borrelly-Nine appears in the Kepler archive.',
  });
  assert.equal(related(a, b), true);
  const [row] = factCheckItems([a, b], { now: () => now });
  assert.equal(row.status, 'confirmed');
  assert.equal(row.adapter, 'TEMPORARY_ADAPTER:distinctive-anchor-corroboration');
  const mismatched = factCheckItems([
    item({
      engineStoryId: 'e1', url: 'https://www.npr.org/2026/nigeria-confirms-ebola-abuja',
      title: 'Nigeria confirms an Ebola case in Abuja', summary: 'Nigeria confirmed an Ebola case in Abuja.',
    }),
    item({
      org: 'aljazeera', publisher: 'Al Jazeera', sourceId: 'aj', engineStoryId: 'e2',
      url: 'https://www.aljazeera.com/news/kenya-confirms-ninth-ebola-case',
      title: 'Nigeria confirms an Ebola case in Abuja today', summary: 'Nigeria confirmed an Ebola case in Abuja.',
    }),
  ], { now: () => now });
  assert.ok(mismatched.every(r => r.status !== 'confirmed' || !r.sources.some(s => /kenya/.test(s.url))));
  assert.ok(mismatched.every(r => r.status === 'rejected'));
});

test('different figures are not treated as the same claim', () => {
  const a = item({ title: 'Strike kills 73 recruits at a training camp', summary: 'Local authorities said 73 recruits died.', engineStoryId: 'a' });
  const b = item({
    org: 'guardian', publisher: 'The Guardian', url: 'https://www.theguardian.com/strike', sourceId: 'g', engineStoryId: 'b',
    title: 'Attack kills 53 in the same training camp', summary: 'Reports said 53 people died at the camp.',
  });
  assert.equal(related(a, b), false);
});
