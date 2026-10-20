// Parameter schema for the vetted Blender template blender/templates/scene_basic.py.
// The LLM / OpenCode agent only chooses VALUES; anything outside the schema is rejected (never executed as code).
'use strict';
const SUBJECTS = ['cat', 'cube', 'sphere', 'monkey', 'cylinder', 'torus', 'cone'];
const LIGHTS = ['three_point', 'sun', 'studio'];
const ENGINES = ['CYCLES', 'EEVEE', 'WORKBENCH'];
const DEFAULTS = { title: 'MOONKATTY scene', subject: 'cat', color: [0.55, 0.35, 0.85], metallic: 0.0, roughness: 0.45, background: [0.04, 0.04, 0.08],
  lighting: 'three_point', camera: { distance: 9, height: 1.2, focal: 50 }, render: { engine: 'CYCLES', samples: 32, width: 640, height: 480 }, animation: { frames: 0 }, exports: ['glb'] };
const num = (v, lo, hi, n, errs) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) { errs.push(`${n}: число от ${lo} до ${hi}`); return null; } return v; };
const rgb = (v, n, errs) => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && x >= 0 && x <= 1) ? v.map(Number) : (errs.push(`${n}: [r,g,b] 0..1`), null);
function validate(input) {
  const errs = []; if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['параметры должны быть JSON-объектом'] };
  const known = Object.keys(DEFAULTS); const extra = Object.keys(input).filter(k => !known.includes(k)); if (extra.length) errs.push('неизвестные поля: ' + extra.join(', '));
  const i = { ...DEFAULTS, ...input, camera: { ...DEFAULTS.camera, ...(input.camera || {}) }, render: { ...DEFAULTS.render, ...(input.render || {}) }, animation: { ...DEFAULTS.animation, ...(input.animation || {}) } };
  const p = {};
  p.title = typeof i.title === 'string' && /^[\p{L}\p{N} .,!?:'()_-]{1,60}$/u.test(i.title) ? i.title : (errs.push('title: 1–60 символов (буквы, цифры, пробел, .,!?:\'()_-)'), null);
  p.subject = SUBJECTS.includes(i.subject) ? i.subject : (errs.push('subject: одно из ' + SUBJECTS.join('|')), null);
  p.color = rgb(i.color, 'color', errs); p.background = rgb(i.background, 'background', errs);
  p.metallic = num(i.metallic, 0, 1, 'metallic', errs); p.roughness = num(i.roughness, 0, 1, 'roughness', errs);
  p.lighting = LIGHTS.includes(i.lighting) ? i.lighting : (errs.push('lighting: одно из ' + LIGHTS.join('|')), null);
  p.camera = { distance: num(i.camera.distance, 2, 30, 'camera.distance', errs), height: num(i.camera.height, -5, 15, 'camera.height', errs), focal: num(i.camera.focal, 18, 135, 'camera.focal', errs) };
  p.render = { engine: ENGINES.includes(i.render.engine) ? i.render.engine : (errs.push('render.engine: ' + ENGINES.join('|')), null),
    samples: Number.isInteger(i.render.samples) ? num(i.render.samples, 1, 256, 'render.samples', errs) : (errs.push('render.samples: целое 1..256'), null),
    width: Number.isInteger(i.render.width) ? num(i.render.width, 64, 1920, 'render.width', errs) : (errs.push('render.width: целое'), null),
    height: Number.isInteger(i.render.height) ? num(i.render.height, 64, 1920, 'render.height', errs) : (errs.push('render.height: целое'), null) };
  p.animation = { frames: Number.isInteger(i.animation.frames) ? num(i.animation.frames, 0, 48, 'animation.frames', errs) : (errs.push('animation.frames: целое 0..48'), null) };
  p.exports = Array.isArray(i.exports) && i.exports.every(x => ['glb', 'fbx'].includes(x)) ? [...new Set(i.exports)] : (errs.push('exports: ["glb","fbx"]'), null);
  for (const k of Object.keys(input.camera || {})) if (!(k in DEFAULTS.camera)) errs.push('camera.' + k + ': неизвестное поле');
  for (const k of Object.keys(input.render || {})) if (!(k in DEFAULTS.render)) errs.push('render.' + k + ': неизвестное поле');
  return errs.length ? { ok: false, errors: errs } : { ok: true, params: p };
}
// Deterministic fallback when no LLM is available (stated as paramsBy: 'rules' in the job log).
const COLORS = { 'фиолет|purple|violet|фіолет': [0.55, 0.3, 0.85], 'красн|red|червон': [0.85, 0.15, 0.15], 'син|blue|голуб': [0.15, 0.35, 0.9], 'зел|green': [0.2, 0.75, 0.3], 'жёлт|желт|yellow|жовт': [0.95, 0.8, 0.2], 'бел|white|біл': [0.92, 0.92, 0.92], 'черн|чёрн|black|чорн': [0.05, 0.05, 0.05], 'золот|gold': [0.9, 0.7, 0.25], 'оранж|orange|помаранч': [0.95, 0.5, 0.1], 'розов|pink|рожев': [0.95, 0.5, 0.7] };
const SUBJ = { 'кот|кош|cat|kitty|кіт|котик|moonkatty': 'cat', 'куб|cube|box|ящик': 'cube', 'шар|сфер|sphere|ball|куля|м[яё]ч': 'sphere', 'обезьян|monkey|suzanne|мавп': 'monkey', 'цилиндр|cylinder|цилінд': 'cylinder', 'тор|torus|бублик|пончик|donut': 'torus', 'конус|cone': 'cone' };
function fromText(text) {
  const t = String(text || '').toLowerCase(); const p = JSON.parse(JSON.stringify(DEFAULTS));
  for (const [re, s] of Object.entries(SUBJ)) if (new RegExp(re).test(t)) { p.subject = s; break; }
  for (const [re, c] of Object.entries(COLORS)) if (new RegExp(re).test(t)) { p.color = c; break; }
  if (/металл|metal|метал/.test(t)) { p.metallic = 0.9; p.roughness = 0.25; }
  if (/солн|sun|сонц|сонячн/.test(t)) p.lighting = 'sun'; else if (/студи|studio/.test(t)) p.lighting = 'studio';
  if (/анимац|animation|turntable|оборот|облёт|аніма/.test(t)) p.animation.frames = 24;
  if (/fbx/.test(t)) p.exports = ['glb', 'fbx'];
  const res = /(\d{2,4})\s*[x×х]\s*(\d{2,4})/.exec(t); if (res) { p.render.width = Math.min(1920, Math.max(64, +res[1])); p.render.height = Math.min(1920, Math.max(64, +res[2])); }
  const smp = /(\d{1,3})\s*(сэмпл|семпл|samples|spp)/.exec(t); if (smp) p.render.samples = Math.min(256, Math.max(1, +smp[1]));
  if (/eevee/.test(t)) p.render.engine = 'EEVEE'; else if (/workbench|черновик|draft/.test(t)) p.render.engine = 'WORKBENCH';
  const title = String(text || '').replace(/[^\p{L}\p{N} .,!?:'()_-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); if (title) p.title = title;
  return p;
}
// Rework: apply only the features the comment actually mentions on top of the previous version's params.
function applyComment(base, comment) {
  const t = String(comment || '').toLowerCase(); const p = JSON.parse(JSON.stringify(base)); const changed = [];
  for (const [re, s] of Object.entries(SUBJ)) if (new RegExp(re).test(t)) { if (p.subject !== s) { p.subject = s; changed.push('subject'); } break; }
  for (const [re, c] of Object.entries(COLORS)) if (new RegExp(re).test(t)) { p.color = c; changed.push('color'); break; }
  if (/матов|matte|матов/.test(t)) { p.metallic = 0; p.roughness = 0.8; changed.push('material'); } else if (/металл|metal|метал|блест|glossy|shiny/.test(t)) { p.metallic = 0.9; p.roughness = 0.25; changed.push('material'); }
  if (/солн|sun|сонц|сонячн/.test(t)) { p.lighting = 'sun'; changed.push('lighting'); } else if (/студи|studio/.test(t)) { p.lighting = 'studio'; changed.push('lighting'); } else if (/тр[её]хточ|three.?point|трьохточ/.test(t)) { p.lighting = 'three_point'; changed.push('lighting'); }
  if (/ближе|closer|крупн|ближч/.test(t)) { p.camera.distance = Math.max(2, +(p.camera.distance * 0.75).toFixed(2)); changed.push('camera'); } else if (/дальше|farther|further|общ|далі/.test(t)) { p.camera.distance = Math.min(30, +(p.camera.distance * 1.3).toFixed(2)); changed.push('camera'); }
  if (/выше|higher|вище/.test(t)) { p.camera.height = Math.min(15, p.camera.height + 1); changed.push('camera'); } else if (/ниже|lower|нижче/.test(t)) { p.camera.height = Math.max(-5, p.camera.height - 1); changed.push('camera'); }
  if (/без анимац|no animation|без аніма/.test(t)) { p.animation.frames = 0; changed.push('animation'); } else if (/анимац|animation|turntable|оборот|аніма/.test(t)) { p.animation.frames = p.animation.frames || 24; changed.push('animation'); }
  if (/fbx/.test(t) && !p.exports.includes('fbx')) { p.exports = [...p.exports, 'fbx']; changed.push('exports'); }
  const res = /(\d{2,4})\s*[x×х]\s*(\d{2,4})/.exec(t); if (res) { p.render.width = Math.min(1920, Math.max(64, +res[1])); p.render.height = Math.min(1920, Math.max(64, +res[2])); changed.push('resolution'); }
  return { params: p, changed };
}
const SCHEMA_TEXT = `{"title":"<=60 chars","subject":"${SUBJECTS.join('|')}","color":[r,g,b 0..1],"metallic":0..1,"roughness":0..1,"background":[r,g,b],"lighting":"${LIGHTS.join('|')}","camera":{"distance":2..30,"height":-5..15,"focal":18..135},"render":{"engine":"${ENGINES.join('|')}","samples":1..256,"width":64..1920,"height":64..1920},"animation":{"frames":0..48},"exports":["glb","fbx"]}`;
module.exports = { validate, fromText, applyComment, DEFAULTS, SUBJECTS, LIGHTS, ENGINES, SCHEMA_TEXT };
