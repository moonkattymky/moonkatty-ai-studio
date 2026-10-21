# Аудит сборки v1.2.1 (read-only)

Дата: 2026-10-21. Проверено на Linux (box), Node 22.23.3; Mac не использовался. Код не менялся.

## 0. Проверка сборки
| Пункт | Результат |
|---|---|
| Релиз | `v1.2.1-mac-preview` (prerelease), `MOONKATTY-AI-STUDIO-1.2.1-arm64-mac.zip`, 169 654 757 байт |
| SHA-256 | `ae87d263…8b42` — **совпадает** с заявленным и с `.sha256`/BUILD-INFO |
| Архитектура | разбор Mach-O заголовков (нет `file`/`lipo` на Linux): главный бинарник, 4 Helper (GPU/Plugin/Renderer/обычный), фреймворки, `Resources/node/node` — **все thin arm64**, 15 Mach-O, x86_64/FAT нет |
| Подпись | все Mach-O — **ad-hoc** (CodeDirectory flag adhoc, без CMS/Developer ID); `node` — ad-hoc + hardened runtime; `_CodeSignature/CodeResources` есть. **Не нотаризовано**, ticket нет. `codesign --verify` на Mac не запускался |
| Fuses | RunAsNode off, NODE_OPTIONS off, inspect off, ASAR integrity on, OnlyLoadAppFromAsar on |
| Содержимое | `app.asar` распакован: `server.js` и `lib/*.js` побайтно равны `42d3fd5`; строк `video_render` нет |
| Bundle | `com.moonkatty.aistudio`, версия 1.2.1 |

### Что входит
`main e87bd32` → `da64941` (macOS app) → `9755184` (1.1.1 security) → `7967f0a` → `3f9bd90` (1.1.2 OpenCode auth) → `00b63fc` (1.2.0 стадии A+B) → `42d3fd5` (1.2.1 стадия C). Диапазон: `git log e87bd32..42d3fd5` (6 коммитов). PR не было (коммиты напрямую в ветки).

