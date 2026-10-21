'use strict';
// Real server (temp data dir) with STUDIO_OPS_UPDATE=1 + BACKUP: auth, flag-off, input validation, real pre-update backup. No GitHub calls.
const test = require('node:test'); const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server.js');
test('Update Center API: off by default, auth required, real verified backup, no install without download', async () => {
  const off = await startServer({ port: 18931 });
  try { assert.equal((await off.j('GET', '/api/ops/status')).body.flags.update, false); assert.equal((await off.j('GET', '/api/ops/update-center')).status, 404); } finally { await off.cleanup(); }
  const s = await startServer({ port: 18932, env: { STUDIO_OPS_UPDATE: '1', STUDIO_OPS_BACKUP: '1' } });
  try {
    assert.equal((await s.j('GET', '/api/ops/update-center', s.R)).status, 401);
    const st = (await s.j('GET', '/api/ops/update-center')).body; assert.equal(st.current, require('../../package.json').version); assert.equal(st.keysLoaded, 0, 'prod set empty until owner adds a real key'); assert.equal(st.identity.flavor, 'prod'); assert.equal(st.identity.known, true); assert.equal(st.keyring.test.stubOnly, true); assert.equal(st.autoInstall.enabled, false); assert.equal(st.nodeUpdates, false);
    assert.equal((await s.j('POST', '/api/ops/update-center/..%2F..%2Fetc/download', s.A, {})).status, 400);
    assert.equal((await s.j('GET', '/api/ops/update-center/v9.9.9/plan')).status, 404);
    const b = await s.j('POST', '/api/ops/update-center/backup', s.A, {}); assert.equal(b.status, 200); assert.equal(b.body.verified, true, JSON.stringify(b.body));
    assert.equal((await s.j('POST', '/api/ops/update-center/v1.2.1/approve', s.A, { password: 'wrong' })).status, 403);
    assert.equal((await s.j('POST', '/api/ops/update-center/rollback', s.A, {})).body.dryRun, true);
    assert.equal((await s.j('GET', '/api/ops/update-center/health')).body.ok, true);
  } finally { await s.cleanup(); }
});
