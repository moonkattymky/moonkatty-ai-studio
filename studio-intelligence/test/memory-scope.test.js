'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup } = require('./helpers');
const { createCappedPanelLog } = require('../src/audit-feed');

test('новости и проект не смешиваются, общее читают оба, редактор выключен', () => {
  const { si, owner, agent } = setup();
  const project = si.memory.put({
    principal: owner,
    record: {
      namespace: 'moonkatty_project', kind: 'decision', title: 'Сборка игры', body: 'Только проект.',
      status: 'approved', idempotencyKey: 'decision/games/1', payload: {}
    }
  });
  assert.throws(() => si.memory.get({ principal: agent('news'), id: project.id }), err => err.code === 'NOT_FOUND');
  assert.equal(si.permissions.checkPermission(agent('news'), 'read', { namespace: 'moonkatty_shared' }).allowed, true);
  assert.equal(si.permissions.checkPermission(agent('news'), 'write', { namespace: 'moonkatty_shared', agentId: 'news' }).allowed, false);
  assert.equal(si.permissions.checkPermission(agent('design3d'), 'write', { namespace: 'moonkatty_shared', agentId: 'design3d' }).allowed, true);
  const editor = { id: 'editor1', role: 'editor', user: 'igor' };
  assert.equal(si.permissions.checkPermission(editor, 'approve', { namespace: 'moonkatty_news' }).allowed, false);
  assert.match(si.permissions.checkPermission(editor, 'read', { namespace: 'moonkatty_news' }).reason, /выключена/);
  assert.throws(() => si.runtime.handoff({
    principal: owner,
    task: {
      id: 'shared1', idempotencyKey: 'shared/task/1', namespace: 'moonkatty_shared', agentId: 'director',
      title: 'Общее', description: '', priority: 'normal', dependsOn: [], executor: 'runtime',
      requiresOwnerApproval: false, files: []
    }
  }), err => err.code === 'VALIDATION');
  si.close();
});

test('агент рекомендует и возвращает, итог ставит только владелец', () => {
  const { si, owner, agent } = setup();
  si.approval.request({
    principal: agent('news'),
    request: {
      id: 'ap-pub', namespace: 'moonkatty_news', subjectType: 'publication', subjectId: 'ep9',
      requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'news',
      requestedAt: '2026-10-20T12:00:00.000Z'
    }
  });
  const recommended = si.approval.advise({ principal: agent('news'), approvalId: 'ap-pub', action: 'recommended', comment: 'можно выпускать' });
  assert.equal(recommended.executed, false);
  assert.equal(recommended.approval.status, 'recommended');
  const back = si.approval.advise({ principal: agent('director'), approvalId: 'ap-pub', action: 'rework', comment: 'поправить заголовок' });
  assert.equal(back.approval.status, 'rework');
  assert.throws(() => si.approval.decide({ principal: owner, approvalId: 'ap-pub', action: 'approved' }), err => err.code === 'INVALID_STATE');
  si.approval.advise({ principal: agent('news'), approvalId: 'ap-pub', action: 'resubmitted' });
  const decided = si.approval.decide({ principal: owner, approvalId: 'ap-pub', action: 'approved', comment: 'Игорь' });
  assert.equal(decided.executed, false);
  assert.equal(decided.approval.autoExecute, false);
  assert.equal(si.db.prepare('SELECT auto_execute FROM si_approvals WHERE id = ?').get('ap-pub').auto_execute, 0);
  si.close();
});

