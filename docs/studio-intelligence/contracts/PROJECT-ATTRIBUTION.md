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

`resolveProject(projectId)` возвращает:

| Поле | Смысл |
|---|---|
| `projectId` | известный id или `unassigned` |
| `rawProjectId` | строка, как её передали; пустое значение даёт `null` |
| `known` | id есть в реестре |
| `namespace` | пространство или `null` у `unassigned` |
| `slug` | часть после двоеточия или `null` |
| `dropped` | всегда `false` |

Неизвестный id не выбрасывается. Сумма остаётся в отчёте в корзине `unassigned`, а исходная строка сохраняется в `rawProjectId`. Studio 3 вызывает `resolveProject`, если функция есть, и сама помечает неизвестное как `unassigned`.

## Чтение журнала

Сигнатура, которую Studio 3 подтвердила (код `lib/ops/ledger` и `GET /api/ops/ledger` ещё не запушены):

```js
listEntries({ kind, direction, projectId, from, to })
```

Строка:

| Поле | Значения |
|---|---|
| `id` | строка |
| `kind` | `actual`, `estimate`, `forecast` |
| `direction` | `income`, `expense` |
| `amount` | число ≥ 0 |
| `currency` | три буквы, например `USD` |
| `date` | ISO-8601 UTC |
| `source` | откуда цифра |
| `proof` | ссылка на подтверждение или `null` |
| `projectId` | необязательно |

Запрос `GET /api/ops/ledger` несёт те же пять полей в query. Маршрут монтирует Studio 3. Здесь только разбор объекта запроса: `si.ledger.toQuery`.

Подключение:

```js
const ledger = require('./lib/ops/ledger'); // когда файл появится
const si = openStudioIntelligence({ db, ledger });
```

Пока модуля нет, в тесте стоит заглушка `createLedgerStub`. Без функции `listEntries` отчёт ставит `ledger.source = 'none'` и нули. Цифры не выдумываются.

В дневном отчёте факт, оценка и прогноз лежат в `ledger.actual`, `ledger.estimate`, `ledger.forecast`. `costs.totalUsd` и `costs.scope = 'actual'` — только фактический расход в USD. Прогноз в эту сумму не входит. Другая валюта не пересчитывается в доллары и попадает в `ledger.otherCurrencies`.

`recordCost` отвечает `NOT_IMPLEMENTED`. Старая таблица `si_cost_entries` остаётся, чтобы уже открытый файл базы не ломался, и в отчёт не суммируется.

Платных вызовов нет. Запись расхода в их журнале — их контракт. Эта сторона только читает.
