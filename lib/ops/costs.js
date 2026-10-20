// Cost Controller (STUDIO_OPS_COSTS=1): ledger of paid API calls, per-service daily/monthly budgets, warnings,
// block over budget unless explicitly confirmed (with Security Center: confirm token for 'cost-override').
// Currently the studio uses NO paid APIs (Ollama is local, Meta Graph is free) — the ledger is for future modules.
'use strict';
const fs = require('fs'), path = require('path');
function createCostController({ dir, now = Date.now, warnAt = 0.8, log = () => {} }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ledgerFile = path.join(dir, 'costs.jsonl'), budgetFile = path.join(dir, 'cost-budgets.json');
  const budgets = () => { try { return JSON.parse(fs.readFileSync(budgetFile, 'utf8')); } catch { return { default: { dailyUsd: 0, monthlyUsd: 0 } }; } }; // 0 = nothing paid allowed
  function setBudgets(b) {
    if (!b || typeof b !== 'object') throw new Error('Ожидается объект');
    const out = {}; for (const [s, v] of Object.entries(b)) { if (!/^[\w.-]{1,40}$/.test(s)) throw new Error('Неверное имя сервиса ' + s);
      const d = +v.dailyUsd, m = +v.monthlyUsd; if (!(d >= 0 && m >= 0 && d < 1e5 && m < 1e6)) throw new Error('Неверный бюджет ' + s); out[s] = { dailyUsd: d, monthlyUsd: m }; }
    if (!out.default) out.default = { dailyUsd: 0, monthlyUsd: 0 };
    fs.writeFileSync(budgetFile, JSON.stringify(out, null, 1), { mode: 0o600 }); return out;
  }
  const entries = () => { try { return fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const day = t => new Date(t).toISOString().slice(0, 10), month = t => new Date(t).toISOString().slice(0, 7);
  function spent(service, t = now()) { let d = 0, m = 0; for (const e of entries()) if (e.service === service) { if (e.at.slice(0, 10) === day(t)) d += e.usd; if (e.at.slice(0, 7) === month(t)) m += e.usd; } return { day: +d.toFixed(4), month: +m.toFixed(4) }; }
  const budgetOf = s => { const b = budgets(); return b[s] || b.default; };
  function check(service, usd) {
    const b = budgetOf(service), s = spent(service); const nd = s.day + usd, nm = s.month + usd;
    const over = nd > b.dailyUsd || nm > b.monthlyUsd; const warn = !over && (nd >= warnAt * b.dailyUsd || nm >= warnAt * b.monthlyUsd) && usd > 0;
    return { service, usd, spent: s, budget: b, allowed: !over, warn, reason: over ? `Превышение бюджета ${service}: день ${nd.toFixed(2)}/${b.dailyUsd}$, месяц ${nm.toFixed(2)}/${b.monthlyUsd}$` : null };
  }
  // Call BEFORE a paid request. confirmed=true only after an explicit owner confirmation.
  function authorize(service, usd, { confirmed = false, user = null, purpose = '' } = {}) {
    if (!(usd >= 0)) throw new Error('usd >= 0'); const c = check(service, usd);
    if (!c.allowed && !confirmed) { log('warn', 'costs', c.reason + ' — заблокировано'); return { ...c, blocked: true }; }
    if (c.warn) log('warn', 'costs', `Бюджет ${service} почти исчерпан (≥${warnAt * 100}%)`);
    return { ...c, blocked: false, override: !c.allowed && confirmed, user, purpose };
  }
  function record(service, usd, { user = null, purpose = '', ref = null, override = false } = {}) {
    if (!/^[\w.-]{1,40}$/.test(service) || !(usd >= 0)) throw new Error('Неверная запись');
    const e = { at: new Date(now()).toISOString(), service, usd: +(+usd).toFixed(6), user, purpose: String(purpose).slice(0, 200), ref, override };
    fs.appendFileSync(ledgerFile, JSON.stringify(e) + '\n', { mode: 0o600 }); return e;
  }
  function summary() { const b = budgets(); const services = new Set([...Object.keys(b).filter(k => k !== 'default'), ...entries().map(e => e.service)]);
    return { budgets: b, services: [...services].map(s => ({ service: s, ...spent(s), budget: budgetOf(s) })), recent: entries().slice(-20).reverse(), paidServicesInUse: entries().length > 0 }; }
  return { check, authorize, record, summary, budgets, setBudgets, entries };
}
module.exports = { createCostController };
