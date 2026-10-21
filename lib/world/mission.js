// Load config/WORLD_CLASS_MISSION.md + config/mission.yaml. Files are the source of truth.
// A small snapshot is stored in meta and copied onto every agent so a restart keeps it.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const MD = path.join(ROOT, 'config', 'WORLD_CLASS_MISSION.md');
const YML = path.join(ROOT, 'config', 'mission.yaml');

function parseYaml(text) {
  const root = {}; const stack = [{ indent: -1, obj: root }];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length; const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    let frame = stack[stack.length - 1];
    if (line.startsWith('- ')) {
      if (!Array.isArray(frame.obj)) {
        const gp = stack[stack.length - 2]; const keys = gp ? Object.keys(gp.obj) : []; const last = keys[keys.length - 1];
        if (!gp || gp.obj[last] !== frame.obj || Object.keys(frame.obj).length) throw new Error('mission.yaml: список вне массива');
        frame.obj = gp.obj[last] = [];
      }
      const cur = frame.obj; const rest = line.slice(2).trim();
      if (rest.startsWith('{') && rest.endsWith('}')) cur.push(parseInline(rest));
      else cur.push(unquote(rest));
      continue;
    }
    const cur = frame.obj;
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/); if (!m) throw new Error('mission.yaml: строка «' + line.slice(0, 40) + '»');
    const key = m[1], val = m[2].trim();
    if (!val) { const child = {}; cur[key] = child; stack.push({ indent, obj: child }); }
    else if (val.startsWith('[')) cur[key] = parseList(val);
    else { cur[key] = unquote(val); }
  }
  return root;
}
function parseList(s) { return s.replace(/^\[|\]$/g, '').split(',').map(x => unquote(x.trim())).filter(x => x !== ''); }
function parseInline(s) {
  const o = {}; for (const part of s.slice(1, -1).split(',')) { const i = part.indexOf(':'); if (i < 0) continue; o[part.slice(0, i).trim()] = unquote(part.slice(i + 1).trim()); } return o;
}
function unquote(s) {
  if (s === 'true') return true; if (s === 'false') return false; if (s === 'null' || s === '') return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (/^-?\d+$/.test(s)) return +s; return s;
}
function load() {
  if (!fs.existsSync(MD) || !fs.existsSync(YML)) {
    const e = new Error('Файлы миссии не найдены (config/WORLD_CLASS_MISSION.md, config/mission.yaml)'); e.code = 'mission_missing'; throw e;
  }
  const md = fs.readFileSync(MD), yml = fs.readFileSync(YML);
  const data = parseYaml(yml.toString('utf8'));
  const channels = Array.isArray(data.audience_channels) ? data.audience_channels : [];
  const ids = channels.map(c => c && c.id);
  const need = ['youtube-news', 'youtube-project', 'instagram', 'facebook', 'telegram', 'x', 'tiktok'];
  if (data.id !== 'world-class' || !Array.isArray(data.monthly_goals_usd) || data.views_are_revenue !== false || data.audience_goal_subscribers !== 1000000 || data.merge_youtube !== false || need.some(id => !ids.includes(id)) || new Set(ids).size !== ids.length) {
    const e = new Error('mission.yaml не проходит проверку'); e.code = 'mission_invalid'; throw e;
  }
  const sha256 = crypto.createHash('sha256').update(md).update(yml).digest('hex');
  return { id: data.id, version: String(data.version), title: String(data.title), sha256, bytes: md.length + yml.length, data, markdown: md.toString('utf8') };
}
function snapshot(m, at) { return { id: m.id, version: m.version, title: m.title, sha256: m.sha256, loadedAt: at }; }
module.exports = { load, snapshot, parseYaml, MD, YML };
