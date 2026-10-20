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

test('бренд и утверждение только проверяют форму и ничего не пишут', () => {
  const { si, owner } = setup();
  const before = si.tableNames();
  const asset = si.brand.validateAsset({
    id: 'cat_original', kind: 'cat_image', namespace: 'moonkatty_project', version: 1,
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
  assert.throws(() => si.brand.check(check), err => err.code === 'NOT_IMPLEMENTED');
  assert.throws(() => si.brand.register(asset), err => err.code === 'NOT_IMPLEMENTED');
  const request = si.approval.validateRequest({
    id: 'ap1', namespace: 'moonkatty_project', subjectType: 'brand_substitution', subjectId: 'cat_original',
    requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'director',
    requestedAt: '2026-10-20T12:00:00.000Z'
  });
  assert.equal(request.autoExecute, false);
  assert.throws(() => si.approval.request(request), err => err.code === 'NOT_IMPLEMENTED');
  assert.throws(() => si.approval.decide({ id: 'ap1', action: 'approved' }), err => err.code === 'NOT_IMPLEMENTED');
  const event = si.approval.validateEvent({
    id: 'ev1', approvalId: 'ap1', at: '2026-10-20T12:00:00.000Z', action: 'approved',
    actorId: 'igor', actorRole: 'owner', prevStatus: 'pending', nextStatus: 'approved'
  });
  assert.equal(event.action, 'approved');
  assert.throws(() => si.approval.validateEvent(Object.assign({}, event, { id: 'ev2', actorRole: 'agent' })), err => err.code === 'VALIDATION');
  assert.equal(si.permissions.checkPermission(owner, 'approve', { namespace: 'moonkatty_project' }).allowed, true);
  assert.deepEqual(si.tableNames(), before);
  assert.ok(si.tableNames().every(name => name.startsWith('si_')));
  assert.ok(!si.tableNames().some(name => /approval|brand|workflow/.test(name)));
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
