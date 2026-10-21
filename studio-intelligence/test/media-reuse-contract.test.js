'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

function clip(extra = {}) {
  return Object.assign({
    namespace: 'moonkatty_news',
    kind: 'video',
    title: 'Кадр пуска с мыса Канаверал',
    sourceName: 'NASA',
    sourceUrl: 'https://example.com/clip.mp4?utm_source=news&id=1',
    contentHash: 'c'.repeat(64),
    idempotencyKey: 'news/clip/nasa-1',
    rights: {
      basis: 'licensed',
      license: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      holder: 'NASA',
      attributionRequired: true,
      attributionText: 'NASA'
    }
  }, extra);
}

test('повторная регистрация того же ролика не создаёт вторую карточку', () => {
  const { si, agent } = setup();
  const news = agent('news');
  const first = si.assets.register({ principal: news, asset: clip() });
  assert.equal(first.reused, false);
  assert.equal(first.asset.sourceUrl, 'example.com/clip.mp4?id=1');
  assert.equal(first.rights.license, 'CC-BY-4.0');
  assert.equal(first.rights.basis, 'licensed');
  assert.equal(first.asset.status, 'draft');

  const second = si.assets.register({
    principal: news,
    asset: clip({ idempotencyKey: 'news/clip/nasa-1-again', title: 'Другой заголовок того же файла' })
  });
  assert.equal(second.reused, true);
  assert.equal(second.asset.id, first.asset.id);
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM si_assets').get().n, 1);

  const byUrl = si.assets.findReusable({
    principal: news,
    namespace: 'moonkatty_news',
    sourceUrl: 'https://www.example.com/clip.mp4?id=1&utm_campaign=x'
  });
  assert.equal(byUrl.reusable, true);
  assert.equal(byUrl.match, 'source_url');
  assert.equal(byUrl.asset.id, first.asset.id);

  const byHash = si.assets.findReusable({
    principal: news,
    namespace: 'moonkatty_news',
    contentHash: 'c'.repeat(64)
  });
  assert.equal(byHash.match, 'content_hash');

  const other = si.assets.register({
    principal: news,
    asset: clip({
      contentHash: 'd'.repeat(64),
      sourceUrl: 'https://example.com/other.mp4',
      idempotencyKey: 'news/clip/other',
      title: 'Другой ролик'
    })
  });
  assert.equal(other.reused, false);
  assert.notEqual(other.asset.id, first.asset.id);

  const shorts = si.assets.recordUsage({
    principal: news,
    usage: {
      assetId: first.asset.id,
      namespace: 'moonkatty_news',
      whereUsed: 'shorts',
      publicationId: 'ep9',
      publicationVersion: 3,
      idempotencyKey: 'usage/ep9/shorts',
      context: 'нарезка из выпуска'
    }
  });
  const episode = si.assets.recordUsage({
    principal: agent('video'),
    usage: {
      assetId: first.asset.id,
      namespace: 'moonkatty_news',
      whereUsed: 'episode',
      publicationId: 'ep9',
      publicationVersion: 2,
      idempotencyKey: 'usage/ep9/episode'
    }
  });
  assert.equal(shorts.whereUsed, 'shorts');
  assert.equal(episode.publicationVersion, 2);
  const history = si.assets.usageOf({ principal: news, assetId: first.asset.id });
  assert.deepEqual(history.map(item => item.whereUsed).sort(), ['episode', 'shorts']);
  assert.deepEqual(history.map(item => item.publicationVersion).sort(), [2, 3]);
  assert.ok(history.every(item => item.publicationId === 'ep9'));
  const looked = si.assets.findReusable({ principal: news, namespace: 'moonkatty_news', contentHash: 'c'.repeat(64) });
  assert.equal(looked.usages.length, 2);

  assert.throws(() => si.assets.register({
    principal: news,
    asset: clip({ title: 'access_token=secret', idempotencyKey: 'news/clip/secret', contentHash: 'e'.repeat(64), sourceUrl: null })
  }), err => err.code === 'SECRET_REJECTED');
  assert.throws(() => si.assets.addRights({
    principal: news,
    assetId: first.asset.id,
    rights: { basis: 'cc0', license: 'CC0-1.0' }
  }), err => err.code === 'PERMISSION_DENIED');
  si.close();
});
