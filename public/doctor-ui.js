/* MOONKATTY AI STUDIO — System Doctor. Ten owner buttons, real /api/ops/doctor data only. */
'use strict';
(() => {
  if (typeof NAV !== 'undefined' && !NAV.some(x => x[0] === 'doctor')) NAV.push(['doctor', '✚', 'System Doctor']);
  let LAST = null, BUSY = '', PEND = [];
  const badge = s => `<span class="badge ${s === 'OK' ? 'b-ok' : s === 'WARN' ? 'b-warn' : s === 'FAIL' || s === 'FORBIDDEN' ? 'b-err' : 'b-dev'}">${esc(s || '—')}</span>`;
  const checksHtml = rep => !rep || !rep.checks ? '<p class="small mut">Проверки ещё не запускались.</p>' : rep.checks.map(c => `<div class="list-item"><b style="min-width:110px">${esc(c.id)}</b><span class="sp small">${esc(c.summary || '')}</span>${badge(c.status)}</div>`).join('');
  VIEWS.doctor = () => `<div class="card"><h3>System Doctor</h3>
    <p class="small mut" style="margin-top:0">Диагностика и безопасный ремонт без Терминала. Тяжёлые проверки идут по кнопке. Опасные действия — только после подтверждения владельца.</p>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      <button class="btn primary sm" data-sd="quick">Быстрая проверка</button>
      <button class="btn sm" data-sd="full">Полная диагностика</button>
      <button class="btn sm" data-sd="ollama">Проверить ИИ (Ollama)</button>
      <button class="btn sm" data-sd="opencode">Проверить OpenCode</button>
      <button class="btn sm" data-sd="blender">Проверить Blender</button>
      <button class="btn sm" data-sd="db">Проверить базу</button>
      <button class="btn sm" data-sd="backup">Сделать бэкап сейчас</button>
      <button class="btn sm" data-sd="restart">Перезапустить OpenCode/Ollama</button>
      <button class="btn sm" data-sd="fix">Починить зависшее</button>
      <button class="btn sm danger" data-sd="restore">Восстановить из бэкапа</button>
      <button class="btn sm" data-sd="report">Скачать отчёт</button>
    </div>
    <div id="sdOut" style="margin-top:12px">${checksHtml(LAST)}</div>
    <div id="sdPend" class="small" style="margin-top:8px"></div></div>`;
  async function run(kind) {
    if (typeof MODE !== 'undefined' && MODE !== 'server') { toast('Нужен сервер студии', true); return; }
    BUSY = kind; render();
    try {
      if (kind === 'report') {
        const r = await fetch('/api/ops/doctor/report.md', { credentials: 'same-origin', headers: { 'x-studio-request': '1' } });
        const text = await r.text();
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); a.download = 'system-doctor.md'; a.click();
        return;
      }
      if (kind === 'restart' || kind === 'fix' || kind === 'restore') return owner(kind);
      const path = { quick: '/quick', full: '/full', ollama: '/ollama', opencode: '/opencode', blender: '/blender', db: '/db', backup: '/backup' }[kind];
      LAST = await api('POST', '/api/ops/doctor' + path, {});
      toast(kind === 'backup' ? 'Бэкап создан' : 'Проверка завершена');
    } catch (e) { toast(e.message, true); }
    finally { BUSY = ''; if (ROUTE === 'doctor') render(); }
  }
  async function owner(kind) {
    const pw = prompt('Пароль владельца');
    if (!pw) { BUSY = ''; return; }
    let actionId, params;
    if (kind === 'restart') { actionId = 'svc-restart'; params = { target: 'both' }; }
    else if (kind === 'fix') {
      const st = LAST && (LAST.checks || []).find(c => c.id === 'proc');
      const procs = (st && st.data && st.data.processes || []).filter(p => ['ollama', 'blender', 'opencode'].includes(p.comm));
      if (procs.length) { actionId = 'proc-kill'; params = { pid: String(procs[0].pid), name: procs[0].comm }; }
      else { actionId = 'lock-reset'; params = {}; }
    } else {
      const list = await api('GET', '/api/ops/doctor/backups');
      const name = (list.backups || [])[0];
      if (!name) { toast('Нет резервной копии', true); BUSY = ''; return; }
      actionId = 'db-restore'; params = { backup: name, mode: 'verify' };
    }
    const req = await api('POST', '/api/ops/doctor/actions/request', { actionId, params });
    const done = await api('POST', '/api/ops/doctor/actions/execute', { approvalId: req.approvalId, password: pw });
    LAST = { kind: actionId, checks: [{ id: actionId, status: done.result && done.result.status || (done.ok ? 'OK' : 'FAIL'), summary: (done.result && done.result.summary) || '' }] };
    toast(LAST.checks[0].summary || 'Готово', !done.ok);
  }
  BIND.doctor = v => {
    v.querySelectorAll('[data-sd]').forEach(b => { b.disabled = !!BUSY; b.onclick = () => run(b.dataset.sd); });
    const p = v.querySelector('#sdPend');
    if (p) api('GET', '/api/ops/doctor').then(s => { PEND = s.pending || []; if (LAST == null && s.last) LAST = s.last; }).catch(() => {});
  };
})();
