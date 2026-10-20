# Отчёт Phase 2 — feat/studio-operations

База: `origin/feat/opencode-auth` @ `3f9bd9038a3245a362b355565c4ba2a860c6ba3c`. Ветка запушена до `a922f12`.

## Функции
- **System Watchdog** (`lib/ops/watchdog.js`, процесс `ops/watchdog.js`, `deploy/com.moonkatty.watchdog.plist`) — отдельный процесс. Проверяет `/api/health` и устаревание scheduler tick (>90 с), Ollama `/api/tags`, OpenCode `/global/health` (401/403 = жив), RAM (vm_stat), диск, зависшие blender/ffmpeg/opencode своего пользователя, зависшие задачи и долю ошибок (через scoped-токен). Оповещение после 2 неудач подряд и при восстановлении, дедупликация 30 мин. Опционально: `launchctl kickstart` и SIGTERM — экспоненциальный backoff + circuit breaker (≤~5 попыток, затем блокировка до `--reset`). Состояние: `<DATA>/ops/watchdog-state.json`. Notifier ntfy/Telegram, по умолчанию `none`.
- **Resource Manager** (`STUDIO_OPS_RESOURCES=1`) — профиль 24 ГБ (бюджет 18 ГБ, мин. 2 ГБ свободно), классы light 0.5×4 (+2 urgent) / llm-large 10×1 / render 8×1 / video 6×1, llm-large⊥render, учёт Ollama `/api/ps`, выгрузка `keep_alive:0` (`OPS_RM_UNLOAD_OLLAMA=1`), очередь рендера (urgent→…→FIFO), квота/TTL только своих tmp-папок с маркером. Хук admit/release в `runner.js`.
- **Mobile Control Center** (`STUDIO_OPS_MOBILE=1`) — `/api/mobile/*`, scoped-токены `mkm_…` (хранится только SHA-256, TTL, отзыв), токен отклоняется вне `/api/mobile` (generic CRUD, restore, reset, backup, /files); start/stop только allowlist-агентов, не `kind: code`; медиа, утверждение материалов, публикации — отдельный scope `materials:publish` + guardrails; `/mobile.html`. Защиты CSRF/Host/app-token/sandbox/Keychain/CSP не ослаблены.

## Тесты
- `npm run test:ops`: 35/35 PASS (юнит + интеграция с реальным сервером, флаги вкл/выкл).
- Существующие: security 51/51, runner 5/5, opencode-auth 51/51 (один раз нестабильно из-за фиксированного ожидания 2,5 с, при повторе PASS; на базе так же).
- smoke.mjs (headless Chrome): ok, 0 ошибок; `scripts/mobile-ui-test.mjs` (iPhone viewport): все вкладки, 0 ошибок.
- Не запускалось: `desktop-test.mjs` (нет бинарника Electron в окружении).

## Изменённые файлы (33)
Новые: `lib/ops/{backoff,state,notifier,probes,watchdog,resource-manager,mobile,index}.js`, `ops/watchdog.js`, `deploy/com.moonkatty.watchdog.plist`, `public/mobile.{html,js}`, `test/ops/*.test.js` (8), `scripts/mobile-ui-test.mjs`, `docs/ops/*.md`.
Изменены минимально: `server.js`, `runner.js`, `desktop/main.js`, `desktop/service.js`, `package.json`.

## Ограничения
- macOS-части (launchctl, vm_stat, launchd, Tailscale) проверены только на моках.
- Оценки RAM — стартовые, нужен замер на Mac.
- Реальные ntfy/Telegram не отправлялись; публикаций не было.
- Мобильный токен хранится в localStorage iPhone; при потере — отзыв.
- Для desktop-приложения `OPS_RM_UNLOAD_OLLAMA` пока не выведен в `desktop.json`.
- Изменение `PROFILE_24GB` требует пересборки приложения.

## Действия Igor на Mac
См. `MOONKATTY_Mac_Setup.pdf` / `docs/ops/MAC_CHECKLIST.md`: бэкап → checkout + `npm ci` + `npm run test:ops` → сборка → `desktop.json` (`opsResources`, `opsMobile`, `allowedHosts`) → токены iPhone/watchdog → `watchdog.env` (chmod 600) → plist + `launchctl bootstrap` → `tailscale serve` (без funnel) → `/mobile.html` на iPhone → замеры памяти → прислать результаты.
