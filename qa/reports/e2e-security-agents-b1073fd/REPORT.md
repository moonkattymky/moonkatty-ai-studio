# Финальный аудит feat/e2e-security-agents @ b1073fd

Дата: 2026-10-22 (Asia/Jerusalem). Node v22.23.4. Продуктовый код не менялся. N5/task-runners **не** аудировались (отдельная ветка).
Studio 2 report прочитан: `/workspace/out/audit-e2e/e2e_security_agents_report_ru.md` (исторический по fc32f72; актуальные claims — в задании).

## Вердикт: PASS

QA-E2E-001 закрыт. N1–N3 закрыты. Revert 28c2f3b полный. Owner self-approval и SQLite-лимитер соответствуют заявке. Упакованный TEST app.asar загружает `server.js`. Остаточные замечания — Low/Info (не блокеры).

---

## 1. Revert f6fe7ad (28c2f3b)
| Проверка | Результат | Вердикт |
|---|---|---|
| `lib/task-runners.js` отсутствует в дереве и в app.asar | да | PASS |
| `lib/services.js` = stubs opencode_task/render_segment (как до 28c2f3b) | `git diff 28c2f3b^ HEAD -- lib/services.js` пуст | PASS |
| `scripts/task-runners-test.mjs` удалён | да | PASS |
| Force-push | `28c2f3b` остаётся предком; remote reflog только fast-forward; линейная история с `git revert` | PASS |

## 2. Порядок проверок approve (70a3eba)
Факт в `lib/world/index.js:178-206`:
1. not_found (404)
2. consumed (409)
3. expired (409)
4. already_decided (409)
5. self / step-up gate
6. channel === session
7. limiter (429 + Retry-After)
8. password

Live: not_found→404; consumed→409; expired→409; already_decided→409. **PASS** (совпадает с заявкой).

Атомарный consume: `UPDATE … consumed_at IS NULL` + `changes===1`; race 10 запросов → 1×200 / 9×409. **PASS**.
Повторная проверка payload hash перед exec: `execApproval` сравнивает `P.paramsHash(payload)` с `row.params_hash` **до** consume; при порче payload → `execStatus:failed`, не исполняется. **PASS**.

## 3. owner_self_approval
Механизм (чат t35u не верифицировался — аудирован только код):
- только `me.endsWith('@session')`, окно `STEPUP_MS` (15 мин, в тесте 2 с через env);
- свежий пароль; params hash; single-use consume; journal `decision: owner_self_approval`;
- kill switch: `MK_WORLD_OWNER_SELF_APPROVAL=0` или mission `allowOwnerSelfApproval: false`.

| Атака | Результат | Вердикт |
|---|---|---|
| Через app token | 403 self_approval (self до channel) | PASS — нельзя |
| Пустой/whitespace token / Authorization / x-api-key + cookie | канал app → 403 | PASS |
| Bearer session | `authorization` в headers → app → 403 | PASS (by design) |
| Unverified channel | не session → 403 | PASS |
| Вне окна 15 мин (2 с в тесте) | 403 self_approval | PASS |
| Изменённый payload_json | exec failed, hash mismatch | PASS |
| sessionIssuedAt с клиента | только `getSession(req).exp - SESSION_TTL` (`server.js:160`) | PASS — неподделываемо |
| В окне, session→session, пароль | 200 + journal owner_self_approval | PASS |

## 4. Password limiter (world_auth_fails)
| Свойство | Факт | Вердикт |
|---|---|---|
| Ключ | `user\|socket.remoteAddress` (`index.js:305`) — **без** X-Forwarded-For | PASS; XFF-spoof не снимает throttle |
| Backoff → lock | delay до 30 с, затем 5 fails → lock 15 мин, 429 + Retry-After | PASS (live-lock.out) |
| Persist | строка в SQLite переживает restart; старая cookie остаётся locked | PASS |
| Safe reset | только session с `sessionIssuedAt` после начала lockout (= успешный main login с паролем) | PASS; украденная session **без** пароля не сбрасывает |
| Attacker+session сбрасывает через login? | только если знает пароль → тогда и так может approve | PASS (не обход) |
| Миграция | `CREATE TABLE IF NOT EXISTS world_auth_fails`; approvals 1→1; идемпотентно | PASS |
| Рост таблицы | PK = `user\|IP`; одна строка на пару; нет GC для «остывших» IP | **Low**: теоретический рост при многих IP |

## 5. Whitespace / Authorization / x-api-key → app
`reqChannel`: `['x-studio-app-token','authorization','x-api-key'].some(k => k in H)` — наличие ключа, не значение. Live: empty/whitespace/Authorization/x-api-key → app. **PASS**.

## 6. server.js:160
Только wiring: `sessionUser` + `sessionIssuedAt` (read-only). Auth middleware не расширен. **PASS**.

## 7. Матрица эксплойтов (сводка)
confirm:true / savings / paid_ads / critical_settings → 403 needs_owner; fake_views → forbidden; R1 reuse → 409 consumed; N1 обходы закрыты; self-approval ограничен; race atomic. **PASS**.

## 8. Тесты (чистое дерево, STUDIO_FLAVOR=test)
| Набор | Заявлено | Факт |
|---|---|---|
| world-approval-test | 18/18 | 18/18 |
| world-approval-e2e-test | 45/45 | 45/45 |
| test:security | 52/52 | 52/52 |
| test:policy | 46/46 | 46/46 |
| test:ops | 119/119 | 119/119 (2 skip) |
| test:world | 62/63 | 62/63 (Ollama) |
| test:isolation | — | 65/65 |
| test:publish-guard | — | 73/73 |
| Real-Mac | — | BLOCKED |

Примечание: после `package-mac-on-linux.sh` файл `desktop/build-info.json` (untracked) ломал ops (fixture builtAt старше сборки) → 105/119; после удаления — 119/119. Не дефект ветки.

## 9. Упакованный TEST app
`FLAVOR=test scripts/package-mac-on-linux.sh` → exit 0.
Извлечён `app.asar`: нет task-runners; services = stubs.
`node app/server.js` (PORT=8841, temp data): health `{"ok":true,"flavor":"test",...}`. **BOOT PASS**.

## 10. Новые / остаточные (не блокеры)
| ID | Sev | Суть |
|---|---|---|
| F1 | Low | После approve с подменённым payload статус=`approved`, consume не выполнен; id ещё годится для `/savings` с **оригинальными** params (исполняется то, что владелец задумал). Путаница состояния, не эскалация. |
| F2 | Low | `world_auth_fails` без TTL-GC по IP. |
| F3 | Info | `reject` без пароля (любая session может отклонить pending). |
| F4 | Info | Bearer/`Authorization` не может approve (намеренно → app). Клиентам нужен Cookie. |

## Итог по пунктам задания
| Пункт | Статус |
|---|---|
| f6fe7ad revert полный, без force-push | PASS |
| Порядок проверок 70a3eba | PASS |
| Atomic consume + payload hash | PASS |
| owner_self_approval механизм | PASS |
| Лимитер SQLite user+IP / backoff / reset | PASS |
| Whitespace/Auth/x-api-key → app | PASS |
| 1ca7643 sessionIssuedAt | PASS |
| e2e 45/45 | PASS |
| Матрица + N1–N3 + R-series | PASS |
| Suites | PASS (world 62/63 Ollama) |
| Packaged asar boots | PASS |

**Ветка готова с точки зрения QA-E2E security-agents.** N5/task-runners — отдельный аудит.
