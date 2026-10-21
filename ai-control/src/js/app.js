/* MOONKATTY AI CONTROL — Stage 1 app (vanilla ES modules, no frameworks). */
import * as D from './demo-data.js';
import { t, L, ago, money, setLang, getLang } from './i18n.js';
import { icon } from './icons.js';
import { sparkline, lineChart, barChart } from './charts.js';

/* ---------------- state (local DEMO only) ---------------- */
const KEY = 'aic.state.v1';
const defaults = () => ({ lang: 'ru', approvals: {}, read: {}, toggles: { push: true, important: false, finance: true, system: true }, ideas: {}, exp: {}, motion: true, currency: 'USD', paused: {} });
let S = load();
function load() { try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return defaults(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode */ } }
const ui = { agentF: 'all', taskF: 'all', contentK: 'all', contentS: 'all', period: '30', finPeriod: '30', game: 'nh', newsTab: 'episodes', socialTab: 'posts', notifF: 'all', hidden: new Set() };

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => esc(L(v));
const demo = () => `<span class="demo-chip" title="${esc(t('demo.data'))}">DEMO</span>`;
const brand = { youtube: ['youtube', 'yt'], tiktok: ['tiktok', 'tt'], instagram: ['instagram', 'ig'], facebook: ['facebook', 'fb'], x: ['xlogo', 'x'], telegram: ['telegram', 'tg'] };
const agentById = (id) => D.agents.find((a) => a.id === id);
const taskStatus = (tk) => S.approvals[tk.id] || tk.status;
const contentState = (c) => S.approvals[c.id] || c.state;
const isReviewable = (st) => st === 'review' || st === 'ready';
function hdr(title, sub, right = '', cls = '') { return `<header class="hdr ${cls}"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right}</header>`; }
function backHdr(title, sub, to) { return `<button class="back-btn" data-act="back" data-to="${esc(to)}">${icon('back')}<span>${esc(t('back'))}</span></button>${hdr(title, sub)}`; }
function chip(group, val, label, cur, n, hot) { return `<button class="chip" data-act="filter" data-g="${group}" data-v="${val}" aria-pressed="${cur === val}">${esc(label)}${n != null ? `<span class="n${hot ? ' hot' : ''}">${n}</span>` : ''}</button>`; }
function disabledBtn(label, ic = 'lock', stage = 2) {
  return `<div class="disabled-block"><button class="btn ghost wide" disabled aria-disabled="true" data-stage="${stage}">${icon(ic)}<span>${esc(label)}</span></button><span class="stage-note">${esc(t(stage === 3 ? 'stage3' : 'stage2'))}</span></div>`;
}
function approveBar(id, title) {
  const st = S.approvals[id];
  if (st === 'approved' || st === 'rework') {
    return `<div class="done-bar"><span class="pill ${st === 'approved' ? 'green' : 'red'}">${icon(st === 'approved' ? 'check' : 'update', '')}${esc(t(st === 'approved' ? 'ts.approved' : 'ts.rework'))}</span>
      <button class="btn ghost" data-act="undo" data-id="${id}">${esc(t('undo'))}</button></div>`;
  }
  return `<div class="actions"><button class="btn ok" data-act="approve" data-id="${id}" data-title="${esc(title)}">${icon('check')}<span>${esc(t('approve'))}</span><span class="demo-tag">DEMO</span></button>
    <button class="btn no" data-act="rework" data-id="${id}" data-title="${esc(title)}">${icon('update')}<span>${esc(t('rework'))}</span><span class="demo-tag">DEMO</span></button></div>`;
}
const img = (src, alt = '', eager = false) => `<img src="${esc(src)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
function widthsPass(root) { root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = Math.max(0, Math.min(100, +el.dataset.w)) + '%'; }); }

/* ---------------- screens ---------------- */
const screens = {};

screens.home = () => {
  const s = D.studio;
  return `<section class="screen home">
    <div class="hero">${img('img/hero.webp', 'MOONKATTY', true)}
      <div class="top"><span class="logo">${icon('catHead')}</span><div class="brandtxt"><b>MOONKATTY</b><span>AI CONTROL</span></div>
        <div class="online"><b><span class="dot"></span>${esc(t('online'))}</b><br>${esc(s.host)}</div>
        <a class="icon-btn plain" href="#/settings" aria-label="${esc(t('home.settings'))}">${icon('gear')}</a></div>
      <div class="copy"><h2>${esc(t('home.hero1'))}<br>${esc(t('home.hero2'))}</h2><p>${esc(t('home.heroSub'))}</p></div>
    </div>
    <div class="stats">
      <a class="stat" href="#/agents"><span class="ic blue">${icon('robot')}</span><span><span class="lbl">${esc(t('home.agents'))}</span><span class="val">${s.agentsTotal}</span><span class="meta green">${esc(t('home.active', { n: s.agentsActive }))}</span></span></a>
      <a class="stat" href="#/tasks"><span class="ic violet">${icon('playTri')}</span><span><span class="lbl">${esc(t('home.tasks'))}</span><span class="val">${s.tasksTotal}</span><span class="meta">${esc(t('home.review', { n: D.tasks.filter((x) => taskStatus(x) === 'review').length }))}</span></span></a>
      <a class="stat" href="#/social"><span class="ic blue">${icon('users')}</span><span><span class="lbl">${esc(t('home.channels'))}</span><span class="val">${s.channels}</span><span class="meta">${esc(t('home.growth'))} <span class="up">${s.channelsGrowth}</span></span></span></a>
      <a class="stat" href="#/finance"><span class="ic green">${icon('dollar')}</span><span><span class="lbl">${esc(t('home.revenue'))}</span><span class="val">${money(s.revenueMonth)}</span><span class="meta"><span class="up">${s.revenueGrowth}</span> ${demo()}</span></span></a>
    </div>
    <h2 class="section-title">${esc(t('home.quick'))}</h2>
    <div class="quick">
      <a class="tile" href="#/home/request"><span class="q1">${icon('newReq')}</span>${esc(t('qa.new'))}</a>
      <a class="tile" href="#/content?s=review"><span class="q2">${icon('pin')}</span>${esc(t('qa.check'))}</a>
      <a class="tile" href="#/analytics"><span class="q3">${icon('statBars')}</span>${esc(t('qa.stats'))}</a>
      <a class="tile" href="#/finance"><span class="q4">${icon('report')}</span>${esc(t('qa.report'))}</a>
    </div>
    <a class="newscard" href="#/news">${img('img/news-cat.webp')}<span class="body"><b>${esc(t('home.newsTitle'))}</b><span>${esc(t('home.newsSub'))}</span></span><span class="round-btn">${icon('play')}</span></a>
  </section>`;
};

screens.agents = () => {
  const c = { all: D.agents.length, work: 0, wait: 0, off: 0 };
  D.agents.forEach((a) => c[S.paused[a.id] ? 'wait' : a.status]++);
  const list = D.agents.filter((a) => ui.agentF === 'all' || (S.paused[a.id] ? 'wait' : a.status) === ui.agentF);
  const colors = { blue: '#4aa3ff', cyan: '#2dd4f0', violet: '#a78bfa', gold: '#f5c451', green: '#34d399', pink: '#f472b6', gray: '#64748b' };
  const rows = list.map((a) => {
    const st = S.paused[a.id] ? 'wait' : a.status;
    const w = a.widget === 'progress'
      ? `<span class="wi">${icon(a.icon)}</span><span class="pbar"><span>${a.progress}%</span><span class="track"><span class="fill${a.color === 'violet' ? ' violet' : ''}" data-w="${a.progress}"></span></span></span>`
      : `<span class="wi">${icon(a.icon)}</span>${sparkline(sparkFor(a.id), colors[a.color] || '#4aa3ff')}`;
    return `<a class="row agent-row${a.widget === 'progress' ? ' has-progress' : ''}" href="#/agents/${a.id}">
      <span class="thumb">${img(a.img, a.name)}</span>
      <span class="body"><span class="t1">${esc(a.name)}${a.crown ? `<span class="crown">${icon('crown')}</span>` : ''}</span><span class="t2">${E(a.role)}</span>
      <span class="t3 st-${st}"><span class="dot"></span>${esc(S.paused[a.id] ? t('agent.pause') + ' · DEMO' : L(a.activity))}</span></span>
      <span class="widget">${w}</span></a>`;
  }).join('');
  return `<section class="screen">${hdr(esc(t('agents.title')), esc(t('agents.sub', { n: c.all, w: c.work })), `<a class="icon-btn" href="#/agents/new" aria-label="${esc(t('agent.add'))}">${icon('plus')}</a>`)}
    <div class="chips">${chip('agentF', 'all', t('f.all'), ui.agentF, c.all)}${chip('agentF', 'work', t('f.work'), ui.agentF, c.work)}${chip('agentF', 'wait', t('f.wait'), ui.agentF, c.wait)}${chip('agentF', 'off', t('f.off'), ui.agentF, c.off)}</div>
    <div class="stack" id="list">${rows || `<p class="empty">${esc(t('content.empty'))}</p>`}</div></section>`;
};
function sparkFor(id) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997; return Array.from({ length: 12 }, (_, i) => 5 + ((h * (i + 3)) % 9) + (i % 3 === 0 ? 4 : 0)); }

const tagOf = (k) => D.taskTags[k] || { ru: k, en: k, c: 'blue' };
function taskStatusLine(tk) {
  const st = taskStatus(tk);
  const lbl = st === 'approved' ? t('ts.approved') : st === 'rework' ? t('ts.rework') : t('ts.' + st);
  return `<span class="t3 s-${st}">${esc(lbl)}${tk.when && !['approved', 'rework', 'ready', 'test'].includes(st) ? ' • ' + esc(ago(tk.when)) : ''}</span>`;
}
screens.tasks = () => {
  const cnt = (f) => D.tasks.filter((x) => taskStatus(x) === f).length;
  const list = D.tasks.filter((x) => ui.taskF === 'all' || taskStatus(x) === ui.taskF || (ui.taskF === 'done' && ['done', 'approved'].includes(taskStatus(x))));
  const rows = list.map((tk) => {
    const tg = tagOf(tk.tag);
    return `<a class="row task-row" href="#/tasks/${tk.id}"><span class="thumb">${img(tk.img)}</span>
      <span class="body"><span class="tag ${tg.c}">${E(tg)}</span><span class="t1">${E(tk.title)}</span><span class="t2">${E(tk.sub)}</span>${taskStatusLine(tk)}</span>
      <span class="round-btn${tk.action === 'publish' ? ' alt' : ''}" aria-hidden="true">${icon(tk.action === 'publish' ? 'share2' : 'play')}</span></a>`;
  }).join('');
  return `<section class="screen">${hdr(esc(t('tasks.title')), esc(t('tasks.sub', { n: D.tasks.length })), `<a class="icon-btn" href="#/tasks/new" aria-label="${esc(t('task.new'))}">${icon('plus')}</a>`)}
    <div class="chips">${chip('taskF', 'all', t('f.all'), ui.taskF, D.tasks.length)}${chip('taskF', 'review', t('tf.review'), ui.taskF, cnt('review'))}${chip('taskF', 'work', t('tf.work'), ui.taskF, cnt('work'))}${chip('taskF', 'done', t('tf.done'), ui.taskF, cnt('done') + cnt('approved'))}</div>
    <div class="stack" id="list">${rows || `<p class="empty">${esc(t('content.empty'))}</p>`}</div></section>`;
};

screens.content = () => {
  const byK = (k) => D.content.filter((c) => c.kind === k).length;
  const pool = D.content.filter((c) => ui.contentK === 'all' || c.kind === ui.contentK);
  const sCount = (s) => pool.filter((c) => contentState(c) === s).length;
  const list = pool.filter((c) => ui.contentS === 'all' || contentState(c) === ui.contentS);
  const cards = list.map((c) => {
    const st = contentState(c);
    const pill = st === 'published' ? `<span class="pill green state">${esc(t('cs.published'))}</span>` : st === 'draft' ? `<span class="pill gray state">${esc(t('cs.draft'))}</span>` : '';
    return `<article class="card ccard"><a class="media" href="#/content/${c.id}" aria-label="${esc(c.title)}">${img(c.img, c.title)}${c.dur ? `<span class="dur">${c.dur}</span>` : ''}${pill}</a>
      ${['review', 'approved', 'rework'].includes(st) ? approveBar(c.id, c.title) : ''}</article>`;
  }).join('');
  return `<section class="screen">${hdr(esc(t('content.title')), esc(t('content.sub')))}
    <div class="chips">${chip('contentK', 'all', t('f.all'), ui.contentK)}${chip('contentK', 'video', t('cf.video'), ui.contentK, byK('video'))}${chip('contentK', 'post', t('cf.posts'), ui.contentK, byK('post'))}${chip('contentK', 'draft', t('cf.drafts'), ui.contentK, byK('draft'))}</div>
    <div class="chips">${chip('contentS', 'all', t('f.all'), ui.contentS)}${chip('contentS', 'review', t('cf.approve'), ui.contentS, sCount('review'))}${chip('contentS', 'published', t('cf.published'), ui.contentS)}</div>
    <div id="list">${cards || `<p class="empty">${esc(t('content.empty'))}</p>`}</div></section>`;
};

function periodChips(group, cur) { return `<div class="chips fill">${D.analytics.periods.map((p) => chip(group, p, t('p.' + p), cur)).join('')}</div>`; }
screens.analytics = () => {
  const d = D.analytics.byPeriod[ui.period];
  const kpi = (ic, cls, lbl, val, g) => `<div class="kpi"><span class="ic ${cls}">${icon(ic)}</span><span><span class="lbl">${esc(lbl)}</span><div class="val">${val}</div><span class="g">${g}</span></span></div>`;
  const legend = D.analytics.platforms.map((p) => `<button data-act="series" data-id="${p.id}" aria-pressed="${!ui.hidden.has(p.id)}"><span class="sw c-${p.id}"></span>${esc(p.name)}<span class="v">${p.v}</span></button>`).join('');
  return `<section class="screen">${hdr(esc(t('an.title')) + ' ' + demo(), '', `<a class="icon-btn" href="#/analytics/widget" aria-label="+">${icon('plus')}</a>`)}
    ${periodChips('period', ui.period)}
    <div class="kpis">${kpi('pulse', 'green', t('an.views'), d.views, d.viewsG)}${kpi('users', 'violet', t('an.subs'), d.subs, d.subsG)}${kpi('dollar', 'blue', t('an.rev'), money(d.rev), d.revG)}${kpi('gamepad', 'violet', t('an.players'), d.players, d.playersG)}</div>
    <div class="card chart-card"><h3>${esc(t('an.byPlatform'))} <span class="r">${d.views} ${demo()}</span></h3><div id="lchart">${lineChart(D.analytics.platforms, ui.hidden)}</div><div class="legend">${legend}</div></div>
    <div class="card chart-card"><h3>${esc(t('an.audience'))} <span class="r up">${d.growth}</span></h3>${barChart(D.analytics.audience, 330, 100, { labels: false, gap: .32 })}</div>
  </section>`;
};

screens.finance = () => {
  const d = D.finance.byPeriod[ui.finPeriod], cur = S.currency, rate = D.finance.rates[cur];
  const rows = D.finance.sources.map((s) => {
    const [ic, cls] = s.icon === 'gamepad' ? ['gamepad', 'gp'] : s.icon === 'x' ? ['xlogo', 'black'] : s.icon === 'tiktok' ? ['tiktok', 'black'] : brand[s.icon];
    return `<a class="row src-row" href="#/finance/${s.id}"><span class="bi ${cls}">${icon(ic)}</span><span class="body"><span class="t1">${esc(s.name)}</span><span class="pbar"><span class="track"><span class="fill" data-w="${s.share}"></span></span></span></span>
      <span class="amt"><b>${money(s.amount * rate * (d.total / 3450), cur)}</b><span>${s.growth}</span></span></a>`;
  }).join('');
  return `<section class="screen">${hdr(esc(t('fin.title')), esc(t('fin.sub')), `<a class="icon-btn" href="#/finance/new" aria-label="+">${icon('plus')}</a>`)}
    ${periodChips('finPeriod', ui.finPeriod)}
    <div class="card total-card"><div class="lbl">${esc(t('fin.total'))}</div><div class="val">${money(d.total * rate, cur)} ${demo()}</div><div class="g up">${d.growth}</div>
      <button class="cur-btn" data-act="currency" aria-label="${esc(cur)}">${esc(cur)}${icon('down')}</button>${barChart(d.bars, 330, 90)}</div>
    <h2 class="section-title">${esc(t('fin.sources'))} ${demo()}</h2><div class="stack">${rows}</div></section>`;
};

screens.games = () => {
  const g = D.games[ui.game], st = g.stats;
  const nav = D.games.sections.map((s) => `<a class="row nav-row" href="#/games/${s.id}"><span class="ic ${s.color}">${icon(s.icon)}</span><span class="body"><span class="t1">${E(s.title)}</span><span class="t2">${E(s.sub)}</span></span><span class="chev">${icon('chevron')}</span></a>`).join('');
  return `<section class="screen">${hdr(esc(t('games.title')), esc(t('games.sub')))}
    <div class="seg">${chip('game', 'mk', 'MOONKATTY Game', ui.game)}${chip('game', 'nh', 'New Horizons', ui.game)}</div>
    <a class="banner" href="#/games/players">${img(g.img, g.name)}${ui.game === 'mk' ? '<span class="lbl">MOONKATTY<br>GAME</span>' : ''}</a>
    <div class="gstats"><div class="gstat"><div class="lbl">${esc(t('g.active'))}</div><div class="val">${st.active}</div><div class="g">${st.activeG}</div></div>
      <div class="gstat"><div class="lbl">${esc(t('g.new'))}</div><div class="val">${st.fresh}</div><div class="g">${st.freshG}</div></div>
      <div class="gstat"><div class="lbl">${esc(t('g.time'))}</div><div class="val">${st.time} <small>${esc(t('g.min'))}</small></div><div class="g">${st.timeG}</div></div></div>
    <p class="muted" id="gdemo">${demo()} <small>${esc(t('demo.data'))}</small></p>
    <div class="stack">${nav}</div></section>`;
};

const epState = (e) => S.approvals[e.id] || e.state;
const epPill = (st) => ({ ready: 'green', work: 'gold', plan: 'navy', draft: 'navy', approved: 'green', rework: 'red' }[st]);
const epLabel = (st) => st === 'approved' ? t('ts.approved') : st === 'rework' ? t('ts.rework') : t('es.' + st);
screens.news = () => {
  const c = D.news.current;
  let body = '';
  if (ui.newsTab === 'episodes') {
    body = `<article class="card ep-hero"><a class="media" href="#/news/${c.id}" aria-label="${esc(L(c.title))}">${img(c.img, L(c.title), true)}<span class="pill onair onair">${esc(t('news.onair'))}</span><span class="play">${icon('play')}</span></a>
      <div class="ep-meta"><div><b>${E(c.title)}</b><div class="muted">#${c.no} • ${c.dur} ${esc(t('news.min'))}</div></div><span class="pill ${epPill(epState(c))}">${esc(epLabel(epState(c)))}</span></div>
      ${approveBar(c.id, L(c.title))}</article>
      <h2 class="section-title">${esc(t('news.next'))}</h2>
      <div class="stack">${D.news.next.map((e) => `<a class="row ep-row" href="#/news/${e.id}"><span class="thumb">${img(e.img)}</span><span class="body"><span class="t1">${E(e.title)}</span><span class="t2">#${e.no} • ${E(e.when)}</span></span><span class="pill ${epPill(e.state)}">${esc(t('es.' + e.state))}</span></a>`).join('')}</div>`;
  } else if (ui.newsTab === 'scripts') {
    body = `<ul class="list-plain">${D.news.scripts.map((s) => `<li><span>${E(s.title)}</span><span class="muted">${s.words} ${esc(t('news.words'))}</span></li>`).join('')}</ul><div class="grid2"></div>${disabledBtn(t('news.script'), 'doc')}`;
  } else if (ui.newsTab === 'topics') {
    body = `<ul class="list-plain">${D.news.topics.map((s) => `<li>${E(s)}<span class="pill blue">DEMO</span></li>`).join('')}</ul><div class="grid2"></div>${disabledBtn(t('news.topicAdd'), 'plus')}`;
  } else {
    body = `<div class="plan-week">${D.news.plan.map((p) => `<div>${E(p.day)}<b>${p.items}</b></div>`).join('')}</div><p class="para muted">${demo()} ${esc(t('demo.data'))}</p>`;
  }
  return `<section class="screen">${hdr(esc(t('news.title')), esc(t('news.sub')), '', 'brand')}
    <div class="seg">${['episodes', 'scripts', 'topics', 'plan'].map((k) => chip('newsTab', k, t('nf.' + k), ui.newsTab)).join('')}</div><div id="list">${body}</div></section>`;
};

function postRow(p) {
  const [ic, cls] = brand[p.platform];
  const name = p.name || D.social.platforms.find((x) => x.id === p.platform).name;
  return `<a class="row post-row" href="#/social/post/${p.id}"><span class="bi ${cls}">${icon(ic)}</span><span class="body"><span class="t0 c-${p.platform}">${esc(name)}</span><span class="t1">${E(p.title)}</span>
    <span class="t3 s-${p.state}">${esc(t('ss.' + p.state))}${p.when ? ' • ' + E(p.when) : ''}</span></span><span class="pub">${icon('share2')}</span></a>`;
}
screens.social = () => {
  const plats = D.social.platforms.map((p) => { const [ic, cls] = brand[p.id]; return `<a class="plat" href="#/social/${p.id}"><span class="pi ${cls}">${icon(ic)}</span>${esc(p.name)}</a>`; }).join('');
  let body;
  if (ui.socialTab === 'posts') body = `<div class="stack">${D.social.posts.map(postRow).join('')}</div>`;
  else if (ui.socialTab === 'plan') body = `<div class="stack">${D.social.posts.filter((p) => p.state === 'scheduled').map(postRow).join('')}</div>`;
  else if (ui.socialTab === 'ideas') body = `<ul class="list-plain">${D.social.ideas.map((i) => `<li>${E(i)}<span class="pill blue">DEMO</span></li>`).join('')}</ul>`;
  else body = `<ul class="list-plain">${D.social.platforms.map((p) => `<li><span>${esc(p.name)}</span><span>${p.followers} <span class="up">${p.growth}</span> ${demo()}</span></li>`).join('')}</ul>`;
  return `<section class="screen">${hdr(esc(t('social.title')), esc(t('social.sub')))}<div class="plats">${plats}</div>
    <div class="chips">${['posts', 'plan', 'ideas', 'stats'].map((k) => chip('socialTab', k, t('sf.' + k), ui.socialTab)).join('')}</div><div id="list">${body}</div></section>`;
};

screens.notifications = () => {
  const imp = D.notifications.filter((n) => n.cat === 'important').length;
  const list = D.notifications.filter((n) => ui.notifF === 'all' || n.cat === ui.notifF);
  const rows = list.map((n) => `<a class="row notif-row${S.read[n.id] ? '' : ' unread'}" href="#/notifications/${n.id}"><span class="ic ${n.color}">${icon(n.icon)}</span>
    <span class="body"><span class="t1">${E(n.title)}</span><span class="t2">${E(n.text)}</span></span><span class="time">${esc(ago(n.ago))}</span></a>`).join('');
  const unread = D.notifications.some((n) => !S.read[n.id]);
  return `<section class="screen">${hdr(esc(t('notif.title')), '', unread ? `<button class="icon-btn" data-act="readAll" aria-label="${esc(t('notif.markAll'))}">${icon('check')}</button>` : '')}
    <div class="chips">${chip('notifF', 'all', t('f.all'), ui.notifF)}${chip('notifF', 'important', t('nfl.important'), ui.notifF, imp, true)}${chip('notifF', 'system', t('nfl.system'), ui.notifF)}${chip('notifF', 'finance', t('nfl.finance'), ui.notifF)}</div>
    <div class="stack" id="list">${rows || `<p class="empty">${esc(t('content.empty'))}</p>`}</div></section>`;
};

const SETTINGS = [['profile', 'user', 's-blue'], ['devices', 'monitor', 's-indigo'], ['notif', 'bell', 's-orange'], ['integr', 'plane', 's-sky'], ['mac', 'mac', 's-steel'], ['look', 'palette', 's-rose'], ['help', 'info', 's-azure'], ['about', 'box', 's-amber']];
screens.settings = () => `<section class="screen">${hdr(esc(t('set.title')))}<div class="set-list">${SETTINGS.map(([k, ic, c]) =>
  `<a class="row set-row" href="#/settings/${k}"><span class="ic ${c}">${icon(ic)}</span><span class="body"><span class="t1">${esc(t('set.' + k))}</span><span class="t2">${esc(t('set.' + k + '.s'))}</span></span><span class="chev">${icon('chevron')}</span></a>`).join('')}</div></section>`;

const MORE = [['ideas', 'bulb', 'm-gray'], ['docs', 'file', 'm-blue'], ['team', 'team', 'm-violet'], ['exp', 'flask', 'm-teal'], ['backup', 'backup', 'm-olive']];
const SECTIONS = [['tasks', 'playTri', '#/tasks'], ['finance', 'dollar', '#/finance'], ['games', 'gamepad', '#/games'], ['news', 'stack', '#/news'], ['social', 'send', '#/social'], ['notif', 'bell', '#/notifications'], ['settings', 'gear', '#/settings'], ['analytics', 'bars', '#/analytics']];
screens.more = () => `<section class="screen">${hdr(esc(t('more.title')))}<div class="set-list">${MORE.map(([k, ic, c]) =>
  `<a class="row set-row more-row" href="#/more/${k}"><span class="ic ${c}">${icon(ic)}</span><span class="body"><span class="t1">${esc(t('more.' + k))}</span><span class="t2">${esc(t('more.' + k + '.s'))}</span></span><span class="chev">${icon('chevron')}</span></a>`).join('')}</div>
  <div class="logout"><span class="lr">${icon('logout')}<button disabled aria-disabled="true" data-stage="3">${esc(t('more.logout'))}</button></span><span class="stage-note">${esc(t('stage3'))}</span></div>
  <h2 class="section-title">${esc(t('more.sections'))}</h2>
  <div class="sections">${SECTIONS.map(([k, ic, h]) => `<a class="tile" href="${h}">${icon(ic)}${esc(t('sec.' + k))}</a>`).join('')}</div></section>`;

/* ---------------- sub-pages ---------------- */
const pages = {};
pages.games = (id) => {
  const s = D.games.sections.find((x) => x.id === id); if (!s) return null;
  let body = '';
  if (id === 'manage') body = `<ul class="list-plain">${D.games.events.map((e) => `<li>${E(e)}<span class="pill blue">DEMO</span></li>`).join('')}</ul><div class="grid2"></div>${disabledBtn(t('g.events'), 'plus')}`;
  if (id === 'players') body = `<div class="card">${D.games.regions.map((r) => `<div class="meter"><span>${E(r.name)}</span><span class="track"><span class="fill" data-w="${r.share}"></span></span><span>${r.share}%</span></div>`).join('')}</div><p class="para">${demo()}</p>`;
  if (id === 'monetization') body = `<ul class="list-plain">${D.games.store.map((r) => `<li><span>${E(r.name)}</span><span class="muted">${r.sold} ${esc(t('g.sold'))} · $${r.price} ${demo()}</span></li>`).join('')}</ul><div class="grid2"></div>${disabledBtn(t('g.store'), 'coin')}`;
  return `<section class="screen">${backHdr(E(s.title), E(s.sub), '#/games')}${body}</section>`;
};
pages.social = (id) => {
  const p = D.social.platforms.find((x) => x.id === id); if (!p) return null;
  const [ic, cls] = brand[id];
  return `<section class="screen">${backHdr(esc(p.name), esc(t('social.followers')) + ': ' + p.followers + ' · ' + p.growth, '#/social')}
    <div class="plats"><span class="plat"><span class="pi ${cls}">${icon(ic)}</span>${esc(p.name)}</span><div class="plat"><b>${p.followers}</b>${demo()}</div><div class="plat"><b class="up">${p.growth}</b>${esc(t('home.growth'))}</div></div>
    <h2 class="section-title">${esc(t('social.postsOn'))}</h2><div class="stack">${D.social.posts.filter((x) => x.platform === id).map(postRow).join('') || `<p class="empty">${esc(t('content.empty'))}</p>`}</div>
    <div class="grid2"></div>${disabledBtn(t('social.connect'), 'lock')}</section>`;
};
function toggleRow(key, label, scope = 'toggles') { const on = !!S[scope][key]; return `<div class="tg-row"><span>${esc(label)}</span><button class="toggle" role="switch" data-act="toggle" data-scope="${scope}" data-k="${key}" aria-checked="${on}" aria-label="${esc(label)}"></button></div>`; }
pages.settings = (id) => {
  const title = t('set.' + id); if (title === 'set.' + id) return null;
  let body = '';
  if (id === 'profile') body = `<div class="card kv"><div><span>${esc(t('set.owner'))}</span><span>Igor</span></div><div><span>${esc(t('set.sessions'))}</span><span>1 · iPhone ${demo()}</span></div></div><div class="grid2"></div>${disabledBtn(t('set.auth'), 'lock', 3)}`;
  if (id === 'devices') body = `<div class="stack">${D.devices.map((d) => `<div class="row dev-row"><span class="ic ${d.online ? 's-steel' : 'gray'}">${icon(d.id === 'iphone' ? 'user' : 'monitor')}</span><span class="body"><span class="t1">${esc(d.name)}</span><span class="t2">${E(d.role)}</span></span><span class="pill ${d.online ? 'green' : 'gray'}">${esc(t(d.online ? 'online' : 'offline'))}</span></div>`).join('')}</div><p class="para">${demo()} ${esc(t('demo.data'))}</p>`;
  if (id === 'notif') body = `<div class="card">${toggleRow('push', t('set.n.push'))}${toggleRow('important', t('set.n.important'))}${toggleRow('finance', t('set.n.finance'))}${toggleRow('system', t('set.n.system'))}</div><p class="stage-note">${esc(t('set.saved'))} · ${esc(t('stage2'))}: push</p>`;
  if (id === 'integr') body = `<div class="stack">${D.integrations.map((i) => { const [ic, cls] = brand[i.id]; return `<div class="row post-row"><span class="bi ${cls}">${icon(ic)}</span><span class="body"><span class="t1">${esc(i.name)}</span><span class="t3">${esc(t('stage2'))}</span></span><button class="btn ghost" disabled aria-disabled="true">${esc(t('set.connect'))}</button></div>`; }).join('')}</div>`;
  if (id === 'mac') { const d = D.devices[0]; body = `<div class="card"><div class="tg-row"><span>${esc(d.name)}</span><span class="pill green">${esc(t('online'))} · DEMO</span></div>${[['cpu', d.cpu], ['ram', d.ram], ['disk', d.disk]].map(([k, v]) => `<div class="meter"><span>${esc(t('set.' + k))}</span><span class="track"><span class="fill" data-w="${v}"></span></span><span>${v}%</span></div>`).join('')}<div class="tg-row"><span>${esc(t('set.uptime'))}</span><span>${E(d.uptime)}</span></div></div><div class="grid2"></div>${disabledBtn(t('set.restart'), 'update')}<div class="grid2"></div>${disabledBtn(t('set.logs'), 'doc')}`; }
  if (id === 'look') body = `<div class="card"><div class="tg-row"><span>${esc(t('set.lang'))}</span><div class="seg lang-seg">${chip('lang', 'ru', 'Русский', getLang())}${chip('lang', 'en', 'English', getLang())}</div></div>
    <div class="tg-row"><span>${esc(t('set.theme'))}</span><span class="muted">${esc(t('set.themeDark'))}</span></div><div class="tg-row"><span>${esc(t('set.motion'))}</span><button class="toggle" role="switch" data-act="motion" aria-checked="${S.motion}" aria-label="${esc(t('set.motion'))}"></button></div></div>`;
  if (id === 'help') body = `<div class="card faq">${D.faq.map((f) => `<details><summary class="q">${E(f.q)}${icon('down')}</summary><p>${E(f.a)}</p></details>`).join('')}</div><div class="grid2"></div>${disabledBtn(t('set.support'), 'chat')}`;
  if (id === 'about') body = `<div class="card kv"><div><span>${esc(t('app.name'))}</span><span>v${D.appInfo.version}</span></div><div><span>${esc(t('set.stage'))}</span><span>${D.appInfo.stage} · DEMO</span></div><div><span>${esc(t('set.data'))}</span><span>${esc(D.DATA_VERSION)}</span></div></div><div class="grid2"></div><button class="btn ghost wide" data-act="reset">${icon('update')}<span>${esc(t('set.reset'))}</span></button>`;
  return `<section class="screen">${backHdr(esc(title), esc(t('set.' + id + '.s')), '#/settings')}${body}</section>`;
};
pages.more = (id) => {
  const title = t('more.' + id); if (title === 'more.' + id) return null;
  let body = '';
  if (id === 'ideas') body = `<div class="card">${D.ideas.map((i) => { const done = S.ideas[i.id] ?? i.done; return `<div class="tg-row"><span>${E(i.title)}</span><button class="toggle" role="switch" data-act="idea" data-id="${i.id}" aria-checked="${done}" aria-label="${esc(t('ideas.done'))}"></button></div>`; }).join('')}</div><p class="stage-note">${esc(t('set.saved'))}</p>`;
  if (id === 'docs') body = `<ul class="list-plain">${D.documents.map((d) => `<li><span>${E(d.title)}</span><span class="muted">${d.kind} · ${d.size}</span></li>`).join('')}</ul><div class="grid2"></div>${disabledBtn(t('docs.open'), 'doc')}`;
  if (id === 'team') body = `<div class="stack">${D.agents.map((a) => `<a class="row agent-row" href="#/agents/${a.id}"><span class="thumb">${img(a.img)}</span><span class="body"><span class="t1">${esc(a.name)}</span><span class="t2">${E(a.role)}</span></span><span class="chev">${icon('chevron')}</span></a>`).join('')}</div>`;
  if (id === 'exp') body = `<div class="card">${D.experiments.map((x) => { const on = S.exp[x.id] ?? x.on; return `<div class="tg-row"><span>${E(x.title)}</span><button class="toggle" role="switch" data-act="exp" data-id="${x.id}" aria-checked="${on}" aria-label="${esc(L(x.title))}"></button></div>`; }).join('')}</div><p class="stage-note">${esc(t('set.saved'))}</p>`;
  if (id === 'backup') body = `<div class="card kv"><div><span>${esc(t('backup.last'))}</span><span>${esc(t('backup.none'))}</span></div></div><div class="grid2"></div>${disabledBtn(t('backup.now'), 'backup')}`;
  return `<section class="screen">${backHdr(esc(title), esc(t('more.' + id + '.s')), '#/more')}${body}</section>`;
};

/* ---------------- sheets ---------------- */
const sheets = {};
function sheetHdr(title) { return `<div class="grabber"></div><div class="sheet-hdr"><h2>${title}</h2><button class="icon-btn" data-act="close" aria-label="${esc(t('close'))}">${icon('close')}</button></div>`; }
sheets.agents = (id) => {
  if (id === 'new') return sheetHdr(esc(t('agent.add'))) + `<label class="field">${esc(t('agents.title'))}<input disabled value="New Agent"></label>${disabledBtn(t('agent.add'), 'plus')}`;
  const a = agentById(id); if (!a) return null;
  const st = S.paused[a.id] ? 'wait' : a.status;
  const my = D.tasks.filter((x) => x.agent === a.id);
  return sheetHdr(esc(a.name)) + `<div class="agent-head">${img(a.img, a.name)}<div><b>${esc(a.name)}${a.crown ? icon('crown') : ''}</b><p>${E(a.role)}</p><p class="st-${st}"><span class="dot"></span>${esc(S.paused[a.id] ? t('agent.pause') + ' · DEMO' : L(a.activity))}</p></div></div>
    <p class="para">${E(a.about)}</p>
    <div class="card kv"><div><span>${esc(t('agent.load'))}</span><span>${a.load}% ${demo()}</span></div><div><span>${esc(t('agent.done'))}</span><span>${a.done} ${demo()}</span></div></div>
    <h2 class="section-title">${esc(t('agent.tasks'))}</h2><div class="stack">${my.map((x) => `<a class="row" href="#/tasks/${x.id}"><span class="body"><span class="t1">${E(x.title)}</span>${taskStatusLine(x)}</span><span class="chev">${icon('chevron')}</span></a>`).join('') || `<p class="empty">${esc(t('agent.none'))}</p>`}</div>
    <div class="grid2"><button class="btn ghost" data-act="pause" data-id="${a.id}">${icon(S.paused[a.id] ? 'play' : 'lock')}<span>${esc(S.paused[a.id] ? t('f.work') : t('agent.pause'))}</span><span class="demo-tag">DEMO</span></button>${disabledBtn(t('agent.assign'), 'plus')}</div>`;
};
sheets.tasks = (id) => {
  if (id === 'new') return sheetHdr(esc(t('task.new'))) + `<label class="field">${esc(t('tasks.title'))}<textarea disabled rows="3"></textarea></label><label class="field">${esc(t('task.agent'))}<select disabled><option>AI CEO</option></select></label>${disabledBtn(t('task.new'), 'plus')}`;
  const tk = D.tasks.find((x) => x.id === id); if (!tk) return null;
  const tg = tagOf(tk.tag), ag = agentById(tk.agent), st = taskStatus(tk);
  return sheetHdr(E(tk.title)) + `<div class="hero-img">${img(tk.img)}</div><span class="tag ${tg.c}">${E(tg)}</span>
    <div class="card kv"><div><span>${esc(t('task.status'))}</span>${taskStatusLine(tk)}</div><div><span>${esc(t('task.agent'))}</span><a class="cyan" href="#/agents/${ag.id}">${esc(ag.name)}</a></div><div><span>${esc(t('content.platform'))}</span><span>${E(tk.sub)}</span></div></div>
    ${isReviewable(tk.status) ? `<div class="card">${approveBar(tk.id, L(tk.title))}</div>` : ''}${st === 'approved' || st === 'rework' ? '' : ''}`;
};
sheets.content = (id) => {
  const c = D.content.find((x) => x.id === id); if (!c) return null;
  const ag = agentById(c.agent), st = contentState(c);
  return sheetHdr(esc(c.title)) + `<div class="hero-img">${img(c.img, c.title)}${c.dur ? `<button class="playov" disabled aria-disabled="true" aria-label="${esc(t('stage2'))}">${icon('play')}</button>` : ''}</div>
    ${c.dur ? `<p class="stage-note">▶ ${esc(t('stage2'))}</p>` : ''}
    <div class="card kv"><div><span>${esc(t('content.platform'))}</span><span>${esc(c.platform)}</span></div><div><span>${esc(t('content.state'))}</span><span>${esc(st === 'approved' ? t('ts.approved') : st === 'rework' ? t('ts.rework') : t('cs.' + st))}</span></div><div><span>${esc(t('task.agent'))}</span><a class="cyan" href="#/agents/${ag.id}">${esc(ag.name)}</a></div>${c.dur ? `<div><span>⏱</span><span>${c.dur}</span></div>` : ''}</div>
    ${c.state === 'review' ? `<div class="card">${approveBar(c.id, c.title)}</div>` : ''}`;
};
sheets.news = (id) => {
  const c = D.news.current;
  if (id === c.id) return sheetHdr(E(c.title) + ` #${c.no}`) + `<div class="hero-img">${img(c.img)}<button class="playov" disabled aria-disabled="true" aria-label="${esc(t('stage2'))}">${icon('play')}</button></div><p class="stage-note">▶ ${esc(t('stage2'))}</p>
    <h2 class="section-title">${esc(t('news.script'))}</h2><p class="para">${E(c.script)}</p><div class="card">${approveBar(c.id, L(c.title))}</div>`;
  const e = D.news.next.find((x) => x.id === id); if (!e) return null;
  return sheetHdr(E(e.title) + ` #${e.no}`) + `<div class="hero-img">${img(e.img)}</div><div class="card kv"><div><span>${esc(t('task.status'))}</span><span class="pill ${epPill(e.state)}">${esc(t('es.' + e.state))}</span></div><div><span>⏱</span><span>${E(e.when)}</span></div></div><div class="grid2"></div>${disabledBtn(t('news.script'), 'doc')}`;
};
sheets.notifications = (id) => {
  const n = D.notifications.find((x) => x.id === id); if (!n) return null;
  return sheetHdr(E(n.title)) + `<div class="agent-head"><span class="ic ${n.color} notif-big">${icon(n.icon)}</span><div><p>${E(n.text)}</p><p class="muted">${esc(ago(n.ago))} · DEMO</p></div></div>
    <a class="btn ghost wide" href="${esc(n.link)}">${icon('chevron')}<span>${esc(t('notif.go'))}</span></a>`;
};
sheets.finance = (id) => {
  if (id === 'new') return sheetHdr('+ ' + esc(t('fin.title'))) + `<label class="field">${esc(t('fin.sources'))}<input disabled></label>${disabledBtn(t('fin.export'), 'doc')}`;
  const s = D.finance.sources.find((x) => x.id === id); if (!s) return null;
  return sheetHdr(esc(s.name)) + `<div class="card kv"><div><span>${esc(t('fin.total'))}</span><span>${money(s.amount * D.finance.rates[S.currency], S.currency)} ${demo()}</span></div><div><span>${esc(t('home.growth'))}</span><span class="up">${s.growth}</span></div><div><span>${esc(t('fin.share'))}</span><span>${Math.round(s.amount / 34.5)}%</span></div></div>
    <div class="card chart-card">${barChart(sparkFor(s.id), 330, 90)}</div><div class="grid2"></div>${disabledBtn(t('fin.export'), 'doc')}`;
};
sheets.analytics = (id) => id === 'widget' ? sheetHdr('+ ' + esc(t('an.title'))) + `<p class="para">${esc(t('an.byPlatform'))}, ${esc(t('an.audience'))}…</p>${disabledBtn('+ ' + t('an.title'), 'plus')}` : null;
sheets.home = (id) => id === 'request' ? sheetHdr(esc(t('toast.newRequest'))) + `<label class="field">${esc(t('agents.title'))}<select disabled><option>AI CEO</option></select></label><label class="field">${esc(t('qa.new').replace('\n', ' '))}<textarea disabled rows="4"></textarea></label>${disabledBtn(t('toast.newRequest'), 'send')}` : null;
sheets.socialpost = (id) => {
  const p = D.social.posts.find((x) => x.id === id); if (!p) return null;
  const [ic, cls] = brand[p.platform];
  return sheetHdr(E(p.title)) + `<div class="row post-row"><span class="bi ${cls}">${icon(ic)}</span><span class="body"><span class="t1">${E(p.title)}</span><span class="t3 s-${p.state}">${esc(t('ss.' + p.state))}${p.when ? ' • ' + E(p.when) : ''}</span></span></div><div class="grid2"></div>${disabledBtn(t('social.publishNow'), 'send')}`;
};

