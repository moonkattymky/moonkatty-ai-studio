/**
 * Dashboard card for a Horizons QA run.
 *
 * Fits the studio report style (public/core.js buildReport): counts come
 * only from the run file, never from invented scores. Stage C can drop this
 * object into the existing `reports` collection or a future `qaRuns`
 * collection. This module does not modify COLLECTIONS.
 */

export function dashboardCard(report) {
  if (!report || !Array.isArray(report.checks)) throw new Error('dashboardCard: report.checks[] required');
  const counts = { pass: 0, fail: 0, not_tested: 0 };
  for (const c of report.checks) {
    if (c.status === 'pass' || c.status === 'fail' || c.status === 'not_tested') counts[c.status] += 1;
  }
  const openBugs = (report.bugs || []).filter(b => b.status === 'open' || b.status === 'confirmed');
  return {
    source: 'qa',
    kind: 'horizons-playtest',
    generatedAt: report.finishedAt || report.startedAt || null,
    game: report.game || {},
    seed: report.seed ?? null,
    counts,
    openBugCount: openBugs.length,
    openBugs: openBugs.map(b => ({
      id: b.id,
      title: b.title,
      severity: b.severity,
      viewport: b.viewport || null,
      checkId: b.checkId || null
    })),
    metrics: report.metrics || {},
    note: 'Counts are check results from this run. There is no quality score.'
  };
}
