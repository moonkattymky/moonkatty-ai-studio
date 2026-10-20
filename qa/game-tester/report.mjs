import fs from 'node:fs';
import path from 'node:path';
import { bugToTask } from '../interfaces/map-bug-to-task.mjs';
import { dashboardCard } from '../interfaces/dashboard-card.mjs';

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function writeReport(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  const card = dashboardCard(report);
  const tasks = (report.bugs || []).map(b => bugToTask(b, { now: report.finishedAt }));
  const full = { ...report, studio: { dashboardCard: card, proposedTasks: tasks } };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(full));
  fs.writeFileSync(path.join(dir, 'dashboard-card.json'), JSON.stringify(card, null, 2));
  fs.writeFileSync(path.join(dir, 'proposed-tasks.json'), JSON.stringify(tasks, null, 2));
  return full;
}

function renderMarkdown(report) {
  const g = report.game || {};
  const lines = [];
  lines.push(`# MOONKATTY Horizons — QA run ${report.date}`);
  lines.push('');
  lines.push(`Measured on this machine. There is no quality score.`);
  lines.push('');
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Seed: ${report.seed}`);
  lines.push(`- Game repo: ${g.repo || 'unknown'} \`${g.sha || ''}\``);
  lines.push(`- Branch requested: ${g.branch || ''}`);
  lines.push(`- Commit subject: ${g.subject || ''}`);
  lines.push(`- Build step: ${g.build || ''}`);
  lines.push(`- Source fallback: ${g.fallback ? 'yes — moonkatty-horizons was not cloneable, horizons-play was served' : 'no'}`);
  lines.push(`- Prepare notes: ${(g.notes || []).join(' | ')}`);
  lines.push(`- Served: ${g.url || ''}`);
  lines.push(`- Browser: ${report.browser || ''}`);
  lines.push(`- Graphics: ${report.graphics || ''}`);
  lines.push('');
  lines.push('## Check results');
  lines.push('');
  lines.push('| Check | Status | Detail |');
  lines.push('| --- | --- | --- |');
  for (const c of report.checks) {
    lines.push(`| ${mdEscape(c.id)} | ${c.status} | ${mdEscape(c.detail)} |`);
  }
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.metrics, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Bugs found');
  lines.push('');
  if (!report.bugs.length) lines.push('No product defects were confirmed by a failing check in this run.');
  for (const b of report.bugs) {
    lines.push(`### ${b.id} — ${b.title}`);
    lines.push('');
    lines.push(`- Severity: ${b.severity}`);
    lines.push(`- Viewport: ${b.viewport || 'n/a'}`);
    lines.push(`- Check: ${b.checkId || 'n/a'}`);
    lines.push(`- Expected: ${b.expected || ''}`);
    lines.push(`- Actual: ${b.actual || ''}`);
    lines.push('- Repro:');
    (b.repro || []).forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
    if (b.evidence && b.evidence.length) lines.push(`- Evidence: ${b.evidence.join(', ')}`);
    if (b.console && b.console.length) {
      lines.push('- Console / failures:');
      for (const row of b.console.slice(0, 12)) lines.push(`  - ${row.type}: ${mdEscape(row.text).slice(0, 400)}`);
    }
    lines.push('');
  }
  lines.push('## Not tested');
  lines.push('');
  const skipped = report.checks.filter(c => c.status === 'not_tested');
  if (!skipped.length) lines.push('Every planned check returned pass or fail.');
  for (const c of skipped) lines.push(`- **${c.id}**: ${c.detail}`);
  lines.push('');
  lines.push('## Steps (repro log)');
  lines.push('');
  for (const group of report.steps || []) {
    lines.push(`### ${group.viewport}`);
    for (const step of group.steps) lines.push(`- ${step}`);
    lines.push('');
  }
  lines.push('## Studio payloads');
  lines.push('');
  lines.push('`dashboard-card.json` and `proposed-tasks.json` in this folder are proposals. They were not posted to the studio API.');
  lines.push('');
  return lines.join('\n');
}

export function bugFromCheck(check, ctx) {
  return {
    id: check.bugId,
    title: check.bugTitle || check.detail.slice(0, 140),
    severity: check.severity || 'major',
    status: 'open',
    repo: ctx.repo,
    commit: ctx.sha,
    viewport: check.viewport || ctx.viewport,
    checkId: check.id,
    summary: check.detail,
    expected: check.expected || '',
    actual: check.actual || check.detail,
    repro: check.repro || ctx.repro || [],
    evidence: check.evidence || [],
    console: check.console || [],
    metrics: check.metrics || {},
    foundAt: ctx.foundAt,
    seed: ctx.seed,
    source: 'qa'
  };
}
