# Монетизация и операции — аудит и устройство

## Аудит (что уже было, чтобы не дублировать)
| Где | Что есть | Решение |
|---|---|---|
| `lib/ops/costs.js` (эта ветка) | Cost Controller: журнал платных API-вызовов, бюджеты по сервисам, блокировка | оставлен; в журнале денег показывается read-only как `estimate/api_cost` (без копирования) |
| `meta.js` (main) | аналитика FB/IG (охваты, вовлечённость) в workspace.analytics | не деньги — не трогаем |
| `feat/media-automation` `media-automation/src/analytics/*` | адаптеры метрик просмотров YouTube/X/Telegram/Meta | метрики вовлечённости — не дублируем; наши адаптеры только про доходы |
| `feat/studio-intelligence` (Studio 5, PR #1) | `si_cost_entries` (cost-entry.schema.json), namespaces | станет read-only адаптером к нашему `GET /api/ops/ledger` (MONETIZATION_CONTRACT.md) |
| Доходы, спонсоры, клиенты | нигде не было | новое: `lib/ops/ledger.js`, `lib/ops/deals.js`, `lib/ops/monetization-adapters.js` |

## Что сделано (флаг `STUDIO_OPS_MONEY=1` / `"opsMoney": true`)
1. **Журнал фактических доходов и расходов**: ручной ввод и импорт CSV (dry-run, построчные ошибки, идемпотентность), поле `source` и подтверждение `proof` (обязательно для факта).
2. **Адаптеры аналитики монетизации** YouTube/TikTok/Instagram/X/Telegram — только интерфейсы и моки; по умолчанию «не подключено»; что есть в официальных API — в `PLATFORMS`.
3. **Строгое разделение**: `actual` / `estimate` / `forecast` — разные типы, итоги никогда не суммируются между ними, валюты не конвертируются, пусто → пустое состояние (числа не выдумываются). Договорённая сумма сделки — не доход.
4. **Спонсорские размещения и будущие клиенты AI STUDIO** (`/api/ops/deals`): статусы lead → … → paid, размещения по платформам, полученное = связанные `actual`.
5. **Оповещения** через существующий notifier: превышение бюджета по фактическим расходам; повреждение журнала (хеш-цепочка) — критическое, запись останавливается.
CSV-колонки: `kind,direction,amount,currency,date,category[,source,proof_type,proof_ref,proof_sha256,counterparty,projectId,basis,note,idempotencyKey]`.
