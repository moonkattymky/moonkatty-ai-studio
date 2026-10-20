# System Watchdog

Отдельный процесс `node ops/watchdog.js` (или `npm run watchdog`). Цикл раз в `OPS_WATCHDOG_INTERVAL_MS` (60 с).
`--once` — одна проверка; `--reset` — сбросить circuit breakers после ручного вмешательства.

## Проверки
| Проверка | Как | Ошибка, если |
|---|---|---|
| server | `GET /api/health` | нет ответа, или `lastTick` старше `OPS_TICK_STALE_SEC` (90 с) |
| ollama | `GET /api/tags` | нет ответа / не 2xx |
| opencode | `GET /global/health` (если задан `OPS_OPENCODE_URL`) | нет ответа; 401/403 = жив (Basic Auth) |
| memory | macOS `vm_stat` (free+inactive+speculative+purgeable) | < `OPS_MIN_FREE_RAM_GB` (2) |
| disk | `statfs` каталога данных | < `OPS_MIN_FREE_DISK_GB` (20) |
| processes | `ps -axo …` только своего пользователя, имена из `OPS_WATCH_PROCS` | работает > `OPS_HUNG_PROC_SEC` (4 ч) и CPU < 1% |
| queue | `GET /api/mobile/summary` с токеном `OPS_WATCHDOG_TOKEN` | задачи in_progress > `OPS_STUCK_TASK_MIN` (60) или ошибок за 10 мин > `OPS_ERROR_RATE_MAX` (20) |

Оповещение отправляется после `OPS_FAIL_AFTER` (2) подряд неудачных проверок и при восстановлении; дубли подавляются 30 мин.

## Действия (по умолчанию ВЫКЛЮЧЕНЫ)
- `OPS_WATCHDOG_RESTART=1` — `launchctl kickstart -k gui/<uid>/<label>` для сервера (`OPS_SERVER_LAUNCHD_LABEL`, по умолчанию `com.moonkatty.aistudio.server` — метка desktop-приложения; для ручного plist из `deploy/` — `com.moonkatty.aistudio`) и Ollama (только если задан `OPS_OLLAMA_LAUNCHD_LABEL`).
- `OPS_WATCHDOG_KILL_HUNG=1` — `SIGTERM` (не SIGKILL) зависшему процессу своего пользователя.
- Ограничения: экспоненциальный backoff (1, 2, 4… мин, максимум 30), circuit breaker: 3 неудачи за 15 мин → пауза 30 мин → 1 пробная попытка; после 3 срабатываний — **блокировка до `--reset`**. Итого не более ~5 попыток подряд, бесконечных перезапусков нет.

## Уведомления
`OPS_NOTIFY=none|ntfy|telegram` (по умолчанию `none`).
- ntfy: `OPS_NTFY_URL=https://ntfy.sh/<длинный-секретный-топик>` (только https), опционально `OPS_NTFY_TOKEN`.
- Telegram: `OPS_TELEGRAM_BOT_TOKEN`, `OPS_TELEGRAM_CHAT_ID`.
Текст проходит `redact()`. Оба сервиса бесплатны; ничего не включается без явной настройки.

## Секреты
Не кладите токены в plist (он читается любым процессом пользователя и часто попадает в бэкапы). Создайте
`~/.config/moonkatty/watchdog.env` с правами `600`:
```
OPS_WATCHDOG_TOKEN=mkm_...   # мобильный токен со scope ops:read,read (см. MOBILE.md)
OPS_NOTIFY=ntfy
OPS_NTFY_URL=https://ntfy.sh/mk-<случайная-строка>
```
plist-пример его подхватывает (`deploy/com.moonkatty.watchdog.plist`).
