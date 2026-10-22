// Step 2 wiring (kept out of server.js): Approval Center deps for createWorld + MA_JOBS_BACKEND selection.
// server.js calls this once after world.boot(). Nothing here publishes, pays or mails: external owner
// actions are recorded as approved but return executed:false / status 'external_disabled'.
'use strict';
const EXTERNAL = ['spending', 'paid_ads', 'outreach_new_clients', 'contracts', 'payment_settings', 'mass_mailing', 'editorial_publication'];
function wireWorld({ app, world, services, checkPassword, sessionUser, env = process.env, log = () => {} }) {
  const executors = {
    critical_settings: async p => { const v = world.applySavings(p); return { executed: true, status: 'executed', applied: v }; },
    // opencode_task is created only here, after the owner approved exactly these params (feat/e2e-task-runners)
    render_segment_execution: async (p, ctx) => { if (!services || !p || p.kind !== 'render_segment') return { executed: false, status: 'not_wired' };
      const r = services.jobsApi.createJob({ type: 'render_segment', input: p.input, timeoutSec: p.timeoutSec || undefined, approvalId: ctx.approvalId, idempotencyKey: 'appr-' + ctx.approvalId });
      return { executed: true, status: 'executed', jobId: r.jobId }; },
    agent_code_execution: async (p, ctx) => { if (!services || !p || p.kind !== 'opencode_task') return { executed: false, status: 'not_wired' };
      const r = services.jobsApi.createJob({ type: 'opencode_task', input: { prompt: p.prompt }, timeoutSec: p.timeoutSec || undefined, approvalId: ctx.approvalId, idempotencyKey: 'appr-' + ctx.approvalId });
      return { executed: true, status: 'executed', jobId: r.jobId }; }
  };
  for (const a of EXTERNAL) executors[a] = async () => ({ executed: false, status: 'external_disabled', note: 'Подтверждено владельцем. Внешний вызов (оплата/публикация/рассылка) в этой сборке не выполняется.' });
  if (services && services.setApprovalCheck) services.setApprovalCheck((id, action, params) => world.approvalExecuting(id, action, params));
  world.setDeps({ checkPassword, sessionUser, executors }); // sessionUser: read-only lookup in the existing session store
  // MA_JOBS_BACKEND=jobsapi -> media-automation uses the Studio job engine (services.jobsApi); default stays local.
  let jobsBackend = { backend: 'local', reason: 'media-automation jobs module unavailable' };
  try {
    const J = require('../../media-automation/src/jobs');
    const local = null; // flag off: media-automation keeps its own LocalJobQueue (constructed by its caller, not here)
    const r = J.selectJobQueue({ env, local, jobsApi: services && services.jobsApi, videoRender: services && services.videoRender });
    jobsBackend = { backend: r.backend, reason: r.reason, queue: r.queue };
  } catch (e) { jobsBackend.reason += ': ' + e.message; }
  if (app && app.locals) app.locals.maJobs = jobsBackend;
  log('info', 'world', `Approval Center подключён; MA jobs backend: ${jobsBackend.backend} (${jobsBackend.reason})`);
  return { executors: Object.keys(executors), jobsBackend: { backend: jobsBackend.backend, reason: jobsBackend.reason } };
}
module.exports = { wireWorld, EXTERNAL };
