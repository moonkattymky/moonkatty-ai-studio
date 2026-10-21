// Ledger math. Income counts only when payout_confirmed and not demo.
// Views are rejected. Missing totals stay null so the UI can say НЕТ ДАННЫХ, never a fake zero.
'use strict';
const ND = 'НЕТ ДАННЫХ';
const STREAMS = ['games', 'news', 'main_media', 'ad_services', 'sponsors', 'affiliates', 'other_legal'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function cents(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const c = Math.round(n * 100); if (Math.abs(n * 100 - c) > 1e-6) return null; return c;
}
function money(c) { if (c == null) return ND; const a = Math.abs(c); return { usd: c / 100, label: (c < 0 ? '-' : '') + '$' + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0') }; }
function rowFrom(o) {
  if (!o || typeof o !== 'object') return { error: 'запись не объект' };
  if (['views', 'reach', 'impressions'].includes(o.kind) || ['views', 'reach', 'impressions'].includes(o.metric) || o.fabricated === true) return { error: 'просмотры и охват не принимаются в выручку', code: 'fake_financials' };
  if (!DATE.test(String(o.date || ''))) return { error: 'дата YYYY-MM-DD' };
  if (!STREAMS.includes(o.stream)) return { error: 'неизвестное направление' };
  if (o.kind !== 'income' && o.kind !== 'expense') return { error: 'kind: income или expense' };
  const amount = amountOf(o); if (amount == null) return { error: 'сумма: целое в минорных единицах или число с не более чем 2 знаками' };
  const flag = v => /^(1|true|yes|да)$/i.test(String(v));
  const demo = flag(o.demo);
  const currency = String(o.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'валюта: три буквы' };
  if (o.kind === 'expense') {
    const platform = o.platform || null;
    if (platform && !/^[a-z0-9-]{1,40}$/.test(platform)) return { error: 'некорректный id площадки' };
    return { row: base(o, { platform, amount, currency, payout_id: null, state: 'confirmed', payout_confirmed: 0, confirmation_source: String(o.confirmation_source || 'owner:expense').slice(0, 120), demo }) };
  }
  if (!/^[a-z0-9-]{1,40}$/.test(String(o.platform || ''))) return { error: 'нужна площадка' };
  const payout_id = String(o.payout_id || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(payout_id)) return { error: 'нужен payout_id' };
  const state = o.state || (flag(o.payout_confirmed) ? 'confirmed' : 'estimate');
  if (!['confirmed', 'estimate', 'accrued'].includes(state)) return { error: 'state: confirmed, estimate или accrued' };
  const confirmation_source = String(o.confirmation_source || '').trim();
  if (!confirmation_source) return { error: 'нужен источник подтверждения' };
  return { row: base(o, { platform: o.platform, amount, currency, payout_id, state, payout_confirmed: state === 'confirmed' ? 1 : 0, confirmation_source: confirmation_source.slice(0, 120), demo }) };
}
function amountOf(o) {
  if (o.amount_minor != null && o.amount_minor !== '') {
    const n = typeof o.amount_minor === 'number' ? o.amount_minor : Number(o.amount_minor);
    if (!Number.isInteger(n) || n < 0) return null; return n;
  }
  return cents(typeof o.amount_usd === 'number' ? o.amount_usd : Number(o.amount_usd));
}
function base(o, x) {
  return { booked_on: o.date, stream: o.stream, platform: x.platform, kind: o.kind, amount_cents: x.amount, currency: x.currency, payout_id: x.payout_id, payout_confirmed: x.payout_confirmed, state: x.state, confirmation_source: x.confirmation_source, demo: x.demo ? 1 : 0, source: 'import', note: String(o.note || '').slice(0, 300) };
}
function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (!lines.length) return { error: 'пустой CSV' };
  const head = lines[0].split(',').map(s => s.trim()); const need = ['date', 'stream', 'kind', 'amount_usd'];
  if (need.some(k => !head.includes(k))) return { error: 'CSV: нужны колонки date,stream,kind,amount_usd' };
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(','); const o = {}; head.forEach((h, i) => o[h] = (cells[i] || '').trim());
    if (o.amount_usd !== '') o.amount_usd = Number(o.amount_usd);
    if (o.amount_minor !== '' && o.amount_minor != null) o.amount_minor = Number(o.amount_minor);
    if (o.platform === '') o.platform = null;
    if (o.payout_id === '') o.payout_id = null;
    const r = rowFrom(o); if (r.error) return { error: 'строка ' + (out.length + 2) + ': ' + r.error, code: r.code }; out.push(r.row);
  }
  return { rows: out };
}
function parseImport(body) {
  if (!body || typeof body !== 'object') return { error: 'нет тела' };
  if (body.fabricated === true || body.action === 'fake_financials') return { error: 'fake_financials', code: 'fake_financials' };
  if (typeof body.csv === 'string') return parseCsv(body.csv);
  if (!Array.isArray(body.entries)) return { error: 'ожидается entries или csv' };
  if (body.entries.length > 5000) return { error: 'слишком много строк' };
  const rows = [];
  for (const [i, e] of body.entries.entries()) { const r = rowFrom(e); if (r.error) return { error: 'entries[' + i + ']: ' + r.error, code: r.code }; rows.push(r.row); }
  return { rows };
}
function sum(rows, pred) { let s = 0, n = 0; for (const r of rows) if (pred(r)) { s += r.amount_cents; n++; } return n ? s : null; }
function real(r) { return !r.demo; }
function isCash(r) { return r.kind === 'income' && r.state === 'confirmed' && r.payout_id && real(r); }
function isAccrued(r) { return r.kind === 'income' && r.state === 'accrued' && real(r); }
function isEstimate(r) { return r.kind === 'income' && r.state === 'estimate' && real(r); }
function confirmedIncome(r) { return isCash(r); }
function samePayout(a, b) {
  return a.kind === b.kind && a.amount_cents === b.amount_cents && a.currency === b.currency && a.state === b.state && a.booked_on === b.booked_on && a.demo === b.demo && a.stream === b.stream;
}
function realExpense(r) { return r.kind === 'expense' && !r.demo; }
function inPeriod(r, from, to) { return r.booked_on >= from && r.booked_on <= to; }
function report(rows, { now = new Date(), goals = [1000, 5000, 10000, 20000], savings = { item: 'Mac Studio', target_usd: null }, newPlayers = null } = {}) {
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7), year = day.slice(0, 4);
  const usd = pred => r => pred(r) && (r.currency || 'USD') === 'USD';
  const bucket = (from, to, pred) => sum(rows.filter(r => inPeriod(r, from, to)), pred);
  const pack = (from, to) => ({ revenue: money(bucket(from, to, usd(confirmedIncome))), opex: money(bucket(from, to, usd(realExpense))) });
  const d = pack(day, day), m = pack(month + '-01', month + '-31'), y = pack(year + '-01-01', year + '-12-31');
  const pretaxOf = (rev, opex) => rev === ND || opex === ND ? ND : money(Math.round(rev.usd * 100) - Math.round(opex.usd * 100));
  const by = (keyFn, pred) => { const ids = [...new Set(rows.map(keyFn).filter(Boolean))]; const o = {}; for (const id of ids) o[id] = money(sum(rows, r => keyFn(r) === id && pred(r))); return o; };
  const monthRows = rows.filter(r => r.booked_on.startsWith(month));
  const goalsOut = goals.map(t => { const rev = m.revenue === ND ? null : Math.round(m.revenue.usd * 100); const pct = rev == null ? ND : Math.floor(rev * 100 / (t * 100)); return { target_usd: t, label: '$' + t, progress: pct === ND ? ND : { percent: pct, label: pct + '%' } }; });
  const loss = [];
  for (const s of STREAMS) {
    const inc = sum(monthRows, r => r.stream === s && confirmedIncome(r));
    const exp = sum(monthRows, r => r.stream === s && realExpense(r));
    if (inc != null && exp != null && exp > inc) loss.push({ stream: s, revenue: money(inc), opex: money(exp) });
    else if (exp != null && inc == null) loss.push({ stream: s, revenue: ND, opex: money(exp), note: 'расход без подтверждённой выплаты' });
  }
  const accruedMonth = money(bucket(month + '-01', month + '-31', usd(isAccrued)));
  const estimateMonth = money(bucket(month + '-01', month + '-31', usd(isEstimate)));
  const ad = sum(monthRows, r => r.stream === 'ad_services' && realExpense(r) && (r.currency || 'USD') === 'USD');
  const cac = ad != null && typeof newPlayers === 'number' && newPlayers > 0 ? money(Math.floor(ad / newPlayers)) : ND;
  const days = new Set(rows.filter(confirmedIncome).map(r => r.booked_on));
  const forecast = days.size >= 7 ? { label: 'ПРОГНОЗ', note: 'не входит в факт', days: days.size } : ND;
  const demoSum = sum(rows, r => r.demo && r.kind === 'income');
  const months = {};
  for (const r of rows) { const k = r.booked_on.slice(0, 7); months[k] = months[k] || { month: k, income: [], expense: [] }; (confirmedIncome(r) ? months[k].income : realExpense(r) ? months[k].expense : []).push(r); }
  const history = Object.keys(months).sort().map(k => ({ month: k, revenue: money(sum(months[k].income, () => true)), opex: money(sum(months[k].expense, () => true)) }));
  const target = savings && savings.target_usd != null ? cents(savings.target_usd) : null;
  const pretaxYear = pretaxOf(y.revenue, y.opex);
  const recommendations = [];
  if (!rows.some(confirmedIncome) && !rows.some(realExpense)) recommendations.push('Нет данных для рекомендаций. Импортируйте подтверждённые выплаты и расходы.');
  for (const x of loss) recommendations.push(x.note ? `${x.stream}: ${x.note} (${x.opex.label})` : `${x.stream}: расход выше подтверждённой выплаты (${x.opex.label} против ${x.revenue.label})`);
  if (m.revenue !== ND) recommendations.push('Подтверждённая выручка месяца ' + m.revenue.label + '. Это не прогноз.');
  if (forecast !== ND) recommendations.push('Метка ПРОГНОЗ не входит в факт выручки.');
  return {
    day: d.revenue, month: m.revenue, year: y.revenue,
    accrued: { month: accruedMonth, note: 'начислено, не кэш' },
    estimates: { month: estimateMonth, note: 'не подтверждено' },
    opex: { day: d.opex, month: m.opex, year: y.opex },
    pretax: { day: pretaxOf(d.revenue, d.opex), month: pretaxOf(m.revenue, m.opex), year: pretaxYear },
    byStream: by(r => r.stream, confirmedIncome),
    goals: goalsOut, history: history.length ? history : ND, loss, cac,
    unconfirmed: rows.filter(r => r.kind === 'income' && !r.payout_confirmed && !r.demo).length,
    demo: demoSum == null ? ND : { label: 'DEMO ' + money(demoSum).label, excludedFromActual: true },
    forecast, viewsAreRevenue: false,
    savings: { item: (savings && savings.item) || 'Mac Studio', target: target == null ? ND : money(target), progress: target == null || target === 0 || pretaxYear === ND ? ND : { percent: Math.floor(Math.round(pretaxYear.usd * 100) * 100 / target), label: 'от подтверждённого результата до налога' } },
    recommendations
  };
}
function platformsFrom(rows, channels) {
  return (channels || []).map(ch => ({ id: ch.id, name: ch.name, project: ch.project || null, revenue: money(sum(rows, r => r.platform === ch.id && confirmedIncome(r))), opex: money(sum(rows, r => r.platform === ch.id && realExpense(r))) }));
}
module.exports = { ND, STREAMS, parseImport, report, platformsFrom, money, cents, confirmedIncome, isCash, isAccrued, isEstimate, samePayout };
