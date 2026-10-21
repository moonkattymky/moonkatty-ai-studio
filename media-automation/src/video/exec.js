'use strict';
const { execFile } = require('child_process');
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (err, stdout, stderr) => {
    if (err) { err.message += `\n${String(stderr).slice(-2000)}`; return reject(err); }
    resolve({ stdout: String(stdout), stderr: String(stderr) });
  }));
}
async function probeDuration(file, runFn = run) {
  const { stdout } = await runFn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(stdout); if (!isFinite(d)) throw new Error(`cannot probe ${file}`); return d;
}
async function hasBinary(bin) { try { await run('sh', ['-c', `command -v ${bin}`]); return true; } catch { return false; } }
module.exports = { run, probeDuration, hasBinary };
