/* MOONKATTY AI CONTROL — Stage 2 data layer: READ-ONLY adapters over the existing MOONKATTY AI STUDIO API.
 * Every request goes to the same-origin proxy (server.mjs) with GET only. Nothing here writes to the Studio.
 * The adapters return the SAME shapes as demo-data.js, plus `tags` — the data state of each value:
 *   CONFIRMED — real source (ledger, Studio DB/runtime, data marked real)
 *   ESTIMATE  — forecast/projection/accrual the Studio itself labels as not confirmed
 *   DEMO      — the Studio returns demo/mock data (e.g. read-api dataMode "mock", ledger demo rows)
 *   NO_DATA   — nothing to show → «НЕТ ДАННЫХ»
 * No secrets are kept here: the browser never sees the Studio token (it stays in the proxy). */
export const ND = 'НЕТ ДАННЫХ';
export const TAGS = ['CONFIRMED', 'ESTIMATE', 'DEMO', 'NO_DATA'];
export class AuthError extends Error { constructor(code) { super(code); this.code = code; } }

async function req(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { let j = {}; try { j = await r.json(); } catch { /* */ } throw new AuthError(j.error || 'auth_required'); }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
export const get = (path) => req(path);
export async function config() { try { return await req('/aic/config'); } catch { return { mode: 'demo', offline: true }; } }
export async function session() { try { return await req('/aic/session'); } catch (e) { if (e instanceof AuthError) return null; throw e; } }
export async function login(username, password) {
  const r = await fetch('/aic/login', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-aic-request': '1' }, body: JSON.stringify({ username, password }) });
  let j = {}; try { j = await r.json(); } catch { /* */ }
  if (!r.ok) throw Object.assign(new Error(j.error || 'login_failed'), { status: r.status, code: j.error });
  return j;
}
export async function logout() { try { await fetch('/aic/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-aic-request': '1' } }); } catch { /* offline */ } }

/* Endpoints actually used (all GET, all allowlisted in server.mjs). */
export const ENDPOINTS = {
  health: '/api/health', system: '/api/system', runtime: '/api/runtime', agents: '/api/agents', tasks: '/api/tasks', jobs: '/api/jobs?limit=50',
  episodes: '/api/episodes', channels: '/api/channels', posts: '/api/posts', queue: '/api/queue', files: '/api/files', logs: '/api/logs', reports: '/api/reports',
  mission: '/api/world/mission', cc: '/api/world/command-center', approvals: '/api/world/approvals', nodes: '/api/ops/nodes', update: '/api/ops/update-center', backups: '/api/backups',
};
export async function fetchAll() {
  const keys = Object.keys(ENDPOINTS);
  const res = await Promise.allSettled(keys.map((k) => get(ENDPOINTS[k])));
  const raw = {}, errors = {};
  res.forEach((r, i) => { if (r.status === 'fulfilled' && r.value && r.value.__nodata) errors[keys[i]] = r.value.studioStatus; else if (r.status === 'fulfilled') raw[keys[i]] = r.value; else { if (r.reason instanceof AuthError) throw r.reason; errors[keys[i]] = r.reason?.status || 'error'; } });
  return { raw, errors, at: Date.now() };
}

