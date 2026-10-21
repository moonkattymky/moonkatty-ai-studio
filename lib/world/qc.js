// Evidence-based Creative Director score. Client-supplied totals are ignored.
// Missing evidence scores 0. News cannot pass without a recorded fact-check, at any score.
'use strict';
const GENERIC = /^(subscribe|like and subscribe|watch till the end|смотрите до конца|подпишись|подписывайтесь)$/i;
function score(input, { pass = 70, maxRegenerations = 3 } = {}) {
  const ev = input && typeof input === 'object' ? input : {};
  const findings = []; const weak = [];
  const add = (name, max, points, why) => { const p = Math.max(0, Math.min(max, points | 0)); if (p < max) weak.push(name + ': ' + why); return { name, max, points: p, why }; };
  const text = String(ev.script?.text || '');
  const script = add('script_originality', 20,
    (text.length >= 80 ? 8 : 0) + (String(ev.script?.difference || '').length >= 40 ? 6 : 0) + (ev.script?.plagiarism === false && text ? 6 : 0),
    text.length >= 80 ? 'часть пунктов без доказательства' : 'нет текста сценария');
  const hookText = String(ev.hook?.text || '').trim();
  const hookOk = hookText.length >= 12 && !GENERIC.test(hookText);
  const ret = String(ev.hook?.retentionEvidence || '');
  const hook = add('hook_retention', 20, (hookOk ? 10 : 0) + ((/\d+:\d\d/.test(ret) || ret.length >= 20) && hookOk ? 10 : 0), hookOk ? 'нет доказательства удержания' : 'хук пустой или общий');
  const assets = Array.isArray(ev.visuals?.assets) ? ev.visuals.assets.filter(Boolean) : [];
  const defects = Array.isArray(ev.technical?.defects) ? ev.technical.defects : [];
  const critical = defects.some(d => d && (d.critical === true || d.severity === 'critical'));
  const visuals = add('visuals', 20, (assets.length ? 10 : 0) + (ev.visuals?.inspected === true && !defects.length ? 10 : 0), assets.length ? 'осмотр или дефекты' : 'нет списка кадров');
  const edit = add('edit_pacing_sound', 15,
    (String(ev.edit?.pacing || '').length >= 8 ? 5 : 0) + (ev.voice?.present === true && String(ev.voice?.evidence || '').length >= 4 ? 5 : 0) + (ev.subtitles?.present === true && ev.subtitles?.lang ? 5 : 0),
    'нет монтажа, голоса или субтитров с доказательством');
  const audience = add('audience_value', 15, (String(ev.audience?.value || '').length >= 40 ? 8 : 0) + (String(ev.audience?.who || '').length >= 2 ? 7 : 0), 'нет пользы для названной аудитории');
  const brand = add('brand_fit', 10, (ev.brand?.characterPresent === true ? 5 : 0) + (ev.brand?.formatOk === true && ev.brand?.format ? 5 : 0), 'нет персонажа или формата');
  const parts = [script, hook, visuals, edit, audience, brand];
  const total = parts.reduce((s, p) => s + p.points, 0);
  if (total > 100) throw new Error('score overflow');
  const checks = {
    technical: defects.length ? defects.map(d => d.message || d.code || 'дефект') : ['явных дефектов в доказательстве нет'],
    voice: ev.voice?.present === true ? 'голос указан' : 'голос не подтверждён',
    subtitles: ev.subtitles?.present === true ? 'субтитры ' + (ev.subtitles.lang || '') : 'субтитры не подтверждены',
    character: ev.brand?.characterPresent === true ? 'персонаж есть' : 'персонаж не подтверждён',
    format: ev.brand?.formatOk === true ? String(ev.brand.format) : 'формат не подтверждён',
    weak
  };
  const news = ev.kind === 'news';
  const sources = Array.isArray(ev.factCheck?.sources) ? ev.factCheck.sources : [];
  const factOk = ev.factCheck?.status === 'passed' && String(ev.factCheck.by || '').length > 0 && sources.length > 0 && sources.every(u => /^https:\/\/[^\s]+$/.test(String(u)));
  if (news) findings.push(factOk ? 'Фактчек записан' : 'Фактчек обязателен и не пройден');
  if (critical) findings.push('Критический технический дефект');
  let verdict = 'pass';
  if (news && !factOk) verdict = 'blocked_factcheck';
  else if (critical || total < pass) verdict = 'rework';
  const regen = Number.isInteger(ev.regeneration) && ev.regeneration >= 0 ? ev.regeneration : 0;
  let next = verdict === 'pass' ? 'accept' : 'rework';
  if (verdict !== 'pass' && regen >= maxRegenerations) { next = 'stop'; verdict = verdict === 'blocked_factcheck' ? verdict : 'blocked_regen_cap'; }
  if (ev.score != null || ev.total != null) findings.push('Присланный балл отклонён, посчитан заново');
  return { total, passScore: pass, parts, checks, findings, verdict, news, factCheck: news ? (factOk ? 'passed' : 'required') : 'n/a', regeneration: regen, maxRegenerations, next, ignoredClientScore: ev.score != null || ev.total != null };
}
module.exports = { score };
