# MONETIZATION CONTRACT (v1) — журнал денег ↔ Studio 5 (`feat/studio-intelligence`, PR #1)

Статус: формат projectId согласован со Studio 5. Наш журнал — **единственный источник правды по деньгам**; `si_cost_entries` Studio 5 станет read-only адаптером к нашему API. Ветку Studio 5 мы не меняем.

## projectId
Строка `<namespace>:<slug>`, namespaces: `moonkatty_news`, `moonkatty_project`, `moonkatty_shared` (константы `studio-intelligence/src/constants.js`). Примеры: `moonkatty_project:games`, `moonkatty_project:mkty`, `moonkatty_project:youtube`, `moonkatty_project:ads`, `moonkatty_news:episodes`.
Разрешение: подключаемый резолвер. Если в дереве есть `studio-intelligence/src/{projects,index}.js` с синхронной `resolveProject(projectId)`, используется она; иначе проверка формата. Неизвестный/ошибка резолвера → корзина **`unassigned`**, запись не теряется, исходный projectId сохраняется.

## Стабильный read API
- Функция: `ops.listEntries({ kind, direction, projectId, from, to, includeVoided })` (= `lib/ops/ledger.js → createLedger().listEntries`).
- HTTP: **`GET /api/ops/ledger?kind=&direction=&projectId=&from=&to=`** (сессия владельца/app-token; мобильный и узловой токены не допускаются) → `{ apiVersion: 1, entries[], totals, empty }`.
- Также: `GET /api/ops/ledger/summary` (итоги по проектам, целостность, бюджеты).
Запись (только владелец): `POST /api/ops/ledger`, `POST /api/ops/ledger/import {csv, dryRun}`, `POST /api/ops/ledger/:id/void {reason}`, `PUT /api/ops/ledger/budgets`, `GET|POST|PUT /api/ops/deals`, `GET /api/ops/monetization/adapters`.

## Запись (entry)
`id, at, kind (actual|estimate|forecast), direction (income|expense), amount ('12.34'), amountMinor (1234), currency (ISO-4217), date (YYYY-MM-DD), category, source, proof {type, ref, sha256?} | null, basis | null, counterparty, projectId, project {projectId, namespace, slug, bucket, resolvedBy}, dealId, note, idempotencyKey, createdBy, voided {at, reason} | null`.
Правила: `actual` — только с proof (receipt, invoice, bank_statement, payout_report, contract, url, file), не датируется будущим; `estimate`/`forecast` — только с basis. Итоги считаются **отдельно по kind × direction × валюта**, без конвертации валют. Нет данных → `empty: true`, `totals: {}`.
Записи Cost Controller показываются read-only как `estimate`/`api_cost` (не копируются). Журнал — append-only JSONL с хеш-цепочкой; при нарушении — запись останавливается + критическое оповещение.

## Отображение в si_cost_entries (Studio 5)
`namespace = project.namespace`, `component = category`, `amountUsd = +amount` (только `currency = 'USD'`; другие валюты Studio 5 не конвертирует), `idempotencyKey = idempotencyKey || id`, `at = date + 'T00:00:00Z'`, `note = note`. Фильтр: `direction=expense`. Тест: `test/contract/monetization.contract.test.js`.

## Открытые вопросы к Studio 5
1) нужен ли `moonkatty_shared` в его `NAMESPACES` (сейчас там 2 значения); 2) асинхронный `resolveProject` — нужен синхронный кэш или наш вызов через await; 3) USD-only в cost-entry.schema.json — как показывать EUR/ILS.
