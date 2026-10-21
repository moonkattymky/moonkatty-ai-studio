'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('сценарии описаны, шаги владельца не автозапускаются, run не исполняет', () => {
  const { si } = setup();
  for (const id of ['news', 'studio3d', 'games']) {
    const pipeline = si.workflow.describe(id);
    assert.ok(pipeline.steps.length >= 5);
    for (const step of pipeline.steps) {
      if (step.requiresOwnerApproval || step.executor === 'human' || step.executor === 'opencode') {
        assert.equal(step.autoExecute, false, step.id);
      }
    }
  }
  const news = si.workflow.describe('news').steps.map(step => step.id);
  assert.deepEqual(news, ['search', 'factcheck', 'script', 'video', 'qa', 'approval', 'publish', 'analytics']);
  const studio = si.workflow.describe('studio3d').steps.map(step => step.id);
  assert.deepEqual(studio, ['references', 'model', 'materials', 'animation', 'render', 'likeness', 'approval']);
  const games = si.workflow.describe('games').steps.map(step => step.id);
  assert.deepEqual(games, ['test', 'bug_found', 'fix', 'retest', 'approval']);
  assert.equal(si.workflow.describe('games').steps.find(step => step.id === 'fix').executor, 'opencode');
  assert.throws(() => si.workflow.run('news'), err => err.code === 'NOT_IMPLEMENTED');
  assert.throws(() => si.workflow.validatePipeline({
    id: 'news', namespace: 'moonkatty_news', title: 'Плохой',
    steps: [{ id: 'approval', agentId: 'owner', requiresOwnerApproval: true, autoExecute: true, executor: 'human' }]
  }), err => err.code === 'VALIDATION');
  si.close();
});

test('бренд сохраняет оригинал, проверка и решение ничего не исполняют', () => {
  const { si, owner, agent } = setup();
  const asset = si.brand.validateAsset({
    id: 'cat_original', kind: 'cat_image', namespace: 'moonkatty_shared', version: 1,
    filePath: 'brand/cat-original.png', approvedBy: 'igor',
    substitutionPolicy: 'owner_approval_required', autoExecute: false, locked: true
  });
  assert.equal(asset.locked, true);
  assert.throws(() => si.brand.validateAsset(Object.assign({}, asset, { locked: false })), err => err.code === 'VALIDATION');
  const check = si.brand.validateCheck({
    assetId: 'cat_original', action: 'substitute', candidate: { filePath: 'brand/cat-new.png' }
  });
  assert.equal(check.autoExecute, false);
  assert.equal(check.requiresOwnerApproval, true);
  const saved = si.brand.register({ principal: owner, asset });
  assert.equal(saved.reused, false);
  assert.equal(saved.asset.storagePath, 'brand/cat-original.png');
  assert.equal(saved.approval.autoExecute, false);
  assert.equal(saved.approval.status, 'approved');
  assert.throws(() => si.brand.check(check), err => err.code === 'NOT_IMPLEMENTED');
  assert.equal(si.assets.get({ principal: owner, id: saved.asset.id }).storagePath, 'brand/cat-original.png');
  assert.throws(() => si.brand.register({
    principal: owner,
    asset: Object.assign({}, asset, { id: 'cat_other', filePath: 'brand/cat-other.png' })
  }), err => err.code === 'IDEMPOTENCY_CONFLICT');
  const request = si.approval.validateRequest({
    id: 'ap1', namespace: 'moonkatty_project', subjectType: 'brand_substitution', subjectId: 'cat_original',
    requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'director',
    requestedAt: '2026-10-20T12:00:00.000Z'
  });
  assert.equal(request.autoExecute, false);
  const pending = si.approval.request({ principal: agent('director'), request });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.autoExecute, false);
  assert.throws(() => si.approval.decide({ principal: agent('director'), approvalId: 'ap1', action: 'approved' }), err => err.code === 'PERMISSION_DENIED');
  const decided = si.approval.decide({ principal: owner, approvalId: 'ap1', action: 'rejected', comment: 'подмена не нужна' });
  assert.equal(decided.executed, false);
  assert.equal(decided.approval.status, 'rejected');
  assert.equal(decided.approval.autoExecute, false);
  assert.equal(decided.event.action, 'rejected');
  const again = si.approval.decide({ principal: owner, approvalId: 'ap1', action: 'rejected' });
  assert.equal(again.executed, false);
  assert.equal(again.approval.status, 'rejected');
  const event = si.approval.validateEvent({
    id: 'ev1', approvalId: 'ap1', at: '2026-10-20T12:00:00.000Z', action: 'approved',
    actorId: 'igor', actorRole: 'owner', prevStatus: 'pending', nextStatus: 'approved'
  });
  assert.equal(event.action, 'approved');
  assert.throws(() => si.approval.validateEvent(Object.assign({}, event, { id: 'ev2', actorRole: 'agent' })), err => err.code === 'VALIDATION');
  assert.equal(si.permissions.checkPermission(owner, 'approve', { namespace: 'moonkatty_project' }).allowed, true);
  const names = si.tableNames();
  assert.ok(names.includes('si_approvals'));
  assert.ok(names.includes('si_approval_events'));
  assert.ok(names.includes('si_assets'));
  assert.ok(!names.includes('items'));
  assert.ok(!names.some(name => name.includes('workflow')));
  assert.ok(names.every(name => name.startsWith('si_')));
  const row = si.db.prepare('SELECT auto_execute, status FROM si_approvals WHERE id = ?').get('ap1');
  assert.equal(row.auto_execute, 0);
  assert.equal(row.status, 'rejected');
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM si_approval_events WHERE approval_id = ?').get('ap1').n, 2);
  si.close();
});

test('сессия отображается без проверки пароля и без приёма секрета', () => {
  const { si } = setup();
  const principal = si.auth.principalFromSession({ user: 'igor', exp: Date.now() + 1000 });
  assert.deepEqual(principal, { id: 'igor', role: 'owner', user: 'igor' });
  const asNews = si.auth.principalFromSession({ user: 'igor', exp: Date.now() + 1000 }, { agentId: 'news' });
  assert.equal(asNews.role, 'agent');
  assert.equal(asNews.agentId, 'news');
  assert.equal(si.auth.principalFromSession({ user: 'igor', exp: Date.now() - 1000 }), null);
  assert.throws(() => si.auth.principalFromSession({ user: 'igor', password: 'secret' }), err => err.code === 'SECRET_REJECTED');
  assert.equal(si.permissions.checkPermission(asNews, 'read', { namespace: 'moonkatty_project' }).allowed, false);
  assert.equal(si.permissions.checkPermission(asNews, 'cancel', { namespace: 'moonkatty_news', agentId: 'video' }).allowed, false);
  const envelope = si.contracts.envelope({
    type: 'studio.memory.written', principal, namespace: 'moonkatty_project', payload: { recordId: 'abc' },
    at: '2026-10-20T12:00:00.000Z', id: 'env1'
  });
  assert.equal(envelope.actor.role, 'owner');
  assert.throws(() => openWithoutDb(), err => err.code === 'VALIDATION');
  si.close();
});

function openWithoutDb() {
  const { openStudioIntelligence } = require('../src');
  return openStudioIntelligence();
}
