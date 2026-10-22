/**
 * Static dashboard from a regression JSON file.
 * Counts are check results. This page does not invent a score.
 *   node qa/dashboard/build.mjs [--in regression.json] [--out dashboard.html]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

export function render(report) {
  const rows = (report.suites || []).map(suite => `<tr>
    <td>${esc(suite.name)}</td>
    <td>${esc(suite.ran ? 'ran' : 'not run')}</td>
    <td>${esc(suite.pass)}</td>
    <td>${esc(suite.fail)}</td>
    <td>${esc(suite.not_tested)}</td>
    <td>${esc(suite.note || '')}</td>
  </tr>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MOONKATTY QA — measured checks</title>
  <style>
    body { font: 16px/1.45 sans-serif; margin: 2rem; color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
  </style>
</head>
<body>
  <h1>Measured checks</h1>
  <p>These counts are check results. They are not a quality score.</p>
  <p>Finished ${esc(report.finishedAt || '')}. Pass ${esc(report.pass)}, fail ${esc(report.fail)}, not tested ${esc(report.not_tested)}.</p>
  <table>
    <thead><tr><th>Suite</th><th>Run</th><th>Pass</th><th>Fail</th><th>Not tested</th><th>Note</th></tr></thead>
    <tbody>
${rows}
    <tr><td>Total</td><td></td><td>${esc(report.pass)}</td><td>${esc(report.fail)}</td><td>${esc(report.not_tested)}</td><td></td></tr>
    </tbody>
  </table>
</body>
</html>
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const input = arg('--in') || path.join(root, 'qa/reports/stages-C-E/regression.json');
  const report = JSON.parse(fs.readFileSync(input, 'utf8'));
  const html = render(report);
  const out = arg('--out') || path.join(root, 'qa/reports/stages-C-E/dashboard.html');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(JSON.stringify({ ok: true, out, pass: report.pass, fail: report.fail, not_tested: report.not_tested }));
}
