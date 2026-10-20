# Mobile Control Center

Включение: `STUDIO_OPS_MOBILE=1`. Страница: `/mobile.html` (iPhone, тёмная тема, без inline-скриптов — CSP `script-src 'self'`).

## Токены (отдельные от сессии, хранятся только SHA-256)
Создание (в панели на Mac, нужна сессия владельца или app-token; мобильный токен создать токен **не может**):
```
curl -s -X POST http://127.0.0.1:8787/api/ops/mobile-tokens \
  -H 'x-studio-request: 1' -H 'content-type: application/json' \
  -H "x-studio-app-token: $(cat ~/Library/Application\ Support/MOONKATTY\ AI\ STUDIO/app-token)" \
  -d '{"label":"iPhone Igor","ttlDays":90}'
```
Ответ содержит `token` (`mkm_…`) — он показывается один раз. Список: `GET /api/ops/mobile-tokens`, отзыв: `DELETE /api/ops/mobile-tokens/<id>`.

Scopes: `read`, `tasks:control`, `materials:review`, `ops:read` — по умолчанию; `materials:publish` (утверждение публикаций в очереди Meta) — только явно.
Для watchdog создайте отдельный токен `{"label":"watchdog","scopes":["read","ops:read"]}`.

## API `/api/mobile/*` (авторизация обязательна везде)
| Метод | Путь | Scope |
|---|---|---|
| GET | `/summary` — агенты, задачи по статусам, зависшие, ошибки, система, ресурсы, watchdog | read |
| GET | `/tasks?status=` | read |
| POST | `/tasks/:id/start`, `/tasks/:id/stop` — только агенты из `OPS_MOBILE_AGENTS`, никогда `kind: code` | tasks:control |
| POST | `/agents/:id/start|stop` — только allowlist | tasks:control |
| GET | `/media`, `/media/:id` (файлы с теми же защитными заголовками, что `/files`) | read |
| GET | `/materials` — результаты `waiting_approval` и очередь `pending_approval` | read |
| POST | `/materials/task/:id/approve|reject` | materials:review |
| POST | `/materials/queue/:id/approve` (+ guardrails как в панели) / `reject` | materials:publish / materials:review |
| GET | `/notifications`, `/me` | read |

Мобильный токен **не принимается** нигде, кроме `/api/mobile/*`: generic `/api/:col`, `/api/restore`, `/api/reset`, `/api/backup`, настройки, `/files`, OpenCode approve — 401.
Утверждение OpenCode-кода с телефона невозможно.

## Доступ только через Tailscale
1. Сервер остаётся на `127.0.0.1:8787` (не меняйте `HOST`).
2. На Mac: `tailscale serve --bg --https=443 http://127.0.0.1:8787` → адрес `https://<mac>.<tailnet>.ts.net`.
3. Разрешите имя в Host allowlist: desktop `desktop.json` → `"allowedHosts": ["<mac>.<tailnet>.ts.net"]` (или `STUDIO_ALLOWED_HOSTS`).
4. **Не используйте `tailscale funnel`** (публичный доступ из интернета).
5. На iPhone: Tailscale-приложение → Safari → `https://<mac>.<tailnet>.ts.net/mobile.html` → вставить токен. «На экран Домой» для быстрого доступа.
Токен хранится в localStorage этого origin; при потере телефона — отзовите токен.
