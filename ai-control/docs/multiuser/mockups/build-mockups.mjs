// Генератор статических макетов UI Алекса (DEMO/МАКЕТ). Использует ai-control/src/css/app.css без изменений.
import { writeFileSync } from 'node:fs';
const I = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  tasks: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 13h.01M15 13h.01"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-12 3-12 7"/>',
  check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>', file: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
  send: '<path d="M3 11l18-8-8 18-2-8z"/>', test: '<path d="M9 3h6M10 3v6L4 20h16L14 9V3"/>', chev: '<path d="M9 6l6 6-6 6"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const tabs = [['dashboard', 'home', 'Главная'], ['tasks', 'tasks', 'Задачи'], ['agents', 'bot', 'Агенты'], ['studio3d', 'cube', '3D'], ['more', 'more', 'Ещё']];
const page = (file, tab, title, sub, body) => writeFileSync(file + '.html', `<!doctype html><html lang="ru" class="preview-safe"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>MOONKATTY AI CONTROL — ALEX · ${title} (МАКЕТ)</title>
<link rel="stylesheet" href="../../../src/css/app.css"><link rel="stylesheet" href="mockup.css"></head><body>
<div class="space" aria-hidden="true"></div>
<div class="demo-badge" role="note"><i></i>DEMO · МАКЕТ</div>
<main class="screen"><div class="alexbar">MOONKATTY AI CONTROL — ALEX <span>GAME MANAGER</span></div>
<div class="hdr"><div><h1>${title}</h1><p class="sub">${sub}</p></div></div>
${body}
<p class="mock-foot">МАКЕТ · все данные вымышлены · не подключено к Studio</p></main>
<nav class="tabbar">${tabs.map(([k, i, l]) => `<a href="${k === 'more' ? 'more' : k}.html"${k === tab ? ' aria-current="page"' : ''}>${ic(i)}<span>${l}</span></a>`).join('')}</nav></body></html>`);
const row = (thumbIc, color, t1, t2, t3 = '', extra = '') => `<div class="row card"><span class="ic ${color} mic">${ic(thumbIc)}</span><span class="body"><span class="t1">${t1}</span><span class="t2">${t2}</span>${t3 ? `<span class="t3">${t3}</span>` : ''}</span>${extra}</div>`;
const author = (a) => `<span class="who ${a === 'OWNER' ? 'own' : 'alx'}">${a}</span>`;
const game = (img, name, branch, st) => `<div class="card gcard"><div class="banner"><img src="../../../src/img/${img}" alt=""><span class="lbl">${name}</span><span class="demo-tag">DEMO</span></div>
<div class="gstats"><div class="gstat"><div class="lbl">Задачи</div><div class="val">${st[0]}</div></div><div class="gstat"><div class="lbl">Тесты</div><div class="val g2">${st[1]}</div></div><div class="gstat"><div class="lbl">На утвержд.</div><div class="val gold2">${st[2]}</div></div></div>
<div class="kv"><div><span>Рабочая ветка</span><span class="mono">${branch}</span></div><div><span>Защищённая</span><span>${ic('lock')} только чтение</span></div></div></div>`;

page('dashboard', 'dashboard', 'Games Dashboard', 'Игровые проекты Алекса',
  game('preview.jpg', 'MOONKATTY Game', 'ai/alex/game/demo-01', ['3', '12/12', '1']) +
  game('game-banner.webp', 'MOONKATTY Horizons', 'ai/alex/horizons/demo-02', ['1', '8/9', '0']) +
  `<div class="section-title">Активно сейчас</div><div class="stack">${row('bot', 'blue', 'Game Dev · пример задачи', 'MOONKATTY Game · демо', 'выполняется 40%')}</div>`);

page('projects', 'more', 'Игровые проекты', 'Только проекты из allowlist владельца', `<div class="stack">
${row('branch', 'blue', 'moonkatty-game', 'рабочие ветки ai/alex/*, game/*', 'main — защищена, только чтение')}
${row('branch', 'violet', 'moonkatty-horizons', 'предварительно включён · рабочие ветки', 'master, world-v40, world-v40-final, world-v42 — только чтение')}
${row('file', 'gray', 'moonkatty-horizons-play', 'только просмотр билда', 'запись недоступна')}
</div><div class="note">Новые игры добавляет только владелец. Другие репозитории Алексу не видны.</div>`);

