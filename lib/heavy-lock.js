// Process-wide lock for heavy work: Blender runs, video_render jobs and EVERY Ollama generation (/api/chat, /api/generate)
// are serialized so they never compete for the 24 GB of unified memory on the Mac mini (one heavy job at a time, FIFO).
// v1.2.2: tryHeavy() — wait at most `waitMs`, then give up with a clear {busy:true} error instead of piling up; plus a
// cap on interactive waiters (Director chat) so requests can never accumulate without bound.
'use strict';
let tail = Promise.resolve(), holder = null, waiting = 0, since = null;
const busyErr = (msg, extra) => Object.assign(new Error(msg), { busy: true, holder, waiting }, extra);
async function withHeavy(label, fn, signal) {
  let release; const mine = new Promise(r => release = r); const prev = tail; tail = prev.then(() => mine); waiting++;
  try { await Promise.race([prev, new Promise((_, rej) => { if (signal?.aborted) return rej(signal.reason?.busy ? signal.reason : Object.assign(new Error('Отменено'), { cancelled: true }));
    signal?.addEventListener('abort', () => rej(signal.reason?.busy ? signal.reason : Object.assign(new Error('Отменено'), { cancelled: true })), { once: true }); })]); }
  catch (e) { waiting--; prev.then(release); throw e; }
  waiting--; holder = label; since = Date.now();
  try { return await fn(); } finally { holder = null; since = null; release(); }
}
// Interactive use: wait up to waitMs for the lock. Rejects with err.busy=true on timeout or when too many are waiting.
let interactive = 0; // interactive callers currently WAITING (not holding) the lock
async function tryHeavy(label, fn, { waitMs = 15000, maxWaiting = 3, signal } = {}) {
  if (interactive >= maxWaiting) throw busyErr('Слишком много запросов в очереди', { code: 'queue_full' });
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(busyErr('Занято тяжёлой задачей: ' + (holder || '—'), { code: 'busy' })), waitMs);
  signal?.addEventListener('abort', () => ac.abort(), { once: true });
  interactive++; let waitingNow = true; const done = () => { if (waitingNow) { waitingNow = false; interactive--; } };
  try { return await withHeavy(label, () => { clearTimeout(t); done(); return fn(); }, ac.signal); }
  finally { clearTimeout(t); done(); }
}
module.exports = { withHeavy, tryHeavy, status: () => ({ holder, waiting, since }) };
