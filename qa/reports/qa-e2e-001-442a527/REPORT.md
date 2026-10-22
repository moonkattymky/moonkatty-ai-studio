# QA-E2E-001 — повторный аудит, feat/e2e-security-agents @ 442a527

Коммиты: 93f336b, 78fc6f9, 50690aa, f84fac8, 927edb7, 442a527 (+ 28c2f3b — task runners, вне скоупа, только отмечен).
Среда: Node v22.23.4, test-flavor, 127.0.0.1:8812/8813, временные каталоги /tmp/mk-qa-e2e001-r2|r3. Продуктовый код не изменялся.

## Вердикт
**QA-E2E-001: ЗАКРЫТ (PASS).** R1, R3, R4, R6 закрыты; R2 закрыт **частично** — найден обход канала app-token (N1) и отсутствие лимита на перебор пароля (N2).
**Итоговый вердикт исправления: FAIL (условный)** — до устранения N1+N2 утверждение «app token не может подтверждать» не выполняется.

## Матрица эксплойтов (live-matrix-r2.txt)
| Проверка | Результат | Вердикт |
|---|---|---|
| savings без confirm / с confirm:true | 403 needs_owner | PASS |
| paid_ads + confirm | 403 needs_owner | PASS |
| critical_settings + confirm | 403 needs_owner | PASS |
| fake_views + confirm | 403 forbidden | PASS |
| pending id | 403 reason=not_approved | PASS |
| array/object/number/true как approvalId | 403 reason=missing | PASS |
| SQLi `' OR 1=1 --` | 403 reason=unknown | PASS |

## R1–R6
| # | Было | Сейчас | Вердикт |
|---|---|---|---|
| R1 | повторное использование id после /approvals | approve исполняет и consume; /savings с тем же id (999999 и 300) → 403 reason=consumed; повторный approve → 409 | **ЗАКРЫТ (PASS)** |
| R2 | самоодобрение без пароля, app-token мог одобрять | без пароля/неверный → 403 owner_reauth; чистый app-token → 403 owner_session_required; сессия на свой запрос → 403 self_approval | **ЧАСТИЧНО** — см. N1, N2 |
| R3 | нет привязки к параметрам | запрос {10}, затем {777777}, approve первого → применено 10 (params_hash + payload_json); TTL 24 ч; requested_by сверяется | **ЗАКРЫТ (PASS)** |
| R4 | legacy approved-строки одноразово годны | legacy approved (без params_hash/expires_at) → reason=expired; legacy pending → approve 409 expired | **ЗАКРЫТ (PASS)** |
| R5 | UI c confirm:true получает 403 | не перепроверялось (UI) | NOT TESTED |
| R6 | нет HTTP e2e | world-approval-e2e-test.mjs 18/18 | **ЗАКРЫТ (PASS)** |

## Новые находки
**N1 — High. app token обходит запрет на подтверждение через поддельную cookie.** lib/world/index.js:244 (`reqPrincipal`): канал определяется по заголовкам — «app», только если есть `x-studio-app-token` И НЕТ `mk_session=` в Cookie. Аутентификация (server.js:188-192) при невалидной cookie падает на app-token. Итого: `x-studio-app-token: <tok>` + `Cookie: mk_session=deadbeef` → principal `owner@session`. Воспроизведено (live-n1-expiry.txt): агент через app token создаёт запрос (owner@app) → тот же app token + фиктивная cookie + пароль → **200, executed:true, target 4242 записан**. Нужен пароль, но см. N2. Fix: определять канал по фактическому пути аутентификации (ставить `req.authVia='session'|'app'` в middleware server.js:190-191), а не по заголовкам.

**N2 — High (в связке с N1) / Medium отдельно. Нет лимита на перебор пароля в approve.** index.js:183 (`checkPassword` в /approvals/:id): 30 неверных паролей подряд → 30×403, затем верный → 200. Нет ни rate-limit, ни блокировки (в отличие от /api/auth/login, server.js:178-185). Кроме того, проверка пароля стоит ДО проверки канала (index.js:183-184): любой держатель app token получает неограниченный оракул пароля владельца (owner_reauth vs owner_session_required). Цепочка N2→N1: локальный агент с app token перебирает пароль и затем сам себе одобряет owner-действия. Fix: общий лимитер с login (по user+IP), проверять канал до пароля, журналировать серию отказов.