page('agents', 'agents', 'Game AI Agents', 'Только игровые агенты', `<div class="stack">
${row('bot', 'blue', 'Game Dev', 'код игры в рабочих ветках', 'свободен')}
${row('test', 'green', 'Game QA', 'тесты и отчёты', 'свободен')}
${row('cube', 'violet', '3D DESIGN', 'Blender · проверенные шаблоны', 'в очереди: 1')}
</div><div class="section-title">Новая задача</div><div class="card pad">
<label class="field">Проект<select><option>moonkatty-game</option><option>moonkatty-horizons</option></select></label>
<label class="field">Агент<select><option>Game Dev</option><option>Game QA</option><option>3D DESIGN</option></select></label>
<label class="field">Базовая ветка<select><option>game/demo-feature</option></select></label>
<label class="field">Что сделать<textarea rows="3">Пример: поправить подсказку в главе 1 (DEMO)</textarea></label>
<div class="note small">Будет создана ветка <b class="mono">ai/alex/&lt;проект&gt;/&lt;id&gt;</b>. В main/master запись невозможна.</div>
<button class="btn ok wide">Поставить в очередь</button></div>`);

page('tasks', 'tasks', 'Задачи и очередь', 'Общая игровая очередь', `<div class="seg"><button class="chip" aria-pressed="true">Все</button><button class="chip">Мои</button><button class="chip">Упавшие</button></div><div class="stack">
${row('bot', 'blue', 'Подсказка главы 1 ' + author('ALEX'), 'moonkatty-game · ai/alex/game/demo-01', 'выполняется · 40% · 🔒 lock ветки', '<button class="btn no sm">Стоп</button>')}
${row('test', 'green', 'Прогон тестов ' + author('OWNER'), 'moonkatty-horizons · game/demo-qa', 'в очереди · ждёт lock')}
${row('cube', 'violet', 'Сцена: камень (шаблон) ' + author('ALEX'), 'moonkatty-game · 3D', 'готово')}
${row('x', 'red', 'Пример упавшей задачи ' + author('ALEX'), 'moonkatty-horizons · ai/alex/horizons/demo-02', 'ошибка тестов', '<button class="btn ghost sm">Повтор</button>')}
</div><div class="note small">Остановить можно только свою задачу. Задачи владельца — только просмотр.</div>`);

page('studio3d', 'studio3d', '3D Studio', 'Blender — только проверенные шаблоны', `<div class="card pad">
<label class="field">Шаблон<select><option>scene_basic (vetted)</option></select></label>
<label class="field">Режим<select><option>Превью-рендер (EEVEE)</option></select></label>
<label class="field">Описание<textarea rows="2">Пример: низкополигональный лунный камень (DEMO)</textarea></label>
<div class="kv"><div><span>Лимит времени</span><span>15 мин</span></div><div><span>Произвольный Python</span><span class="red2">запрещён</span></div></div>
<button class="btn ok wide mt">Создать</button></div>
<div class="section-title">Версии</div><div class="stack">${row('cube', 'violet', 'demo-rock · v2', 'превью готово', 'удаление версий — только владелец')}</div>`);

page('testing', 'more', 'Тестирование', 'Фиксированные наборы тестов проекта', `<div class="stack">
${row('check', 'green', 'moonkatty-game · unit', 'ветка ai/alex/game/demo-01', 'DEMO: 12/12 пройдено', '<button class="btn ghost sm">Запуск</button>')}
${row('x', 'red', 'moonkatty-horizons · e2e', 'ветка ai/alex/horizons/demo-02', 'DEMO: 8/9 · 1 упал', '<button class="btn ghost sm">Лог</button>')}
</div><div class="note small">Тесты идут в изолированном воркере без сети и без секретов.</div>`);