/* ---------------- router ---------------- */
const TAB_OF = { home: 'home', agents: 'agents', content: 'content', analytics: 'analytics' };
let current = { key: null, sheet: null };
function parse() {
  const h = (location.hash || '#/home').replace(/^#\/?/, '');
  const [p, q] = h.split('?');
  const parts = p.split('/').filter(Boolean);
  return { parts: parts.length ? parts : ['home'], query: new URLSearchParams(q || '') };
}
function resolve({ parts, query }) {
  const [a, b, c] = parts;
  if (!screens[a]) return { key: '404', html: notFound() };
  if (a === 'social' && b === 'post') return { key: 'social', base: a, sheet: sheets.socialpost(c) ?? undefined };
  if (b && pages[a]) { const html = pages[a](b); return html ? { key: a + '/' + b, html, base: a, sub: true } : { key: '404', html: notFound() }; }
  if (b && sheets[a]) { const sh = sheets[a](b); return sh ? { key: a, base: a, sheet: sh, query } : { key: '404', html: notFound() }; }
  if (b) return { key: '404', html: notFound() };
  return { key: a, base: a, query };
}
function notFound() { return `<section class="screen">${hdr(esc(t('notfound')))}<a class="btn ghost wide" href="#/home">${esc(t('home.link'))}</a></section>`; }
function applyQuery(base, q) {
  if (!q) return;
  if (base === 'content' && q.get('s')) { ui.contentS = q.get('s'); ui.contentK = 'all'; }
  if (base === 'tasks' && q.get('f')) ui.taskF = q.get('f');
  if (base === 'agents' && q.get('f')) ui.agentF = q.get('f');
  if (base === 'notifications' && q.get('f')) ui.notifF = q.get('f');
}
let lastDepth = 0;
function route(opts = {}) {
  const r = resolve(parse());
  if (r.key !== current.key || opts.force) {
    if (r.base) applyQuery(r.base, r.query);
    const html = r.html || screens[r.base]();
    const view = $('#view');
    const depth = r.sub ? 1 : 0;
    view.innerHTML = html;
    const scr = view.firstElementChild;
    if (!opts.inplace && S.motion) scr.classList.add(depth < lastDepth ? 'enter-back' : 'enter');
    lastDepth = depth;
    widthsPass(view);
    if (!opts.inplace) window.scrollTo(0, 0);
    current.key = r.key;
    setTab(r.base || 'home');
    document.title = (scr.querySelector('h1')?.textContent || 'MOONKATTY') + ' · MOONKATTY AI CONTROL';
  }
  setSheet(r.sheet || null);
}
function setTab(base) {
  const tab = TAB_OF[base] || 'more';
  const atRoot = current.key === base && !current.sheetOpen;
  document.querySelectorAll('.tabbar a').forEach((a) => { const on = a.dataset.tab === tab; if (on && atRoot) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); a.classList.toggle('active', on); });
}
function renderTabbar() {
  const tabs = [['home', 'home', 'tab.home'], ['agents', 'robot', 'tab.agents'], ['content', 'stack', 'tab.content'], ['analytics', 'bars', 'tab.analytics'], ['more', 'cluster', 'tab.more']];
  $('#tabbar').innerHTML = tabs.map(([k, ic, l]) => `<a href="#/${k}" data-tab="${k}">${icon(ic)}<span>${esc(t(l))}</span></a>`).join('');
}
let lastFocus = null;
function setSheet(html) {
  const wrap = $('#sheet-wrap'), sheet = $('#sheet');
  if (html) {
    if (!current.sheetOpen) lastFocus = document.activeElement;
    sheet.innerHTML = html; widthsPass(sheet); sheet.scrollTop = 0;
    wrap.classList.add('open'); wrap.removeAttribute('aria-hidden'); document.body.classList.add('locked');
    current.sheetOpen = true; $('#view').setAttribute('inert', '');
    requestAnimationFrame(() => sheet.querySelector('[data-act="close"]')?.focus({ preventScroll: true }));
  } else if (current.sheetOpen) {
    wrap.classList.remove('open'); wrap.setAttribute('aria-hidden', 'true'); document.body.classList.remove('locked');
    current.sheetOpen = false; $('#view').removeAttribute('inert');
    lastFocus?.focus?.({ preventScroll: true });
  }
  setTab(resolve(parse()).base || 'home');
}
function go(hash) { if (location.hash === hash) return route(); history.pushState({ aic: 1 }, '', hash); route(); }
function up(toHash) { if (history.state?.aic) history.back(); else { history.replaceState(null, '', toHash); route(); } }
function parentHash() { const { parts } = parse(); return '#/' + parts[0]; }
function rerender() { route({ force: true, inplace: true }); }

