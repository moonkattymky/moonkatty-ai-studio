/**
 * Map a QA bug report onto the studio task shape already stored by
 * POST /api/tasks (public/app.js taskForm and server.js generic CRUD).
 *
 * This module does not call the server. Other developers own server.js,
 * public/core.js and the task UI. Stage C can POST the object this returns.
 *
 * Existing task fields used here: title, description, agentId, priority,
 * status, project, schedule, source. Extra `qa` is stored with the row
 * because the CRUD handler persists the JSON body as-is.
 */

const PRIORITY = { blocker: 'urgent', major: 'high', minor: 'normal', trivial: 'low' };

const AGENT_BY_REPO = {
  'moonkattymky/moonkatty-horizons': 'games',
  'moonkattymky/moonkatty-horizons-play': 'games',
  'moonkattymky/moonkatty-world-preview': 'games',
  'moonkattymky/moonkatty-game': 'games',
  'moonkattymky/moonkatty-site': 'pr'
};

export function bugToTask(bug, { now = new Date().toISOString() } = {}) {
  if (!bug || typeof bug.title !== 'string' || typeof bug.id !== 'string') {
    throw new Error('bugToTask: bug.id and bug.title are required');
  }
  const priority = PRIORITY[bug.severity] || 'normal';
  const agentId = AGENT_BY_REPO[bug.repo] || 'games';
  const repro = Array.isArray(bug.repro) ? bug.repro.map((s, i) => `${i + 1}. ${s}`).join('\n') : '';
  const description = [
    bug.summary || '',
    bug.expected ? `Expected: ${bug.expected}` : '',
    bug.actual ? `Actual: ${bug.actual}` : '',
    repro ? `Repro:\n${repro}` : '',
    bug.commit ? `Build: ${bug.repo || ''}@${bug.commit}` : '',
    bug.viewport ? `Viewport: ${bug.viewport}` : ''
  ].filter(Boolean).join('\n\n');
  return {
    title: `[QA ${bug.id}] ${bug.title}`.slice(0, 180),
    description,
    agentId,
    priority,
    status: 'queued',
    project: 'main',
    schedule: { type: 'none' },
    source: 'qa',
    createdAt: now,
    qa: {
      bugId: bug.id,
      severity: bug.severity || 'minor',
      repo: bug.repo || null,
      commit: bug.commit || null,
      checkId: bug.checkId || null,
      viewport: bug.viewport || null,
      evidence: bug.evidence || []
    }
  };
}
