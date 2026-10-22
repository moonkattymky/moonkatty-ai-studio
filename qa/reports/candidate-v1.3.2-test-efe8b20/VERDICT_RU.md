# Аудит кандидата `candidate/v1.3.2-test` @ `efe8b20`

**Вердикт: FAIL**  
**Аудитор:** независимый QA (Studio 4 / quality-automation)  
**Дата:** 22.10.2026, ~20:57 (Asia/Jerusalem, UTC+3)  
**Цель:** `efe8b204895a3d882c9a640cf85a0650f7c1e9b5`  
**База:** `3b72817` + `feat/e2e-security-agents@b1073fd` + `feat/e2e-news-video-3d@dd03cae` + fix `efe8b20`  
**Окружение:** Node v22.23.4 (`/workspace/bin/node`), Linux box; упакованный TEST app из asar.unpacked на `127.0.0.1:19010`.

Причина FAIL: воспроизведён **S5-NV-01 (High)** — рендер Shorts 9:16 детерминированно падает на слове >28 символов; Retry падает так же. Остальные блоки (слияние, security/approval, opencode_task 403, хэш zip, boot, live approval/NEWS 16:9) — в порядке. Кандидат **не готов** к релизу, пока S5-NV-01 не исправлен (или явно принят владельцем с откатом Shorts).

---

## 1. Целостность слияния — PASS

| Шаг | Коммит | Проверка |
|---|---|---|
| База | `3b72817d8c2a1af49d08c3f5d752f8e65dcaf0ef` | ancestor ✓ |
| merge security | `a057d48` parents = `3b72817` + `b1073fd` | ✓ |
| merge news | `16840f1` parents = `a057d48` + `dd03cae` | ✓ |
| disable opencode_task | `efe8b20` | ✓ |

- `git diff b1073fd efe8b20 -- lib/world/` — **пусто** (security не искажён).
- `git diff dd03cae efe8b20 -- media-automation/ lib/news-video.js` — **пусто** (news не искажён).
- `public/app.js`: относительно b1073fd — UI news/approval contract из dd03cae; относительно dd03cae — без изменений.
- `server.js` ~145–175: сохранены и `video_render`/Ollama unload (news), и `wireWorld(...)` после `world.boot()` (security). Конфликтов git не было (разные строки) — согласуется с отчётом Studio.
- `efe8b20`: `OPENCODE_TASK_ENABLED = false` → `POST /api/jobs` с `type|kind=opencode_task` → **403** `{code:'feature_disabled', feature:'opencode_task'}`. Живой API подтверждён (сессия и app-token).
- **`lib/task-runners.js` отсутствует.** `MK_TEST_REAL_RUNNERS` — **нигде** в дереве. `28c2f3b` является предком истории (через security-ветку), но содержимое **откачено** `f6fe7ad`; в дереве кандидата runners нет.
- `feat/e2e-task-runners` **не** слит.

---

## 2. Регрессия (чистое дерево, Node 22, `STUDIO_FLAVOR=test`)

| Набор | Результат | Примечание |
|---|---|---|
| security-test ×3 | **52/52, 52/52, 52/52** | порт 8795 свободен; флаков нет |
| world-approval | 18 PASS | |
| world-approval-e2e | **45/45** ALL PASS | |
| opencode-task-disabled | 4/4 | |
| newsvideo | 62/0 | |
| newsvideo-security / owner-approval-ui | SKIP (нужен живой URL) — покрыто live §4 | |
| build-files | 94/94 модулей | |
| policy | 46/46 | |
| isolation | 65/65 | |
| publish-guard | **73/73** | счётчик больше, чем у Studio (59) — актуальный набор на efe8b20 |
| location | 26/26 | |
| nodes | 52/52 | |
| opencode-serve | 21/21 | |
| opencode-json | 22/22 | |
| opencode-auth | 50 pass / **1 fail** | Keychain service: тест ждёт `MOONKATTY AI STUDIO`, TEST → `…STUDIO.test` — окружение/ожидание теста, не регрессия кандидата |
| runner | PASS (OpenCode CLI выключен по умолчанию) | |
| ops | 119 pass / 0 fail / 2 skipped | |
| update-center | 79/79 | |
| world-class | 1 FAIL | `qwen3:8b` не установлена в Ollama — env (как у Studio) |
| subtitle-split | 6/0 | |

