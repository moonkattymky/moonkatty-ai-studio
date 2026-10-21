/* MOONKATTY AI STUDIO — Main Server dashboard (target look per owner's mockup). REAL data only: /api/system, /api/ops/nodes,
   /api/tasks, /api/logs. Missing features show empty / "не подключено" states — no invented numbers. */
'use strict';
(() => {
  const $ = id => document.getElementById(id); const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const H = { 'x-studio-request': '1', 'content-type': 'application/json' };
  const get = p => fetch(p, { credentials: 'same-origin', headers: H }).then(r => { if (r.status === 401) { location.href = '/'; throw new Error('401'); } return r.ok ? r.json() : null; }).catch(() => null);
  const pct = (u, t) => t ? Math.round(100 * u / t) : null; const gb = b => b == null ? '—' : b >= 1024 ** 4 ? (b / 1024 ** 4).toFixed(1) + ' TB' : (b / 1024 ** 3).toFixed(0) + ' GB';
  const bar = (n, p, c) => `<div class="m"><span>${n}</span><div class="bar"><i style="width:${p || 0}%;background:${c}"></i></div><span>${p == null ? '—' : p + '%'}</span></div>`;
  const hhmm = t => { const d = new Date(t); return isNaN(d) ? '' : d.toTimeString().slice(0, 5); };
  let nodesBadge = 0;
  const NAV = [['Dashboard', '⌂', '/studio.html'], ['AI Agents', '✦', '/#agents'], ['3D Studio', '⬡', '/#studio3d'], ['News Production', '◉', '/#news'], ['Video Production', '▶', '/#video'],
    ['Assets Library', '▣', '/#files'], ['Projects', '☾', '/#project'], ['Computers (Nodes)', '🖥', '/#computers'], ['Tasks', '☑', '/#agents'], ['Schedule', '▦', '/#calendar'], ['Analytics', '▤', '/#analytics'], ['Settings', '⚙', '/#settings']];
  const nav = () => { $('nav').innerHTML = NAV.map(([n, i, h], k) => `<a href="${h}" class="${k === 0 ? 'on' : ''}"><span class="i">${i}</span>${n}${n.startsWith('Computers') && nodesBadge ? `<span class="b">${nodesBadge}</span>` : ''}</a>`).join(''); };
  function macCard(name, role, sub, ico, st, cpu, ram, disk) {
    const cls = st === 'online' ? 'on' : st === 'down' ? 'off' : st === 'paused' ? 'pz' : 'na'; const label = { online: 'Online', down: 'Offline', paused: 'Paused', 'never-seen': 'Не подключён', 'not-registered': 'Не подключён', revoked: 'Отозван' }[st] || st;
    return `<div class="mac"><div class="top"><div class="ico">${ico}</div><div><b>${esc(name)} <span class="mut">(${esc(role)})</span></b><span class="mut">${esc(sub || '—')}</span></div><span class="pill ${cls}">${esc(label)}</span></div>
      ${bar('CPU', cpu, 'var(--blue)')}${bar('RAM', ram, 'var(--blue)')}${bar('Disk', disk, 'var(--blue)')}</div>`;
  }
  async function load() {
    const [sys, nodes, tasks, logs] = await Promise.all([get('/api/system'), get('/api/ops/nodes'), get('/api/tasks'), get('/api/logs')]);
    const M = sys && sys.memory && sys.memory.total ? sys.memory : null;
    let html = macCard('Mac mini', 'Main', sys ? sys.platform.replace('darwin', 'macOS') + ' · ' + sys.cpus + ' CPU' : '', '🖥️', sys ? 'online' : 'down', sys ? sys.cpuPct : null, M ? M.usedPct : sys ? pct(sys.memTotal - sys.memFree, sys.memTotal) : null, sys && sys.disk ? pct(sys.disk.total - sys.disk.free, sys.disk.total) : null);
    const list = nodes ? nodes.nodes : []; const want = [['news', 'News Node', 'iMac', '🖥'], ['monitor', 'Monitor Node', 'MacBook', '💻']];
    for (const [role, rl, def, ico] of want) { const n = list.find(x => x.role === role || x.role === (role === 'news' ? 'imac' : 'macbook'));
      if (!n) { html += macCard(def, rl, nodes ? 'узел не зарегистрирован' : 'Node Manager выключен (opsNodes)', ico, 'not-registered', null, null, null); continue; }
      const i = n.info || {}; const st = n.status === 'online' && n.command && n.command !== 'run' ? 'paused' : n.status;
      html += macCard(n.name || def, rl, [i.model, i.cpuModel && i.cpuModel.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim(), i.os].filter(Boolean).join(' · '), ico, st, i.cpuPct ?? null, i.memTotal ? pct(i.memTotal - i.memAvailable, i.memTotal) : null, i.diskTotal ? pct(i.diskTotal - i.diskFree, i.diskTotal) : null); }
    $('sys').innerHTML = html; nodesBadge = list.filter(n => n.status === 'online').length; nav();
    // running tasks: studio tasks in progress + node jobs leased (progress only when reported)
    const run = []; for (const t of (tasks || []).filter(t => t.status === 'in_progress')) run.push({ ic: '✦', t: t.title, s: t.agentId, p: null });
    if (nodes) for (const j of nodes.jobs.filter(j => j.status === 'leased')) run.push({ ic: j.capability.startsWith('news') ? '🌐' : j.capability.includes('ffprobe') ? '🎞' : '⚙', t: j.capability, s: (list.find(n => n.id === j.nodeId) || {}).name || j.nodeId, p: j.progress ?? null });
    $('run').innerHTML = run.length ? run.slice(0, 6).map(r => `<div class="task"><div class="ic">${r.ic}</div><div><b>${esc(r.t)}</b><div class="mut">${esc(r.s)}</div><div class="bar"><i style="width:${r.p ?? 0}%;background:var(--blue)"></i></div></div><span class="mut">${r.p == null ? '' : r.p + '%'}</span></div>`).join('') : '<div class="empty">Сейчас ничего не выполняется</div>';
    // recent activity: studio logs + node activity
    const acts = (logs || []).slice(-30).map(l => ({ at: l.at, txt: (l.source ? l.source + ': ' : '') + l.message, c: l.level === 'error' ? 'var(--red)' : l.level === 'warn' ? 'var(--amber)' : 'var(--blue)' }));
    for (const n of list) for (const a of n.activity || []) acts.push({ at: a.at, txt: `${n.name}: ${a.a}`, c: 'var(--green)' });
    acts.sort((a, b) => a.at < b.at ? 1 : -1); $('act').innerHTML = acts.length ? acts.slice(0, 6).map(a => `<div class="act"><time>${hhmm(a.at)}</time><span class="dot" style="background:${a.c}"></span><span>${esc(String(a.txt).slice(0, 90))}</span></div>`).join('') : '<div class="empty">Событий пока нет</div>';
    const errs = (logs || []).filter(l => l.level === 'error' && Date.now() - Date.parse(l.at) < 86400000).length + (nodes ? nodes.alerts.length : 0); $('bellN').textContent = errs || '';
    // storage: only what is measured (disk of the data volume + DB size); per-category breakdown is not tracked yet
    if (sys && sys.disk) { const used = sys.disk.total - sys.disk.free; $('stor').innerHTML = `<div class="leg"><b>${gb(used)} / ${gb(sys.disk.total)}</b><span>${pct(used, sys.disk.total)}%</span></div><div class="bar"><i style="width:${pct(used, sys.disk.total)}%;background:var(--blue)"></i></div>
      <div class="leg"><span>База данных студии</span><span>${(sys.dbSize / 1e6).toFixed(1)} MB</span></div><div class="leg"><span>Файлов в библиотеке</span><span>${sys.counts && sys.counts.files != null ? sys.counts.files : '—'}</span></div><div class="mut">Разбивка по категориям не ведётся</div>`; }
    else $('stor').innerHTML = '<div class="empty">Нет данных о диске</div>';
    const newsNode = list.find(n => (n.role === 'news' || n.role === 'imac') && n.status === 'online');
    $('qa').innerHTML = `<div class="qa"><button data-h="/#project"><span class="ic">＋</span>New Project</button><button data-h="/#video"><span class="ic">▶</span>Generate Video</button><button id="collect" ${newsNode ? '' : 'disabled title="Нет онлайн NEWS NODE"'}><span class="ic">🌐</span>Collect News</button></div>`;
    for (const b of document.querySelectorAll('.qa button[data-h]')) b.onclick = () => { location.href = b.dataset.h; };
    const c = $('collect'); if (c && newsNode) c.onclick = async () => { const feeds = (prompt('RSS-ленты (через пробел), официальные источники:') || '').split(/\s+/).filter(u => /^https:\/\//.test(u)); if (!feeds.length) return;
      const r = await fetch('/api/ops/nodes/jobs', { method: 'POST', credentials: 'same-origin', headers: H, body: JSON.stringify({ capability: 'news.collect', input: { feeds }, safeToRetry: true, maxAttempts: 3, preferNode: newsNode.id }) }); alert(r.ok ? 'Задача отправлена на ' + newsNode.name : 'Ошибка: ' + r.status); load(); };
    window.__DATA = { tasks: tasks || [], nodes: list };
  }
  $('q').oninput = () => { const s = $('q').value.trim().toLowerCase(); if (!s) { $('searchRes').innerHTML = ''; return; } const D = window.__DATA || { tasks: [] };
    const hits = D.tasks.filter(t => String(t.title).toLowerCase().includes(s)).slice(0, 8); $('searchRes').innerHTML = `<div class="card"><h3>Поиск: ${esc(s)}</h3>${hits.length ? hits.map(t => `<div class="act"><span class="mut">${esc(t.status)}</span> ${esc(t.title)}</div>`).join('') : '<div class="empty">Ничего не найдено</div>'}</div>`; };
  $('bell').onclick = () => { location.href = '/#logs'; };
  nav(); load(); setInterval(() => { if (!document.hidden) load(); }, 5000);
})();
