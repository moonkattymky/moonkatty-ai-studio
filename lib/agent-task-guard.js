'use strict';
// Checks for the sandboxed agent task. The model never chooses the command line.
const path = require('path');
const MAX_FILES = 12;
const MAX_FILE = 64 * 1024;
const MAX_TOTAL = 256 * 1024;
const MAX_PROMPT = 8000;

function fail(code, message) { const e = new Error(message); e.code = code; return e; }

function safeRel(p) {
  const n = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.length > 180 || n.includes('\0') || n.includes('//')) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(n)) return null;
  const parts = n.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (parts.some(s => s === 'node_modules' || s.toLowerCase() === '.git')) return null;
  return parts.join('/');
}

function checkBundle(prompt, files, tests) {
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > MAX_PROMPT) throw fail('bad_prompt', 'Промпт: 1–8000 байт');
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw fail('bad_files', 'Нужен 1–12 файлов');
  if (!Array.isArray(tests) || !tests.length || tests.length > MAX_FILES) throw fail('bad_tests', 'Нужен хотя бы один тест .test.js');
  const seen = new Set(); let total = 0;
  const take = (list, testFile) => list.map(f => {
    const rel = safeRel(f && f.path);
    if (!rel) throw fail('bad_path', 'Недопустимый путь: ' + (f && f.path));
    if (testFile && !rel.endsWith('.test.js')) throw fail('bad_tests', 'Тест должен называться *.test.js');
    if (!testFile && rel.endsWith('.test.js')) throw fail('bad_files', 'Тесты передаются отдельно и модель их не меняет');
    if (seen.has(rel)) throw fail('bad_path', 'Повтор пути: ' + rel);
    const text = String(f.text ?? '');
    const n = Buffer.byteLength(text);
    if (n > MAX_FILE) throw fail('too_large', rel + ' больше 64 КБ');
    total += n; seen.add(rel);
    return { path: rel, text };
  });
  const fsList = take(files, false); const tList = take(tests, true);
  if (total > MAX_TOTAL) throw fail('too_large', 'Суммарно больше 256 КБ');
  return { prompt: prompt.trim(), files: fsList, tests: tList };
}

/** The only command the sandbox may run: node --test <owner test files>. */
function assertTestArgv(execPath, args, allowed) {
  const base = path.basename(String(execPath || ''));
  if (base !== 'node') throw fail('command_forbidden', 'Разрешён только node');
  if (!Array.isArray(args) || args[0] !== '--test' || args.length < 2) throw fail('command_forbidden', 'Разрешён только node --test');
  const allow = new Set(allowed || []);
  for (const a of args.slice(1)) {
    const rel = safeRel(a);
    if (!rel || !allow.has(rel)) throw fail('command_forbidden', 'Тест вне списка владельца: ' + a);
  }
  const banned = /^(git|bash|sh|rm|curl|wget|sudo|opencode|ffmpeg)$/;
  if ([base, ...args].some(a => banned.test(path.basename(String(a))))) throw fail('command_forbidden', 'Запрещённая команда');
  return args;
}

function parseUnified(diffText) {
  const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
  const files = []; let cur = null; let hunk = null;
  const rej = m => { throw fail('diff_rejected', m); };
  for (const line of lines) {
    let m;
    if ((m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line))) {
      if (m[1] !== m[2]) rej('переименование запрещено');
      cur = { path: m[1], hunks: [] }; files.push(cur); hunk = null; continue;
    }
    if ((m = /^--- a\/(\S+)$/.exec(line))) {
      if (!cur) { cur = { path: m[1], hunks: [] }; files.push(cur); }
      else if (cur.path !== m[1]) rej('путь --- не совпадает');
      continue;
    }
    if ((m = /^\+\+\+ b\/(\S+)$/.exec(line))) { if (!cur || cur.path !== m[1]) rej('путь +++ не совпадает'); continue; }
    if ((m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line))) {
      if (!cur) rej('hunk без файла');
      hunk = { oldStart: +m[1], rows: [] }; cur.hunks.push(hunk); continue;
    }
    if (line.startsWith('\\')) rej('служебная строка diff');
    if (!hunk) continue;
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) hunk.rows.push(line);
    else if (line === '') hunk = null;
    else rej('строка diff: ' + line.slice(0, 40));
  }
  if (!files.length) rej('нет diff');
  return files;
}

function applyUnified(original, diffText, editable) {
  const allow = new Set(editable);
  const next = new Map(Object.entries(original));
  for (const file of parseUnified(diffText)) {
    const rel = safeRel(file.path);
    if (!rel || !allow.has(rel)) throw fail('diff_rejected', 'diff трогает запрещённый путь: ' + file.path);
    if (!next.has(rel)) throw fail('diff_rejected', 'нет исходного файла: ' + rel);
    const lines = next.get(rel).split('\n');
    let i = 0; const out = [];
    for (const h of file.hunks) {
      const start = h.oldStart - 1;
      if (start < i || start > lines.length) throw fail('diff_rejected', 'hunk вне файла ' + rel);
      out.push(...lines.slice(i, start)); i = start;
      for (const row of h.rows) {
        const kind = row[0]; const text = row.slice(1);
        if (kind === ' ') { if (lines[i] !== text) throw fail('diff_rejected', 'контекст не совпал в ' + rel); out.push(lines[i]); i++; }
        else if (kind === '-') { if (lines[i] !== text) throw fail('diff_rejected', 'удаляемая строка не совпала в ' + rel); i++; }
        else if (kind === '+') out.push(text);
        else throw fail('diff_rejected', 'строка hunk');
      }
    }
    out.push(...lines.slice(i));
    const body = out.join('\n');
    if (Buffer.byteLength(body) > MAX_FILE) throw fail('too_large', rel);
    next.set(rel, body);
  }
  return next;
}

module.exports = { safeRel, checkBundle, assertTestArgv, parseUnified, applyUnified, fail, MAX_FILES, MAX_FILE, MAX_TOTAL, MAX_PROMPT };
