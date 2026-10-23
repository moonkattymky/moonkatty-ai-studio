// Redacted diagnostic report (JSON and Markdown). Free text goes through redact().
'use strict';
const { redact } = require('./redact');

function scrubChecks(checks, sec) {
  return (checks || []).map(c => ({
    id: c.id, status: c.status,
    summary: redact(c.summary || '', sec),
    data: scrubData(c.data, sec)
  }));
}

function scrubData(data, sec) {
  if (data == null) return data;
  if (typeof data === 'string') return redact(data, sec);
  if (Array.isArray(data)) return data.map(x => scrubData(x, sec));
  if (typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'sha256' || k === 'hashes' || k === 'subjectId') out[k] = v;
      else out[k] = scrubData(v, sec);
    }
    return out;
  }
  return data;
}

function build(report, sec) {
  const checks = scrubChecks(report.checks, sec);
  return {
    app: 'moonkatty-ai-studio',
    tool: 'system-doctor',
    at: new Date().toISOString(),
    kind: report.kind || 'report',
    platform: process.platform,
    checks,
    alerts: (report.alerts || []).map(a => ({ ...a, summary: redact(a.summary || '', sec) }))
  };
}

function markdown(report, sec) {
  const j = build(report, sec);
  const lines = ['# System Doctor', '', 'Время: ' + j.at, 'Платформа: ' + j.platform, ''];
  for (const c of j.checks) lines.push(`- **${c.id}** ${c.status} — ${c.summary}`);
  if (j.alerts.length) {
    lines.push('', '## Тревоги', '');
    for (const a of j.alerts) lines.push(`- ${a.status} ${a.id}: ${a.summary}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { build, markdown, scrubChecks };
