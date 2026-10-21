'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path'); const fs = require('fs');
const express = require('express');
const { ApprovalCenter, createApprovalRouter } = require('../src/approval');
const { tmp } = require('./helpers');
const TOKEN = 'a'.repeat(16) + 'b'.repeat(16);

test('center: submit, edit resets approval, approve hook, send back, reject, history', async () => {
  const hooked = []; const c = new ApprovalCenter({ statePath: path.join(tmp(), 'a.json'), onApproved: it => hooked.push(it.id) });
  const it = c.submit({ id: 'v1', title: 'Ep', headline: 'Old headline' });
  await assert.rejects(c.approve('v1'), /reviewer/);
  await c.approve('v1', 'igor'); assert.deepEqual(hooked, ['v1']);
  c.edit('v1', { headline: 'New headline' }, 'igor'); assert.equal(c.get('v1').status, 'pending', 'edit invalidates approval');
  assert.throws(() => c.sendBack('v1', 'igor'), /note/); c.sendBack('v1', 'igor', 'shorter please'); assert.equal(c.get('v1').status, 'changes_requested');
  c.reject('v1', 'igor', 'off-topic'); await assert.rejects(c.approve('v1', 'igor'), /resubmitted/);
  assert.deepEqual(c.get('v1').history.map(h => h.action), ['submitted', 'approved', 'edited', 'sent_back', 'rejected']);
  assert.equal(c.get('v1').history[2].changes.headline.from, 'Old headline');
  assert.equal(c.submit({ id: 'v1', title: 'dup' }).title, 'Ep', 'idempotent submit');
  const c2 = new ApprovalCenter({ statePath: c.store.file }); assert.equal(c2.get('v1').status, 'rejected', 'persists across restart');
});

test('router: auth required, list/edit/approve, media with Range, path containment', async t => {
  const dir = tmp(); const media = path.join(dir, 'media'); fs.mkdirSync(media); const vid = path.join(media, 'v.mp4'); fs.writeFileSync(vid, Buffer.alloc(5000, 1));
  const outside = path.join(dir, 'secret.txt'); fs.writeFileSync(outside, 'nope');
  const c = new ApprovalCenter({ statePath: path.join(dir, 'a.json') });
  c.submit({ id: 'v1', title: 'Ep', headline: 'H', videoPath: vid }); c.submit({ id: 'bad', title: 'x', headline: 'x', videoPath: outside });
  assert.throws(() => createApprovalRouter({ center: c, token: 'short' }), /token/);
  const app = express(); app.use('/approval', createApprovalRouter({ center: c, token: TOKEN, mediaRoots: [media] }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r)); t.after(() => srv.close());
  const B = `http://127.0.0.1:${srv.address().port}/approval`; const auth = { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' };
  assert.equal((await fetch(B + '/api/items')).status, 401); assert.equal((await fetch(B + '/api/items', { headers: { authorization: 'Bearer ' + 'x'.repeat(32) } })).status, 401);
  const items = await (await fetch(B + '/api/items', { headers: auth })).json(); assert.equal(items.length, 2); assert.ok(!('videoPath' in items[0]) || items[0].videoPath === undefined);
  const page = await fetch(B + '/?token=' + TOKEN); assert.equal(page.status, 200); assert.match(await page.text(), /Approval Center/);
  let r = await fetch(B + '/api/items/v1/edit', { method: 'POST', headers: auth, body: JSON.stringify({ headline: 'Better', by: 'igor' }) }); assert.equal((await r.json()).headline, 'Better');
  r = await fetch(B + '/api/items/v1/approve', { method: 'POST', headers: auth, body: JSON.stringify({}) }); assert.equal(r.status, 400);
  r = await fetch(B + '/api/items/v1/approve', { method: 'POST', headers: auth, body: JSON.stringify({ by: 'igor' }) }); assert.equal((await r.json()).status, 'approved');
  r = await fetch(B + '/media/v1/video?token=' + TOKEN, { headers: { range: 'bytes=0-99' } }); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(B + '/media/bad/video?token=' + TOKEN)).status, 403);
  assert.equal((await fetch(B + '/media/v1/etc?token=' + TOKEN)).status, 404);
  assert.equal((await fetch(B + '/api/items/nope', { headers: auth })).status, 404);
  const h = await (await fetch(B + '/api/items/v1/history', { headers: auth })).json(); assert.deepEqual(h.map(x => x.action), ['submitted', 'edited', 'approved']);
});