Итог регрессии относительно заявленного Studio: security стабилен; критичных регрессий слияния нет. Известные env-падения (world ollama model, opencode Keychain имя) не блокируют сами по себе.

---

## 3. Упакованное приложение

**Заявленный sha256 Studio:**  
`6144e735304cf00350e6141f4b9d42f2ba0517ac55a5de754148d98ee87238b4`

| Проверка | Результат |
|---|---|
| sha256 zip Studio (`mk-candidate-build/dist/…`) | **совпал** с заявленным |
| Пересборка `FLAVOR=test` @ efe8b20 | sha256 **байт-в-байт идентичен** (SOURCE_DATE_EPOCH от коммита) |
| asar: `media-automation/src/news/**`, `orchestrator/facts.js`, `lib/news-video.js`, `lib/world/wiring.js` | присутствуют |
| asar: `lib/task-runners.js` | **отсутствует** |
| Токены/секреты в asar | реальных ключей нет (`studio-intelligence/src/secrets.js` — код редактирования; stub `.pem` для update-keys) |
| `desktop/build-info.json` в пакете | `commit=efe8b20…`, `flavor=test`, `appId=com.moonkatty.aistudio.test`, `builtAt` = timestamp коммита |
| Info.plist | `CFBundleIdentifier=com.moonkatty.aistudio.test`, version **1.3.1-test** (серия 1.3.x test) |
| Boot `app.asar.unpacked/server.js` | `HOST=127.0.0.1 PORT=19010` (≠8687/8787/4096), temp `STUDIO_DATA_DIR` → listen loopback, `/api/health` flavor=test, db node:sqlite |

После сборки в working tree остаётся `desktop/build-info.json` — нужно удалять перед `test:ops` (как делает Studio). В git не отслеживается.

---

## 4. Живые потоки на упакованном сервере (порт 19010)

| Поток | Итог |
|---|---|
| login / bad login / unauth 401 | PASS |
| `confirm:true` на critical_settings/savings → 403 `needs_owner` + approvalId | PASS |
| approve через app-token → 403 `self_approval` | PASS |
| неверный пароль → 403 `owner_reauth` | PASS |
| прогрессивный throttle (429) после серии ошибок | PASS |
| self-approval: session + свежий пароль → 200 approved/executed | PASS |
| повтор / consumed → 409 | PASS |
| `opencode_task` type/kind → 403 `feature_disabled` | PASS |
| NEWS search (RSS) → кандидаты | PASS |
| draft → 422 без `factChecked` → approve с `factChecked:true` | PASS |
| render **youtube** 16:9 → succeeded; export; ffprobe **h264 1920×1080 + aac 48kHz 2ch**, ~75 s, ~17 MB | PASS |
| TTS | espeak-ng доступен (рендер прошёл) |
| **Shorts 9:16 + длинное слово (42)** | **FAIL → S5-NV-01** |
| Retry того же job | **FAIL той же ошибкой** |

Ollama: локально есть qwen2.5:*; сценарий создан (extractive/доступная модель). Полный lockout до `locked` в этом прогоне не дожидался — виден progressive **throttled** (как в e2e 45/45).

---

## 5. UI ↔ API contract (app.js vs server)

- UI **не** шлёт `confirm:true` для owner-действий; при 403 `needs_owner` открывает Approval Center (`ownerRedirect`).
- Approve: `POST /api/world/approvals/:id` с `{decision:'approve', password}` — совпадает с server (`lib/world/index.js`).
- Retry действия с `{approvalId}`; тексты 409 `consumed` / `owner_reauth` согласованы.
- NEWS: approve шлёт `{factChecked:true, contentHash}` — сервер требует `factChecked===true` иначе 422 `fact_check_required`.
- **Зазор:** `opencode_task` теперь 403 `feature_disabled`, а `ownerRedirect` срабатывает только на `needs_owner` — UI покажет тост ошибки, **не** уведёт в Центр (осознанный выбор efe8b20). OK.
- **S5-NV-02:** `nvDo('search', …, 'Поиск завершён')` тостит успех при любом resolved HTTP, **без** проверки `r.run.status` (failed/partial). Код на кандидате подтверждён; живой nonet — у Studio 5, здесь rated по коду.

