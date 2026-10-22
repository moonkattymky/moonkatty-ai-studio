// Step 2 wiring (kept out of server.js): Approval Center deps for createWorld + MA_JOBS_BACKEND selection.
// server.js calls this once after world.boot(). Nothing here publishes, pays or mails: external owner
// actions are recorded as approved but return executed:false / status 'external_disabled'.
'use strict';
const EXTERNAL = ['spending', 'paid_ads', 'outreach_new_clients', 'contracts', 'payment_settings', 'mass_mailing', 'editorial_publication'];
function wireWorld({ app, world, services, checkPassword, sessionUser, sessionIssuedAt, env = process.env, log = () => {} }) {
  const executors = {
    critical_settings: async (p, ctx) => {
      // E2E-UC: owner-approved app update (payload kind app_update) → Update Center executor registered by update-center-mount.js
      if (p && p.kind === 'app_update') { const ex = app && app.locals && app.locals.updateCenterExecutor; if (typeof ex !== 'function') return { executed: false, status: 'not_wired', note: 'Update Center не подключён' }; return ex(p, ctx); }
      const v = world.applySavings(p); return { executed: true, status: 'executed', applied: v }; }
  };
  for (const a of EXTERNAL) executors[a] = async () => ({ executed: false, status: 'external_disabled', note: 'Подтверждено владельцем. Внешний вызов (оплата/публикация/рассылка) в этой сборке не выполняется.' });
  world.setDeps({ checkPassword, sessionUser, sessionIssuedAt, executors }); // sessionUser: read-only lookup in the existing session store
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
