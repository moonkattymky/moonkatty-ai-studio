// SQLite integrity on a copy (or on an already-isolated test file). Never runs
// integrity_check as a way to mutate the live file.
'use strict';
const fs = require('fs'), path = require('path');
const { makeTemp } = require('../paths');

function firstValue(row) {
  if (!row || typeof row !== 'object') return String(row ?? '');
  const v = Object.values(row)[0];
  return v == null ? '' : String(v);
}

function checkFile(openDb, file, pragma) {
  const db = openDb(file);
  try {
    const row = db.prepare(`PRAGMA ${pragma}`).get();
    const integrity = firstValue(row);
    return { ok: integrity === 'ok', integrity };
  } finally { try { db.close(); } catch { /* already closed */ } }
}

function quickCheck(ctx) {
  try {
    if (!ctx.db) return { id: 'db.quick', status: 'BLOCKED', summary: 'База не открыта', data: {} };
    const integrity = firstValue(ctx.db.prepare('PRAGMA quick_check').get());
    return { id: 'db.quick', status: integrity === 'ok' ? 'OK' : 'FAIL', summary: integrity === 'ok' ? 'quick_check ok' : integrity.slice(0, 180), data: { integrity } };
  } catch (e) {
    return { id: 'db.quick', status: 'FAIL', summary: e.message, data: {} };
  }
}

function integrityOn(openDb, file) {
  try {
    const r = checkFile(openDb, file, 'integrity_check');
    return { id: 'db.integrity', status: r.ok ? 'OK' : 'FAIL', summary: r.ok ? 'integrity_check ok' : String(r.integrity).slice(0, 300), data: r };
  } catch (e) {
    return { id: 'db.integrity', status: 'FAIL', summary: 'Файл базы не читается: ' + e.message, data: { error: e.message } };
  }
}

function integrityCopy(ctx) {
  const openDb = ctx.openDb;
  const src = ctx.dbPath;
  if (!openDb || !src || !fs.existsSync(src)) return { id: 'db.integrity', status: 'BLOCKED', summary: 'Нет файла базы для копии', data: {} };
  if (ctx.db && typeof ctx.snapshot === 'function') {
    const dir = makeTemp();
    try {
      const snap = ctx.snapshot(ctx.db, dir, 'sd-integrity');
      return integrityOn(openDb, snap.file);
    } catch (e) {
      return { id: 'db.integrity', status: 'FAIL', summary: e.message, data: {} };
    }
  }
  const dir = makeTemp();
  const dest = path.join(dir, 'copy.db');
  try { fs.copyFileSync(src, dest); } catch (e) { return { id: 'db.integrity', status: 'FAIL', summary: e.message, data: {} }; }
  return integrityOn(openDb, dest);
}

module.exports = { quickCheck, integrityCopy, integrityOn, checkFile };