---

## 6. Доп. проверки (steering)

### POST `/api/jobs` → design3d без approval
- Да: кроме `opencode_task`, `type:'design3d'` создаёт job **201** без owner-gate и стартует runner (`lib/services.js` → OpenCode agent + Blender).
- На упакованном TEST: job создан; сразу **blocked** («Blender не найден»); `/api/runtime` → `opencode: {path:null, enabled:false}`; URL TEST = `127.0.0.1:4097` — **никто не слушает**.
- **Оценка: Info** (OpenCode в TEST-сборке недостижим / выключен; путь не эксплуатируется до появления Blender+OpenCode). На Mac с рабочим OpenCode на 4097 это стало бы Medium/High — вне этого окружения.

### `MK_TEST_REAL_RUNNERS`
- **Отсутствует** во всём дереве кандидата.

---

## 7. Находки

| ID | Severity | Описание |
|---|---|---|
| **S5-NV-01** | **High** | Shorts 9:16: слово без пробелов >28 символов → `subtitle validation failed: cue N: line M chars > 28`. `subtitles.js` `chunk()` не режет слова; `factory2.js:90` `maxChars: V?28:46`. **Воспроизведено на efe8b20** (слово 42 символа, cue 4: line 43>28). Retry — та же ошибка. 16:9 с тем же текстом ранее проходил у Studio 5. |
| **S5-NV-02** | **Medium** | UI тост «Поиск завершён» при любом успешном ответе search; `run.status=failed` не проверяется (`public/app.js` nvSearch → nvDo). Подтверждено кодом на кандидате (+ отчёт Studio 5 nonet). |
| N-D3D | Info | `POST /api/jobs` design3d без approval; в TEST OpenCode unreachable → Info. |
| N-VER | Info | package.json / bundle version всё ещё `1.3.1-test` при имени ветки v1.3.2-test (решение владельца). |
| N-OC-KC | Info | opencode-auth 50/51: ожидание имени Keychain service без `.test` в TEST flavor. |
| N-WORLD-OLLAMA | Info | world-class: нет qwen3:8b в локальной Ollama. |

(S5-NV-03…06 из отчёта Studio 5 на dd03cae здесь отдельно не гонялись; S5-NV-01/02 проверены на кандидате.)

---

## 8. Мнение по `build-info.json` (QA-131-004)

**Допустимо и правильно оставлять свежий `desktop/build-info.json` внутри упакованного приложения** — Update Center / anti-rollback fail-closed без него.  
**Недопустимо** коммитить его в git или оставлять в working tree после сборки (ломает `test:ops`). Практика Studio: генерировать при package, удалять из дерева после — **приемлема**. Исключать файл из asar нельзя без отдельного решения по Update Center.

Упакованный файл: `commit=efe8b20…` совпадает с HEAD сборки. После нашего rebuild файл снова появился в working tree build-worktree — удалён вручную, в индекс не попадал.

---

## 9. Вердикт

**FAIL** — из-за S5-NV-01 (High) на слитом NEWS-пути.  
Merge integrity, security/approval e2e, disable opencode_task, хэш пакета, boot и live 16:9/approval — **PASS**.  
После фикса subtitles/chunk (или жёсткой обрезки слов / предупреждения при approve) — переаудит Shorts + тоста поиска.

**Не аудировалось:** `feat/e2e-task-runners`; Real-Mac Gatekeeper/notarization (BLOCKED by policy); полный UI Playwright (частично закрыто API+кодом; Studio 5 закрыл UI на dd03cae).
