// Money ledger (STUDIO_OPS_MONEY=1) — the single source of truth for studio money (agreed with Studio 5, docs/ops/MONETIZATION_CONTRACT.md).
// Three DISTINCT kinds that are never mixed in totals: actual (real receipt/payment, proof required), estimate (platform-reported or
// computed, basis required), forecast (plan, basis required). No FX conversion (no invented rates): totals are per currency.
// Append-only hash-chained JSONL (0600); corrections = void entries, never deletion. Empty state when no data — no invented numbers.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const KINDS = ['actual', 'estimate', 'forecast']; const DIRECTIONS = ['income', 'expense'];
const CATEGORIES = ['platform_payout', 'ad_revenue', 'sponsor', 'client', 'donation', 'merch', 'api_cost', 'software', 'hardware', 'hosting', 'contractor', 'tax_fee', 'other'];
const PROOF_TYPES = ['receipt', 'invoice', 'bank_statement', 'payout_report', 'contract', 'url', 'file'];
const NAMESPACES = ['moonkatty_news', 'moonkatty_project', 'moonkatty_shared'];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// projectId '<namespace>:<slug>' (Studio 5). Pluggable resolver: Studio 5 resolveProject(projectId) when present; unknown → 'unassigned', never dropped.
function defaultResolver(pid) { const m = /^([a-z_]+):([a-z0-9][a-z0-9_-]{0,63})$/.exec(pid || ''); if (!m || !NAMESPACES.includes(m[1])) return null; return { projectId: pid, namespace: m[1], slug: m[2], resolvedBy: 'format' }; }
function createLedger({ dir, now = Date.now, notify = async () => {}, log = () => {}, costs = null } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const file = path.join(dir, 'ledger.jsonl'), budgetFile = path.join(dir, 'ledger-budgets.json');
  let resolver = defaultResolver; const alerted = new Set();
  const read = () => { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); };
  function verify() { let prev = '0'.repeat(64); const rows = read(); for (let i = 0; i < rows.length; i++) { const { hash, ...r } = rows[i]; if (r.prev !== prev || sha(JSON.stringify(r)) !== hash) return { ok: false, brokenAt: i, count: rows.length }; prev = hash; } return { ok: true, count: rows.length, head: prev }; }
  function append(rec) { const v = verify(); if (!v.ok) { alert('ledger-integrity', 'Финансовый журнал повреждён', `Нарушена целостность цепочки на записи ${v.brokenAt}. Запись новых операций остановлена.`); throw Object.assign(new Error('Целостность журнала нарушена — запись остановлена'), { status: 409 }); }
    const r = { ...rec, prev: v.head || '0'.repeat(64) }; const line = JSON.stringify({ ...r, hash: sha(JSON.stringify(r)) }); fs.appendFileSync(file, line + '\n', { mode: 0o600 }); return JSON.parse(line); }
  function alert(key, title, body) { if (alerted.has(key)) return; alerted.add(key); log('error', 'money', `${title}: ${body}`); notify({ title, body, level: 'critical' }).catch(() => {}); }
  const money = v => { const n = typeof v === 'string' ? v.trim().replace(',', '.') : v; if (!/^-?\d+(\.\d{1,2})?$/.test(String(n))) throw new Error('amount: число с ≤2 знаками после точки'); const minor = Math.round(+n * 100); if (!(minor > 0) || minor > 1e13) throw new Error('amount должен быть > 0'); return minor; };
  function validate(e, { by } = {}) {
    const err = m => { throw Object.assign(new Error(m), { status: 400 }); };
    if (!KINDS.includes(e.kind)) err('kind: actual | estimate | forecast'); if (!DIRECTIONS.includes(e.direction)) err('direction: income | expense');
    const amountMinor = e.amountMinor != null ? (Number.isInteger(+e.amountMinor) && +e.amountMinor > 0 ? +e.amountMinor : err('amountMinor')) : money(e.amount);
    const currency = String(e.currency || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) err('currency: ISO-4217, например USD, EUR, ILS');
    const date = String(e.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) err('date: YYYY-MM-DD');
    if (e.kind === 'actual' && Date.parse(date) > now() + 86400000) err('actual не может быть датирован будущим — используйте forecast');
    const category = CATEGORIES.includes(e.category) ? e.category : err('category: ' + CATEGORIES.join(', '));
    const source = String(e.source || 'manual').slice(0, 80);
    let proof = null; if (e.proof && (e.proof.type || e.proof.ref)) { if (!PROOF_TYPES.includes(e.proof.type)) err('proof.type: ' + PROOF_TYPES.join(', ')); if (!String(e.proof.ref || '').trim()) err('proof.ref обязателен');
      proof = { type: e.proof.type, ref: String(e.proof.ref).slice(0, 300), ...(e.proof.sha256 ? { sha256: /^[a-f0-9]{64}$/.test(e.proof.sha256) ? e.proof.sha256 : err('proof.sha256') } : {}) }; }
    if (e.kind === 'actual' && !proof) err('Для actual обязательно подтверждение (proof: квитанция, счёт, выписка, отчёт о выплате…)');
    const basis = e.basis ? String(e.basis).slice(0, 500) : null; if (e.kind !== 'actual' && !basis) err('Для estimate/forecast обязательно basis — откуда оценка (метод/источник)');
    const pidRaw = e.projectId == null || e.projectId === '' ? null : String(e.projectId).slice(0, 140);
    return { kind: e.kind, direction: e.direction, amountMinor, currency, date, category, source, proof, basis, counterparty: e.counterparty ? String(e.counterparty).slice(0, 120) : null,
      projectId: pidRaw, dealId: e.dealId ? String(e.dealId).slice(0, 40) : null, note: e.note ? String(e.note).slice(0, 500) : null, idempotencyKey: e.idempotencyKey ? String(e.idempotencyKey).slice(0, 200) : null, createdBy: by || null };
  }
  function add(e, opts = {}) { const v = validate(e, opts); const rows = read();
    if (v.idempotencyKey) { const ex = rows.find(r => r.type === 'entry' && r.idempotencyKey === v.idempotencyKey); if (ex) return { duplicate: true, entry: view(ex, rows) }; }
    const r = append({ type: 'entry', id: 'le_' + crypto.randomBytes(8).toString('hex'), at: new Date(now()).toISOString(), ...v }); checkBudgets(); return { entry: view(r, read()) }; }
  function voidEntry(id, reason, by) { const rows = read(); const e = rows.find(r => r.type === 'entry' && r.id === id); if (!e) throw Object.assign(new Error('not found'), { status: 404 });
    if (rows.some(r => r.type === 'void' && r.entryId === id)) throw Object.assign(new Error('уже аннулирована'), { status: 409 }); if (!String(reason || '').trim()) throw Object.assign(new Error('reason обязателен'), { status: 400 });
    append({ type: 'void', entryId: id, reason: String(reason).slice(0, 300), by: by || null, at: new Date(now()).toISOString() }); return { ok: true }; }
  function resolve(pid) { if (!pid) return { projectId: null, bucket: 'unassigned' }; let r = null; try { r = resolver(pid); } catch { r = null; } return r ? { ...r, bucket: r.projectId || pid } : { projectId: pid, bucket: 'unassigned', unresolved: true }; }
  function view(r, rows) { const { prev, hash, type, ...e } = r; const voided = rows.find(x => x.type === 'void' && x.entryId === r.id); return { ...e, amount: (r.amountMinor / 100).toFixed(2), project: resolve(r.projectId), voided: voided ? { at: voided.at, reason: voided.reason } : null }; }
  // Cost Controller rows are shown read-only (not copied): metered API charges are estimates until an invoice is entered as actual.
  function costRows() { if (!costs || !costs.entries) return []; try { return costs.entries().map(c => ({ id: 'cc_' + sha(JSON.stringify(c)).slice(0, 16), kind: 'estimate', direction: 'expense', amountMinor: Math.round(+c.usd * 100), currency: 'USD', date: String(c.at || '').slice(0, 10), category: 'api_cost', source: 'cost-controller', proof: null, basis: 'учёт платного вызова Cost Controller (' + (c.service || '?') + ')', projectId: c.projectId || null, readOnly: true, amount: (+c.usd).toFixed(2), project: resolve(c.projectId) })).filter(x => x.amountMinor > 0); } catch { return []; } }
  // Stable read API for Studio 5 (si_cost_entries adapter) and the panel.
  function listEntries({ kind, direction, projectId, from, to, includeVoided = false, includeCostController = true } = {}) {
    const rows = read(); let out = rows.filter(r => r.type === 'entry').map(r => view(r, rows)); if (includeCostController) out = out.concat(costRows());
    return out.filter(e => (includeVoided || !e.voided) && (!kind || e.kind === kind) && (!direction || e.direction === direction) && (!projectId || e.projectId === projectId || (projectId === 'unassigned' && e.project.bucket === 'unassigned'))
      && (!from || e.date >= from) && (!to || e.date <= to)).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  }
  // totals per kind × direction × currency; never mixed. Empty object when there is no data.
  function totals(filter = {}) { const t = {}; for (const e of listEntries(filter)) { const k = ((t[e.kind] ||= {})[e.direction] ||= {}); k[e.currency] = (k[e.currency] || 0) + e.amountMinor; }
    const fmt = {}; for (const [k, d] of Object.entries(t)) { fmt[k] = {}; for (const [dir, cur] of Object.entries(d)) { fmt[k][dir] = {}; for (const [c, v] of Object.entries(cur)) fmt[k][dir][c] = (v / 100).toFixed(2); } }
    return fmt; }
  function summary(filter = {}) { const entries = listEntries(filter); const byProject = {}; for (const e of entries) { const b = e.project.bucket; const x = ((byProject[b] ||= {})[e.kind] ||= {}); const d = (x[e.direction] ||= {}); d[e.currency] = (((+d[e.currency] || 0) * 100 + e.amountMinor) / 100).toFixed(2); }
    return { empty: entries.length === 0, totals: totals(filter), byProject, integrity: verify(), note: 'actual, estimate и forecast считаются раздельно и не суммируются; валюты не конвертируются' }; }
  // ---- import (CSV) ----
  function parseCsv(text) { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
    if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows.filter(r => r.some(x => x.trim() !== '')); }
  function importCsv(text, { dryRun = false, by, source = 'import:csv' } = {}) { const rows = parseCsv(String(text || '')); if (rows.length < 2) throw Object.assign(new Error('CSV: нужна строка заголовков и данные'), { status: 400 });
    const h = rows[0].map(x => x.trim()); const need = ['kind', 'direction', 'amount', 'currency', 'date', 'category']; const miss = need.filter(k => !h.includes(k)); if (miss.length) throw Object.assign(new Error('CSV: нет колонок ' + miss.join(', ')), { status: 400 });
    const res = { imported: 0, duplicates: 0, errors: [], dryRun }; rows.slice(1).forEach((r, i) => { const o = Object.fromEntries(h.map((k, j) => [k, (r[j] || '').trim()]));
      const e = { ...o, source: o.source || source, proof: o.proof_type || o.proof_ref ? { type: o.proof_type, ref: o.proof_ref, sha256: o.proof_sha256 || undefined } : null, idempotencyKey: o.idempotencyKey || 'csv:' + sha(r.join('\u0001')).slice(0, 32) };
      try { if (dryRun) { validate(e, { by }); res.imported++; } else { const a = add(e, { by }); a.duplicate ? res.duplicates++ : res.imported++; } } catch (x) { res.errors.push({ line: i + 2, error: x.message }); } });
    if (res.errors.length && !dryRun) log('warn', 'money', `Импорт: ${res.errors.length} строк с ошибками`); return res; }
  // ---- budgets & alerts (via existing notifier) ----
  const budgets = () => { try { return JSON.parse(fs.readFileSync(budgetFile, 'utf8')); } catch { return {}; } };
  function setBudgets(b) { const out = {}; for (const [cat, v] of Object.entries(b || {})) { if (!CATEGORIES.includes(cat) && cat !== 'total') throw Object.assign(new Error('категория ' + cat), { status: 400 }); const cur = String(v.currency || '').toUpperCase(); const m = +v.monthly;
    if (!/^[A-Z]{3}$/.test(cur) || !(m >= 0)) throw Object.assign(new Error('бюджет ' + cat + ': {monthly, currency}'), { status: 400 }); out[cat] = { monthly: m, currency: cur }; } fs.writeFileSync(budgetFile, JSON.stringify(out, null, 1), { mode: 0o600 }); checkBudgets(); return out; }
  function checkBudgets() { const b = budgets(); const month = new Date(now()).toISOString().slice(0, 7); const res = [];
    for (const [cat, v] of Object.entries(b)) { const spent = listEntries({ kind: 'actual', direction: 'expense', from: month + '-01', to: month + '-31' }).filter(e => (cat === 'total' || e.category === cat) && e.currency === v.currency).reduce((a, e) => a + e.amountMinor, 0) / 100;
      const r = { category: cat, currency: v.currency, monthly: v.monthly, spentActual: spent.toFixed(2), over: spent > v.monthly, warn: spent >= 0.8 * v.monthly }; res.push(r);
      if (r.over) alert(`budget:${month}:${cat}`, 'Превышен бюджет', `${cat}: фактические расходы ${r.spentActual} ${v.currency} > ${v.monthly} ${v.currency} за ${month}`); }
    return res; }
  const v0 = verify(); if (!v0.ok) alert('ledger-integrity', 'Финансовый журнал повреждён', `Нарушена целостность цепочки на записи ${v0.brokenAt}`);
  return { add, voidEntry, listEntries, totals, summary, importCsv, verify, setBudgets, budgets, checkBudgets, setResolver: fn => { resolver = typeof fn === 'function' ? pid => fn(pid) || defaultResolver(pid) : defaultResolver; }, resolve, file };
}
module.exports = { createLedger, KINDS, DIRECTIONS, CATEGORIES, PROOF_TYPES, NAMESPACES, defaultResolver };
