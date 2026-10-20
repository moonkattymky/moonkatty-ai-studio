#!/usr/bin/env node
// Update verification CLI — never installs anything.
//   node ops/update.js --repo <dir> --ref <tag|commit> [--zip <file> (--sha256 <hex> | --sums <SHA256SUMS>)] [--app <.app>] [--data <dir>]
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const { createUpdateManager } = require('../lib/ops/update.js');
const a = process.argv.slice(2); const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
(async () => {
  const um = createUpdateManager(); const report = [];
  if (opt('--repo')) report.push({ step: 'origin', ...(await um.verifyOrigin({ repoDir: opt('--repo'), ref: opt('--ref') || 'HEAD' })) });
  if (opt('--zip')) report.push({ step: 'artifact', ...(await um.verifyArtifact({ file: opt('--zip'), sha256: opt('--sha256'), sumsFile: opt('--sums') })) });
  if (opt('--app')) report.push({ step: 'signature', ...(await um.verifySignature({ appPath: opt('--app') })) });
  const dataDir = opt('--data') || process.env.STUDIO_DATA_DIR || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MOONKATTY AI STUDIO') : null);
  if (dataDir && fs.existsSync(path.join(dataDir, 'studio.db'))) { const db = require('../lib/db.js').open(path.join(dataDir, 'studio.db')); try { report.push({ step: 'schema', ...um.schemaCheck(db) }); } finally { db.close(); } }
  if (!report.length) { console.log('usage: --repo <dir> --ref <ref> [--zip f --sha256 x|--sums f] [--app path] [--data dir]'); process.exit(2); }
  const plan = um.plan({ report, backupId: opt('--backup-id') });
  console.log(JSON.stringify({ report, plan }, null, 1)); process.exit(plan.allowed ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
