/**
 * Runs the QA suites on this branch and writes one JSON result.
 * Horizons is recorded and not re-run. Does not publish.
 *   node qa/regression/run.mjs [--out file.json]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportDir = path.join(root, 'qa/reports/stages-C-E');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function tapCounts(text, status) {
  const pick = label => {
    const match = text.match(new RegExp(`^# ${label} (\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const pass = pick('pass');
  const fail = pick('fail');
  const skipped = pick('skipped') || 0;
  const cancelled = pick('cancelled') || 0;
  if (pass == null || fail == null) {
    return { pass: status === 0 ? 1 : 0, fail: status === 0 ? 0 : 1, not_tested: 0, note: 'node:test summary missing' };
  }
  return { pass, fail, not_tested: skipped + cancelled };
}

function jsonCounts(text, status) {
  const report = parseJson(text);
  if (!report) {
    return status === 0
      ? { pass: 1, fail: 0, not_tested: 0, note: 'exit 0' }
      : { pass: 0, fail: 1, not_tested: 0, note: 'stdout was not JSON' };
  }
  if (report.ok === true && report.pass == null) {
    return { pass: 1, fail: 0, not_tested: 0, note: `${report.bugs} registry entries` };
  }
  return {
    pass: Number(report.pass) || 0,
    fail: Number(report.fail) || 0,
    not_tested: Number(report.not_tested) || 0,
    note: report.mode || report.note || ''
  };
}

function runSuite(suite) {
  fs.mkdirSync(path.dirname(suite.args.includes('--out') ? path.resolve(root, suite.args[suite.args.indexOf('--out') + 1]) : reportDir), { recursive: true });
  const started = Date.now();
  const result = spawnSync(process.execPath, suite.args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: suite.timeout || 300000
  });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const counts = suite.kind === 'tap' ? tapCounts(text, result.status) : jsonCounts(result.stdout || '', result.status);
  if (result.error) counts.note = `${counts.note || ''} ${result.error.message}`.trim();
  return {
    name: suite.name,
    ran: true,
    command: `${process.execPath} ${suite.args.join(' ')}`,
    exitCode: result.status,
    ms: Date.now() - started,
    pass: counts.pass,
    fail: counts.fail,
    not_tested: counts.not_tested,
    note: counts.note || ''
  };
}

const suites = [
  { name: 'bug-registry', kind: 'json', args: ['qa/bugs/registry.mjs', 'validate'] },
  { name: 'bug-registry-tests', kind: 'tap', args: ['--test', 'qa/bugs/test/registry.test.mjs'] },
  { name: 'content', kind: 'tap', args: ['--test', 'qa/content/test/content.test.mjs'] },
  { name: 'interfaces', kind: 'json', args: ['qa/interfaces/self-check.mjs'] },
  { name: 'release-gate-tests', kind: 'tap', args: ['--test', 'qa/release/test/gate.test.mjs'] },
  { name: 'video-self-test', kind: 'json', args: ['qa/content/video-qc.mjs', '--self-test', '--out', 'qa/reports/stages-C-E/video/self-test.json'] },
  { name: 'video-news-launch', kind: 'json', args: ['qa/content/video-qc.mjs', '--out', 'qa/reports/stages-C-E/video/news-launch.json'] },
  { name: 'api-smoke', kind: 'json', args: ['qa/smoke/api.mjs', '--out', 'qa/reports/stages-C-E/api/smoke.json'], timeout: 60000 },
  { name: 'site', kind: 'json', args: ['qa/site/moonkatty.mjs', '--out', 'qa/reports/stages-C-E/site/site.json'], timeout: 300000 }
];

const startedAt = new Date().toISOString();
const results = suites.map(runSuite);
results.push({
  name: 'horizons',
  ran: false,
  command: 'npm run qa:horizons',
  exitCode: null,
  ms: 0,
  pass: 0,
  fail: 0,
  not_tested: 1,
  note: 'Not re-run. moonkattymky/moonkatty-horizons is not cloneable here. Evidence remains qa/reports/2026-10-20/report.md. Blocked on horizons source access.'
});

const report = {
  contract: 'moonkatty.qa.regression/1',
  startedAt,
  finishedAt: new Date().toISOString(),
  note: 'Counts are check results, not a score. Horizons was not re-run.',
  pass: results.reduce((sum, item) => sum + item.pass, 0),
  fail: results.reduce((sum, item) => sum + item.fail, 0),
  not_tested: results.reduce((sum, item) => sum + item.not_tested, 0),
  testsGreen: results.filter(item => item.ran).every(item => item.fail === 0),
  suites: results
};

const text = JSON.stringify(report, null, 2);
const out = path.resolve(root, arg('--out') || path.join(reportDir, 'regression.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text + '\n');
console.log(text);
process.exit(report.fail ? 1 : 0);
