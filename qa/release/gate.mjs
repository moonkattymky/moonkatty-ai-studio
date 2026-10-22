/**
 * Release gate. Prints GO or NO-GO.
 * GO requires security PASS, tests green, fact-check done, and the owner flag.
 *   node qa/release/gate.mjs [--regression file] [--out file]
 * QA_FACT_CHECK=1 and QA_OWNER_APPROVAL=1 override the flags file for a drill.
 * This script does not publish.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function decide({ security, testsGreen, factCheckDone, ownerApproval }) {
  const criteria = [
    { id: 'security', required: 'PASS', actual: security ?? null, pass: security === 'PASS' },
    { id: 'tests', required: 'green', actual: testsGreen === true ? 'green' : 'not green', pass: testsGreen === true },
    { id: 'factCheck', required: true, actual: factCheckDone === true, pass: factCheckDone === true },
    { id: 'ownerApproval', required: true, actual: ownerApproval === true, pass: ownerApproval === true }
  ];
  const reasons = [];
  if (!criteria[0].pass) reasons.push('security result is not PASS');
  if (!criteria[1].pass) reasons.push('tests are not green');
  if (!criteria[2].pass) reasons.push('fact-check is not done');
  if (!criteria[3].pass) reasons.push('owner approval flag is not set');
  return { decision: reasons.length ? 'NO-GO' : 'GO', criteria, reasons };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const security = readJson(path.join(root, 'qa/release/security-status.json'));
  const flags = readJson(path.join(root, 'qa/release/flags.json'));
  const regressionPath = arg('--regression') || path.join(root, 'qa/reports/stages-C-E/regression.json');
  let testsGreen = false;
  let regression = null;
  if (fs.existsSync(regressionPath)) {
    regression = readJson(regressionPath);
    testsGreen = regression.testsGreen === true && regression.fail === 0;
  }
  const factCheckDone = process.env.QA_FACT_CHECK === '1' ? true : flags.factCheckDone === true;
  const ownerApproval = process.env.QA_OWNER_APPROVAL === '1' ? true : flags.ownerApproval === true;
  const result = decide({ security: security.result, testsGreen, factCheckDone, ownerApproval });
  const report = {
    contract: 'moonkatty.qa.release-gate/1',
    at: new Date().toISOString(),
    decision: result.decision,
    criteria: result.criteria,
    reasons: result.reasons,
    securityScope: security.scope,
    securityReport: security.report,
    securityCommit: security.commit,
    securityNote: security.note,
    regression: path.relative(root, regressionPath),
    note: 'GO needs every criterion. Counts elsewhere are check results, not a score.'
  };
  const text = JSON.stringify(report, null, 2);
  const out = arg('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, text + '\n');
  }
  console.log(text);
  process.exit(report.decision === 'GO' ? 0 : 2);
}
