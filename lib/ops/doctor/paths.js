// Temp files System Doctor is allowed to create and delete. Never a shell rm.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

function doctorError(code, message, status) {
  return Object.assign(new Error(message), { code, status: status || (code === 'FORBIDDEN' ? 403 : 400) });
}

function tmpRoot() {
  return fs.realpathSync(os.tmpdir());
}

function makeTemp() {
  const dir = path.join(os.tmpdir(), 'mk-sd-' + crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function assertTempPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || p.includes('..')) throw doctorError('FORBIDDEN', 'Путь вне /tmp/mk-sd-*');
  const resolved = path.resolve(p);
  const root = tmpRoot();
  let real = resolved;
  try { real = fs.realpathSync(resolved); } catch { real = resolved; }
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw doctorError('FORBIDDEN', 'Путь вне временного каталога');
  if (!/^mk-sd-[a-f0-9]+([/\\]|$)/.test(rel)) throw doctorError('FORBIDDEN', 'Путь не принадлежит System Doctor');
  return real;
}

function cleanupOld(maxAgeMs = 24 * 3600 * 1000, now = Date.now()) {
  const root = os.tmpdir();
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(root); } catch { return { removed: 0 }; }
  for (const name of names) {
    if (!/^mk-sd-[a-f0-9]+$/.test(name)) continue;
    const full = path.join(root, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (now - st.mtimeMs < maxAgeMs) continue;
    try { assertTempPath(full); fs.rmSync(full, { recursive: true, force: true }); removed++; } catch { /* leave it */ }
  }
  return { removed };
}

module.exports = { doctorError, makeTemp, assertTempPath, cleanupOld, tmpRoot };
