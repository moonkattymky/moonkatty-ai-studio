/* MOONKATTY AI STUDIO — Operations Dashboard (STUDIO_OPS_DASHBOARD=1). Real data only from /api/ops/*; the section
   appears only when the server reports the flag. Extends NAV/VIEWS/BIND from app.js. */
'use strict';
(() => {
  // MODE is detected asynchronously by app.js; the probe below simply finds no server in browser-only mode
  const gb = b => b == null ? '—' : (b / 1024 ** 3).toFixed(1) + ' ГБ';
  const dot = ok => `<span class="badge ${ok ? 'b-ok' : 'b-err'}">${ok ? 'OK' : 'ОШИБКА'}</span>`;
  let D = null, ERR = null;
  VIEWS.ops = () => {
    if (ERR) return `<div class="card"><b>Операции недоступны:</b> ${esc(ERR)}</div>`;
    if (!D) return '<div class="card">Загрузка данных…</div>';
    const c = D.components, wd = c.watchdog;
    return `<div class="grid g3">
      <div class="card"><h3>Компоненты</h3>
        <div>Сервер ${dot(c.server.ok)} <span class="small mut">pid ${c.server.pid}, ${Math.round(c.server.uptimeSec / 60)} мин</span></div>
        <div>Планировщик <span class="small mut">${esc(c.scheduler.lastTick || '—')}</span></div>
        <div>Ollama ${dot(c.ollama && c.ollama.ok)} <span class="small mut">${esc(c.ollama && (c.ollama.error || c.ollama.model) || '')}</span></div>
        <div>OpenCode <span class="small mut">${c.opencode.enabled ? 'включён (sandbox)' : 'выключен'}</span></div>
        <div>Watchdog ${wd ? `<span class="small mut">${esc(wd.lastCycleAt || '')}</span>${Object.entries(wd.checks || {}).map(([k, v]) => `<div class="small">${dot(v.ok)} ${esc(k)}: ${esc(v.detail)}</div>`).join('')}` : '<span class="small mut">не запущен</span>'}</div></div>
      <div class="card"><h3>Нагрузка</h3><div class="small">load ${D.load.loadavg.map(x => x.toFixed(2)).join(' ')} · CPU ${D.load.cpus}</div>
        ${(m => m && m.total ? `<div class="small">Память: занято ${gb(m.used)} из ${gb(m.total)} (${m.usedPct}%) · давление <span class="badge ${m.pressure === 'green' ? 'b-ok' : m.pressure === 'yellow' ? 'b-warn' : 'b-err'}">${esc(m.pressure)}</span></div><div class="small mut">App ${gb(m.app)} · Wired ${gb(m.wired)} · Compressed ${gb(m.compressed)} · Cached ${gb(m.cached)} · Swap ${gb(m.swapUsed)}</div>` : '<div class="small mut">Память: нет данных</div>')(D.load.memory)}
        ${D.load.resources ? `<div class="small">Resource Manager: ${esc(D.load.resources.mode)} · тяжёлые: ${Object.entries(D.load.resources.footprints).map(([k, v]) => esc(k) + ' ' + (v === 'unmeasured' ? 'не замерено' : v.limitGB + ' ГБ')).join(', ')} · Ollama ${D.load.resources.ollama.totalGB} ГБ · задач ${D.load.resources.running.length}</div>` : '<div class="small mut">Resource Manager выключен</div>'}</div>
      <div class="card"><h3>Задачи</h3><div class="small">Выполняются: ${D.tasks.current.length} · зависли (>60 мин): ${D.tasks.stuck.length} · ждут утверждения: ${D.tasks.waitingApproval} · заблокированы: ${D.tasks.blocked}</div>
        ${D.tasks.current.map(t => `<div class="small">▶ ${esc(t.title)} <span class="mut">${esc(t.agentId)} · ${t.minutes ?? '?'} мин</span></div>`).join('')}
        ${D.tasks.waitingPlan.length ? `<h4>План LLM ждёт проверки</h4>${D.tasks.waitingPlan.map(t => `<div class="row small">${esc(t.title)} <button class="btn sm" data-plan="${esc(t.id)}">Утвердить</button></div>`).join('')}` : ''}</div>
    </div>
    ${D.money ? `<div class="card"><h3>Деньги (журнал)</h3>${D.money.empty ? '<div class="small mut">Данных нет. Записи вносятся вручную или импортом CSV с подтверждением (proof). Числа не выдумываются.</div>' :
      ['actual', 'estimate', 'forecast'].map(k => `<div class="small"><b>${{ actual: 'Факт (с подтверждением)', estimate: 'Оценки (не выплаты)', forecast: 'Прогноз' }[k]}:</b> ${D.money.totals[k] ? Object.entries(D.money.totals[k]).map(([dir, cur]) => (dir === 'income' ? 'доход ' : 'расход ') + Object.entries(cur).map(([c, v]) => esc(v) + ' ' + esc(c)).join(' / ')).join(' · ') : '<span class="mut">нет данных</span>'}</div>`).join('')}
      <div class="small mut">Факт, оценки и прогноз не суммируются между собой; валюты не конвертируются. Сделок: ${D.money.deals} · целостность журнала: ${D.money.integrity.ok ? 'OK' : 'НАРУШЕНА'}</div>
      ${D.money.budgets.filter(b => b.over || b.warn).map(b => `<div class="small"><span class="badge ${b.over ? 'b-err' : 'b-warn'}">${b.over ? 'превышен' : '≥80%'}</span> ${esc(b.category)}: ${esc(b.spentActual)} / ${b.monthly} ${esc(b.currency)}</div>`).join('')}</div>` : ''}
    ${D.nodes ? `<div class="card"><h3>Узлы (Node Manager)</h3>${D.nodes.nodes.length ? D.nodes.nodes.map(n => `<div class="row small"><b>${esc(n.name)}</b> <span class="mut">${esc(n.id)} · ${esc(n.role)}</span> <span class="badge ${n.status === 'online' ? 'b-ok' : n.status === 'down' ? 'b-err' : 'b-warn'}">${esc(n.status)}</span>
      ${n.info ? `<span class="mut">${esc(n.info.os)} · CPU ${n.info.cpus} · load ${n.info.load1 != null ? n.info.load1.toFixed(1) : '?'} · RAM своб. ${gb(n.info.memAvailable)} из ${gb(n.info.memTotal)} · диск ${gb(n.info.diskFree)}</span>` : ''} · задач ${n.running} · ошибок ${n.errors}${n.lastError ? ` <span class="mut">(${esc(n.lastError)})</span>` : ''}</div>`).join('') : '<div class="small mut">Узлы не зарегистрированы (docs/ops/NODES.md)</div>'}
      <div class="small">Очередь узлов: ${Object.entries(D.nodes.counts).map(([k, v]) => esc(k) + ' ' + v).join(' · ') || 'пусто'}</div>
      <div class="row"><select id="enRole"><option value="news">news (iMac)</option><option value="monitor">monitor (MacBook)</option></select> <input id="enName" placeholder="ожидаемое имя" maxlength="64"> <button class="btn sm" id="enNew">Подключить компьютер</button></div>
      <div id="enOut" class="small"></div>
      ${(D.enroll || []).filter(q => ['pending', 'awaiting_code', 'locked'].includes(q.state)).map(q => `<div class="row small"><b>${esc(q.name)}</b> <span class="mut">${esc(q.nodeId)} · ${esc(q.role)} · ${esc(q.state)}${q.reenroll ? ' · повторное подключение' : ''}</span>
        ${q.device ? `<div><b>Ключ устройства: ${esc(q.device.pubKeyShort)}</b> — должен совпасть с экраном узла (127.0.0.1:8791)<br><span class="mut" style="word-break:break-all">SHA-256 ключа: ${esc(q.device.pubKeyFingerprint)} · deviceId ${esc(q.device.deviceId)}</span><br>
          <span class="mut">Сеть: ${esc(q.device.peer)} ${q.device.peerVerified ? '(подтверждено Tailscale)' : '(не подтверждено)'}</span><br>
          <span class="mut">Сообщено устройством (не проверено): ${esc(q.device.hostname)} · ${esc(q.device.model)} · ${esc(q.device.os)} · ${esc(q.device.arch)} · агент ${esc(q.device.agentVersion)}</span></div>` : ''}
        ${q.state === 'pending' ? `<button class="btn sm" data-enc="${esc(q.requestId)}">Подтвердить</button> <button class="btn sm" data-enr="${esc(q.requestId)}">Отклонить</button>` : ''}</div>`).join('')}
      ${D.nodes.nodes.map(n => `<span class="small"><button class="btn sm" data-rot="${esc(n.id)}">Ротация токена ${esc(n.id)}</button> <button class="btn sm" data-rev="${esc(n.id)}">Отозвать ${esc(n.id)}</button></span>`).join(' ')}
      <details class="small"><summary>Журнал событий узлов</summary>${(D.audit || []).slice(0, 50).map(e => `<div class="mut">${esc(e.at)} · ${esc(e.type)} · ${esc(e.nodeId || e.requestId || e.ip || '')}</div>`).join('')}</details>
      ${D.nodes.jobs.filter(j => j.status === 'needs_approval').map(j => `<div class="small">⚠ ${esc(j.capability)} ${esc(j.id)}: ${esc(j.error || '')}</div>`).join('')}</div>` : ''}
    <div class="grid g2">
      <div class="card"><h3>Последние ошибки</h3>${D.errors.map(e => `<div class="small"><span class="mut">${esc(e.at.slice(5, 16))}</span> <b>${esc(e.source)}</b> ${esc(e.message)}</div>`).join('') || '<div class="small mut">Нет</div>'}</div>
      <div class="card"><h3>Уведомления</h3>${D.notifications.map(n => `<div class="small"><span class="badge ${n.level === 'info' ? 'b-ok' : 'b-warn'}">${esc(n.level)}</span> ${esc(n.source)}: ${esc(n.message)}</div>`).join('') || '<div class="small mut">Нет</div>'}</div>
      <div class="card"><h3>Резервные копии</h3>${D.backups.ops ? D.backups.ops.map(b => `<div class="row small">${esc(b.id)} · ${(b.bytes / 1e6).toFixed(1)} МБ · ключ: ${esc(b.secretKey)} <span><button class="btn sm" data-bv="${esc(b.id)}">Проверить</button> <button class="btn sm" data-bt="${esc(b.id)}">Тест-восстановление</button></span></div>`).join('') || '<div class="small mut">Ops-бэкапов нет</div>' : '<div class="small mut">Backup & Recovery выключен</div>'}
        <div class="small mut">Старый ежедневный JSON-бэкап: ${esc(D.backups.lastLegacy || '—')}</div>${D.backups.ops ? '<button class="btn sm primary" id="bkNow">Создать бэкап</button>' : ''}</div>
      <div class="card"><h3>Расходы</h3>${D.costs ? (D.costs.paidServicesInUse ? D.costs.services.map(s => `<div class="small">${esc(s.service)}: день ${s.day}$ / ${s.budget.dailyUsd}$ · месяц ${s.month}$ / ${s.budget.monthlyUsd}$</div>`).join('') : '<div class="small">Платные сервисы не используются (расходов 0 $)</div>') : '<div class="small mut">Cost Controller выключен</div>'}</div>
    </div>
    <div class="card"><h3>Права агентов</h3>${D.permissions ? `<table class="tbl small"><tr><th>Агент</th><th>shell</th><th>publish</th><th>fs</th><th>network</th></tr>${Object.entries(D.permissions).map(([id, p]) => `<tr><td>${esc(id)}</td><td>${p.shell ? '✔' : '—'}</td><td>${p.publish ? '✔' : '—'}</td><td>${esc((p.fs || []).join(', ') || '—')}</td><td>${esc((p.network || []).join(', ') || '—')}</td></tr>`).join('')}</table>
      <details><summary class="small">Изменить (JSON, требует пароль)</summary><textarea id="capsJson" rows="6" style="width:100%"></textarea><button class="btn sm" id="capsSave">Сохранить</button></details>
      <div class="small mut">Журнал действий: ${D.audit.ok ? 'цепочка цела' : 'НАРУШЕНА'}, записей ${D.audit.entries ?? '—'}</div>` : '<div class="small mut">Security Center выключен</div>'}</div>
    <div class="small mut">Данные: ${esc(D.at)} · v${esc(D.version)} · флаги: ${esc(Object.entries(D.flags).filter(([, v]) => v).map(([k]) => k).join(', '))}</div>`;
  };
  async function load() { try { D = await api('GET', '/api/ops/dashboard'); if (D && D.nodes) { const [e, a] = await Promise.all([api('GET', '/api/ops/nodes/enroll').catch(() => null), api('GET', '/api/ops/nodes/audit').catch(() => null)]); D.enroll = e ? e.requests : []; D.audit = a ? a.events : []; } ERR = null; } catch (e) { ERR = e.message; } if (ROUTE === 'ops') render(); }
  BIND.ops = v => {
    if (!D && !ERR) load();
    const act = async fn => { try { const r = await fn(); if (r) toast ? toast(JSON.stringify(r).slice(0, 200)) : alert(JSON.stringify(r)); } catch (e) { alert(e.message); } load(); };
    const en = v.querySelector('#enNew'); if (en) en.onclick = async () => { try { const r = await api('POST', '/api/ops/nodes/enroll', { role: v.querySelector('#enRole').value, name: v.querySelector('#enName').value });
      v.querySelector('#enOut').innerHTML = `Код (одноразовый, 5 минут): <b style="font-size:18px;letter-spacing:2px">${esc(r.code)}</b><br>Адрес: https://&lt;mac-mini&gt;:8790 или https://mac-mini.&lt;tailnet&gt;.ts.net:8443<br>Отпечаток сертификата: <code>${esc(r.fingerprint || '—')}</code><br>Короткая сверка: <b>${esc(r.fingerprintShort || '—')}</b><br><span class="mut">Код показывается один раз и нигде не сохраняется.</span>`; } catch (e) { alert(e.message); } };
    v.querySelectorAll('[data-enc]').forEach(b => b.onclick = () => { const q = (D.enroll || []).find(x => x.requestId === b.dataset.enc) || {}; const dv = q.device || {};
      return confirm(`Подтвердить устройство для узла ${q.nodeId} (${q.role})?\n\nКлюч устройства: ${dv.pubKeyShort}\nSHA-256: ${dv.pubKeyFingerprint}\ndeviceId: ${dv.deviceId}\nСеть: ${dv.peer}${dv.peerVerified ? ' (Tailscale)' : ' (не подтверждено)'}\n\nКлюч должен совпадать с экраном узла. Имя/модель/ОС сообщены устройством и не проверены. Потребуется пароль владельца.`) && act(() => api('POST', `/api/ops/nodes/enroll/${encodeURIComponent(b.dataset.enc)}/confirm`, {})); });
    v.querySelectorAll('[data-enr]').forEach(b => b.onclick = () => act(() => api('POST', `/api/ops/nodes/enroll/${encodeURIComponent(b.dataset.enr)}/reject`, {})));
    v.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => act(() => api('POST', `/api/ops/nodes/${encodeURIComponent(b.dataset.rot)}/rotate`, {})));
    v.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => confirm('Отозвать токен узла ' + b.dataset.rev + '?') && act(() => api('POST', `/api/ops/nodes/${encodeURIComponent(b.dataset.rev)}/revoke`, {})));
    v.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => act(() => api('POST', `/api/ops/tasks/${encodeURIComponent(b.dataset.plan)}/approve-plan`, {})));
    v.querySelectorAll('[data-bv]').forEach(b => b.onclick = () => act(() => api('POST', `/api/ops/backups/${encodeURIComponent(b.dataset.bv)}/verify`, {})));
    v.querySelectorAll('[data-bt]').forEach(b => b.onclick = () => act(() => api('POST', `/api/ops/backups/${encodeURIComponent(b.dataset.bt)}/test-restore`, {})));
    const bk = v.querySelector('#bkNow'); if (bk) bk.onclick = () => act(() => api('POST', '/api/ops/backups', { note: 'manual' }));
    const cj = v.querySelector('#capsJson'); if (cj) { api('GET', '/api/ops/permissions').then(p => { cj.value = JSON.stringify(p.stored, null, 1); }).catch(() => {});
      v.querySelector('#capsSave').onclick = () => act(() => api('PUT', '/api/ops/permissions', JSON.parse(cj.value))); }
  };
  const toast = typeof window.toast === 'function' ? window.toast : null;
  // show the section only when the server has the dashboard flag
  let tries = 0; const probe = () => fetch('/api/ops/status', { credentials: 'same-origin' }).then(r => r.status === 401 ? 'retry' : r.ok ? r.json() : null).then(s => {
    if (s === 'retry') { if (++tries < 120) setTimeout(probe, 5000); return; } // not logged in yet
    if (s && s.flags && s.flags.nodes && !NAV.some(n => n[0] === 'computers')) { NAV.splice(NAV.length - 1, 0, ['computers', '🖥', 'Computers (Nodes)']); window.addEventListener('hashchange', () => { if (location.hash === '#computers') location.href = '/studio.html'; }); if (DB.agents) render(); }
    if (s && s.flags && s.flags.dashboard && !NAV.some(n => n[0] === 'ops')) { NAV.splice(NAV.length - 1, 0, ['ops', '⛨', 'Операции']); if (DB.agents) render(); setInterval(() => { if (ROUTE === 'ops' && !document.hidden) load(); }, 30000); }
  }).catch(() => {});
  probe();
})();