/* ---------------- helpers ---------------- */
const isND = (v) => v == null || v === ND || (typeof v === 'string' && /НЕТ ДАННЫХ/.test(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const agoOf = (iso) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return null; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? { n: m, u: 'm' } : m < 1440 ? { n: Math.round(m / 60), u: 'h' } : { n: Math.round(m / 1440), u: 'd' }; };
const when = (iso) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return null; const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
/** A Studio money value is { usd, label } (confirmed ledger) or «НЕТ ДАННЫХ». */
const usd = (m) => (m && typeof m === 'object' && typeof m.usd === 'number' ? m.usd : null);
const dur = (s) => { if (!Number.isFinite(s)) return ND; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return { ru: d ? `${d} д ${h} ч` : `${h} ч ${m} мин`, en: d ? `${d} d ${h} h` : `${h} h ${m} min` }; };
const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

const AGENT_IMG = { ceo: 'img/agent-ceo.webp', news: 'img/agent-news.webp', video: 'img/agent-video.webp', social: 'img/agent-smm.webp', games: 'img/agent-games.webp', revenue: 'img/agent-revenue.webp', marketing: 'img/agent-trend.webp', analytics: 'img/agent-research.webp', community: 'img/av-social.jpg', content: 'img/av-brand.jpg', creative: 'img/av-brand.jpg', growth: 'img/av-games.jpg', publishing: 'img/av-social.jpg', pr: 'img/av-news.jpg', mkty: 'img/av-news.jpg', design3d: 'img/av-brand.jpg', director: 'img/agent-ceo.webp' };
const AGENT_ICON = { news: 'doc', video: 'film', social: 'send', games: 'gamepad', revenue: 'coin', marketing: 'search', analytics: 'db', community: 'chat', content: 'brush', creative: 'brush', growth: 'gamepad', design3d: 'brush' };
const COLORS = ['blue', 'cyan', 'violet', 'gold', 'green', 'pink'];
const TAG_OF_AGENT = { news: 'youtube', video: 'video', social: 'social', publishing: 'social', content: 'social', community: 'social', games: 'game', growth: 'game', revenue: 'finance', mkty: 'finance', analytics: 'analytics', marketing: 'analytics', ceo: 'analytics', director: 'analytics', creative: 'video', design3d: 'video', pr: 'social' };
const TAG_IMG = { video: 'img/task-1.webp', youtube: 'img/task-2.webp', social: 'img/task-3.webp', game: 'img/task-4.webp', analytics: 'img/task-5.webp', finance: 'img/task-6.webp', research: 'img/agent-research.webp', studio: 'img/task-5.webp' };
const PLAT = (s) => { const x = String(s || '').toLowerCase(); return /youtube|^yt/.test(x) ? 'youtube' : /tiktok/.test(x) ? 'tiktok' : /insta|^ig/.test(x) ? 'instagram' : /face|^fb/.test(x) ? 'facebook' : /telegram|^tg/.test(x) ? 'telegram' : /^x$|^x-|twitter/.test(x) ? 'x' : null; };
const PLAT_NAME = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', telegram: 'Telegram', x: 'X' };

function agentStatus(a, busy) { if (a.enabled === false || a.inDevelopment) return 'off'; if (busy.has(a.id) || ['running', 'busy', 'working'].includes(a.status)) return 'work'; return 'wait'; }
function taskState(st) { return ({ waiting_approval: 'review', waiting_confirmation: 'review', needs_approval: 'review', running: 'work', queued: 'work', scheduled: 'work', done: 'done', succeeded: 'done', failed: 'failed', blocked: 'failed', cancelled: 'cancelled', rejected: 'cancelled' })[st] || 'work'; }
function queueState(st) { return ({ pending_approval: 'review', restored_pending_approval: 'review', approved: 'review', scheduled: 'review', published: 'published', draft: 'draft', rejected: 'draft', failed: 'draft' })[st] || 'draft'; }
function postState(st) { return ({ scheduled: 'scheduled', approved: 'scheduled', published: 'published' })[st] || 'work'; }

/** Build the LIVE dataset (demo-data.js shape) from the raw Studio answers. */
export function adapt({ raw, errors, at }, user) {
  const tags = {};
  const T = (k, v) => { tags[k] = v; return v; };
  const health = raw.health || null, sys = raw.system || null, rt = raw.runtime || null, cc = raw.cc || null;
  const busy = new Set(arr(rt?.busy).map((b) => b.agentId));

  /* agents */
  const rawAgents = arr(raw.agents), rawTasks = arr(raw.tasks), rawJobs = arr(raw.jobs);
  const agents = rawAgents.map((a, i) => {
    const done = rawTasks.filter((t) => t.agentId === a.id && taskState(t.status) === 'done').length;
    const status = agentStatus(a, busy);
    return { id: a.id, name: a.name || a.id, role: a.role || '', status, crown: a.id === 'ceo' || a.id === 'director',
      activity: status === 'work' ? { ru: 'Выполняет задачу', en: 'Running a task' } : status === 'off' ? { ru: a.inDevelopment ? 'В разработке' : 'Выключен', en: a.inDevelopment ? 'In development' : 'Disabled' } : { ru: 'Ожидает задачу', en: 'Idle' },
      img: AGENT_IMG[a.id] || ['img/av-social.jpg', 'img/av-brand.jpg', 'img/av-games.jpg', 'img/av-news.jpg'][i % 4], widget: 'nodata', color: COLORS[i % COLORS.length], icon: AGENT_ICON[a.id] || 'pulse',
      load: ND, done, about: a.role || '', missionError: a.missionError || null };
  });
  T('agents', raw.agents ? 'CONFIRMED' : 'NO_DATA');

  /* tasks + jobs (listJobs) */
  const tagFor = (agentId) => TAG_OF_AGENT[agentId] || 'studio';
  const tasks = [
    ...rawTasks.map((t) => { const tg = tagFor(t.agentId); return { id: 't:' + t.id, sid: t.id, tag: tg, title: t.title || '—', sub: [t.agentId, t.priority].filter(Boolean).join(' · '), status: taskState(t.status), raw: t.status, when: agoOf(t.updatedAt || t.finishedAt || t.createdAt), img: TAG_IMG[tg], action: tg === 'social' || tg === 'youtube' ? 'publish' : 'play', agent: t.agentId, result: t.result || null }; }),
    ...rawJobs.map((j) => ({ id: 'j:' + j.id, sid: j.id, tag: 'job', title: j.title || j.type || j.kind || 'job', sub: `job · ${j.kind || j.type || ''}`, status: taskState(j.status), raw: j.publicStatus || j.status, when: agoOf(j.updatedAt || j.createdAt), img: TAG_IMG.studio, action: 'play', agent: j.agentId || null })),
  ];
  T('tasks', raw.tasks || raw.jobs ? 'CONFIRMED' : 'NO_DATA');

  /* content: publishing queue + posts + uploaded files (media artifacts) */
  const covers = ['img/content-1.webp', 'img/content-2.webp', 'img/content-3.webp', 'img/content-4.webp', 'img/cover-mk-ig.jpg', 'img/cover-mk-fb.jpg'];
  const chanName = Object.fromEntries(arr(raw.channels).map((c) => [c.id, c.name]));
  const content = [
    ...arr(raw.queue).map((q, i) => ({ id: 'q:' + q.id, kind: /video|mp4|clip/i.test(q.format || q.type || '') ? 'video' : 'post', state: queueState(q.status), raw: q.status, img: covers[i % covers.length], title: q.title || q.text?.slice(0, 60) || '—', platform: chanName[q.channelId] || q.channelId || ND, agent: 'publishing', when: when(q.scheduledAt || q.createdAt) })),
    ...arr(raw.posts).map((p, i) => ({ id: 'p:' + p.id, kind: 'post', state: p.status === 'published' ? 'published' : 'draft', raw: p.status, img: covers[(i + 2) % covers.length], title: p.title || String(p.text || '').slice(0, 60) || '—', platform: chanName[p.channelId] || p.platform || ND, agent: 'social' })),
    ...arr(raw.files).map((f, i) => ({ id: 'f:' + f.id, kind: /^video\//.test(f.mime || '') ? 'video' : 'draft', state: 'draft', raw: 'file', img: covers[(i + 4) % covers.length], title: f.name || f.id, platform: f.project || '—', agent: 'content', size: f.size })),
  ];
  T('content', raw.queue || raw.posts || raw.files ? 'CONFIRMED' : 'NO_DATA');

  /* revenue (world/command-center → revenue = ledger math; only payout-confirmed, non-demo rows are «confirmed») */
  const rev = cc?.revenue || null;
  const conf = { day: usd(rev?.day), month: usd(rev?.month), year: usd(rev?.year) };
  const estimate = usd(rev?.estimates?.month), accrued = usd(rev?.accrued?.month);
  const demoLabel = rev && rev.demo && !isND(rev.demo) ? rev.demo.label : null;
  const readPlat = arr(cc?.readPlatforms);
  const readDemo = readPlat.filter((p) => p.dataMode === 'mock' || p.confirmed?.demo).map((p) => ({ id: p.id, label: p.label, confirmed: p.confirmed?.label || ND, estimate: p.estimate?.label || ND }));
  const history = Array.isArray(rev?.history) ? rev.history : [];
  const bars = history.map((h) => usd(h.revenue) || 0);
  const period = (v, tag) => ({ total: v, growth: ND, bars: bars.length ? bars : [], tag });
  const finance = {
    byPeriod: {
      '7': period(ND, 'NO_DATA'), '90': period(ND, 'NO_DATA'),
      '30': period(conf.month ?? ND, conf.month != null ? 'CONFIRMED' : 'NO_DATA'), 'year': period(conf.year ?? ND, conf.year != null ? 'CONFIRMED' : 'NO_DATA'),
    },
    day: conf.day ?? ND,
    estimate: estimate ?? ND, accrued: accrued ?? ND, demo: demoLabel || ND, readDemo,
    forecast: rev && rev.forecast && !isND(rev.forecast) ? rev.forecast : ND,
    sources: arr(cc?.platforms).map((p) => ({ id: p.id, name: p.name, icon: PLAT(p.id) || PLAT(p.name) || 'gamepad', amount: usd(p.revenue) ?? ND, growth: ND, share: 0, tag: usd(p.revenue) != null ? 'CONFIRMED' : 'NO_DATA' })),
    goals: arr(rev?.goals), recommendations: arr(cc?.recommendations), unconfirmed: rev?.unconfirmed ?? 0,
    currencies: ['USD'], rates: { USD: 1 },
  };
  const totalConf = finance.sources.reduce((s, x) => s + (typeof x.amount === 'number' ? x.amount : 0), 0);
  finance.sources.forEach((x) => { x.share = typeof x.amount === 'number' && totalConf ? pct(x.amount, totalConf) : 0; });
  T('finance', !cc ? 'NO_DATA' : conf.month != null || conf.year != null ? 'CONFIRMED' : 'NO_DATA');
  T('finance.estimate', estimate != null || accrued != null ? 'ESTIMATE' : 'NO_DATA');
  T('finance.demo', demoLabel || readDemo.length ? 'DEMO' : 'NO_DATA');
  T('home.revenue', conf.month != null ? 'CONFIRMED' : 'NO_DATA');

  /* audience / analytics (MILLION AUDIENCE + media-automation read-api via command-center) */
  const aud = cc?.audience || null;
  const chans = arr(aud?.channels);
  const realSubs = chans.filter((c) => c.subscribers?.real && typeof c.subscribers.value === 'number');
  const demoSubs = chans.filter((c) => c.subscribers?.demo);
  const subsReal = realSubs.reduce((s, c) => s + c.subscribers.value, 0);
  const subsVal = realSubs.length ? compact(subsReal) : demoSubs.length ? 'DEMO' : ND;
  T('analytics.subs', realSubs.length ? 'CONFIRMED' : demoSubs.length ? 'DEMO' : 'NO_DATA');
  const players = cc?.growth?.metrics?.new_players;
  const playersVal = typeof players === 'number' ? compact(players) : ND;
  T('analytics.players', typeof players === 'number' ? (cc.growth.demo ? 'DEMO' : 'CONFIRMED') : 'NO_DATA');
  const anPeriod = { views: ND, viewsG: '', subs: subsVal, subsG: '', rev: conf.month ?? ND, revG: '', players: playersVal, playersG: '', growth: ND };
  const platformsAgg = {};
  for (const c of chans) {
    const id = PLAT(c.id) || PLAT(c.name); if (!id) continue;
    const x = platformsAgg[id] || (platformsAgg[id] = { id, name: PLAT_NAME[id], v: ND, mode: null, sum: 0, color: '', series: [] });
    if (c.subscribers?.real && typeof c.subscribers.value === 'number') { x.sum += c.subscribers.value; x.v = compact(x.sum); x.mode = 'real'; }
    else if (c.subscribers?.demo && x.mode !== 'real') { x.v = c.subscribers.label || 'DEMO'; x.mode = 'mock'; }
  }
  const analytics = { periods: ['7', '30', '90', 'year'], byPeriod: { '7': anPeriod, '30': anPeriod, '90': anPeriod, 'year': anPeriod }, platforms: Object.values(platformsAgg), audience: [], goal: aud?.goal ?? null, readApi: cc?.readApi || null };
  T('analytics', !cc ? 'NO_DATA' : realSubs.length ? 'CONFIRMED' : demoSubs.length ? 'DEMO' : 'NO_DATA');
  T('analytics.views', 'NO_DATA');
  T('analytics.chart', 'NO_DATA');

  /* social */
  const socialPlat = {};
  for (const c of arr(raw.channels)) { const id = PLAT(c.platform) || PLAT(c.id); if (!id) continue; const x = socialPlat[id] || (socialPlat[id] = { id, name: PLAT_NAME[id], followers: ND, growth: ND, connected: false, channels: [], mode: null }); x.connected = x.connected || !!c.connected; x.channels.push(c.name); }
  for (const p of Object.values(platformsAgg)) if (socialPlat[p.id]) { socialPlat[p.id].followers = p.v; socialPlat[p.id].mode = p.mode; }
  const social = {
    platforms: Object.values(socialPlat),
    posts: [...arr(raw.queue).map((q) => ({ id: 'q-' + q.id, platform: PLAT(chanName[q.channelId]) || PLAT(q.channelId) || 'x', name: chanName[q.channelId] || undefined, title: q.title || '—', state: postState(q.status), raw: q.status, when: when(q.scheduledAt) })),
      ...arr(raw.posts).map((p) => ({ id: 'p-' + p.id, platform: PLAT(p.platform || chanName[p.channelId]) || 'x', name: chanName[p.channelId] || undefined, title: p.title || String(p.text || '').slice(0, 60) || '—', state: postState(p.status), raw: p.status, when: when(p.scheduledAt || p.publishedAt) }))],
    ideas: [],
  };
  T('social', raw.channels ? 'CONFIRMED' : 'NO_DATA');
  T('social.followers', Object.values(socialPlat).some((p) => p.mode === 'real') ? 'CONFIRMED' : Object.values(socialPlat).some((p) => p.mode === 'mock') ? 'DEMO' : 'NO_DATA');

  /* news (studio episodes collection; separate MOONKATTY NEWS project) */
  const eps = arr(raw.episodes).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const epState = (e) => (/publish|ready|done/.test(e.status || '') ? 'ready' : /draft|new/.test(e.status || '') ? 'draft' : /plan/.test(e.status || '') ? 'plan' : 'work');
  const epObj = (e, i) => ({ id: 'e-' + e.id, no: e.number ?? e.no ?? (eps.length - i), title: e.title || '—', dur: e.duration ? Math.round(e.duration / 60) : ND, state: epState(e), img: ['img/news-hero.webp', 'img/ep-1.webp', 'img/ep-2.webp', 'img/ep-3.webp'][i % 4], when: when(e.date || e.createdAt) || ND,
    script: Object.values(e.scripts || {}).find(Boolean) || ND });
  const news = { current: eps[0] ? epObj(eps[0], 0) : null, next: eps.slice(1, 6).map((e, i) => epObj(e, i + 1)),
    scripts: eps.flatMap((e) => Object.entries(e.scripts || {}).filter(([, s]) => s).map(([lang, s]) => ({ id: e.id + lang, title: `${e.title || ''} · ${lang.toUpperCase()}`, words: String(s).split(/\s+/).filter(Boolean).length }))),
    topics: [], plan: [], episodesCount: cc?.news?.episodes ?? eps.length, openTasks: cc?.news?.openTasks ?? null };
  T('news', raw.episodes ? (eps.length ? 'CONFIRMED' : 'NO_DATA') : 'NO_DATA');

  /* games (AI Game Growth: read-only import; not connected → НЕТ ДАННЫХ) */
  const gm = cc?.growth?.metrics || {};
  const gv = (k) => (typeof gm[k] === 'number' ? compact(gm[k]) : ND);
  const gstats = { active: gv('dau'), activeG: '', fresh: gv('new_players'), freshG: '', time: ND, timeG: '' };
  const games = { mk: { id: 'mk', name: 'MOONKATTY Game', img: 'img/preview.jpg', stats: gstats }, nh: { id: 'nh', name: 'New Horizons', img: 'img/game-banner.webp', stats: gstats },
    sections: null, events: [], regions: [], store: [], growth: cc?.growth || null };
  T('games', !cc?.growth ? 'NO_DATA' : cc.growth.demo ? 'DEMO' : cc.growth.connected ? 'CONFIRMED' : 'NO_DATA');

  /* notifications (Studio journal /api/logs + pending owner approvals, read-only) */
  const logs = arr(raw.logs).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
  const pend = arr(raw.approvals).filter((a) => a.status === 'pending');
  const notifications = [
    ...pend.map((a) => ({ id: 'a-' + a.id, type: 'reminder', cat: 'important', icon: 'bell', color: 'gold', title: { ru: 'Ждёт решения владельца', en: 'Awaiting owner decision' }, text: `${a.action} · ${a.tier}${a.detail ? ' · ' + a.detail : ''}`, ago: agoOf(a.at), link: '#/notifications', approval: true })),
    ...logs.map((l) => { const finance = /revenue|finance|ledger/.test(l.source || ''); const imp = l.level === 'error' || l.level === 'warn';
      return { id: 'l-' + l.id, type: imp ? 'error' : 'done', cat: imp ? 'important' : finance ? 'finance' : 'system', icon: l.level === 'error' ? 'x' : l.level === 'warn' ? 'bell' : finance ? 'dollar' : 'check', color: l.level === 'error' ? 'pink' : l.level === 'warn' ? 'gold' : finance ? 'green' : 'teal',
        title: `${l.source || 'system'} · ${l.level}`, text: l.message || '', ago: agoOf(l.at), link: '#/notifications' }; }),
  ];
  T('notifications', raw.logs ? 'CONFIRMED' : 'NO_DATA');
  T('approvals', raw.approvals ? 'CONFIRMED' : 'NO_DATA');

  /* devices: Mac mini (this Studio host: /api/health + /api/system) + nodes (/api/ops/nodes) */
  const memUsed = sys && sys.memTotal ? pct(sys.memTotal - sys.memFree, sys.memTotal) : null;
  const diskUsed = sys && sys.disk && sys.disk.total ? pct(sys.disk.total - sys.disk.free, sys.disk.total) : null;
  const mac = { id: 'macmini', name: 'Mac mini', host: sys?.hostname || ND, role: { ru: 'Основной узел студии', en: 'Main studio node' }, online: !!health?.ok, cpu: sys?.cpuPct ?? ND, ram: memUsed ?? ND, disk: diskUsed ?? ND, uptime: sys ? dur(sys.uptimeSec) : ND,
    version: health?.version || ND, flavor: health?.flavor || ND, product: health?.product || ND, db: health?.db || ND, schema: health?.schemaVersion ?? ND, lastTick: health?.lastTick || null, platform: sys?.platform || ND,
    ollama: rt ? !!rt.ollama?.ok : null, blender: rt ? !!rt.blender?.ok : null, heavy: rt?.heavy?.holder || null };
  T('mac', health ? 'CONFIRMED' : 'NO_DATA');
  const nodesRaw = raw.nodes || null;
  const nodeList = arr(nodesRaw?.nodes).map((n) => ({ id: n.id, name: n.name || n.id, role: n.role || '', online: !!n.online && !n.revoked, cpu: ND, ram: ND, disk: ND, uptime: ND }));
  const devices = [mac, ...nodeList, { id: 'iphone', name: 'iPhone', role: { ru: 'Этот пульт', en: 'This remote' }, online: true, cpu: null, ram: null, disk: null, uptime: { ru: '—', en: '—' } }];
  T('devices', health ? 'CONFIRMED' : 'NO_DATA');
  T('nodes', nodesRaw ? (nodeList.length ? 'CONFIRMED' : 'NO_DATA') : 'NO_DATA');

  /* integrations = channels connection flags (read-only) */
  const integrations = Object.values(socialPlat).map((p) => ({ id: p.id, name: p.name, connected: p.connected }));

  /* backups (status only) + Update Center (status only, gated) + memory (studio-intelligence, read-only) */
  const backup = { last: sys?.lastBackup || null, count: raw.backups?.count ?? null, latest: raw.backups?.latest || null };
  T('backup', sys?.lastBackup || raw.backups ? 'CONFIRMED' : 'NO_DATA');
  const update = raw.update ? { ...raw.update, enabled: true } : { enabled: false, error: errors.update || null };
  T('update', raw.update ? 'CONFIRMED' : 'NO_DATA');
  const memory = cc?.memory ? { path: cc.memory.path, mission: arr(cc.memory.mission), audience: arr(cc.memory.audience) } : null;
  T('memory', memory && (memory.mission.length || memory.audience.length) ? 'CONFIRMED' : 'NO_DATA');
  const mission = raw.mission || cc?.mission || null;
  const documents = [
    ...(mission ? [{ id: 'mission', title: `${mission.title || 'Mission'} · ${mission.version || ''}`, kind: 'MISSION', size: (mission.sha256 || '').slice(0, 12) }] : []),
    ...arr(memory?.mission).map((m) => ({ id: 'm-' + m.id, title: { ru: 'Память: миссия', en: 'Memory: mission' }, kind: m.kind, size: 'v' + m.version })),
    ...arr(memory?.audience).map((m) => ({ id: 'g-' + m.id, title: { ru: 'Память: цель «Миллион аудитории»', en: 'Memory: Million Audience goal' }, kind: m.kind, size: 'v' + m.version + (m.goal ? ' · ' + compact(m.goal) : '') })),
    ...arr(raw.reports).slice(0, 5).map((r) => ({ id: 'r-' + r.id, title: { ru: `Отчёт за ${r.periodDays || '?'} дн.`, en: `Report, ${r.periodDays || '?'} days` }, kind: 'REPORT', size: when(r.createdAt) || '' })),
  ];
  T('docs', documents.length ? 'CONFIRMED' : 'NO_DATA');

  /* home */
  const studio = { host: mac.host !== ND ? 'Mac mini · ' + String(mac.host).split('.')[0].slice(0, 16) : 'Mac mini', online: !!health?.ok, agentsTotal: agents.length || ND, agentsActive: agents.filter((a) => a.status === 'work').length, tasksTotal: tasks.length, tasksReview: tasks.filter((t) => t.status === 'review').length,
    channels: arr(raw.channels).length || ND, channelsGrowth: ND, revenueMonth: conf.month ?? ND, revenueGrowth: '', currency: 'USD',
    newsSub: news.current ? news.current.title : ND };
  T('home', health ? 'CONFIRMED' : 'NO_DATA');

  return { LIVE: true, DATA_VERSION: 'live · ' + new Date(at).toISOString().slice(0, 19).replace('T', ' ') + ' UTC', at, user, errors, tags,
    studio, agents, tasks, taskTags: {}, content, analytics, finance, games, news, social, notifications, devices, integrations, ideas: [], documents, experiments: [],
    backup, update, memory, mission, cc: cc ? { readApi: cc.readApi, publishing: cc.publishing, ceo: cc.ceo } : null,
    appInfo: { name: 'MOONKATTY AI CONTROL', version: '2.0', stage: 2 } };
}