page('files', 'more', 'Игровые файлы и версии', 'Ветки и история (только чтение файлов)', `<div class="seg"><button class="chip" aria-pressed="true">moonkatty-game</button><button class="chip">horizons</button></div>
<div class="section-title">Ветки</div><div class="stack">
${row('lock', 'gray', 'main', 'защищена · только чтение', 'запись и merge — только владелец')}
${row('branch', 'blue', 'ai/alex/game/demo-01', 'рабочая ветка Алекса', '2 коммита (DEMO)')}
</div><div class="section-title">Horizons</div><div class="stack">
${['master', 'world-v40', 'world-v40-final', 'world-v42'].map(b => row('lock', 'gray', b, 'только чтение', 'прямая запись запрещена')).join('')}
</div><div class="section-title">Файлы</div><div class="card"><div class="kv"><div><span class="mono">src/chapter1.js</span><span>просмотр</span></div><div><span class="mono">tests/</span><span>просмотр</span></div></div></div>`);

page('results', 'more', 'Результаты и отчёты', 'Итоги задач', `<div class="card pad"><div class="t1b">Подсказка главы 1 (DEMO)</div><div class="muted small">ai/alex/game/demo-01 · 2 коммита · +14 −3</div>
<div class="kv mt"><div><span>Тесты</span><span class="g2">12/12</span></div><div><span>Diff</span><span>открыть</span></div></div>
<a class="btn ok wide mt" href="release.html">${ic('send')} Отправить владельцу на утверждение</a></div>`);

page('release', 'more', 'Отправить владельцу на утверждение', 'Заявка на релиз', `<div class="steps"><span class="on">1 Заявка</span><span>2 Владелец</span><span>3 Решение</span></div>
<div class="card pad"><div class="kv"><div><span>Проект</span><span>moonkatty-game</span></div><div><span>Ветка</span><span class="mono">ai/alex/game/demo-01</span></div><div><span>Цель</span><span>${ic('lock')} main</span></div><div><span>Тесты</span><span class="g2">12/12</span></div></div>
<label class="field mt">Комментарий для владельца<textarea rows="2">Пример: готово к проверке (DEMO)</textarea></label>
<button class="btn ok wide">Отправить на утверждение</button></div>
<div class="section-title">После отправки</div><div class="stack">${row('bell', 'gold', 'Ожидает утверждения владельца', 'merge и публикация — только владелец', 'Алекс не может публиковать')}</div>`);

page('notifications', 'more', 'Игровые уведомления', 'Только по игровым проектам', `<div class="stack">
${['check|green|Задача выполнена|Подсказка главы 1 (DEMO)', 'x|red|Задача упала|e2e Horizons (DEMO)', 'bell|gold|Заявка ожидает владельца|ai/alex/game/demo-01', 'lock|gray|Владелец остановил задачу|пример (DEMO)'].map(s => { const [i, c, a, b] = s.split('|'); return `<div class="row card notif-row unread"><span class="ic ${c}">${ic(i)}</span><span class="body"><span class="t1">${a}</span><span class="t2">${b}</span></span></div>`; }).join('')}</div>`);

page('settings', 'more', 'Личные настройки', 'Только личные параметры', `<div class="card"><div class="kv"><div><span>Имя</span><span>Alex (DEMO)</span></div><div><span>Язык</span><span>Русский</span></div><div><span>Уведомления</span><span class="toggle" role="switch" aria-checked="true"></span></div></div></div>
<div class="section-title">Безопасность</div><div class="stack">
${row('key', 'blue', 'Passkey (Face ID)', 'добавить ключ входа', 'рекомендуется')}
${row('lock', 'gray', 'Мои сессии', 'iPhone · текущая (DEMO)', 'выйти на всех устройствах')}
</div><div class="note small">Роль и права меняет только владелец — здесь их редактировать нельзя.</div>`);

page('more', 'more', 'Ещё', 'Разделы Алекса', `<div class="stack">${[['projects', 'branch', 'Игровые проекты'], ['testing', 'test', 'Тестирование'], ['files', 'file', 'Игровые файлы и версии'], ['results', 'check', 'Результаты и отчёты'], ['notifications', 'bell', 'Игровые уведомления'], ['settings', 'key', 'Личные настройки']].map(([h, i, l]) => `<a class="row card" href="${h}.html"><span class="ic blue mic">${ic(i)}</span><span class="body"><span class="t1">${l}</span></span><span class="chev">${ic('chev')}</span></a>`).join('')}</div>`);
