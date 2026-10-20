# Руководство по интеграции

## Точки подключения в существующем коде (минимальные)
1. `server.js`
   - `const ops = require('./lib/ops/index.js')({ env, dataDir, log })` — читает флаги.
   - `runner` получает `admit`/`release` из `ops` (если `STUDIO_OPS_RESOURCES` не включён — `undefined`, поведение прежнее).
   - `ops.mountMobile(app, …)` монтируется **до** основного auth-middleware `/api` (у мобильного API своя проверка токена) и **после** `hostCheck`/`csrfCheck`.
   - `mobile.mountAdmin()` — `/api/ops/mobile-tokens` монтируется **после** основного auth (нужна сессия владельца или app-token).
   - `GET /api/ops/status` (под основной авторизацией) — флаги и состояние Resource Manager.
   - `ops.start()` в `startBackground()` — фоновое обновление RAM/Ollama и очистка tmp.
2. `runner.js` — в `tick()` выбирается первая задача в очереди агента, которую пропускает `admit()`; в `finally` вызывается `release()`.
3. `desktop/main.js`, `desktop/service.js` — булевы `opsResources`/`opsMobile` из `desktop.json` → env сервера.

## Модель данных
- Задача может иметь `resourceClass`: `light | llm-large | render | video`. Иначе класс выводится: `kind: render|video`, агент `design3d`→render, `video`→video, `news/content/director`→llm-large, остальные → light.
- Мобильные токены: `meta.mobileTokens` = `[{id, hash(sha256), label, scopes, createdAt, expiresAt, lastUsedAt}]`. Открытый токен показывается один раз.
- Watchdog: `<DATA_DIR>/ops/watchdog-state.json` (checks, alerts, actions, breakers). Сервер только читает его для мобильной сводки.
- Временные папки тяжёлых задач: `<DATA_DIR>/ops/tmp/<taskId>/` с маркером `.mk-ops-tmp`; `rm.tempDir(taskId)`.

## Как будущие модули (Blender/Video Factory) должны подключаться
- Ставить задачам `resourceClass: 'render' | 'video'`; брать рабочую папку через `ops.rm.tempDir(task.id)`; не писать в чужие каталоги.
- Процессы запускать через `spawn` без shell; имя процесса должно попадать в `OPS_WATCH_PROCS` (по умолчанию `blender,ffmpeg,opencode`).
- Для очереди рендера использовать `ops.rm.renderQueue(tasks)` (urgent → high → normal → low, затем FIFO).

## Переменные окружения
| Переменная | По умолчанию | Назначение |
|---|---|---|
| `STUDIO_OPS_RESOURCES` | выкл | Resource Manager |
| `OPS_RM_UNLOAD_OLLAMA` | выкл | выгружать модели Ollama (`keep_alive:0`) перед render/video |
| `OPS_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama для `/api/ps` (сервер и watchdog) |
| `OPS_TMP_QUOTA_GB` / `OPS_TMP_TTL_HOURS` | 20 / 48 | квота и срок жизни tmp |
| `STUDIO_OPS_MOBILE` | выкл | Mobile API |
| `OPS_MOBILE_AGENTS` | `news,content,social,analytics,community,video` | агенты, которыми можно управлять с телефона |
| Watchdog: см. [WATCHDOG.md](WATCHDOG.md) | | |
