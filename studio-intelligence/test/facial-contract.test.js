'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

function modelAsset(extra = {}) {
  return Object.assign({
    id: 'master_model',
    kind: 'master_model',
    namespace: 'moonkatty_project',
    version: 1,
    filePath: 'brand/moonkatty-cat.blend',
    sha256: 'a'.repeat(64),
    approvedBy: 'igor',
    substitutionPolicy: 'owner_approval_required',
    autoExecute: false
  }, extra);
}

function audioAsset(extra = {}) {
  return Object.assign({
    namespace: 'moonkatty_news',
    kind: 'audio',
    title: 'Дикторский трек выпуска',
    sourceName: 'studio',
    idempotencyKey: 'news/audio/ep1',
    contentHash: 'b'.repeat(64)
  }, extra);
}

test('мимика читает утверждённую модель и пишет использование, не считая кадры', () => {
  const { si, owner, agent } = setup();
  const registered = si.brand.register({ principal: owner, asset: modelAsset() });
  const audio = si.assets.register({ principal: agent('video'), asset: audioAsset() });
  assert.equal(audio.asset.status, 'draft');
  assert.equal(audio.reused, false);

  const seen = si.assets.approvedCharacterModel({ principal: agent('news') });
  assert.equal(seen.asset.id, registered.asset.id);
  assert.equal(seen.asset.brandRole, 'master_model');
  assert.equal(seen.rights.basis, 'own');
  assert.equal(si.assets.approvedCharacterModel({ principal: agent('design3d') }).asset.id, registered.asset.id);
  assert.throws(() => si.assets.get({ principal: agent('news'), id: registered.asset.id }), err => err.code === 'NOT_FOUND');

  assert.throws(() => si.assets.prepareFacialUse({
    principal: agent('design3d'),
    request: {
      namespace: 'moonkatty_news',
      characterModelAssetId: registered.asset.id,
      audioAssetId: audio.asset.id,
      channels: ['lip', 'eye', 'head', 'ear'],
      publicationId: 'ep1',
      publicationVersion: 2,
      idempotencyKey: 'facial/ep1/v2'
    }
  }), err => err.code === 'NOT_FOUND');
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM si_asset_usage').get().n, 0);

  const prepared = si.assets.prepareFacialUse({
    principal: agent('video'),
    request: {
      namespace: 'moonkatty_news',
      characterModelAssetId: registered.asset.id,
      audioAssetId: audio.asset.id,
      channels: ['lip', 'eye', 'head', 'ear'],
      publicationId: 'ep1',
      publicationVersion: 2,
      idempotencyKey: 'facial/ep1/v2'
    }
  });
  assert.equal(prepared.executed, false);
  assert.equal(prepared.model.id, registered.asset.id);
  assert.equal(prepared.audio.id, audio.asset.id);
  assert.equal(prepared.usage.namespace, 'moonkatty_news');
  assert.equal(prepared.usage.whereUsed, 'facial_animation');
  assert.equal(prepared.usage.publicationId, 'ep1');
  assert.equal(prepared.usage.publicationVersion, 2);
  assert.deepEqual(prepared.usage.payload.channels, ['lip', 'eye', 'head', 'ear']);
  const repeat = si.assets.prepareFacialUse({
    principal: agent('video'),
    request: {
      namespace: 'moonkatty_news',
      characterModelAssetId: registered.asset.id,
      audioAssetId: audio.asset.id,
      channels: ['lip', 'eye', 'head', 'ear'],
      publicationId: 'ep1',
      publicationVersion: 2,
      idempotencyKey: 'facial/ep1/v2'
    }
  });
  assert.equal(repeat.usage.id, prepared.usage.id);
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM si_asset_usage').get().n, 1);

  assert.throws(() => si.assets.prepareFacialUse({
    principal: agent('video'),
    request: {
      namespace: 'moonkatty_news',
      characterModelAssetId: 'not-the-model',
      audioAssetId: audio.asset.id,
      channels: ['lip'],
      idempotencyKey: 'facial/ep1/wrong'
    }
  }), err => err.code === 'VALIDATION');
  assert.throws(() => si.brand.check({ assetId: registered.asset.id, action: 'substitute', candidate: { filePath: 'brand/other.blend' } }), err => err.code === 'NOT_IMPLEMENTED');
  assert.equal(si.assets.get({ principal: owner, id: registered.asset.id }).storagePath, 'brand/moonkatty-cat.blend');
  si.close();
});

test('без утверждённой мастер-модели мимика не начинается', () => {
  const { si, agent } = setup();
  assert.throws(() => si.assets.prepareFacialUse({
    principal: agent('video'),
    request: {
      namespace: 'moonkatty_news',
      characterModelAssetId: 'missing',
      audioAssetId: 'missing-audio',
      channels: ['head'],
      idempotencyKey: 'facial/none'
    }
  }), err => err.code === 'NOT_FOUND');
  si.close();
});

test('второй оригинал кота и смена пути утверждённого файла отвергаются', () => {
  const { si, owner } = setup();
  const cat = {
    id: 'cat_original', kind: 'cat_image', namespace: 'moonkatty_project', version: 1,
    filePath: 'brand/cat-original.png', approvedBy: 'igor',
    substitutionPolicy: 'owner_approval_required', autoExecute: false, locked: true
  };
  const saved = si.brand.register({ principal: owner, asset: cat });
  assert.throws(() => si.brand.register({
    principal: owner,
    asset: Object.assign({}, cat, { filePath: 'brand/cat-replaced.png' })
  }), err => err.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(si.assets.get({ principal: owner, id: saved.asset.id }).storagePath, 'brand/cat-original.png');
  assert.throws(() => si.assets.register({
    principal: agentOf(si),
    asset: { namespace: 'moonkatty_news', kind: 'audio', title: 'x', idempotencyKey: 'k', status: 'approved' }
  }), err => err.code === 'PERMISSION_DENIED');
  si.close();
});

function agentOf() {
  return { id: 'news', role: 'agent', agentId: 'news', user: 'igor' };
}