test('библиотека ищет, связывает задачи и не стирает актив со ссылками', () => {
  const { si, owner, agent } = setup();
  const hash = 'd'.repeat(64);
  const first = si.assets.register({
    principal: agent('news'),
    asset: { namespace: 'moonkatty_news', kind: 'image', title: 'Кадр города', idempotencyKey: 'news/img/1', contentHash: hash, storagePath: 'files/city.png' }
  });
  const again = si.assets.register({
    principal: agent('video'),
    asset: { namespace: 'moonkatty_news', kind: 'image', title: 'Другое имя', idempotencyKey: 'news/img/2', contentHash: hash }
  });
  assert.equal(again.reused, true);
  assert.equal(again.asset.id, first.asset.id);
  const found = si.assets.search({ principal: agent('news'), namespace: 'moonkatty_news', text: 'города' });
  assert.equal(found.length, 1);
  const link = si.assets.linkTask({ principal: agent('news'), assetId: first.asset.id, taskId: 'task-city', namespace: 'moonkatty_news' });
  assert.equal(link.taskId, 'task-city');
  const soft = si.assets.softDelete({ principal: agent('news'), assetId: first.asset.id });
  assert.equal(soft.status, 'deleted');
  assert.equal(si.assets.search({ principal: agent('news'), namespace: 'moonkatty_news', text: 'города' }).length, 0);
  assert.throws(() => si.assets.hardDelete({ principal: agent('news'), assetId: first.asset.id }), err => err.code === 'PERMISSION_DENIED');
  assert.throws(() => si.assets.hardDelete({ principal: owner, assetId: first.asset.id }), err => err.code === 'INVALID_STATE');
  si.close();
});

test('реестр версии не создаёт файл кота и хранит хеш, права и голос', () => {
  const { si, owner, agent } = setup();
  const file = 'assets/character/moonkatty_master_v001.blend';
  assert.equal(fs.existsSync(file), false);
  const draft = si.character.registerVersion({
    principal: owner,
    version: {
      file,
      sha256: 'e'.repeat(64),
      voiceProfileId: null,
      sourceRefs: [{ path: 'references/front.png', sha256: 'f'.repeat(64), basis: 'own', license: null, holder: 'MOONKATTY' }]
    }
  });
  assert.equal(fs.existsSync(file), false);
  assert.equal(draft.locked, false);
  assert.throws(() => si.character.registerVersion({
    principal: agent('design3d'),
    version: { file, sha256: 'e'.repeat(64), voiceProfileId: null, sourceRefs: [] }
  }), err => err.code === 'PERMISSION_DENIED');
  si.voices.define({
    principal: agent('video'),
    profile: {
      voiceProfileId: 'anchor_male', label: 'Ведущий', note: null, sampleAssetId: null,
      sampleRate: 16000, recognizer: 'pocketSphinx', gain: 0.8, mouthScale: 1
    }
  });
  const approvedVoice = si.voices.approve({ principal: owner, voiceProfileId: 'anchor_male' });
  assert.equal(approvedVoice.executed, false);
  const locked = si.character.approve({ principal: owner, id: draft.id, voiceProfileId: 'anchor_male' });
  assert.equal(locked.executed, false);
  assert.equal(locked.version.locked, true);
  const studio = si.character.forStudio({ principal: agent('video') });
  assert.equal(studio.characterId, 'MOONKATTY_MASTER_CHARACTER');
  assert.equal(studio.voiceProfileId, 'anchor_male');
  assert.equal(studio.sourceRefs[0].basis, 'own');
  const next = si.character.registerVersion({
    principal: owner,
    version: { file: 'assets/character/moonkatty_master_v002.blend', sha256: '1'.repeat(64), voiceProfileId: null, sourceRefs: [] }
  });
  si.character.approve({ principal: owner, id: next.id });
  const history = si.character.history({ principal: owner });
  assert.equal(history.length, 2);
  assert.equal(history[0].status, 'superseded');
  assert.equal(si.character.approved({ principal: owner }).version, 2);
  si.close();
});

