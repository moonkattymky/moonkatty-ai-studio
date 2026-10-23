// Shared server identity for the desktop shell and server.js.
// A listener is "ours" only when app, flavor, version and (when both sides have one) commit match.
// A missing version is never printed as "vundefined" and is never treated as the same server.
'use strict';
const fs = require('fs'), path = require('path');

function expectFrom(pkgVersion, commit) {
  return { version: pkgVersion, commit: commit && commit !== 'dev' ? commit : null };
}

function classify(h, expect, flavor) {
  if (!h || h.app !== 'moonkatty-ai-studio' || (h.flavor || 'prod') !== flavor) return { kind: 'foreign' };
  const version = h.version || null;
  const commit = h.commit || null;
  const versionMismatch = version !== expect.version;
  const commitMismatch = !!(expect.commit && commit && commit !== expect.commit);
  if (!version || versionMismatch || commitMismatch) return { kind: 'stale', version: version || '?', commit, pid: h.pid };
  return { kind: 'same' };
}

function portConflict(port, h, expect, flavor) {
  const c = classify(h, expect, flavor);
  if (!h || c.kind === 'foreign') return { exitCode: 3, message: `Порт ${port} занят другим процессом` };
  if (c.kind === 'same') return { exitCode: 0, message: `Сервер уже запущен на порту ${port} — второй экземпляр не нужен` };
  const commitBit = c.commit ? ', ' + String(c.commit).slice(0, 7) : '';
  return { exitCode: 3, message: `Порт ${port} занят другой версией сервера (v${c.version}${commitBit}, pid ${c.pid}); эта версия v${expect.version} не запущена` };
}

function readServerPid(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'server.pid'), 'utf8').trim();
    if (!/^[1-9]\d*$/.test(raw)) return null;
    return Number(raw);
  } catch { return null; }
}

/** True only when the PID from /api/health is the PID this server wrote into its own data dir. */
function pidMatchesServerFile(dataDir, pid) {
  const filePid = readServerPid(dataDir);
  return filePid != null && Number(pid) === filePid;
}

module.exports = { expectFrom, classify, portConflict, readServerPid, pidMatchesServerFile };
