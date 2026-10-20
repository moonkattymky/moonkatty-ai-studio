// MOONKATTY Mobile Control Center UI (no inline scripts — CSP script-src 'self'). Token kept in localStorage of this origin only.
(() => {
  const $ = s => document.querySelector(s); const app = $('#app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let tok = localStorage.getItem('mk_mobile_token') || ''; let view = 'summary';
  async function api(m, p, body) {
    const r = await fetch('/api/mobile' + p, { method: m, headers: { authorization: 'Bearer ' + tok, 'x-studio-request': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { logout(); throw new Error('Требуется вход'); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }
  function logout() { localStorage.removeItem('mk_mobile_token'); tok = ''; $('#login').hidden = false; app.hidden = true; $('#nav').hidden = true; }
  const gb = b => b == null ? '—' : (b / 1024 ** 3).toFixed(2) + ' ГБ';
  const memLine = m => m && m.total ? `Память: занято ${gb(m.used)} из ${gb(m.total)} (${m.usedPct}%) · давление <b class="${m.pressure === 'green' ? 'ok' : m.pressure === 'yellow' ? 'warn' : 'err'}">${esc(m.pressure)}</b><br>App ${gb(m.app)} · Wired ${gb(m.wired)} · Compressed ${gb(m.compressed)} · Cached ${gb(m.cached)} · Swap ${gb(m.swapUsed)}` : 'Память: нет данных';
  const V = {
    async summary() { const s = await api('GET', '/summary'); const w = s.watchdog;
      return `<div class="card"><div class="row"><b>Система</b><span class="mut">${esc(new Date(s.at).toLocaleTimeString())}</span></div>
        <div class="mut">${memLine(s.system.memory)}</div><div class="mut">load ${s.system.loadavg.map(x => x.toFixed(1)).join(' ')}</div>
        <div class="mut">Tick: ${esc(s.system.lastTick || '—')}</div>${s.resources ? `<div class="mut">Ресурсы: ${esc(s.resources.mode)}, Ollama ${s.resources.ollama.totalGB} ГБ, задач ${s.resources.running.length}</div>` : ''}</div>
        ${w ? `<div class="card"><b>Watchdog</b> <span class="mut">${esc(w.lastCycleAt || '')}</span>${Object.entries(w.checks).map(([k, v]) => `<div class="${v.ok ? 'ok' : 'err'}">${v.ok ? '●' : '▲'} ${esc(k)} <span class="mut">${esc(v.detail)}</span></div>`).join('')}</div>` : ''}
        <div class="card"><b>Задачи</b><div class="mut">${Object.entries(s.tasks.byStatus).map(([k, v]) => esc(k) + ': ' + v).join(' · ') || 'нет'}</div>
        ${s.tasks.stuck.length ? `<div class="warn">Долго выполняются: ${s.tasks.stuck.map(t => esc(t.title) + ' (' + t.minutes + ' мин)').join(', ')}</div>` : ''}</div>
        <div class="card"><b>Ошибки за 10 мин: <span class="${s.errors.last10min ? 'err' : 'ok'}">${s.errors.last10min}</span></b>${s.errors.recent.slice(0, 5).map(e => `<div class="mut">${esc(e.source)}: ${esc(e.message)}</div>`).join('')}</div>
        <h2>Агенты</h2>${s.agents.map(a => `<div class="card row"><span>${esc(a.name)} <span class="mut">${esc(a.status)}</span>${a.lastError ? `<div class="err mut">${esc(a.lastError)}</div>` : ''}</span>
        ${a.controllable && a.enabled ? `<span><button data-ag="${esc(a.id)}|start">▶</button> <button data-ag="${esc(a.id)}|stop">■</button></span>` : ''}</div>`).join('')}`; },
    async tasks() { const l = await api('GET', '/tasks'); return l.slice(0, 60).map(t => `<div class="card"><div class="row"><b>${esc(t.title)}</b><span class="mut">${esc(t.status)} · ${esc(t.priority || '')}</span></div>
        <div class="mut">${esc(t.agentId)} · ${esc(t.resourceClass || '')}${t.blockedReason ? ' · ' + esc(t.blockedReason) : ''}${t.error ? ' · ' + esc(t.error) : ''}</div>
        <div class="row"><span></span><span><button data-t="${esc(t.id)}|start">Запустить</button> <button class="d" data-t="${esc(t.id)}|stop">Стоп</button></span></div></div>`).join('') || '<p class="mut">Нет задач</p>'; },
    async materials() { const m = await api('GET', '/materials');
      return `<h2>Результаты задач</h2>${m.tasks.map(t => `<div class="card"><b>${esc(t.title)}</b><pre>${esc(t.result)}</pre><div class="row"><span></span><span><button class="p" data-mt="${esc(t.id)}|approve">Утвердить</button> <button class="d" data-mt="${esc(t.id)}|reject">Отклонить</button></span></div></div>`).join('') || '<p class="mut">Нет</p>'}
        <h2>Публикации</h2>${m.queue.map(x => `<div class="card"><b>${esc(x.title)}</b> <span class="mut">${esc(x.channelId)} ${esc(x.scheduledAt || '')}</span><pre>${esc(x.text)}</pre><div class="row"><span></span><span><button class="p" data-mq="${esc(x.id)}|approve">Утвердить</button> <button class="d" data-mq="${esc(x.id)}|reject">Отклонить</button></span></div></div>`).join('') || '<p class="mut">Нет</p>'}`; },
    async media() { const l = await api('GET', '/media'); return l.map(f => `<div class="card"><div class="row"><b>${esc(f.name)}</b><span class="mut">${(f.size / 1e6).toFixed(1)} МБ</span></div><button data-media="${esc(f.id)}|${esc(f.mime)}">Открыть</button><div id="m-${esc(f.id)}"></div></div>`).join('') || '<p class="mut">Нет файлов</p>'; },
    async alerts() { const n = await api('GET', '/notifications'); return `<h2>Watchdog</h2>${n.watchdog.map(a => `<div class="card ${a.level === 'info' ? 'ok' : 'err'}">${esc(a.check)}: ${esc(a.detail)}<div class="mut">${esc(a.at)}</div></div>`).join('') || '<p class="mut">Нет</p>'}
        <h2>Журнал</h2>${n.logs.map(l => `<div class="card"><span class="${l.level === 'error' ? 'err' : 'warn'}">${esc(l.source)}</span> ${esc(l.message)}<div class="mut">${esc(l.at)}</div></div>`).join('')}<p><button class="d" id="logout">Выйти на этом устройстве</button></p>`; }
  };
  async function render() { try { app.innerHTML = await V[view](); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; } }
  async function act(fn) { try { await fn(); } catch (e) { alert(e.message); } render(); }
  app.addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.ag) { const [id, a] = d.ag.split('|'); return act(() => api('POST', `/agents/${encodeURIComponent(id)}/${a}`)); }
    if (d.t) { const [id, a] = d.t.split('|'); return act(() => api('POST', `/tasks/${encodeURIComponent(id)}/${a}`)); }
    if (d.mt) { const [id, a] = d.mt.split('|'); return act(() => api('POST', `/materials/task/${encodeURIComponent(id)}/${a}`, {})); }
    if (d.mq) { const [id, a] = d.mq.split('|'); if (a === 'approve' && !confirm('Утвердить публикацию? Она может уйти по расписанию.')) return; return act(() => api('POST', `/materials/queue/${encodeURIComponent(id)}/${a}`, {})); }
    if (d.media) { const [id, mime] = d.media.split('|'); const r = await fetch('/api/mobile/media/' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + tok } }); if (!r.ok) return alert('HTTP ' + r.status);
      const url = URL.createObjectURL(await r.blob()); const box = document.getElementById('m-' + id);
      box.innerHTML = /^image\//.test(mime) ? `<img src="${url}">` : /^video\//.test(mime) ? `<video src="${url}" controls playsinline></video>` : `<a href="${url}" download>Скачать</a>`; return; }
    if (b.id === 'logout') logout(); });
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b)); render(); });
  $('#save').onclick = () => { tok = $('#tok').value.trim(); localStorage.setItem('mk_mobile_token', tok); $('#tok').value = ''; start(); };
  function start() { if (!tok) return logout(); $('#login').hidden = true; app.hidden = false; $('#nav').hidden = false; render(); }
  setInterval(() => { if (tok && !document.hidden && view === 'summary') render(); }, 30000);
  start();
})();