test('источники, версии сценария и поправки пишутся и ничего не публикуют', () => {
  const panel = createCappedPanelLog(() => '2026-10-20T12:00:00.000Z', 2);
  const { si, owner, agent } = setup({ auditLog: panel.log });
  const source = si.editorial.recordSource({
    principal: agent('news'),
    entry: { namespace: 'moonkatty_news', sourceUrl: 'https://example.test/a', sourceName: 'Wire', action: 'added', note: null, idempotencyKey: 'src/1' }
  });
  const replay = si.editorial.recordSource({
    principal: agent('news'),
    entry: { namespace: 'moonkatty_news', sourceUrl: 'https://example.test/a', sourceName: 'Wire', action: 'added', note: null, idempotencyKey: 'src/1' }
  });
  assert.equal(replay.id, source.id);
  const decision = si.editorial.recordDecision({
    principal: agent('news'),
    decision: { namespace: 'moonkatty_news', subjectType: 'story', subjectId: 'story-1', action: 'recommended', summary: 'Берём в выпуск', status: 'draft' }
  });
  assert.equal(decision.executed, false);
  assert.throws(() => si.editorial.recordDecision({
    principal: agent('news'),
    decision: { namespace: 'moonkatty_news', subjectType: 'story', subjectId: 'story-1', action: 'approved', summary: 'Сам', status: 'approved' }
  }), err => err.code === 'PERMISSION_DENIED');
  const script = si.versions.commit({
    principal: agent('news'),
    version: { namespace: 'moonkatty_news', contentType: 'script', contentKey: 'ep1', title: 'Выпуск 1', body: 'Текст', storagePath: null, checksum: null }
  });
  assert.equal(script.version, 1);
  assert.equal(script.executed, false);
  const video = si.versions.commit({
    principal: agent('video'),
    version: { namespace: 'moonkatty_news', contentType: 'video', contentKey: 'ep1', title: 'Ролик', body: '', storagePath: 'files/ep1.mp4', checksum: 'a'.repeat(64) }
  });
  const approved = si.versions.approve({ principal: owner, id: script.id });
  assert.equal(approved.executed, false);
  assert.equal(approved.version.status, 'approved');
  const notice = si.notices.record({
    principal: agent('news'),
    notice: { namespace: 'moonkatty_news', kind: 'correction', publicationId: 'ep1', publicationVersion: 1, text: 'Уточнена дата' }
  });
  const retraction = si.notices.record({
    principal: agent('news'),
    notice: { namespace: 'moonkatty_news', kind: 'retraction', publicationId: 'ep1', publicationVersion: 1, text: 'Сюжет снят' }
  });
  const logged = si.notices.approve({ principal: owner, id: notice.id });
  assert.equal(logged.executed, false);
  assert.equal(logged.status, 'approved');
  assert.equal(si.notices.history({ principal: agent('publishing'), namespace: 'moonkatty_news', publicationId: 'ep1' }).length, 2);
  assert.equal(retraction.kind, 'retraction');
  assert.equal(video.contentType, 'video');
  si.approval.request({
    principal: agent('news'),
    request: {
      id: 'ap-log', namespace: 'moonkatty_news', subjectType: 'publication', subjectId: 'ep1',
      requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'news',
      requestedAt: '2026-10-20T12:00:00.000Z'
    }
  });
  assert.throws(() => si.approval.request({
    principal: agent('news'),
    request: {
      id: 'ap-secret', namespace: 'moonkatty_news', subjectType: 'publication', subjectId: 'ep1',
      requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'news',
      requestedAt: '2026-10-20T12:00:00.000Z', comment: 'access_token=secret-value'
    }
  }), err => err.code === 'SECRET_REJECTED');
  assert.equal(panel.rows.length <= 2, true);
  assert.equal(panel.rows.some(row => /access_token=secret/.test(row.message)), false);
  assert.ok(panel.rows.some(row => row.source === 'approval'));
  si.close();
});

test('раскладка каталогов печатает найденные пути и не двигает файлы', () => {
  const { inspectCharacterLayout } = require('../src/character-layout');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-char-'));
  const scan = path.join(root, 'incoming');
  fs.mkdirSync(path.join(scan, 'references'), { recursive: true });
  const blend = path.join(scan, 'MOONKATTY_MASTER.blend');
  const ref = path.join(scan, 'references', 'front.png');
  fs.writeFileSync(blend, 'blend-bytes');
  fs.writeFileSync(ref, 'png-bytes');
  const before = fs.readFileSync(blend);
  const dry = inspectCharacterLayout({ root, scans: [scan], apply: false });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.blends.length, 1);
  assert.equal(dry.blends[0].path, blend);
  assert.equal(dry.blends[0].sha256.length, 64);
  assert.equal(dry.references[0].path, ref);
  assert.equal(fs.existsSync(path.join(root, 'CHARACTERS', 'MASTER', 'models')), false);
  const applied = inspectCharacterLayout({ root, apply: true });
  assert.equal(applied.folders.find(item => item.name === 'models').action, 'created');
  assert.deepEqual(fs.readFileSync(blend), before);
  assert.equal(fs.existsSync(blend), true);
  siSafe(root);
});

function siSafe(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
