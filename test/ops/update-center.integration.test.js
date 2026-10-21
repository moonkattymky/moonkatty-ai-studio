'use strict';
// v1.3.0-test: real server (temp data dir, STUDIO_FLAVOR=test source checkout) with STUDIO_OPS_UPDATE=1: routes only when the flag is set,
// auth + CSRF required, BLOCKED signature status, auto-install off, owner-password step-up, real pre-update backup. No GitHub calls.
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer } = require('../helpers/uc-server.js');
test('Update Center API (v1.3.0-test): off by default, auth+CSRF, BLOCKED without owner key, password step-up, verified backup', async () => {
  const off = await startServer({ port: 18931 });
  try { assert.equal((await off.j('GET', '/api/ops/update-center')).status, 404, 'not mounted without STUDIO_OPS_UPDATE=1'); } finally { await off.cleanup(); }
  const s = await startServer({ port: 18932, env: { STUDIO_OPS_UPDATE: '1' } });
  try {
    assert.equal((await s.j('GET', '/api/ops/update-center', s.R)).status, 401);
    assert.equal((await s.j('POST', '/api/ops/update-center/check', { cookie: s.A.cookie, 'content-type': 'application/json' }, {})).status, 403, 'CSRF header required');
    const st = (await s.j('GET', '/api/ops/update-center')).body;
    assert.equal(st.current, require('../../package.json').version); assert.equal(st.identity.flavor, 'test'); assert.equal(st.identity.bundleId, 'com.moonkatty.aistudio.test'); assert.equal(st.identity.known, true, JSON.stringify(st.identity.problems));
    assert.equal(st.signature.state, 'BLOCKED'); assert.equal(st.signature.message, 'BLOCKED: нет публичного ключа владельца'); assert.equal(st.keyring.prod.keys.length, 0);
    assert.equal(st.autoInstall.enabled, false); assert.equal(st.autoInstall.missing.length, 4); assert.equal(st.schema.ok, true, JSON.stringify(st.schema));
    assert.equal((await s.j('POST', '/api/ops/update-center/..%2F..%2Fetc/download', s.A, {})).status, 400);
    assert.equal((await s.j('GET', '/api/ops/update-center/v9.9.9/plan')).status, 404);
    const b = await s.j('POST', '/api/ops/update-center/backup', s.A, {}); assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.verified, true, JSON.stringify(b.body));
    assert.equal((await s.j('POST', '/api/ops/update-center/v1.3.1-test/approve', s.A, { password: 'wrong' })).status, 403);
    assert.equal((await s.j('POST', '/api/ops/update-center/v1.3.1-test/auto-install', s.A, { password: 'wrong' })).status, 403, 'auto-install needs owner password');
    const ai = await s.j('POST', '/api/ops/update-center/v1.3.1-test/auto-install', s.A, { password: 'fake-password-123' }); assert.equal(ai.status, 400); assert.equal(ai.body.code, 'AUTO_INSTALL_DISABLED');
    assert.equal((await s.j('POST', '/api/ops/update-center/rollback', s.A, {})).body.dryRun, true);
    assert.equal((await s.j('GET', '/api/ops/update-center/health')).body.ok, true);
  } finally { await s.cleanup(); }
});
