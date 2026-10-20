'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

function video(key, hash, rights) {
  const asset = {
    namespace: 'moonkatty_news',
    kind: 'video',
    title: 'Ролик ' + key,
    idempotencyKey: key,
    contentHash: hash
  };
  if (rights) asset.rights = rights;
  return asset;
}

test('перед выпуском права читаются из памяти и не запускают ffmpeg', () => {
  const { si, owner, agent } = setup();
  const videoAgent = agent('video');
  const ok = si.assets.register({
    principal: videoAgent,
    asset: video('news/clip/ok', '1'.repeat(64), {
      basis: 'licensed', license: 'CC-BY-4.0', holder: 'Wire', attributionRequired: true, attributionText: 'Wire'
    })
  });
  const bare = si.assets.register({
    principal: videoAgent,
    asset: video('news/clip/bare', '2'.repeat(64))
  });
  const unknown = si.assets.register({
    principal: videoAgent,
    asset: video('news/clip/unknown', '3'.repeat(64), { basis: 'unknown' })
  });
  const expired = si.assets.register({
    principal: videoAgent,
    asset: video('news/clip/expired', '4'.repeat(64), {
      basis: 'licensed', license: 'editorial-2024', expiresAt: '2026-10-01T00:00:00.000Z', attributionRequired: false
    })
  });
  si.assets.recordUsage({
    principal: videoAgent,
    usage: { assetId: ok.asset.id, namespace: 'moonkatty_news', whereUsed: 'episode', publicationId: 'ep4', publicationVersion: 1, idempotencyKey: 'usage/ep4/ok' }
  });
  si.assets.recordUsage({
    principal: videoAgent,
    usage: { assetId: bare.asset.id, namespace: 'moonkatty_news', whereUsed: 'episode', publicationId: 'ep4', publicationVersion: 1, idempotencyKey: 'usage/ep4/bare' }
  });

  const present = si.qa.rightsForPublication({
    principal: videoAgent, namespace: 'moonkatty_news', assetIds: [ok.asset.id]
  });
  assert.equal(present.blocking, false);
  assert.equal(present.assets[0].present, true);
  assert.equal(present.assets[0].reason, null);
  assert.equal(present.warning, null);

  const missing = si.qa.rightsForPublication({
    principal: videoAgent, namespace: 'moonkatty_news', assetIds: [bare.asset.id]
  });
  assert.equal(missing.blocking, true);
  assert.equal(missing.assets[0].reason, 'missing');
  assert.equal(missing.assets[0].present, false);

  const basis = si.qa.rightsForPublication({
    principal: agent('publishing'), namespace: 'moonkatty_news', assetIds: [unknown.asset.id]
  });
  assert.equal(basis.assets[0].reason, 'unknown_basis');
  assert.equal(basis.blocking, true);

  const late = si.qa.rightsForPublication({
    principal: videoAgent, namespace: 'moonkatty_news', assetIds: [expired.asset.id]
  });
  assert.equal(late.assets[0].reason, 'expired');
  assert.equal(late.assets[0].present, true);
  assert.equal(late.blocking, true);

  const byPublication = si.qa.rightsForPublication({
    principal: videoAgent, namespace: 'moonkatty_news', publicationId: 'ep4'
  });
  assert.equal(byPublication.blocking, true);
  assert.equal(byPublication.assets.length, 2);
  assert.equal(byPublication.warning, null);

  const empty = si.qa.rightsForPublication({
    principal: videoAgent, namespace: 'moonkatty_news', publicationId: 'ep-empty'
  });
  assert.equal(empty.warning, 'no_assets_recorded');
  assert.equal(empty.blocking, false);
  assert.deepEqual(empty.assets, []);

  const finding = si.qa.recordFinding({
    principal: videoAgent,
    finding: {
      namespace: 'moonkatty_news', publicationId: 'ep4', publicationVersion: 1,
      checkName: 'corrupted_frames', ok: false, detail: 'кадр 10 не читается'
    }
  });
  assert.equal(finding.executed, false);
  assert.equal(finding.ok, false);
  assert.equal(finding.checkName, 'corrupted_frames');
  assert.throws(() => si.qa.recordFinding({
    principal: agent('games'),
    finding: { namespace: 'moonkatty_news', checkName: 'rights', ok: false, detail: null }
  }), err => err.code === 'PERMISSION_DENIED');

  const model = si.brand.register({
    principal: owner,
    asset: {
      id: 'MOONKATTY_MASTER_CHARACTER', kind: 'master_model', namespace: 'moonkatty_shared', version: 1,
      filePath: 'brand/moonkatty-cat.blend', approvedBy: 'igor',
      substitutionPolicy: 'owner_approval_required', autoExecute: false
    }
  });
  const modelRights = si.qa.rightsForPublication({
    principal: videoAgent, namespace: 'moonkatty_news', publicationId: 'ep-model', assetIds: [model.asset.id]
  });
  assert.equal(modelRights.assets.length, 1);
  assert.equal(modelRights.assets[0].blocking, false);
  assert.equal(modelRights.assets[0].basis, 'own');
  si.close();
});
