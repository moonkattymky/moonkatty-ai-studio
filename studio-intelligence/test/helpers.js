'use strict';
const assert = require('node:assert/strict');
const { openStudioIntelligence } = require('../src');

function setup() {
  const si = openStudioIntelligence({
    dbPath: ':memory:',
    now: () => '2026-10-20T12:00:00.000Z'
  });
  const owner = { id: 'igor', role: 'owner', user: 'igor' };
  const agent = agentId => ({ id: agentId, role: 'agent', agentId, user: 'igor' });
  return { si, owner, agent };
}

function decision(extra = {}) {
  return Object.assign({
    namespace: 'moonkatty_project',
    kind: 'decision',
    title: 'Мастер-модель кота MOONKATTY не подменяется',
    body: 'Оригинал кота остаётся утверждённым эталоном бренда.',
    status: 'approved',
    idempotencyKey: 'decision/brand/original-cat',
    payload: { topic: 'brand' }
  }, extra);
}

module.exports = { setup, decision, assert };
