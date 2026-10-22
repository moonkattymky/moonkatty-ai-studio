# Дельта-аудит candidate/v1.3.2-test @ 7f0129f против efe8b20 — общий 3D-гейт

Node 22.23.3, Linux. Собственный клон, тестовый сервер на порту 8961 (NODE_ENV=test, FLAVOR test). Код продукта не менялся; в server/jobs* и server/blender* ничего не писалось; security-test запускался, когда параллельного security-test не было.

## Вердикт: **FAIL** (низкая тяжесть)

Контракт «каждый 3D-вход → 403 feature_disabled» не выполнен для 13 из 41 проверенных вариантов (одинаково на dev-дереве и в упакованной сборке). **Ни один из них не приводит к исполнению 3D:** 3D-заданий в БД 0, Blender не запускается (`blender.detect` → disabled), задача агента design3d падает в раннере с `feature_disabled`. То есть по безопасности гейт fail-closed, но на уровне API ответы неверные (404/500/200/201 вместо 403).

## 1. Дифф efe8b20..7f0129f
Коммиты: b43dc54 (гейт design3d на POST /api/jobs + тест), 7f0129f (общий гейт). Файлы: lib/feature-gate.js (новый), lib/blender.js, lib/executors/design3d.js, lib/services.js, runner.js, server.js — только вызовы гейта; package.json/package-lock — версия 1.3.2-test + скрипт теста; public/app.js — баннер 403 и выключенная кнопка в 3D-студии (UI, вне «гейт/версия/тесты», но относится к гейту); scripts/* — тесты. **Посторонних изменений нет — PASS.**

## 2. Инвентаризация (grep server.js, runner.js, lib)
Покрыто гейтом: POST /api/jobs (design3d/blender_template/3d, type и kind), /api/studio3d/* (не-GET), /api/projects3d/:pid/:ver/(rerender|run), /api/jobs/:id/(confirm|review) и retry 3D-задания, director chat (LLM и rulePlan), new3dTask, runner (агент design3d / kind 3d), исполнитель design3d (run/confirm), services.blender.runTemplate, lib/blender.js (каждый spawn и detect).
WS-эндпоинтов, принимающих команды, нет. Исполнители Approval Center (lib/world/wiring.js): critical_settings + внешние заглушки — 3D-действий нет, через approval 3D не исполнить. ops/nodes: blender_template в LOCAL_ONLY_TYPES, профили узлов запрещают blender — не вход.

## 3. Живые пробы (сессия и app-token, dev и упакованная сборка): 28 PASS / 13 MISS

| # | Вход | Ответ | Что реально происходит |
|---|---|---|---|
| G-1 | `POST /api/projects3d/:pid/:ver/rerender/` (слэш в конце) и `/API/projects3d/...` (регистр) | 404 / до обработчика | Гейт на `app.use(/regex$/)` чувствителен к регистру и не допускает `/` в конце, а `app.post` (express, не strict, case-insensitive) маршрут принимает. Обработчик достигается; дальше `new3dTask` → assert3dAllowed → 403 без `code`. Не исполняется. |
| G-2 | `POST /api/jobs/:id/confirm/`, `/API/jobs/:id/confirm` | **500** | То же обход route-гейта; `design3d.confirm` бросает feature_disabled, но обработчик не ловит → 500 (error-handler). Не исполняется. |
| G-3 | `POST /api/jobs/:id/Review` (и retry/ с вариантом регистра) | 404 / до обработчика | То же; для существующего 3D-задания rework → new3dTask 403 без code; approve/reject меняют статус задачи (не исполнение). |
| G-4 | `POST /api/tasks {agentId:'design3d', kind:'3d'}` (generic коллекция) | **201**, задача создаётся | Раннер помечает failed `feature_disabled`, ничего не запускается. |
| G-5 | `POST /api/world/plan {goal:'…3d… blender'}` | **200**, создаётся задача агента design3d (source ceo) | `core.rulePlan` маршрутизирует «3d/blender» на design3d; director chat этот путь гейтит, world/plan — нет. Раннер fail-closed. |
| G-6 | `POST /api/agents/design3d/start` | **200** | Запуск агента; задачи падают в раннере feature_disabled. |

Через app-token результаты идентичны сессии. Retry 3D-задания проверить вживую нельзя (3D-задание не создаётся ни одним путём) — по коду гейт срабатывает при `is3dType(j.kind)`.

Рекомендации: гейт-мидлвары повесить на те же пути/с теми же опциями, что маршруты (или `app.use` с регексом `/i` и `\/?$`), либо ловить ошибку гейта в обработчиках confirm/review → 403 code; гейтить `/api/tasks` (agentId design3d), `/api/world/plan` (как director chat) и `/api/agents/design3d/start`. Тест design3d-disabled (48/48) эти варианты не проверяет.

## 4. Наборы тестов
| Набор | Результат |
|---|---|
| design3d-disabled | **48/48** PASS (совпадает с заявленным) |
| security | **52/52 ×2** PASS |
| world-approval | **18/18** PASS |
| approvals e2e (world-approval-e2e) | **45/45** PASS |
| newsvideo | **62/0** PASS |
| ops | **119 pass / 0 fail / 2 skip** PASS |
| policy | **46/46** PASS |

## 5. Упаковка
`FLAVOR=test scripts/package-mac-on-linux.sh` → exit 0, `MOONKATTY-AI-STUDIO-TEST-1.3.2-test-arm64-mac.zip`. Упакованный `app.asar.unpacked/server.js` загружается, /api/health → **version 1.3.2-test**; те же пробы на упакованном дереве — те же 28/13. Запуск .app на Mac — BLOCKED.

Файлы: probe.mjs, run1.log (dev), run-pkg.log (упакованная сборка).
