'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyStory } = require('../../media-automation/src/news/verify');
const { NewsEngine } = require('../../media-automation/src/news/engine');
const { classify } = require('../../media-automation/src/media/licenses');

test('confirmed-primary is a primary source; confirmed-publishers is not', () => {
  const alone = verifyStory([{
    sourceId: 'ea', title: 'Unofficial Referendum Results Reporting Process',
    summary: 'Elections Alberta will publish official results on 29 October 2026.',
    link: 'https://www.elections.ab.ca/resources/media/news-releases/2026-10-19-2/',
    published: '2026-10-19',
    primarySourceUrl: 'https://www.elections.ab.ca/resources/media/news-releases/2026-10-19-2/',
    editorialStatus: 'confirmed-primary',
  }]);
  assert.equal(alone.status, 'primary_only');
  assert.deepEqual(alone.primarySource, ['ea']);

  const corroborated = verifyStory([
    {
      sourceId: 'ea', title: 'Referendum question 10',
      summary: 'Option 1 is remain in Canada. Option 2 starts the legal process for a separation referendum.',
      link: 'https://www.elections.ab.ca/elections/referendum/',
      published: '2026-10-19', editorialStatus: 'confirmed-primary',
      primarySourceUrl: 'https://www.elections.ab.ca/elections/referendum/',
    },
    {
      sourceId: 'cbc', title: 'Alberta referendum coverage',
      summary: 'A separate newsroom account of the same question, written in different words from the official page.',
      link: 'https://www.cbc.ca/news/canada/edmonton/alberta-referendum',
      published: '2026-10-19',
    },
  ]);
  assert.equal(corroborated.status, 'confirmed');

  const outlets = verifyStory([
    {
      sourceId: 'bbc', title: 'City council approves river bridge budget',
      summary: 'The evening bulletin says the council voted to fund the river bridge.',
      link: 'https://www.bbc.com/news/bridge', published: '2026-10-20',
      editorialStatus: 'confirmed-publishers',
    },
    {
      sourceId: 'guardian', title: 'Council funds the river bridge',
      summary: 'A second publisher describes the vote with its own wording and no shared wire copy.',
      link: 'https://www.theguardian.com/bridge', published: '2026-10-20',
      editorialStatus: 'confirmed-publishers',
    },
  ]);
  assert.equal(outlets.status, 'unconfirmed');
  assert.deepEqual(outlets.primarySource, []);
});

test('their engine stores primary fields and drops dropped-unconfirmed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-engine-'));
  const engine = new NewsEngine({ statePath: path.join(dir, 'stories.json') });
  engine.addSource({ id: 'mod', name: 'UK Ministry of Defence', kind: 'official', url: 'https://www.gov.uk/news.rss' });
  engine.addSource({ id: 'solo', name: 'Solo Wire', kind: 'rss', url: 'https://solo.example/rss' });
  await engine.ingest(engine.sources.get('mod'), {
    title: 'Operational update on defensive air support',
    link: 'https://www.gov.uk/government/news/operational-update-20-october-uk-military-support-to-the-kingdom-of-saudi-arabia',
    summary: 'Typhoon jets will defend Saudi cities. The statement does not announce offensive strikes.',
    published: '2026-10-20T12:00:00.000Z',
    primarySourceUrl: 'https://www.gov.uk/government/news/operational-update-20-october-uk-military-support-to-the-kingdom-of-saudi-arabia',
    primaryPublisher: 'UK Ministry of Defence',
    primaryPublished: '2026-10-20',
    editorialStatus: 'confirmed-primary',
  });
  const official = engine.stories().find(s => s.primaryPublisher === 'UK Ministry of Defence');
  assert.equal(official.corroboration, 'primary_only');
  assert.equal(official.editorialStatus, 'confirmed-primary');
  assert.equal(official.reviewStatus, 'auto_approved');

  await engine.ingest(engine.sources.get('solo'), {
    title: 'Warehouse fire reported downtown',
    link: 'https://solo.example/fire',
    summary: 'One outlet reported a warehouse fire.',
    published: '2026-10-20T12:00:00.000Z',
    editorialStatus: 'dropped-unconfirmed',
  });
  const dropped = engine.stories().find(s => /warehouse/i.test(s.items[0].title));
  assert.equal(dropped.items[0].editorialStatus, 'dropped-unconfirmed');
  // Story-level editorialStatus is copied from manualFlags or from the item that has primarySourceUrl.
  assert.equal(dropped.editorialStatus, null);
  assert.equal(dropped.corroboration, 'unconfirmed');
  assert.equal(dropped.reviewStatus, 'pending_approval');

  await engine.flag(official.id, { editorialStatus: 'dropped-unconfirmed' });
  const flagged = engine.story(official.id);
  assert.equal(flagged.editorialStatus, 'dropped-unconfirmed');
  assert.equal(flagged.corroboration, 'unconfirmed');
  assert.equal(flagged.reviewStatus, 'pending_approval');
});

test('OGL v3 is accepted and a numbered non-v3 OGL is rejected', () => {
  const v3 = classify('Open Government Licence v3');
  assert.equal(v3.ok, true);
  assert.equal(v3.id, 'OGL-UK-3.0');
  assert.equal(v3.attributionRequired, true);
  assert.equal(classify('OGL').ok, true);
  assert.equal(classify('OGL 2').ok, false);
});
