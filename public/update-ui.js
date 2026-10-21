/* MOONKATTY AI STUDIO — Settings › Update Center (STUDIO_OPS_UPDATE=1). Real data only from /api/ops/update-center*.
   Appends a card to the Settings view (wraps VIEWS.settings/BIND.settings from app.js). Never installs: download+verify, manual plan. */
'use strict';
(() => {
  let U = null, ERR = null, ON = false, PLAN = {}, BUSY = '';
  const mb = b => b == null ? '—' : (b / 1e6).toFixed(1) + ' МБ';
  const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
  const bar = (p, label) => `<div class="small">${esc(label)} ${p}%</div><div style="background:#0002;border-radius:4px;height:8px"><div style="width:${p}%;height:8px;border-radius:4px;background:var(--accent,#7c5cff)"></div></div>`;
  const badge = (ok, t) => `<span class="badge ${ok ? 'b-ok' : 'b-err'}">${esc(t)}</span>`;
  function rel(r) {
    const d = r.download, g = r.gate || {}, m = r.manifest || {};
    const dl = d ? (d.status === 'verified' ? `<div class="small">${badge(true, 'загружено и проверено')} SHA-256 + подпись · ${mb(d.size)} · записей в архиве ${d.zip ? d.zip.entries : '?'}</div>`
      : `${bar(pct(d.received, d.size), d.status === 'downloading' ? 'Загрузка' : d.status === 'verifying' ? 'Проверка SHA-256' : 'Статус: ' + d.status)}<div class="small mut">${mb(d.received)} из ${mb(d.size)}${d.error ? ' · ' + esc(d.error) : ''}</div>`) : '';
    const p = PLAN[r.tag];
    return `<div class="card" style="margin-top:8px"><div class="row"><b>${esc(r.tag)}</b> ${r.prerelease ? '<span class="badge b-warn">prerelease</span>' : ''} ${r.newer ? '<span class="badge b-ok">новее</span>' : '<span class="small mut">не новее текущей</span>'}
      ${badge(r.verified, r.verified ? 'подпись проверена' : 'не проверено')} <a class="small" href="${esc(r.url)}" target="_blank" rel="noopener">GitHub</a></div>
      ${r.manifest ? `<div class="small mut">канал ${esc(m.channel)} · bundleId ${esc(m.bundleId)} · данные «${esc(m.dataDirName)}» · launchd ${esc(m.launchdLabel)} · схема БД ${esc(m.dbSchemaVersion ?? '—')} · commit ${esc(String(m.sourceCommit || '—').slice(0, 9))}</div>` : ''}
      ${r.problems.length ? `<div class="small">${r.problems.map(x => '⚠ ' + esc(x)).join('<br>')}</div>` : ''}
      <div class="small"><b>Совместимость:</b> ${badge(r.compat && r.compat.ok, r.compat && r.compat.ok ? 'OK' : 'нет')} ${esc(r.compat && r.compat.detail || '')}</div>
      <div class="small"><b>Установка:</b> ${badge(g.allowed, g.allowed ? (g.mode === 'side-by-side' ? 'рядом (изолированная)' : 'разрешена вручную') : 'заблокирована')} ${(g.reasons || []).map(esc).join('; ')} ${(g.warnings || []).map(esc).join('; ')}</div>
      ${r.knownIssues && r.knownIssues.length ? `<details><summary class="small">Известные проблемы (${r.knownIssues.length})</summary><ul class="small">${r.knownIssues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '<div class="small mut">Известные проблемы: не указаны</div>'}
      <details><summary class="small">Список изменений</summary><pre class="small" style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(r.changelog || '—')}</pre></details>
      ${dl}
      <div class="row" style="margin-top:6px">${r.verified ? `<button class="btn sm primary" data-ucdl="${esc(r.tag)}" ${d && ['downloading', 'verifying'].includes(d.status) ? 'disabled' : ''}>Скачать обновление</button>` : '<span class="small mut">Скачивание через Update Center запрещено (нет проверенной подписи) — только ручная проверка по docs/ops/UPDATE_CENTER.md</span>'}
        ${d && d.status !== 'verified' ? `<button class="btn sm" data-ucclean="${esc(r.tag)}">Очистить временные файлы</button>` : ''}
        ${r.manifest ? `<button class="btn sm" data-ucplan="${esc(r.tag)}">План установки</button>` : ''}
        ${r.verified && g.mode !== 'side-by-side' && !r.approved ? `<button class="btn sm" data-ucappr="${esc(r.tag)}">Разрешить замену (владелец)</button>` : r.approved ? '<span class="small">✔ одобрено владельцем</span>' : ''}</div>
      ${p ? `<div class="card" style="margin-top:6px"><b>Ручная установка ${p.allowed ? '' : '(запрещена)'}</b><ol class="small">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><b class="small">Откат</b><ol class="small">${p.rollback.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="small mut">Не трогаем: ${p.services.untouched.map(esc).join(' · ')}</div><div class="small mut">Автоустановка: ${p.autoInstall.enabled ? 'включена' : 'выключена (нет флагов: ' + esc(p.autoInstall.missing.join(', ')) + ')'}</div></div>` : ''}</div>`;
  }
  const card = () => {
    if (!ON) return '';
    if (ERR) return `<div class="card" id="updateCenter" style="grid-column:1/-1"><h3>Центр обновлений</h3><div class="small">Ошибка: ${esc(ERR)}</div><button class="btn sm" id="ucCheck">Повторить</button></div>`;
    if (!U) return '<div class="card" id="updateCenter" style="grid-column:1/-1"><h3>Центр обновлений</h3><div class="small">Загрузка…</div></div>';
    const b = U.backup, s = U.schema || {}; const avail = U.releases.find(r => r.tag === U.available);
    return `<div class="card" id="updateCenter" style="grid-column:1/-1"><h3>Центр обновлений</h3>
      <div class="grid g3"><div><div class="small mut">Текущая версия</div><b>v${esc(U.current)}</b><div class="small mut">${esc(U.identity.bundleId || '—')} (${esc(U.identity.flavor)}, источник: ${esc(U.identity.source || '—')}) · схема БД ${esc(s.schemaVersion ?? '—')} ${s.ok === false ? '(ошибка)' : ''}</div></div>
        <div><div class="small mut">Доступная версия</div><b>${avail ? esc(avail.tag) : '—'}</b><div class="small mut">${U.lastCheck ? 'проверено ' + esc(new Date(U.lastCheck.at).toLocaleString('ru-RU')) : 'ещё не проверялось'} · ${esc(U.repos.join(', '))}</div></div>
        <div><div class="small mut">Бэкап перед обновлением</div>${b ? `${badge(b.verified, b.verified ? 'проверен' : 'ошибка')} <span class="small">${esc(b.id)} · checksum ${b.checksum ? 'OK' : '✗'} · тест-восстановление ${b.testRestore ? 'OK' : '✗'}</span>` : '<span class="small mut">нет</span>'}</div></div>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" id="ucCheck" ${BUSY ? 'disabled' : ''}>${BUSY === 'check' ? 'Проверка…' : 'Проверить обновления'}</button> <button class="btn sm" id="ucBackup" ${BUSY ? 'disabled' : ''}>${BUSY === 'backup' ? 'Бэкап…' : 'Сделать проверенный бэкап'}</button> <button class="btn sm" id="ucHealth">Health</button> <button class="btn sm" id="ucRollback">План отката</button></div>
      ${U.identity.known ? '' : `<div class="small">⚠ идентичность приложения не определена — установка заблокирована: ${esc((U.identity.problems || []).join('; '))}</div>`}
      <div class="small mut">Ключи подписи: prod ${U.keyring.prod.keys.length ? U.keyring.prod.keys.map(k => esc(k.keyId) + ' ' + esc(k.status)).join(', ') : '<b>нет (нужен ключ владельца)</b>'} · test ${U.keyring.test.keys.map(k => esc(k.keyId) + (k.stub ? ' ЗАГЛУШКА' : '')).join(', ') || 'нет'} · отозвано ${U.keyring.revoked.length}</div>
      ${U.keysLoaded ? '' : '<div class="small">⚠ для канала этой сборки нет доверенного ключа — ни один релиз не будет считаться проверенным</div>'}
      <div class="small mut">Установка только вручную. Gatekeeper/карантин не обходятся. Ollama, OpenCode, Keychain и данные пользователя не затрагиваются. Автоустановка: ${U.autoInstall.enabled ? 'включена' : 'выключена'}.</div>
      ${U.releases.length ? U.releases.map(rel).join('') : '<div class="small mut" style="margin-top:6px">Релизы не загружены — нажмите «Проверить обновления».</div>'}
      <div id="ucOut" class="small"></div></div>`;
  };
  async function load() { try { U = await api('GET', '/api/ops/update-center'); ERR = null; } catch (e) { ERR = e.message; } if (ROUTE === 'settings') render(); }
  const prevV = VIEWS.settings, prevB = BIND.settings;
  VIEWS.settings = () => { const h = prevV(); return ON ? h + '<div style="margin-top:16px">' + card() + '</div>' : h; };
  let timer = null;
  BIND.settings = v => {
    if (prevB) prevB(v); if (!ON) return; if (!U && !ERR) load();
    const out = m => { const o = v.querySelector('#ucOut'); if (o) o.textContent = m; };
    const act = async (busy, fn) => { BUSY = busy; render(); try { const r = await fn(); if (r !== undefined) out(typeof r === 'string' ? r : JSON.stringify(r).slice(0, 400)); } catch (e) { ERR = null; alert(e.message); } BUSY = ''; await load(); };
    const q = s => v.querySelector(s);
    if (q('#ucCheck')) q('#ucCheck').onclick = () => act('check', async () => { U = await api('POST', '/api/ops/update-center/check', {}); });
    if (q('#ucBackup')) q('#ucBackup').onclick = () => act('backup', () => api('POST', '/api/ops/update-center/backup', {}));
    if (q('#ucHealth')) q('#ucHealth').onclick = () => act('', () => api('GET', '/api/ops/update-center/health'));
    if (q('#ucRollback')) q('#ucRollback').onclick = () => act('', async () => (await api('POST', '/api/ops/update-center/rollback', {})).commands.join('\n'));
    v.querySelectorAll('[data-ucdl]').forEach(b => b.onclick = () => act('', () => api('POST', `/api/ops/update-center/${encodeURIComponent(b.dataset.ucdl)}/download`, {})));
    v.querySelectorAll('[data-ucclean]').forEach(b => b.onclick = () => act('', () => api('POST', `/api/ops/update-center/${encodeURIComponent(b.dataset.ucclean)}/clean`, {})));
    v.querySelectorAll('[data-ucplan]').forEach(b => b.onclick = () => act('', async () => { PLAN[b.dataset.ucplan] = await api('GET', `/api/ops/update-center/${encodeURIComponent(b.dataset.ucplan)}/plan`); }));
    v.querySelectorAll('[data-ucappr]').forEach(b => b.onclick = () => { const pw = prompt('Пароль владельца для разрешения установки поверх текущей сборки:'); if (pw) act('', () => api('POST', `/api/ops/update-center/${encodeURIComponent(b.dataset.ucappr)}/approve`, { password: pw })); });
    clearInterval(timer); if (U && U.releases.some(r => r.download && ['downloading', 'verifying'].includes(r.download.status))) timer = setTimeout(() => { if (ROUTE === 'settings') load(); }, 1000);
  };
  let tries = 0; const probe = () => fetch('/api/ops/status', { credentials: 'same-origin' }).then(r => r.status === 401 ? 'retry' : r.ok ? r.json() : null).then(s => {
    if (s === 'retry') { if (++tries < 120) setTimeout(probe, 5000); return; }
    if (s && s.flags && s.flags.update) { ON = true; if (typeof ROUTE !== 'undefined' && ROUTE === 'settings') load(); }
  }).catch(() => {});
  probe();
})();
