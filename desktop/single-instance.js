// Second TEST copy must not vanish silently when another window already holds the single-instance lock.
// Electron delivers additionalData to the FIRST instance only, so the version of the open window is read
// from instance.json that the primary wrote in the shared userData folder.
'use strict';
const fs = require('fs'), path = require('path');

function conflictMessage(otherVersion, flavor) {
  const v = otherVersion || '?';
  if (flavor === 'test') return `Открыта другая версия TEST (v${v}). Закройте её (⌘Q) и запустите снова.`;
  return `Открыта другая версия (v${v}). Закройте её (⌘Q) и запустите снова.`;
}

function sameBuild(mine, other) {
  if (!other || !other.version || other.version !== mine.version) return false;
  if (mine.commit && other.commit && mine.commit !== other.commit) return false;
  return true;
}

function onLockResult({ gotLock, mine, other, flavor }) {
  if (gotLock) return { action: 'continue' };
  if (sameBuild(mine, other)) return { action: 'quit', message: `Эта версия ${flavor === 'test' ? 'TEST ' : ''}(v${mine.version}) уже открыта. Новое окно не создаётся — используйте открытое. ⌘Q закрывает только окно: фоновый сервер продолжит работу.` };
  return { action: 'quit', message: conflictMessage(other && other.version, flavor) };
}

function instanceFile(dataDir) { return path.join(dataDir, 'instance.json'); }
function readInstance(dataDir) {
  try { const j = JSON.parse(fs.readFileSync(instanceFile(dataDir), 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; }
}
function writeInstance(dataDir, info) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(instanceFile(dataDir), JSON.stringify({ version: info.version, commit: info.commit || null, pid: info.pid, at: new Date().toISOString() }), { mode: 0o600 });
}

module.exports = { conflictMessage, sameBuild, onLockResult, instanceFile, readInstance, writeInstance };
