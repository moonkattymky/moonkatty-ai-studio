# QA-E2E-001 — аудит исправления fc32f72 (feat/e2e-security-agents)

Аудитор: независимый QA/security. Дата: 2026-10-22. База: 3b72817. Node v22.23.4 (linux x64), test-flavor, 127.0.0.1:8811, временный каталог данных /tmp/mk-qa-e2e001.
Продуктовый код не изменялся; merge/release/publish не выполнялись.

## Итог
**QA-E2E-001 (исходный обход через `confirm:true`) — ЗАКРЫТ: PASS.**
**Исправление в целом — PASS с остаточными рисками** (одна High, две Medium, см. ниже). Real-Mac проверки — BLOCKED.

## 1. Ревью диффа 3b72817..fc32f72
- permissions.js:15-34 — `confirm` больше не читается; `approvalOk()` требует string-id, `status='approved'`, совпадение `action`, `consumed_at IS NULL`. `consume()` — `UPDATE ... WHERE id=? AND status='approved' AND consumed_at IS NULL` с проверкой `changes===1` → атомарно. Параметризованные запросы → SQLi нет.
- schema.js:33-34 — `ALTER TABLE ADD COLUMN consumed_at` только если колонки нет; идемпотентно, данные не удаляются.
- index.js:176, 190-194, 198-202 — оба вызова передают `approvalId`, consume после gate.
- Прочие вызовы `P.gate` (index.js:73,115,118,126,131,144,151,163,170) по-прежнему передают `confirm:true`, но только для auto-tier действий (analysis/drafts/qc/internal_reports) — флаг теперь игнорируется, на результат не влияет. PASS.

## 2. Поиск обходов (живой сервер, файл live-exploit-matrix.txt)
| Проверка | Результат | Вердикт |
|---|---|---|
| savings без confirm | 403 needs_owner | PASS |
| savings + confirm:true | 403 needs_owner | PASS |
| paid_ads + confirm | 403 needs_owner | PASS |
| critical_settings + confirm | 403 needs_owner (было executed:true) | PASS |
| fake_views + confirm | 403 forbidden | PASS |
| pending id | 403 | PASS |
| rejected id | 403 | PASS |
| id другого действия (spending→critical_settings) | 403 | PASS |
| approved id, 1-е использование | 200 executed:true | PASS (ожидаемо) |
| replay после consume | 403 | PASS |
| гонка: 20 параллельных запросов с одним id | 1×200, 19×403 | PASS |
| type confusion: массив, объект, число, null, true | 403 | PASS |
| SQLi `' OR 1=1 --` | 403 | PASS |
| миграция на БД 3b72817 | строки сохранены (1→1), колонка добавлена, повторный migrate без ошибок | PASS |
| кто может approve /approvals/:id | любая сессия ИЛИ app-token (loopback) — тот же субъект, что создал запрос | FAIL (см. R2) |

## 3. Остаточные проблемы
**R1 — High. Повторное использование approval critical_settings (признанный пробел, воспроизведён).** index.js:177-187 (`/approvals/:id` approve применяет `worldSavingsPending`, но не ставит `consumed_at`) + index.js:190-195. Шаги: POST /savings {300} → id; approve через /approvals/id (цель применена); POST /savings {target_usd:999999, approvalId:id} → **200, target 999999**. Второй повтор → 403 (consume сработал). То есть одно одобрение владельца = два изменения критической настройки, второе — с произвольным значением. Оценка High: обход Approval Center для critical_settings, хотя и однократный.

**R2 — Medium/High. Самоодобрение.** server.js:188-192 + index.js:177-182: эндпоинт approve не требует пароля владельца / повторной аутентификации (в отличие от update-center-mount.js:28) и не проверяет `requested_by != decided_by`. С app-token (loopback, файл data/app-token): create → self-approve → execute = 200 executed:true. Любой локальный процесс/агент с доступом к app-token или сессии проходит весь «владельческий» контур. Fix: требовать пароль владельца (checkPassword) в /approvals/:id, запретить app-token для approve.

**R3 — Medium. Одобрение не привязано к параметрам.** index.js:191 перезаписывает единственный `worldSavingsPending` при каждом запросе; index.js:184 применяет последний pending. Воспроизведено: запрос {10} → id A; запрос {777777}; approve A → в БД `worldSavings.target_usd=777777`. Владелец одобряет одно значение, применяется другое. Нет срока действия и привязки к пользователю (признано).

**R4 — Low.** Одобренные до миграции записи (consumed_at=NULL) становятся одноразово используемыми после обновления (schema.js:33-34). Рекомендация: при миграции помечать existing approved как consumed.

**R5 — Low (признано).** UI, отправляющий confirm:true, теперь получает 403 — функциональная регрессия, не безопасность.

**R6 — Info.** world-approval-test.mjs тестирует только модуль permissions; R1/R2/R3 на уровне HTTP не покрыты.

## 4. Тесты (Node 22.23.4)
| Скрипт | Заявлено | Факт | Вердикт |
|---|---|---|---|
| scripts/world-approval-test.mjs | 12/12 | 12/12 | PASS |
| test:security | 52/52 | 52/52 | PASS |
| test:world | 62/63 | 62/63 (FAIL #3: нет модели Ollama qwen3:8b) | PASS (совпадает; 1 BLOCKED: Ollama) |
| test:isolation | — | 65/65 | PASS |
| test:policy | — | 46/46 | PASS |
| test:publish-guard | — | 59/59 | PASS |
| Real-Mac | — | — | BLOCKED |

Примечание: test:world перезаписывает отслеживаемый qa/reports/world-class-v1.3.0/results.json — изменение отброшено, не коммитилось.
