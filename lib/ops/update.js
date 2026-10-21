// Update Manager: verification only — it NEVER installs or runs downloaded code by itself and never bypasses Gatekeeper
// (no xattr -d com.apple.quarantine, no spctl --master-disable). Produces a report + a manual plan with rollback.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFile } = require('child_process'); // v1.3.0-test port: local exec (no ops/probes.js)
const run = (cmd, args, timeout = 5000) => new Promise((res, rej) => execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (e, out) => e ? rej(e) : res(String(out))));
const EXPECTED_REMOTES = ['https://github.com/moonkattymky/moonkatty-ai-studio.git', 'https://github.com/moonkattymky/moonkatty-ai-studio', 'git@github.com:moonkattymky/moonkatty-ai-studio.git'];
const SUPPORTED_SCHEMA = 1;
const sha256File = p => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))); });
function createUpdateManager({ exec = run, platform = process.platform, expectedRemotes = EXPECTED_REMOTES, supportedSchema = SUPPORTED_SCHEMA } = {}) {
  const git = (repo, args) => exec('git', ['-C', repo, ...args], 15000).then(s => s.trim());
  async function verifyOrigin({ repoDir, ref }) {
    const r = { checks: [] }; const add = (id, ok, detail) => r.checks.push({ id, ok: !!ok, detail });
    let remote = ''; try { remote = await git(repoDir, ['remote', 'get-url', 'origin']); } catch (e) { add('remote', false, e.message); return fin(r); }
    add('remote', expectedRemotes.includes(remote), remote);
    let commit = ''; try { commit = await git(repoDir, ['rev-parse', '--verify', ref + '^{commit}']); } catch { add('ref', false, 'ref не найден: ' + ref); return fin(r); }
    add('ref', /^[0-9a-f]{40}$/.test(commit), `${ref} → ${commit}`); r.commit = commit;
    const tags = (await git(repoDir, ['tag', '--points-at', commit]).catch(() => '')).split('\n').filter(Boolean); r.tags = tags;
    const remoteBranches = (await git(repoDir, ['branch', '-r', '--contains', commit]).catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean);
    add('on-origin', remoteBranches.some(b => b.startsWith('origin/')) || tags.length > 0, remoteBranches.length ? 'есть в ' + remoteBranches.slice(0, 3).join(', ') : tags.length ? 'тег ' + tags.join(',') : 'коммит не найден на origin');
    const dirty = await git(repoDir, ['status', '--porcelain', '--untracked-files=no']).catch(() => 'error'); add('clean-tree', dirty === '', dirty ? 'есть локальные изменения' : 'чисто');
    return fin(r);
  }
  async function verifyArtifact({ file, sha256, sumsFile }) {
    const r = { checks: [] }; const add = (id, ok, detail) => r.checks.push({ id, ok: !!ok, detail });
    if (!fs.existsSync(file)) { add('exists', false, file); return fin(r); }
    let want = sha256 ? String(sha256).toLowerCase() : null;
    if (!want && sumsFile) { const line = fs.readFileSync(sumsFile, 'utf8').split('\n').find(l => l.trim().endsWith(path.basename(file))); want = line ? line.trim().split(/\s+/)[0].toLowerCase() : null; }
    if (!want || !/^[0-9a-f]{64}$/.test(want)) { add('sha256', false, 'нет ожидаемого SHA-256 — установка запрещена'); return fin(r); }
    const got = await sha256File(file); add('sha256', got === want, got); r.sha256 = got; return fin(r);
  }
  async function verifySignature({ appPath }) {
    const r = { checks: [] }; const add = (id, ok, detail, info) => r.checks.push({ id, ok: !!ok, detail, info: !!info });
    if (platform !== 'darwin') { add('codesign', false, 'НЕ ПРОВЕРЕНО: не macOS — проверить на Mac', true); r.unverified = true; return fin(r); }
    try { await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], 60000); add('codesign', true, 'подпись цела'); } catch (e) { add('codesign', false, 'codesign: ' + String(e.message).slice(0, 200)); }
    try { await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', appPath], 60000); add('gatekeeper', true, 'принято Gatekeeper'); }
    catch (e) { add('gatekeeper', false, 'Gatekeeper отклонил (ad-hoc/не нотаризовано). НЕ обходите: откройте через Finder → «Открыть» после проверки SHA-256 и кода', true); r.gatekeeper = 'rejected'; }
    return fin(r);
  }
  function schemaCheck(db) {
    const d = detectSchemaVersion(db); const tables = d.tables, v = d.version;
    const ok = tables.includes('items') && tables.includes('meta') && v >= 1 && v <= supportedSchema;
    return { ok, schemaVersion: v, source: d.source, supported: supportedSchema, tables, detail: ok ? 'совместимо' : 'схема новее или повреждена — не обновлять/не откатывать без бэкапа' };
  }
  function plan({ report, backupId, currentApp = '/Applications/MOONKATTY AI STUDIO.app' }) {
    const allOk = report.every(x => x.ok);
    return { allowed: allOk, steps: allOk ? [
      `Бэкап создан: ${backupId || '— СОЗДАЙТЕ: POST /api/ops/backups'}`,
      'Закройте приложение (Cmd+Q)',
      `Переименуйте текущее: mv "${currentApp}" "${currentApp.replace(/\.app$/, '')}-previous.app"`,
      'Перетащите проверенную новую .app в «Программы», откройте через Finder (правый клик → «Открыть»)',
      'node ops/post-update-check.js — все проверки OK'] : ['Обновление ЗАПРЕЩЕНО: исправьте проваленные проверки'],
      rollback: [ 'Закройте приложение', `mv "${currentApp}" "${currentApp.replace(/\.app$/, '')}-failed.app" && mv "${currentApp.replace(/\.app$/, '')}-previous.app" "${currentApp}" (неудачную версию не удалять)`,
        'Если менялась схема данных — восстановите бэкап в пустую папку: node ops/backup.js restore <id> --to <папка> и замените папку данных' ] };
  }
  return { verifyOrigin, verifyArtifact, verifySignature, schemaCheck, plan };
}
// Real DB schema version (docs/RELEASE_MANIFEST.md, branch feat/v1.2.2-test-isolated, lib/db-backup.js detectVersion):
// meta.schemaVersion if present (v1.2.2+), else inferred: 0 = no items · 1 = items/meta (v1.0–v1.1.x) · 2 = + jobs/job_events · 3 = + jobs.input… (v1.2.0/v1.2.1)
function detectSchemaVersion(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('items')) return { version: 0, source: 'tables', tables };
  if (tables.includes('meta')) { let r = null; try { r = db.prepare("SELECT v FROM meta WHERE k='schemaVersion'").get(); } catch {} if (r && /^\d+$/.test(String(r.v))) return { version: +r.v, source: 'meta', tables }; }
  if (!tables.includes('jobs')) return { version: 1, source: 'tables', tables };
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  return { version: cols.includes('input') ? 3 : 2, source: 'tables', tables };
}
const fin = r => Object.assign(r, { ok: r.checks.every(c => c.ok) });
module.exports = { createUpdateManager, detectSchemaVersion, SUPPORTED_SCHEMA, EXPECTED_REMOTES };
