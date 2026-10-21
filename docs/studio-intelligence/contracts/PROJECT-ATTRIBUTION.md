# Проекты и журнал денег

Согласовано со Studio 3 (ветка `feat/studio-operations`, монетизация и операции). Их журнал — единственный источник правды о деньгах. Эта ветка журнал не дублирует и в `si_cost_entries` новые строки не пишет.

## Идентификатор проекта

Строка `<пространство>:<slug>`.

| projectId | Пространство | Смысл |
|---|---|---|
| `moonkatty_project:games` | `moonkatty_project` | игры |
| `moonkatty_project:mkty` | `moonkatty_project` | MKTY |
| `moonkatty_project:youtube` | `moonkatty_project` | основной YouTube |
| `moonkatty_project:ads` | `moonkatty_project` | реклама |
| `moonkatty_news:episodes` | `moonkatty_news` | выпуски новостей |
| `moonkatty_shared` | `moonkatty_shared` | общие материалы, без slug |

Список лежит в таблице `si_projects` и пополняется при открытии базы (`INSERT OR IGNORE`).

`resolveProject(projectId)` экспортируется синхронно из `studio-intelligence/src/projects.js` (и повторно из `studio-intelligence/src/index.js`). База для этого вызова не нужна: список зашит в `PROJECT_SEEDS`. Возвращает обычный объект, не Promise. Поля:

| Поле | Смысл |
|---|---|
| `projectId` | известный id или `unassigned` |
| `rawProjectId` | строка, как её передали; пустое значение даёт `null` |
| `known` | id есть в реестре |
| `namespace` | пространство или `null` у `unassigned` |
| `slug` | часть после двоеточия или `null` |
| `dropped` | всегда `false` |

Неизвестный id не выбрасывается. Сумма остаётся в отчёте в корзине `unassigned`, а исходная строка сохраняется в `rawProjectId`. Studio 3 на `e9a46bf` вызывает `resolveProject`, если функция экспортирована, и подставляет свой разбор по формату только когда ответ пустой. Поэтому неизвестный, но похожий на `<пространство>:<slug>` id обязан получить объект `unassigned`, а не `null`: иначе их запасной разбор сочтёт его известным. Голый `moonkatty_shared` их запасной разбор не узнаёт — его узнаёт наш экспорт.

## Чтение журнала

Сверено с `lib/ops/ledger.js` на `feat/studio-operations` @ `e9a46bf` (только чтение, их ветка не менялась):

```js
listEntries({ kind, direction, projectId, from, to })
```

`GET /api/ops/ledger` монтирует Studio 3, когда включён `STUDIO_OPS_MONEY=1`. Ответ: `{ apiVersion: 1, entries, totals, empty }`. Токен приложения / сессия владельца — их проверка. Этот модуль маршрут не регистрирует.

Строка на проводе (их `view`):

| Поле | Значения |
|---|---|
| `id` | строка, вида `le_` и 16 hex |
| `kind` | `actual`, `estimate`, `forecast` |
| `direction` | `income`, `expense` |
| `amount` | десятичная строка, например `"12.50"`; рядом целое `amountMinor` |
| `currency` | три буквы, например `USD` |
| `date` | `YYYY-MM-DD`, сравнение включительное |
| `source` | откуда цифра |
| `proof` | объект `{ type, ref, sha256? }` или `null`. Для `actual` объект обязателен |
| `projectId` | необязательно, до 140 символов |
| прочие | `category`, `basis`, `project`, `voided`, `at` и другие. Адаптер их не копирует в свою схему |

`si.ledger.toQuery` переводит полуинтервал ISO в их включительные дни. Конец `2026-10-21T00:00:00.000Z` становится `to=2026-10-20`. Адаптер затем оставляет полуинтервал у себя: день `2026-10-21` в отчёт за 20 октября не входит. Сумма в отчёте — число. Факт, оценка и прогноз не складываются.

Подключение, когда процесс уже поднял их журнал:

```js
const si = openStudioIntelligence({ db, ledger: { listEntries: f => ledger.listEntries(f) } });
```

Без функции `listEntries` отчёт ставит `ledger.source = 'none'` и нули. Цифры не выдумываются. Заглушка `createLedgerStub` остаётся для тестов без их файла. `recordCost` по-прежнему `NOT_IMPLEMENTED`.

В дневном отчёте факт, оценка и прогноз лежат в `ledger.actual`, `ledger.estimate`, `ledger.forecast`. `costs.totalUsd` и `costs.scope = 'actual'` — только фактический расход в USD. Прогноз в эту сумму не входит. Другая валюта не пересчитывается в доллары и попадает в `ledger.otherCurrencies`.

`recordCost` отвечает `NOT_IMPLEMENTED`. Старая таблица `si_cost_entries` остаётся, чтобы уже открытый файл базы не ломался, и в отчёт не суммируется.

Платных вызовов нет. Запись расхода в их журнале — их контракт. Эта сторона только читает.
