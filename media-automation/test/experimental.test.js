'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const { tmp } = require('./helpers');
const X = require('../src/experimental'); const { applyMajorEventPolicy, CorrectionsDesk } = require('../src/editorial');
const { defaultAdapters, Publisher, DEFAULT_ACCOUNTS } = require('../src/publish'); const { defaultAnalyticsAdapters } = require('../src/analytics');
const { Scheduler } = require('../src/schedule'); const { ApprovalCenter } = require('../src/approval/center');
const { createReadApi } = require('../src/platforms/read-api'); const { liveMode } = require('../src/platforms/registry');
const { createVideoRenderExecutor } = require('../src/jobs');
const big = { breaking: true, corroboration: 'confirmed', headline: 'H', verification: { independentOrigins: 5 } };
const noNet = () => { throw new Error('network'); };

test('flag: default OFF; MA_EXPERIMENTAL=1 or config experimental:true turns it on', () => {
  assert.equal(X.experimentalEnabled({ env: {}, config: {} }), false);
  assert.equal(X.experimentalEnabled({ env: { MA_EXPERIMENTAL: '1' } }), true); assert.equal(X.experimentalEnabled({ env: { MA_EXPERIMENTAL: 'yes' }, config: {} }), false);
  assert.equal(X.experimentalEnabled({ env: {}, config: { experimental: true } }), true);
  const off = X.moduleStatus({ env: {}, config: {} }); assert.equal(off.length, 6); assert.ok(off.every(m => !m.enabled && m.reason === 'experimental'));
  const on = X.moduleStatus({ env: { MA_EXPERIMENTAL: '1' } }); assert.equal(on.find(m => m.id === 'x_adapter').enabled, true); assert.equal(on.find(m => m.id === 'brand_memory').reason, 'not implemented');
});
test('OFF: experimental modules inert / not registered', () => {
  const env = {}; const config = {};
  const sch = new Scheduler({ statePath: path.join(tmp(), 's.json') }); assert.equal(applyMajorEventPolicy({ stories: [big], scheduler: sch, env, experimental: undefined }), null); assert.equal(sch.settings().paused, false);
  assert.throws(() => new CorrectionsDesk({ statePath: path.join(tmp(), 'c.json'), experimental: false }), e => e.code === 'EXPERIMENTAL_DISABLED' && e.reason === 'experimental');
  const ad = defaultAdapters({ fetchFn: noNet, experimental: false }); assert.deepEqual(Object.keys(ad).sort(), ['facebook', 'instagram', 'tiktok', 'youtube']);
  assert.deepEqual(Object.keys(defaultAnalyticsAdapters({ experimental: false })).sort(), ['facebook', 'instagram', 'tiktok', 'youtube']);
  const api = createReadApi({ env, experimental: false }); const ps = api.getPlatforms();
  for (const id of ['x', 'telegram']) { const p = ps.find(x => x.id === id); assert.equal(p.enabled, false); assert.equal(p.disabledReason, 'experimental'); }
  for (const id of ['youtube-news', 'instagram', 'facebook', 'tiktok']) assert.equal(ps.find(x => x.id === id).enabled, true);
  assert.equal(liveMode('x', { liveFlags: { x: true }, experimental: false }).reason, 'experimental');
});
test('OFF: dry-run for YouTube/FB/IG, Approval Center and video_render unaffected', async () => {
  const pub = new Publisher({ statePath: path.join(tmp(), 'p.json'), adapters: defaultAdapters({ fetchFn: noNet, experimental: false }), accounts: DEFAULT_ACCOUNTS, env: {} });
  const fs = require('fs'); const v = path.join(tmp(), 'v.mp4'); fs.writeFileSync(v, Buffer.alloc(10));
  pub.enqueue({ accountId: 'youtube-news', contentId: 'c1', payload: { videoPath: v, title: 'T' }, content: { reviewStatus: 'approved' } });
  pub.enqueue({ accountId: 'facebook-news', contentId: 'c1', payload: { targetId: 'PG', videoUrl: 'https://e/x.mp4', caption: 'c' }, content: { reviewStatus: 'approved' } });
  pub.enqueue({ accountId: 'instagram-news', contentId: 'c1', payload: { targetId: 'IG', videoUrl: 'https://e/x.mp4', caption: 'c' }, content: { reviewStatus: 'approved' } });
  assert.throws(() => pub.enqueue({ accountId: 'x-news', contentId: 'c1', payload: { text: 'x' } }), /no adapter/);
  const out = await pub.processDue(); assert.equal(out.length, 3); assert.ok(out.every(p => p.status === 'dry_run'));
  const ac = new ApprovalCenter({ statePath: path.join(tmp(), 'a.json') }); const it = ac.submit({ title: 'T' }); await ac.approve(it.id, 'Igor'); assert.equal(ac.get(it.id).status, 'approved');
  assert.equal(typeof createVideoRenderExecutor({ dataDir: tmp(), factory: { render() {} } }), 'function');
});
test('ON: modules registered and active', () => {
  const env = { MA_EXPERIMENTAL: '1' };
  const sch = new Scheduler({ statePath: path.join(tmp(), 's.json') }); applyMajorEventPolicy({ stories: [big], scheduler: sch, env }); assert.equal(sch.settings().paused, true);
  assert.ok(new CorrectionsDesk({ statePath: path.join(tmp(), 'c.json'), env }));
  assert.ok(defaultAdapters({ fetchFn: noNet, env }).x && defaultAdapters({ fetchFn: noNet, env }).telegram); assert.ok(defaultAnalyticsAdapters({ env }).telegram);
  const ps = createReadApi({ env }).getPlatforms(); assert.equal(ps.find(p => p.id === 'x').enabled, true); assert.equal(ps.find(p => p.id === 'moonkatty-web').disabledReason, 'not implemented');
});
