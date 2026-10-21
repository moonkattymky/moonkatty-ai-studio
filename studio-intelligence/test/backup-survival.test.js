'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStudioIntelligence } = require('../src');
const { panelCollectionDump, panelCollectionRestore, siTableNames } = require('../src/si-export');

function counts(db) {
  const out = {};
  for (const name of siTableNames(db)) {
    out[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  }
  return out;
}

function voice(db) {
  return db.prepare(`
    SELECT voice_profile_id, status, engine, voice, model_sha256, voices_sha256, mouth_scale
    FROM si_voice_profiles
  `).get();
}

test('JSON панели не сохраняет si_*, снимок VACUUM INTO и копия закрытого файла сохраняют', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-backup-'));
  const srcPath = path.join(dir, 'studio.db');
  const snapPath = path.join(dir, 'snapshot.db');
  const copyPath = path.join(dir, 'file-copy.db');
  const jsonPath = path.join(dir, 'from-json.db');
  const hookPath = path.join(dir, 'from-si-export.db');
  const owner = { id: 'igor', role: 'owner', user: 'igor' };
  const si = openStudioIntelligence({ dbPath: srcPath, now: () => '2026-10-21T12:00:00.000Z' });
  si.db.exec('CREATE TABLE IF NOT EXISTS items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id))');
  si.db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run(
    'workspaces', 'main', JSON.stringify({ id: 'main', name: 'Main' })
  );
  si.voices.define({
    principal: owner,
    profile: {
      voiceProfileId: 'MOONKATTY_NEWS_MASTER_VOICE',
      label: 'MOONKATTY NEWS anchor',
      note: null,
      sampleAssetId: null,
      sampleRate: 48000,
      recognizer: 'tts-timing',
      gain: 1,
      mouthScale: 1,
      engine: 'kokoro',
      voice: 'am_fenrir',
      speed: 1,
      pitchShift: 0,
      modelSha256: 'a'.repeat(64),
      voicesSha256: 'b'.repeat(64)
    }
  });
  const before = counts(si.db);
  const voiceBefore = voice(si.db);
  assert.equal(voiceBefore.voice_profile_id, 'MOONKATTY_NEWS_MASTER_VOICE');
  assert.equal(voiceBefore.status, 'draft');
  assert.equal(before.si_voice_profiles, 1);
  const dumped = panelCollectionDump(si.db);
  assert.equal(JSON.stringify(dumped).includes('si_voice_profiles'), false);
  assert.equal(JSON.stringify(dumped).includes('MOONKATTY_NEWS_MASTER_VOICE'), false);
  assert.equal(dumped.data.workspaces.length, 1);
  assert.equal(dumped.si, undefined);
  const exported = si.persistence.exportSi();
  assert.equal(exported.tables.si_voice_profiles.length, 1);
  si.persistence.snapshot(snapPath);
  si.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  si.close();
  fs.copyFileSync(srcPath, copyPath);

  const snap = openStudioIntelligence({ dbPath: snapPath });
  assert.deepEqual(counts(snap.db), before);
  assert.deepEqual(voice(snap.db), voiceBefore);
  assert.equal(snap.db.prepare(`SELECT data FROM items WHERE col = 'workspaces' AND id = 'main'`).get().data.includes('Main'), true);
  snap.close();

  const copied = openStudioIntelligence({ dbPath: copyPath });
  assert.deepEqual(counts(copied.db), before);
  assert.deepEqual(voice(copied.db), voiceBefore);
  copied.close();

  const restored = openStudioIntelligence({ dbPath: jsonPath });
  panelCollectionRestore(restored.db, dumped);
  assert.equal(voice(restored.db), undefined);
  assert.equal(counts(restored.db).si_voice_profiles, 0);
  const workspace = restored.db.prepare(`SELECT data FROM items WHERE id = 'main'`).get();
  assert.equal(JSON.parse(workspace.data).name, 'Main');
  restored.close();

  const hooked = openStudioIntelligence({ dbPath: hookPath });
  hooked.persistence.importSi(exported);
  assert.deepEqual(voice(hooked.db), voiceBefore);
  assert.equal(hooked.db.prepare("SELECT name FROM sqlite_master WHERE name = 'items'").get(), undefined);
  hooked.close();
});