/* ---------------- toast ---------------- */
let toastTimer;
export function toast(msg, action) {
  const host = $('#toast'); host.innerHTML = '';
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  el.textContent = msg;
  if (action) { const b = document.createElement('button'); b.className = 'tb'; b.textContent = action.label; b.addEventListener('click', () => { action.fn(); el.remove(); }); el.append(b); }
  host.append(el); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 3200);
}

/* ---------------- actions ---------------- */
const actions = {
  filter(el) {
    const g = el.dataset.g, v = el.dataset.v;
    if (g === 'lang') { S.lang = v; save(); setLang(v); renderTabbar(); rerender(); return toast(t('toast.lang')); }
    ui[g] = v; rerender();
    if (g === 'period' || g === 'finPeriod') toast(t('toast.period', { p: t('p.' + v) }));
  },
  approve(el) { decide(el.dataset.id, 'approved', el.dataset.title); },
  rework(el) { decide(el.dataset.id, 'rework', el.dataset.title); },
  undo(el) { delete S.approvals[el.dataset.id]; save(); refreshAll(); toast(t('toast.undone')); },
  series(el) { const id = el.dataset.id; ui.hidden.has(id) ? ui.hidden.delete(id) : ui.hidden.add(id); if (ui.hidden.size === D.analytics.platforms.length) ui.hidden.delete(id); rerender(); },
  currency() { const c = D.finance.currencies; S.currency = c[(c.indexOf(S.currency) + 1) % c.length]; save(); rerender(); toast(t('toast.currency', { c: S.currency })); },
  toggle(el) { const sc = el.dataset.scope, k = el.dataset.k; S[sc][k] = !S[sc][k]; save(); el.setAttribute('aria-checked', S[sc][k]); toast(t('toast.toggle', { t: el.getAttribute('aria-label'), v: t(S[sc][k] ? 'on' : 'off') })); },
  idea(el) { const i = D.ideas.find((x) => x.id === el.dataset.id); S.ideas[i.id] = !(S.ideas[i.id] ?? i.done); save(); el.setAttribute('aria-checked', S.ideas[i.id]); toast(t('toast.toggle', { t: L(i.title), v: t(S.ideas[i.id] ? 'ideas.done' : 'ideas.todo') })); },
  exp(el) { const x = D.experiments.find((q) => q.id === el.dataset.id); S.exp[x.id] = !(S.exp[x.id] ?? x.on); save(); el.setAttribute('aria-checked', S.exp[x.id]); toast(t('toast.toggle', { t: L(x.title), v: t(S.exp[x.id] ? 'on' : 'off') })); },
  motion(el) { S.motion = !S.motion; save(); applyMotion(); el.setAttribute('aria-checked', S.motion); toast(t('toast.toggle', { t: t('set.motion'), v: t(S.motion ? 'set.motionOn' : 'set.motionOff') })); },
  pause(el) { const id = el.dataset.id; S.paused[id] = !S.paused[id]; if (!S.paused[id]) delete S.paused[id]; save(); refreshAll(); toast(`DEMO: ${agentById(id).name} — ${S.paused[id] ? t('agent.pause') : t('f.work')}`); },
  readAll() { D.notifications.forEach((n) => { S.read[n.id] = 1; }); save(); rerender(); toast(t('notif.allRead')); },
  reset() { const lang = S.lang; S = defaults(); S.lang = lang; save(); applyMotion(); rerender(); toast(t('set.resetDone')); },
  close() { up(parentHash()); },
  back(el) { up(el.dataset.to); },
};
function decide(id, val, title) {
  S.approvals[id] = val; save(); refreshAll();
  toast(t(val === 'approved' ? 'toast.approved' : 'toast.rework', { t: title }), { label: t('toast.undo'), fn: () => { delete S.approvals[id]; save(); refreshAll(); } });
}
function refreshAll() { const r = resolve(parse()); route({ force: true, inplace: true }); if (r.sheet) setSheet(resolve(parse()).sheet); }
function applyMotion() { document.documentElement.classList.toggle('reduce-motion', !S.motion); }

/* ---------------- boot ---------------- */
function boot() {
  setLang(S.lang); applyMotion(); renderTabbar();
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) { e.preventDefault(); actions[act.dataset.act]?.(act, e); return; }
    const a = e.target.closest('a[href^="#/"]');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (a.getAttribute('aria-current') === 'page') { window.scrollTo({ top: 0, behavior: S.motion ? 'smooth' : 'auto' }); return; }
      if (a.closest('.tabbar')) { history.pushState({ aic: 1 }, '', href); return route({ force: location.hash === href && current.key === href.slice(2) ? false : true }); }
      go(href);
    }
  });
  $('#sheet-backdrop').addEventListener('click', () => actions.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current.sheetOpen) actions.close(); });
  window.addEventListener('popstate', () => route());
  window.addEventListener('hashchange', () => route());
  if (!location.hash) history.replaceState(null, '', '#/home');
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* offline cache is optional */ });
  }
}
boot();
export const __test = { state: () => S, ui };
