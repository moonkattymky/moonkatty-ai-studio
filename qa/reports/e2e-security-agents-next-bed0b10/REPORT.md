# Аудит feat/e2e-security-agents-next @ bed0b10

База (frozen): b1073fd. Коммиты: e9950e8 (F1), d8fad8d (F2), 5cdfdb5 (e2e), bed0b10 (docs).
Среда: Node v22.23.4, STUDIO_FLAVOR=test, 127.0.0.1. Продуктовый код не изменялся. task-runners не аудировались.

## Вердикт: PASS

F1 и F2 закрыты live. Матрица эксплойтов PASS. Suites совпадают с заявкой. Упакованный TEST app.asar загружается. Новых High/Medium не найдено.

---

## F1 — payload_mismatch сжигает approval (e9950e8)
Код: `lib/world/index.js:242-244` — при несовпадении hash: `P.consume` затем `status=invalidated`, ответ 409 `payload_mismatch`.
`permissions.js`: `consumed_at` проверяется **до** `status !== 'approved'`.

| Проверка | Результат | Вердикт |
|---|---|---|
| Approve с подменённым payload_json | 409, status=invalidated, execStatus=invalidated, consumed_at установлен | PASS |
| `/savings` с **оригинальными** params + тот же id | 409 consumed | PASS (закрыт gap F1 с b1073fd) |
| `/savings` с подменёнными params | 409 consumed | PASS |
| Повторный approve | 409 consumed | PASS |

## F2 — GC world_auth_fails (d8fad8d)
Код: purge на access / boot / каждые 10 мин; trim `locked_until = 0` only; cap 20 на IP.

| Проверка | Результат | Вердикт |
|---|---|---|
| Активный lock после restart | 429 locked | PASS |
| 25 decoy unlocked rows + stale + restart + access purge | owner lock сохранён; stale удалён (27→26); decoys с next_at в будущем оставлены | PASS |
| Trim только unlocked (`locked_until=0`) | после ручного trim: locked still 1, owner row цела; approve → 429 locked | PASS |
| Cap 20 не вытесняет active lock | trim SQL исключает `locked_until != 0`; bypass lockout через flood decoys — **невозможен** | PASS |

Остаток Info: в гипотетической multi-user системе с одного IP trim может сбросить **ещё не залоченный** счётчик другого user (не active lock). Для однопользовательской Studio неактуально.

## Матрица
savings ± confirm, paid_ads/critical_settings + confirm → 403 needs_owner; fake_views → forbidden. **PASS**.

## F3 / docs (bed0b10)
F3 (reject без пароля) и F4 (Authorization → app) задокументированы как by design в `docs/world/APPROVALS_API.md`. **PASS** (документация; поведение не менялось).

## Тесты
| Набор | Заявлено | Факт |
|---|---|---|
| world-approval-e2e (×2) | 50/50 | 50/50, 50/50 |
| world-approval-test | 18/18 | 18/18 |
| test:security | 52/52 | 52/52 |
| test:policy | 46/46 | 46/46 |
| test:ops | 119/119 | 119/119 (2 skip) |
| test:world | 62/63 | 62/63 (Ollama) |
| isolation / publish-guard | — | 65/65, 73/73 |
| Real-Mac | — | BLOCKED |

## Packaged TEST app
`FLAVOR=test scripts/package-mac-on-linux.sh` → 0. asar без task-runners. `node server.js` из asar → health `ok`, flavor=test. **BOOT PASS**.

## Итог
| Пункт | Статус |
|---|---|
| F1 закрыт | PASS |
| F2 закрыт; cleanup не снимает active lock; cap не обходит lockout | PASS |
| Матрица | PASS |
| Suites | PASS |
| asar boot | PASS |

**Рекомендация:** merge в следующую сборку после tonight's frozen b1073fd.