### Что НЕ входит
- `a991e93` video_render (stub) — после релизного коммита, в asar отсутствует.
- Studio 2 `feat/media-automation` `a33a315` — не предок `42d3fd5`.
- Studio 3 `feat/studio-operations` `e9a46bf` — не входит.
- Studio 4 `feat/quality-automation` (draft PR #4) — не входит.
- Studio 5 draft PR #1 (`feat/studio-intelligence`), #3 (`cursor/studio-server-integration-c51e`) — не входят; PR #2 `feat/news-launch-integration` (draft) — не входит.

### Совместимость с v1.1.2 — БЛОКИРУЮЩЕЕ для «установки рядом»
Одинаковые: appId `com.moonkatty.aistudio`, productName → userData `~/Library/Application Support/MOONKATTY AI STUDIO/`, launchd label `com.moonkatty.aistudio.server`, Keychain service `MOONKATTY AI STUDIO`. Значит v1.2.1 **использует те же данные** и тот же фоновый сервер; одновременно запускать нельзя. Миграция только аддитивная (`CREATE TABLE IF NOT EXISTS jobs/job_events`; `items/meta` без изменений) — данные v1.1.2 не перезаписываются, откат возможен, но нужна резервная копия (см. MAC_FIRST_TEST.md). Распаковка zip в `/Applications` под тем же именем **заменит** .app 1.1.2.

## 1. Работает по‑настоящему (проверено на Linux реальными компонентами)
- OpenCode serve 1.19.3 (реальный бинарь): Basic Auth 401 без пароля, сессия, permission policy, агент реально пишет `scene_params.json`.
- Blender 5.2.2 (реальный, Linux, Cycles): сохранение `.blend` (магия BLENDER), повторное открытие, PNG, GLB/FBX, версии + backup, SHA-256 артефактов.
- Job engine (cancel/retry/timeout/restart recovery), heavy‑lock, review/rework/versions, GLB‑viewer, UI‑смоук в Chrome (без JS‑ошибок).

## 2. Только автотесты / моки
- Keychain (`security -i`) — фейковый `security` (NODE_ENV=test); реальный Keychain не проверен.
- Ollama — мок (runner) / отсутствует (3d: планировщик «по правилам»); qwen3:8b реально не вызывался.
- sandbox-exec профиль OpenCode, launchd, Electron‑оболочка — только на Linux‑уровне/не исполнялись.

## 3. Не проверено на Mac
Запуск .app, Gatekeeper, codesign --verify, Keychain‑промпты, launchd, Blender.app на macOS (Metal), opencode на macOS, `serve.sh`, sandbox-exec, производительность.

## 4. Компоненты в сборке
Electron 44.9.1, electron-builder 26.15.3, встроенный Node 24.22.0, express 5.3.0, node:sqlite; модули: jobs, heavy-lock, blender, opencode-client/auth, policy, workspace, design3d executor, 3D Studio UI (RU/EN/UK).

## 5. Известные ошибки и риски
| # | Проблема | Серьёзность | Статус проверки |
|---|---|---|---|
| 1 | Director chat (`server.js` ~155–160, `llmPlan`) вызывает Ollama (`/api/chat`, таймаут 120 с) **вне heavy‑lock** — может идти параллельно с рендером/LLM‑заданием | Средняя | подтверждено |
| 2 | `video_render` — только stub «Не подключено» (`a991e93`), и его нет в 1.2.1 | Инфо | подтверждено |
| 3 | Референсы (загрузка, SHA, magic‑bytes) хранятся, но **не используются** генерацией до стадии D | Низкая | подтверждено |
| 4 | Rework без Ollama — разбор по ключевым словам (rules), ограниченное понимание | Низкая | подтверждено (тест «params honestly marked as rules») |
| 5 | EEVEE/Workbench в студии не протестированы (тесты — Cycles; ручные пробы в /workspace/tools есть, не в наборе) | Средняя | подтверждено |
| 6 | OpenCode‑сервер доступен любому локальному процессу/пользователю, знающему пароль (Basic Auth, 127.0.0.1) | Средняя | подтверждено по дизайну |
| 7 | SSRF: `POST /api/integrations/:id/test` делает `fetch` на URL из настроек (любой http(s), включая LAN/metadata); только для авторизованного пользователя, ответ (300 симв.) возвращается | Средняя | подтверждено |
| 8 | Docker‑интеграция по умолчанию `http://localhost:2375` (без TLS); код только делает `GET /_ping`, управления Docker нет; но поощряет открытие незащищённого TCP‑сокета | Низкая | подтверждено |
| 9 | «Нет CSRF‑защиты» (Studio 3) — **не подтверждено**: `lib/security.js` csrfCheck — обязательный `X-Studio-Request: 1` + проверка Origin + Host allowlist; test:security покрывает | — | опровергнуто для v1.2.1 |
| 10 | «Сессии в открытом виде» (Studio 3) — **не подтверждено**: в `meta.sessions` хранятся только хэши токенов (`h:`‑префикс); пароли scrypt | — | опровергнуто |
| 11 | Restore/Reset: в UI есть `confirm`, reset требует `confirm:"RESET"`; **restore** — без серверного подтверждения и без автоматического бэкапа перед заменой коллекций | Средняя (restore) / Низкая (reset) | частично подтверждено |
| 12 | Prompt injection: текст пользователя/параметры идут в промпты Director и OpenCode; смягчено схемой `scene_params.json`, белым списком агентов, политикой OpenCode (запись только в workspace), шаблонными Blender‑скриптами (без произвольного Python) | Средняя | риск подтверждён, смягчён |
| 13 | `lib/keystore.js` `keychainSet`: мастер‑ключ шифрования передаётся в argv `security add-generic-password -w <hex>` (одноразово, при первом запуске) — виден в `ps` локально. Пароль OpenCode так **не** передаётся | Низкая | подтверждено |

## 6. Результаты тестов (feat/v1.2.0 HEAD `a991e93`)
| Набор | Результат | Время |
|---|---|---|
| test:video | 45 passed / 0 failed | 1 с |
| test:3c | 61 / 0 (реальный opencode 1.19.3 + Blender) | 21 с |
| test:security | 51 / 0 | 10 с |
| test:opencode | 51 / 0 (Basic‑Auth мок + реальный serve; утечек пароля нет) | 24 с |
| test:policy | 46 / 0 | <1 с |
| test:3d | 53 / 0 (реальный Blender 5.2.2, реальный opencode; Ollama нет) | 119 с |
| test:runner | 5 / 0 (Ollama мок; OpenCode CLI отсутствует → «заблокировано») | 29 с |
| smoke (Chrome, Playwright) | ok, 0 ошибок | ~30 с |

## 7. OpenCode/Blender путь — аудит кода
- Keychain: пароль OpenCode пишется через `security -i` (hex по stdin, не argv); API отдаёт только `hasPassword`; логи через `redact`; `serve.sh` кладёт пароль только в env процесса. Тесты проверяют отсутствие пароля в API и stdout/stderr.
- URL OpenCode только loopback; `serve.sh` — `--hostname 127.0.0.1`; конфиг `opencode-studio.json` проверяется против политики.
- Поток: Director → задача 3d → job (heavy‑lock) → параметры (Ollama/правила) → OpenCode сессия, permission bridge (edit только в workspace) → валидация схемы → Blender `spawn` без shell, ватированные шаблоны, `--python-exit-code 3` → reopen+PNG/GLB → артефакты с size+SHA‑256 → «Ждёт утверждения».
- Ограничение файлов: `workspace.js` проверяет префикс + `realpath` (против symlink‑побега), референсы по SHA‑имени и magic bytes, `/files` за авторизацией, dotfiles deny.
- Ошибки: таймауты, коды выхода Blender, отмена/повтор, восстановление после рестарта — покрыты тестами.

## 8. Установка и откат
См. `docs/MAC_FIRST_TEST.md`: бэкап .app + данных + plist, установка под другим именем, открытие через правый клик/«Всё равно открыть» (без `xattr -d`), откат копированием данных.

## 9. Оценка готовности
**6/10 — готово к ручному тесту на Mac одним пользователем после бэкапа; не готово к релизу.**
Блокеры для релиза: общие appId/данные с 1.1.2 (нет параллельной установки), нет нотаризации, ни один шаг не проверен на macOS (Keychain, launchd, sandbox-exec, Blender.app), SSRF и restore без бэкапа.