**N3 — Low/Info. Правило requester≠approver — это сравнение меток канала, а не людей.** Владелец через Bearer-сессию + мусорный `x-studio-app-token` создаёт запрос с меткой owner@app и затем одобряет его из своей cookie-сессии с паролем → 200 (live N2). Для однопользовательской системы это фактически «самоодобрение с step-up», т.е. не эскалация (нужен пароль), но правило декларативное. Подмена requested_by/user/actor через тело запроса не работает (403 self_approval) — PASS.

**N4 — Info.** Owner не может одобрить запрос, созданный из его же браузерной сессии (403 self_approval) — UX-тупик, см. рекомендацию.

**N5 — Info.** Коммит 28c2f3b (реальные раннеры opencode_task/render_segment) не входит в заявленный список и в этот аудит; требует отдельного ревью (запуск opencode CLI с prompt из API).

## Дополнительные проверки
| Проверка | Результат | Вердикт |
|---|---|---|
| Timing-safe | checkPw: scrypt + crypto.timingSafeEqual (server.js:121); пользователь = req.user, ветки «нет пользователя» нет | PASS |
| Пароль в журнале/логах/БД | нет в world_journal, stdout/stderr сервера, meta, world_approvals, файлах data-dir | PASS |
| Канонизация хеша | params формируются сервером из фиксированных полей (`{kind,target_usd}` / `{detail}`); лишние поля тела игнорируются; ключи сортируются (canon); target_usd строго finite number ≥0; `detail` приводится к String (123 ≡ "123" — безвредно) | PASS |
| Срок действия | expires_at = now+24ч (ISO, сервер); проверка `<=` now; при approve просроченного → статус expired, 409; null expires_at → expired. Часы — только серверные, клиент не влияет. Риск: перевод часов сервера назад продлевает TTL (Info) | PASS |
| Подмена requester/user | поля тела не читаются; requested_by = req.user+канал | PASS (с оговоркой N1/N3) |
| Гонка двойного approve | проверка pending и consume синхронны до первого await → второй получает 409 | PASS (по коду) |
| wireWorld (server.js:160) | маршрутов не добавляет; app.locals.maJobs не отдаётся наружу; новый GET /api/world/approvals/:id (index.js) — за auth-middleware | PASS |
| Миграция | с БД 3b72817 и fc32f72: строки 1→1, данные сохранены, 6 колонок добавлены, повторный migrate идемпотентен; новых DELETE/DROP в диффе нет (DOWN_SQL существовал ранее и не вызывается migrate) | PASS |
| Удаление данных | не обнаружено | PASS |

## Тесты (Node 22.23.4)
| Набор | Заявлено | Факт | Вердикт |
|---|---|---|---|
| world-approval-test.mjs (unit) | 18/18 | 18/18 | PASS |
| world-approval-e2e-test.mjs | 18/18 | 18/18 | PASS |
| e2e `--unwired` | — | 7/9 (ожидаемо: на HEAD сервер подключён, режим требует server.js без строки wireWorld) | NOT TESTED |
| test:security | 52/52 | 52/52 (первый прогон параллельно с live-сервером дал 50/52 по app-token тестам; изолированный повтор 52/52 — флейк под нагрузкой) | PASS |
| test:policy | 46/46 | 46/46 | PASS |
| test:ops | 119/119 | 121 тест: 119 pass, 0 fail, 2 skip | PASS |
| test:world | 62/63 | 62/63 (Ollama qwen3:8b) | PASS (1 BLOCKED: Ollama) |
| test:isolation | — | 65/65 | PASS |
| test:publish-guard | — | 59/59 | PASS |
| Real-Mac | — | — | BLOCKED |

## Рекомендация по самоодобрению владельца (design)
Цель правила requester≠approver — не дать агентам и app token замкнуть контур самостоятельно, а не запретить владельцу действовать. Рекомендуем разрешить владельцу одобрять запрос из собственной браузерной сессии **только** при выполнении всех условий:
1. свежий ввод пароля (step-up) в самом запросе approve, с общим rate-limit/lockout (устранить N2);
2. одобрение привязано к params_hash и показывает владельцу точные параметры (уже есть), TTL 24 ч или короче для self-approve (напр. 15 мин);
3. никогда через app token — канал определяется сервером по фактическому способу аутентификации (устранить N1), а запросы канала app по-прежнему требуют подтверждения из session;
4. отдельная запись в журнале `decision: self_approved_stepup`.
Без исправления N1 разрешать самоодобрение нельзя: app token сможет выдать себя за сессию.
