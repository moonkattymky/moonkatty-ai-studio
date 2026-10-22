// Video render dependency diagnostics (ffmpeg, ffprobe, rsvg-convert).
// Resolution only: looks for an executable file in PATH plus the usual Homebrew dirs (GUI-launched macOS apps get a
// minimal PATH). Nothing is executed and nothing is ever installed — the hint is text for the owner.
'use strict';
const fs = require('fs'), path = require('path');
const DEPS = Object.freeze([
  { bin: 'ffmpeg', pkg: 'ffmpeg', why: 'сборка видео и звука (MP4)' },
  { bin: 'ffprobe', pkg: 'ffmpeg', why: 'проверка длительности и размеров видео (входит в пакет ffmpeg)' },
  { bin: 'rsvg-convert', pkg: 'librsvg', why: 'отрисовка титров и графики (SVG → PNG)' }
]);
// Test hook: NV_DEPS_FALLBACK_DIRS (':'-separated, may be empty) replaces the Homebrew fallback list.
function fallbackDirs(env) { const v = env.NV_DEPS_FALLBACK_DIRS; return v != null ? v.split(':').filter(Boolean) : ['/opt/homebrew/bin', '/usr/local/bin']; }
function isExec(f) { try { const st = fs.statSync(f); if (!st.isFile()) return false; fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } }
function resolveBin(bin, env = process.env) {
  const pathDirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of pathDirs) if (isExec(path.join(d, bin))) return { path: path.join(d, bin), viaFallback: false };
  for (const d of fallbackDirs(env)) if (isExec(path.join(d, bin))) return { path: path.join(d, bin), viaFallback: true };
  return null;
}
function check(env = process.env) {
  const found = {}, missing = [];
  for (const d of DEPS) { const r = resolveBin(d.bin, env); if (r) found[d.bin] = r.path; else missing.push({ bin: d.bin, pkg: d.pkg, why: d.why }); }
  // A binary found only in a Homebrew fallback dir: make it reachable for execFile in this process (PATH only, no install).
  if (env === process.env) for (const p of Object.values(found)) { const dir = path.dirname(p); const cur = String(process.env.PATH || '').split(path.delimiter); if (!cur.includes(dir)) process.env.PATH = [...cur, dir].filter(Boolean).join(path.delimiter); }
  const pkgs = [...new Set(missing.map(m => m.pkg))];
  return { ok: !missing.length, found, missing, hint: pkgs.length ? `brew install ${pkgs.join(' ')}` : null,
    message: missing.length ? `Рендер видео не готов: не найдено ${missing.map(m => `${m.bin} (${m.why})`).join('; ')}. Установите вручную (по согласованию с командой): brew install ${pkgs.join(' ')}` : null };
}
function depsError(r) { return Object.assign(new Error(r.message), { status: 424, code: 'video_deps_missing', details: { missing: r.missing, hint: r.hint } }); }
module.exports = { DEPS, resolveBin, check, depsError };
