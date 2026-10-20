# Studio Operations (v1.2-ops) — Watchdog, Resource Manager, Mobile Control Center

Ветка `feat/studio-operations` (база: `feat/opencode-auth` @ `3f9bd90`). Все модули независимы и **выключены по умолчанию**.

| Модуль | Где | Как включить |
|---|---|---|
| System Watchdog | `lib/ops/watchdog.js`, процесс `ops/watchdog.js`, `deploy/com.moonkatty.watchdog.plist` | отдельный launchd-агент |
| Resource Manager | `lib/ops/resource-manager.js` + хук в `runner.js` | `STUDIO_OPS_RESOURCES=1` (desktop: `"opsResources": true` в `desktop.json`) |
| Mobile Control Center | `lib/ops/mobile.js`, `public/mobile.html`, `public/mobile.js` | `STUDIO_OPS_MOBILE=1` (desktop: `"opsMobile": true`) |

Общие части: `lib/ops/backoff.js` (retry + circuit breaker), `lib/ops/notifier.js` (ntfy/Telegram, по умолчанию `none`),
`lib/ops/state.js` (JSON-состояние, атомарная запись, 0600), `lib/ops/probes.js` (vm_stat/ps/statfs через `execFile`, без shell).

Документы: [INTEGRATION.md](INTEGRATION.md) · [WATCHDOG.md](WATCHDOG.md) · [RESOURCE_MANAGER.md](RESOURCE_MANAGER.md) · [MOBILE.md](MOBILE.md) · [MAC_CHECKLIST.md](MAC_CHECKLIST.md) · [AUDIT-2026-10-21.md](AUDIT-2026-10-21.md)

Тесты: `npm run test:ops` (node:test, юнит + интеграция с реальным сервером на временной папке), `npm test` — всё вместе.
UI-проверка мобильной страницы: `node scripts/mobile-ui-test.mjs http://127.0.0.1:8787 <логин> <пароль>`.

Что НЕ изменено: CSRF (`X-Studio-Request` + Origin), Host allowlist, app-token (только loopback), sandbox-exec для OpenCode, Keychain, CSP.
Мобильные маршруты проходят через те же `hostCheck`/`csrfCheck`, что и вся `/api`.
