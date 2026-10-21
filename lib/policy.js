// Permission policy: the single place that decides whether an agent action is allowed, denied or needs a human
// confirmation. Every decision carries a rule id that is written to the job action log.
'use strict';
const fs = require('fs'), path = require('path');
// Resolve a path the way the OS would (following symlinks of the existing part) and check it stays inside root.
function inside(root, p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false;
  const rootReal = fs.realpathSync(root);
  let abs = path.resolve(rootReal, p), probe = abs, rest = [];
  while (!fs.existsSync(probe)) { rest.unshift(path.basename(probe)); const up = path.dirname(probe); if (up === probe) break; probe = up; }
  let real; try { real = path.join(fs.realpathSync(probe), ...rest); } catch { return false; }
  return real === rootReal || real.startsWith(rootReal + path.sep);
}
// OpenCode tools the studio ever lets through. Everything else (bash, webfetch, websearch, task, skill, question, …) is denied.
const OC_ALLOWED = new Set(['read', 'glob', 'grep', 'list', 'edit', 'write']);
const PROTECTED_EXT = /\.(blend|blend\d+|glb|fbx|png)$/i; // produced by Blender only — the agent may not overwrite them
function decide(a) {
  const R = (decision, rule, reason) => ({ decision, rule, reason });
  switch (a.type) {
    case 'shell': return R('deny', 'shell.never', 'Произвольные shell-команды запрещены политикой');
    case 'publish': return R('confirm', 'publish.confirm', 'Публикация требует подтверждения человеком');
    case 'fs.delete': if (!a.ws || !inside(a.ws, a.path)) return R('deny', 'fs.outside', 'Путь вне рабочей папки проекта');
      return R('confirm', 'fs.delete.confirm', 'Удаление требует подтверждения');
    case 'fs.read': return a.ws && inside(a.ws, a.path) ? R('allow', 'fs.read.ws') : R('deny', 'fs.outside', 'Путь вне рабочей папки проекта');
    case 'fs.write':
      if (!a.ws || !inside(a.ws, a.path)) return R('deny', 'fs.outside', 'Путь вне рабочей папки проекта');
      if (PROTECTED_EXT.test(a.path) && fs.existsSync(path.resolve(a.ws, a.path))) return R('deny', 'fs.versioned', 'Перезапись версионированного файла запрещена (создаётся новая версия)');
      if (PROTECTED_EXT.test(a.path)) return R('deny', 'fs.blender-only', 'Файлы .blend/.glb/.fbx/.png создаёт только Blender-сервис');
      return R('allow', 'fs.write.ws');
    case 'blender.template': return R('allow', 'blender.template');
    case 'blender.generated': return R('confirm', 'blender.generated.confirm', 'Сгенерированный скрипт Blender запускается только после проверки и подтверждения');
    case 'opencode.permission': {
      const p = String(a.permission || '');
      if (p === 'bash') return R('deny', 'shell.never', 'OpenCode: bash запрещён политикой');
      if (p === 'external_directory') return R('deny', 'fs.outside', 'OpenCode: доступ вне рабочей папки запрещён');
      if (p === 'doom_loop') return R('deny', 'oc.doom_loop', 'OpenCode: повтор одного и того же действия — задание остановлено');
      if (!OC_ALLOWED.has(p)) return R('deny', 'oc.tool.' + p, 'OpenCode: инструмент «' + p + '» запрещён политикой');
      const files = (a.files || []).filter(Boolean); if (!files.length) return R('deny', 'oc.nopath', 'OpenCode: запрос без пути к файлу');
      for (const f of files) { const d = decide({ type: p === 'read' || p === 'glob' || p === 'grep' || p === 'list' ? 'fs.read' : 'fs.write', ws: a.ws, path: f }); if (d.decision !== 'allow') return d; }
      return R('allow', 'oc.' + p + '.ws');
    }
    default: return R('deny', 'unknown', 'Неизвестное действие');
  }
}
// Required server-side OpenCode permission config (defence in depth; our own checks above are the real enforcement).
function checkOpencodeConfig(cfg) {
  const p = (cfg && cfg.permission) || {}; const issues = [];
  const val = k => p[k] ?? p['*'];
  const isDeny = v => v === 'deny' || (v && typeof v === 'object' && Object.values(v).every(x => x === 'deny'));
  for (const k of ['bash', 'webfetch', 'external_directory']) if (!isDeny(val(k))) issues.push(`permission.${k} должно быть "deny" (сейчас ${JSON.stringify(val(k) ?? 'allow (по умолчанию)')})`);
  // v1.2.3-test.1: "deny" (recommended — the studio writes scene_params.json itself) or "ask" (every ask is rejected by the studio).
  if (!['ask', 'deny'].includes(val('edit'))) issues.push(`permission.edit должно быть "deny" (или "ask") — агент не пишет файлы, их пишет студия (сейчас ${JSON.stringify(val('edit') ?? 'allow (по умолчанию)')})`);
  if (typeof p === 'string') issues.push('permission задан строкой «' + p + '» — нужен объект с правилами');
  return issues;
}
const permVal = (cfg, k) => { const p = (cfg && cfg.permission) || {}; return p[k] ?? p['*']; };
module.exports = { permVal, decide, inside, checkOpencodeConfig, OC_ALLOWED };
