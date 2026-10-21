'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setup } = require('./helpers');
const { openDatabase, migrate } = require('../src/sqlite');
const { importMasterVoiceDraft } = require('../src/master-voice');

const EXPORT_COMMIT = '551f36189935588a9d318ed02df6c19eacf20091';
const ROOT = path.join(__dirname, '..', '..');
const MODEL_SHA = '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5';
const VOICES_SHA = 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d';

function studio2Export() {
  const text = execFileSync('git', ['show', EXPORT_COMMIT + ':docs/media-automation/exports/master-voice.studio5.json'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return JSON.parse(text);
}

test('старая таблица голоса получает колонки студии 2 и не теряет строку', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-voice-mig-'));
  const db = openDatabase(path.join(dir, 'studio.db'));
  db.exec(`CREATE TABLE si_voice_profiles (
    voice_profile_id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    label TEXT NOT NULL,
    note TEXT,
    sample_asset_id TEXT,
    status TEXT NOT NULL,
    defined_by TEXT NOT NULL,
    defined_at TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    sample_rate INTEGER,
    recognizer TEXT,
    gain REAL,
    mouth_scale REAL
  )`);
  db.prepare(`INSERT INTO si_voice_profiles (
    voice_profile_id, namespace, label, note, sample_asset_id, status, defined_by, defined_at, approved_by, approved_at,
    sample_rate, recognizer, gain, mouth_scale
  ) VALUES ('old_voice', 'moonkatty_news', 'старый', NULL, NULL, 'draft', 'video', '2026-10-20T12:00:00.000Z', NULL, NULL, 16000, 'phonetic', 1, 1)`).run();
  migrate(db);
  const cols = db.prepare('PRAGMA table_info(si_voice_profiles)').all().map(col => col.name);
  for (const name of ['engine', 'voice', 'speed', 'pitch_shift', 'model_sha256', 'voices_sha256', 'sample_rate']) {
    assert.ok(cols.includes(name), name);
  }
  const row = db.prepare('SELECT label, sample_rate, engine, model_sha256 FROM si_voice_profiles WHERE voice_profile_id = ?').get('old_voice');
  assert.equal(row.label, 'старый');
  assert.equal(row.sample_rate, 16000);
  assert.equal(row.engine, null);
  assert.equal(row.model_sha256, null);
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM si_voice_profiles').get().n, 1);
  db.close();
});

test('профиль голоса читается обратно, плохой хеш отвергается, утверждает только владелец', () => {
  const { si, owner, agent } = setup();
  const defined = si.voices.define({
    principal: agent('video'),
    profile: {
      voiceProfileId: 'anchor_round',
      label: 'Круг',
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
      modelSha256: MODEL_SHA,
      voicesSha256: VOICES_SHA
    }
  });
  assert.equal(defined.status, 'draft');
  assert.equal(defined.approved, false);
  assert.equal(defined.engine, 'kokoro');
  assert.equal(defined.voice, 'am_fenrir');
  assert.equal(defined.speed, 1);
  assert.equal(defined.pitchShift, 0);
  assert.equal(defined.modelSha256, MODEL_SHA);
  assert.equal(defined.voicesSha256, VOICES_SHA);
  assert.throws(
    () => si.voices.define({
      principal: owner,
      profile: {
        voiceProfileId: 'bad_hash', label: 'Плохой', note: null, sampleAssetId: null,
        modelSha256: 'abc', voicesSha256: null
      }
    }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.voices.define({
      principal: owner,
      profile: {
        voiceProfileId: 'bad_pack', label: 'Плохой пакет', note: null, sampleAssetId: null,
        voicesSha256: 'g'.repeat(64)
      }
    }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.voices.approve({ principal: agent('video'), voiceProfileId: 'anchor_round' }),
    err => err.code === 'PERMISSION_DENIED'
  );
  const approved = si.voices.approve({ principal: owner, voiceProfileId: 'anchor_round' });
  assert.equal(approved.executed, false);
  assert.equal(approved.profile.status, 'approved');
  const studio = si.voices.forStudio({ principal: agent('video') });
  assert.equal(studio.approved, true);
  assert.equal(studio.id, 'anchor_round');
  assert.equal(studio.engine, 'kokoro');
  assert.equal(studio.voice, 'am_fenrir');
  assert.equal(studio.speed, 1);
  assert.equal(studio.pitchShift, 0);
  assert.equal(studio.sampleRate, 48000);
  assert.equal(studio.recognizer, 'tts-timing');
  assert.equal(studio.modelSha256, MODEL_SHA);
  assert.equal(studio.voicesSha256, VOICES_SHA);
  si.close();
});

test('импорт MOONKATTY_NEWS_MASTER_VOICE из экспорта 551f361 создаёт только черновик', () => {
  const record = studio2Export();
  assert.equal(record.engine.model.sha256, MODEL_SHA);
  assert.equal(record.engine.voicesPack.sha256, VOICES_SHA);
  assert.equal(record.status, 'locked');
  const { si, owner, agent } = setup();
  const imported = importMasterVoiceDraft(si.voices, { principal: agent('video'), record });
  assert.equal(imported.executed, false);
  assert.equal(imported.profile.voiceProfileId, 'MOONKATTY_NEWS_MASTER_VOICE');
  assert.equal(imported.profile.status, 'draft');
  assert.equal(imported.profile.approved, false);
  assert.equal(imported.profile.approvedBy, null);
  assert.equal(imported.profile.engine, 'kokoro');
  assert.equal(imported.profile.voice, 'am_fenrir');
  assert.equal(imported.profile.speed, 1);
  assert.equal(imported.profile.pitchShift, 0);
  assert.equal(imported.profile.sampleRate, 48000);
  assert.equal(imported.profile.recognizer, 'tts-timing');
  assert.equal(imported.profile.gain, 1);
  assert.equal(imported.profile.mouthScale, 1);
  assert.equal(imported.profile.modelSha256, MODEL_SHA);
  assert.equal(imported.profile.voicesSha256, VOICES_SHA);
  const again = importMasterVoiceDraft(si.voices, { principal: agent('video'), record });
  assert.equal(again.profile.status, 'draft');
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM si_voice_profiles').get().n, 1);
  const approved = si.voices.approve({ principal: owner, voiceProfileId: 'MOONKATTY_NEWS_MASTER_VOICE' });
  assert.equal(approved.executed, false);
  assert.equal(approved.profile.approved, true);
  assert.equal(si.voices.forStudio({ principal: agent('video') }).voice, 'am_fenrir');
  si.close();
});

test('mouthScale принимается только в диапазоне 0.5–2.0', () => {
  const { si, owner } = setup();
  function profile(id, mouthScale) {
    return {
      voiceProfileId: id, label: id, note: null, sampleAssetId: null,
      sampleRate: 48000, recognizer: 'tts-timing', gain: 1, mouthScale
    };
  }
  assert.equal(si.voices.define({ principal: owner, profile: profile('scale_lo', 0.5) }).mouthScale, 0.5);
  assert.equal(si.voices.define({ principal: owner, profile: profile('scale_hi', 2) }).mouthScale, 2);
  assert.equal(si.voices.define({ principal: owner, profile: profile('scale_empty', null) }).mouthScale, null);
  assert.throws(
    () => si.voices.define({ principal: owner, profile: profile('scale_under', 0.4) }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.voices.define({ principal: owner, profile: profile('scale_over', 2.1) }),
    err => err.code === 'VALIDATION'
  );
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM si_voice_profiles').get().n, 3);
  si.close();
});

test('новое утверждение снимает предыдущее, снятый профиль снова не утверждается', () => {
  const { si, owner, agent } = setup();
  function profile(id) {
    return {
      voiceProfileId: id, label: id, note: null, sampleAssetId: null,
      sampleRate: 48000, recognizer: 'tts-timing', gain: 1, mouthScale: 1,
      engine: 'kokoro', voice: 'am_fenrir', speed: 1, pitchShift: 0,
      modelSha256: MODEL_SHA, voicesSha256: VOICES_SHA
    };
  }
  si.voices.define({ principal: agent('video'), profile: profile('voice_a') });
  si.voices.define({ principal: agent('video'), profile: profile('voice_b') });
  const first = si.voices.approve({ principal: owner, voiceProfileId: 'voice_a' });
  assert.equal(first.executed, false);
  assert.equal(first.profile.status, 'approved');
  assert.throws(
    () => si.voices.approve({ principal: agent('video'), voiceProfileId: 'voice_b' }),
    err => err.code === 'PERMISSION_DENIED'
  );
  const second = si.voices.approve({ principal: owner, voiceProfileId: 'voice_b' });
  assert.equal(second.executed, false);
  assert.equal(second.profile.status, 'approved');
  assert.equal(si.db.prepare(`SELECT status FROM si_voice_profiles WHERE voice_profile_id = 'voice_a'`).get().status, 'superseded');
  assert.throws(
    () => si.voices.approve({ principal: owner, voiceProfileId: 'voice_a' }),
    err => err.code === 'INVALID_STATE'
  );
  const again = si.voices.approve({ principal: owner, voiceProfileId: 'voice_b' });
  assert.equal(again.executed, false);
  assert.equal(again.profile.status, 'approved');
  assert.equal(si.voices.forStudio({ principal: agent('video') }).id, 'voice_b');
  si.close();
});
