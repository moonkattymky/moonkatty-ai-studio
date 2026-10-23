// Composes quick / full / startup / periodic / hourly runs.
'use strict';
const host = require('./host');
const db = require('./db');
const files = require('./files');
const ollama = require('./ollama');
const opencode = require('./opencode');
const blender = require('./blender');
const tailscale = require('./tailscale');
const { alertsFrom } = require('../schedule');

async function startup(ctx) {
  const t0 = Date.now();
  const checks = await host.quick(ctx);
  checks.push(db.quickCheck(ctx));
  const ports = checks.find(c => c.id === 'ports');
  const presence = {
    ollama: await ollama.tags({ timeoutMs: 800 }),
    opencodePort: ((ports && ports.data.ports) || []).find(p => p.port === 4097) || null,
    blender: blender.candidates().length > 0
  };
  return { kind: 'startup', ms: Date.now() - t0, checks, presence, heavy: false };
}

async function periodic(ctx) {
  const t0 = Date.now();
  const checks = await Promise.all([host.memory(ctx), host.swap(ctx), host.disk(ctx), host.cpu(ctx), host.ports(ctx), host.processes(ctx)]);
  return { kind: 'periodic', ms: Date.now() - t0, checks, alerts: alertsFrom(checks) };
}

async function hourly(ctx) {
  const checks = [
    db.quickCheck(ctx),
    await ollama.tags({ timeoutMs: 3000 }).then(t => ({ id: 'ollama.tags', status: t.status, summary: t.status === 'OK' ? 'модель на месте' : (t.error || 'модели нет'), data: { models: t.models || [] } })),
    await opencode.check({ healthOnly: true, env: ctx.env || process.env }),
    await tailscale.check(ctx)
  ];
  return { kind: 'hourly', checks, alerts: alertsFrom(checks) };
}

async function quick(ctx) {
  const checks = await host.quick(ctx);
  return { kind: 'quick', checks, alerts: alertsFrom(checks) };
}

async function full(ctx) {
  const heavy = ctx.heavy || require('../../../heavy-lock');
  const run = async () => {
    const checks = [];
    checks.push(...await host.quick(ctx));
    checks.push(await host.temperature());
    checks.push(await host.processes(ctx));
    checks.push(await host.logs(ctx));
    checks.push(db.quickCheck(ctx));
    checks.push(db.integrityCopy({ ...ctx, snapshot: ctx.snapshot || require('../../../db-backup').snapshot }));
    checks.push(files.verify(ctx.root || require('path').join(__dirname, '..', '..', '..', '..'), ctx.fileManifest || null));
    checks.push(files.codesign());
    checks.push(await ollama.generate({ skipLock: true, timeoutMs: ctx.ollamaTimeoutMs || 120000 }));
    checks.push(await opencode.check({ env: ctx.env || process.env }));
    checks.push(await blender.check({ blender: ctx.blender }));
    checks.push(await tailscale.check(ctx));
    return { kind: 'full', checks, alerts: alertsFrom(checks) };
  };
  if (ctx.skipLock) return run();
  return heavy.withHeavy('system-doctor:full', run);
}

module.exports = { startup, periodic, hourly, quick, full };
