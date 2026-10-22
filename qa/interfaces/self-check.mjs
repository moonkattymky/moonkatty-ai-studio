/**
 * Offline check that the QA → studio payloads match the documented shape.
 * No browser, no network, no studio database.
 */
import { bugToTask } from './map-bug-to-task.mjs';
import { dashboardCard } from './dashboard-card.mjs';

const bug = {
  id: 'QA-HZ-EXAMPLE',
  title: 'Example failure used by the interface self-check',
  severity: 'major',
  status: 'open',
  repo: 'moonkattymky/moonkatty-horizons-play',
  commit: 'abc',
  viewport: 'desktop',
  checkId: 'desktop.keyboard-move',
  summary: 'The example bug is not a measured game defect.',
  expected: 'position changes',
  actual: 'position stays',
  repro: ['Open the local build', 'Hold W for 2 seconds'],
  evidence: ['qa/reports/example/screenshots/x.png'],
  foundAt: '2026-10-20T00:00:00.000Z',
  source: 'qa'
};

const task = bugToTask(bug, { now: '2026-10-20T00:00:00.000Z' });
const errors = [];
if (task.agentId !== 'games') errors.push('agentId');
if (task.priority !== 'high') errors.push('priority');
if (task.status !== 'queued') errors.push('status');
if (task.project !== 'main') errors.push('project');
if (task.source !== 'qa') errors.push('source');
if (!task.schedule || task.schedule.type !== 'none') errors.push('schedule');
if (task.qa.bugId !== bug.id) errors.push('qa.bugId');
if (!task.description.includes('1. Open the local build')) errors.push('repro');

const card = dashboardCard({
  startedAt: '2026-10-20T00:00:00.000Z',
  game: { repo: bug.repo },
  seed: 1,
  checks: [{ status: 'pass' }, { status: 'fail' }, { status: 'not_tested' }],
  bugs: [bug],
  metrics: { loadMs: { desktop: 10 } }
});
if (card.counts.pass !== 1 || card.counts.fail !== 1 || card.counts.not_tested !== 1) errors.push('counts');
if (card.openBugCount !== 1) errors.push('openBugCount');
if (card.note.includes('score') && /quality score: \d/.test(card.note)) errors.push('score');

if (errors.length) {
  console.error('qa interface self-check failed:', errors.join(', '));
  process.exit(1);
}
console.log('qa interface self-check: ok');
