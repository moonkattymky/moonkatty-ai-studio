// Process-wide lock for heavy work: Blender runs and Ollama generations are serialized so they do not compete
// for the 24 GB of unified memory on the Mac mini (one heavy job at a time, FIFO).
'use strict';
let tail = Promise.resolve(), holder = null, waiting = 0;
async function withHeavy(label, fn, signal) {
  let release; const mine = new Promise(r => release = r); const prev = tail; tail = prev.then(() => mine); waiting++;
  try { await Promise.race([prev, new Promise((_, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('Отменено'), { cancelled: true })), { once: true }))]); }
  catch (e) { waiting--; prev.then(release); throw e; }
  waiting--; holder = label;
  try { return await fn(); } finally { holder = null; release(); }
}
module.exports = { withHeavy, status: () => ({ holder, waiting }) };
