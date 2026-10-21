// Job type `video_render` (requested by Studio 2 / feat/media-automation, INTEGRATION.md §10).
// Input schema, idempotency key, artifact schema and the executor slot. Studio 2's doc (228c2ea) does not define a
// handler/entry point for the Studio side, so the default executor is a STUB that fails the job with «Не подключено»
// and produces no output. A real executor can be plugged in with setExecutor(fn) and must return {artifacts:[…]}.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { inside } = require('./policy.js');
const PRESETS = ['youtube', 'shorts'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;          // runId
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;      // episodeRef (e.g. "s01/e03"); no "..", no leading "/"
const KEYS = ['runId', 'preset', 'episodeRef'];
const NOT_CONNECTED = 'video_render: Не подключено — исполнитель рендера видео (feat/media-automation) ещё не подключён к Studio; результат не создан';
function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['input: объект {runId, preset, episodeRef}'] };
  for (const k of Object.keys(input)) if (!KEYS.includes(k)) errors.push('input: неизвестное поле ' + JSON.stringify(k).slice(0, 40));
  const { runId, preset, episodeRef } = input;
  if (typeof runId !== 'string' || !SAFE_ID.test(runId) || runId.includes('..')) errors.push('runId: 1–64 символа [A-Za-z0-9._-], без ".."');
  if (!PRESETS.includes(preset)) errors.push('preset: ' + PRESETS.join('|'));
  if (typeof episodeRef !== 'string' || !SAFE_REF.test(episodeRef) || episodeRef.split(/[\/:]/).some(s => s === '..' || s === '.' || s === '')) errors.push('episodeRef: 1–128 символов [A-Za-z0-9._:/-], без ".." и пустых сегментов');
  return errors.length ? { ok: false, errors } : { ok: true, input: { runId, preset, episodeRef } };
}
const idempotencyKey = i => i.runId + ':' + i.preset;
// Required result: exactly one mp4, one srt, one jpg cover. Each {path,size,sha256,kind}, path inside root.
const KINDS = { mp4: /\.mp4$/i, srt: /\.srt$/i, jpg: /\.jpe?g$/i };
function validateArtifacts(list, root) {
  const errors = [];
  if (!Array.isArray(list)) return { ok: false, errors: ['artifacts: массив'] };
  const seen = {};
  for (const [n, a] of list.entries()) {
    const e = m => errors.push(`artifacts[${n}]: ${m}`);
    if (!a || typeof a !== 'object') { e('объект'); continue; }
    for (const k of Object.keys(a)) if (!['name', 'path', 'size', 'sha256', 'kind'].includes(k)) e('неизвестное поле ' + k);
    if (!KINDS[a.kind]) { e('kind: mp4|srt|jpg'); continue; }
    seen[a.kind] = (seen[a.kind] || 0) + 1;
    if (typeof a.path !== 'string' || !path.isAbsolute(a.path) || !inside(root, a.path)) { e('path вне рабочей папки'); continue; }
    if (!KINDS[a.kind].test(a.path)) e('расширение не соответствует kind');
    let st; try { st = fs.lstatSync(a.path); } catch { e('файл не найден'); continue; }
    if (!st.isFile()) { e('не обычный файл'); continue; }
    if (!Number.isInteger(a.size) || a.size !== st.size || a.size <= 0) e('size не совпадает с файлом');
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256) || a.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')) e('sha256 не совпадает с файлом');
  }
  for (const k of Object.keys(KINDS)) if (seen[k] !== 1) errors.push(`artifacts: нужен ровно один ${k} (есть ${seen[k] || 0})`);
  return errors.length ? { ok: false, errors } : { ok: true, artifacts: list.map(a => ({ name: path.basename(a.path), path: a.path, size: a.size, sha256: a.sha256, kind: a.kind })) };
}
async function stubExecutor() { throw Object.assign(new Error(NOT_CONNECTED), { notConnected: true }); }
let executor = stubExecutor;
module.exports = { PRESETS, KEYS, NOT_CONNECTED, validateInput, idempotencyKey, validateArtifacts,
  setExecutor: fn => { executor = typeof fn === 'function' ? fn : stubExecutor; }, getExecutor: () => executor,
  hasExecutor: () => executor !== stubExecutor, // API used by feat/media-automation (a33a315)
  isStub: () => executor === stubExecutor };      // kept as alias (= !hasExecutor())
