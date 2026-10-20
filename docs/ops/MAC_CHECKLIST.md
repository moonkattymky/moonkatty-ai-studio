# Чек-лист ручной проверки на Mac mini (Apple Silicon, 24 ГБ)

## 0. Подготовка
- [ ] `git fetch && git checkout feat/studio-operations`, `npm ci`, `npm run test:ops` — все PASS.
- [ ] Бэкап данных: «Настройки → Резервная копия» или копия `~/Library/Application Support/MOONKATTY AI STUDIO/`.

## 1. Флаги выключены — регрессий нет
- [ ] Запустить как обычно: панель, агенты, OpenCode (по-прежнему выключен/в sandbox-exec), вход/выход работают.
- [ ] `curl -s http://127.0.0.1:8787/api/mobile/summary` → 401; с сессией → 404.

## 2. Resource Manager
- [ ] `desktop.json`: `"opsResources": true` → перезапуск. `GET /api/ops/status` → `flags.resources: true`, `availableGB` ≈ реальному (сравнить с «Мониторингом системы»).
- [ ] Загрузить модель (`ollama run qwen3:8b "hi"`), `ollama ps` ↔ `resources.ollama.totalGB`.
- [ ] Создать 2 задачи `resourceClass: "render"` → выполняется одна, вторая `queued`, в журнале причина.
- [ ] Включить `OPS_RM_UNLOAD_OLLAMA=1`: задача render при загруженной большой модели → модель выгружена (`ollama ps` пуст).
- [ ] Замерить реальное потребление Blender/ffmpeg/модели (Activity Monitor → Memory) и при необходимости поправить `PROFILE_24GB`.
- [ ] `ops/tmp`: создать папку без маркера → после очистки остаётся.

## 3. Watchdog
- [ ] Создать токен watchdog (scopes `read,ops:read`), записать в `~/.config/moonkatty/watchdog.env` (`chmod 600`).
- [ ] `node ops/watchdog.js --once` → все OK (opencode — если задан URL).
- [ ] Установить plist (заменить USERNAME, `OPS_DATA_DIR` = папка данных приложения), `launchctl bootstrap gui/$(id -u) …`.
- [ ] Остановить Ollama → через ~2 минуты уведомление (если включён ntfy/Telegram) и запись в `watchdog-state.json`; запустить → «восстановлено».
- [ ] `OPS_WATCHDOG_RESTART=1`: `kill -STOP <pid сервера>` (tick устаревает) → kickstart; `kill -CONT`. Повторить с недоступным label → breaker открывается, перезапуски прекращаются; `--reset` сбрасывает.
- [ ] Blender в фоне > `OPS_HUNG_PROC_SEC` (для теста поставить 60) без CPU → отображается как зависший; kill только при `OPS_WATCHDOG_KILL_HUNG=1`.
- [ ] Заполнить диск/RAM-пороги завышенными значениями → предупреждения.

## 4. Mobile Control Center
- [ ] `"opsMobile": true`, создать токен iPhone, `tailscale serve --bg --https=443 http://127.0.0.1:8787`, добавить имя в `allowedHosts`.
- [ ] С iPhone (Tailscale включён): `/mobile.html` → вход по токену, все вкладки открываются, медиа (картинка/видео) воспроизводятся.
- [ ] Старт/стоп задачи разрешённого агента работает; задача Director/OpenCode → «не разрешена».
- [ ] Утверждение результата задачи; публикации в очереди — только с токеном `materials:publish` (проверять на демо/тестовой странице, не на реальной).
- [ ] С токеном `curl -H 'Authorization: Bearer mkm_…' https://<mac>.ts.net/api/tasks` → 401; `/api/backup` → 401.
- [ ] С Tailscale выключенным iPhone адрес недоступен. `tailscale funnel status` — funnel не включён.
- [ ] Отзыв токена → телефон сразу получает 401.
