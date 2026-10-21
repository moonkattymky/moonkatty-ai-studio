# Контракт со студией 3

Их журнал денег — источник правды. Сигнатура чтения: `listEntries({ kind, direction, projectId, from, to })` и `GET /api/ops/ledger`. Сверено с `feat/studio-operations` @ `e9a46bf`: дата `YYYY-MM-DD`, сумма на проводе строка, `proof` объект, `resolveProject` читается синхронно из `studio-intelligence/src/projects.js`. Адаптер приводит строку к числу и не пишет в `si_cost_entries`.

Они вызывают `si.projects.resolveProject(projectId)`, если функция есть. Неизвестный id становится `unassigned` и не теряется.

Дневной отчёт `reports.daily` кладёт факт, оценку и прогноз в разные поля. `costs.totalUsd` — только фактический расход USD. Короткий вид `compact: true` оставляет те же суммы и режет список внимания до 8 строк. Экран телефона и `/api/mobile` остаются на их ветке.

`recordCost` не пишет локальную таблицу.
