# MOONKATTY AI CONTROL — этап 2: подключение к MOONKATTY AI STUDIO (только чтение)

## 1. Архитектура

```
iPhone 16 Pro (PWA) ──same-origin──► ai-control/server.mjs (127.0.0.1:8697) ──GET allowlist──► Studio (STUDIO_URL, по умолчанию 127.0.0.1:8687 = тест)
```

* Порт **8697**. 8690 занят Node API (TLS) тестовой сборки; также заняты 8787/8687 (Studio prod/test), 8790 (Node API prod),
  8791 (node-agent), 8795 (approval-server / security-тесты), 4096/4097 (OpenCode). Сервер отказывается стартовать на этих портах.
* Слушает только `127.0.0.1`. Нет Tailscale, нет внешнего доступа.
* Прод (8787) — только при явном `AIC_ALLOW_PROD=1`. `STUDIO_URL` — только loopback http, без логина/пароля/пути в URL.
* Режимы: `AIC_MODE=live` (по умолчанию) и `AIC_MODE=demo` (данные этапа 1, офлайн, Studio не вызывается вообще).

## 2. Модель безопасности

| Правило | Как обеспечено |
|---|---|
| Только чтение | Прокси пересылает в Studio только `GET` по allowlist (раздел 3). Любой другой метод → 405, путь вне списка → 403. Query-параметры — только разрешённые ключи. |
| Вход владельца | `POST /aic/login` (только same-origin, Origin/Sec-Fetch-Site проверяются) → прокси вызывает существующий `POST /api/auth/login` Studio. Пароль не сохраняется и не логируется. |
| Сессия | Токен Studio хранится только в памяти прокси. Браузер получает свою cookie `aic_sid`: `HttpOnly; SameSite=Strict; Path=/` (+`Secure` при `AIC_COOKIE_SECURE=1`/https). Idle-таймаут 15 мин (`AIC_IDLE_MIN`), абсолютный 12 ч. `/aic/logout` удаляет сессию в прокси и вызывает logout Studio. |
| Без сессии | любой `/api/*` → 401, PWA показывает экран входа. 401 от Studio гасит сессию прокси. |
| Cookie Studio | `Set-Cookie` от Studio вырезается всегда; наружу уходит только `aic_sid`. |
| Секреты | Ответы чистятся (redaction): `dbPath`, `dataDir`, пути бинарников, логи действий агентов, ключи Update Center. В localStorage/SW/логах нет пароля и токенов (проверено тестом). Лог — только метод, путь без query, статус. |
| Service Worker | `/api/*` и `/aic/*` никогда не кэшируются (network-only). |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none' …` + nosniff, DENY, no-referrer, COOP/CORP. Host-заголовок проверяется (421 при чужом). |
| Управление | Все кнопки записи (одобрить, доработать, пауза, валюта и т.п.) отключены: «Управление — после отдельного разрешения». DEMO-переключатели прототипа в Studio не уходят. |

## 3. Карта эндпоинтов (все существующие, GET)

| Раздел PWA | Эндпоинты Studio |
|---|---|
| Главная / статус Mac mini | `/api/health`, `/api/system`, `/api/runtime` |
| AI-агенты | `/api/agents` (+ занятость из `/api/jobs`) |
| Задачи | `/api/tasks`, `/api/jobs?limit=50` (listJobs) |
| Контент | `/api/queue`, `/api/posts`, `/api/files`, `/api/projects` |
| Аналитика | `/api/world/command-center` (MILLION AUDIENCE, audience) , `/api/channels` |
| Финансы | `/api/world/command-center` (Revenue: confirmed / estimate / accrued / demo) |
| Игры | `/api/world/command-center` (growth-метрики) |
| Новости | `/api/episodes` |
| Соцсети | `/api/channels`, `/api/queue`, `/api/posts` |
| Уведомления | `/api/logs`, `/api/world/approvals` (только чтение) |
| Настройки → устройства/Mac mini | `/api/system`, `/api/ops/nodes` |
| Настройки → обновления | `/api/ops/update-center` (только статус, «gated») |
| Ещё → документы | `/api/reports`, `/api/world/mission` |
| Ещё → резервные копии | `/api/backups` (только количество и последняя) |

Если Studio отвечает 404/503 на разрешённый путь, прокси отдаёт `200 {"__nodata":true}` — раздел показывает «НЕТ ДАННЫХ» без ошибок в консоли.

## 4. Метки данных

| Метка | Значение |
|---|---|
| `CONFIRMED` | значение из Studio, подтверждено (для денег — подтверждённый ledger) |
| `ESTIMATE` | оценка/прогноз Studio |
| `DEMO` | демонстрационные записи (в Studio или режим DEMO) — **никогда** не суммируются с подтверждёнными |
| `NO_DATA` | источника нет или он пуст → «НЕТ ДАННЫХ» |

Финансы показывают три отдельных блока: подтверждено / оценка (+начислено) / DEMO. Деньги — 2 знака, без округления.
В режиме LIVE постоянный бейдж DEMO скрыт, у каждого раздела — своя метка.

## 5. Пробелы («НЕТ ДАННЫХ»)

1. Нагрузка агента (load %) — в `/api/agents` нет.
2. Идеи, эксперименты, план/сценарии/темы новостей — отдельного эндпоинта нет.
3. media-automation read-api (платформы/аналитика/новости внешних площадок) — в Studio нет GET-прокси на него; подключение напрямую означало бы второй источник/порт, поэтому не сделано.
4. studio-intelligence memory — read-only GET в Studio отсутствует.
5. Push-уведомления/настройки уведомлений — нет эндпоинта.
6. Детальная аналитика по дням (ряды для графиков) — command-center отдаёт только агрегаты.
7. Устройства владельца (кроме нод) — нет.

## 6. Предлагаемые read-only расширения Studio (НЕ реализованы)

* `GET /api/agents/:id/load` — загрузка агента (из jobs за N минут).
* `GET /api/world/command-center/series?metric=&days=` — временные ряды для графиков.
* `GET /api/media/read/{platforms,analytics,news}` — серверный прокси Studio к media-automation read-api (с той же сессией).
* `GET /api/intelligence/memory?limit=` — сводка памяти без содержимого секретов.
* `GET /api/ideas`, `GET /api/experiments` — если появятся модули идей/экспериментов.
* `GET /api/notifications/settings` — текущие настройки уведомлений.

Все — только GET, под существующей авторизацией Studio, без новых БД.

## 7. Проверено тестами

DEMO-набор этапа 1 (WebKit + Chromium, профиль iPhone 16 Pro 402×874 @3x, iOS 18 UA) и LIVE-набор (`test/live/run.sh`) против
реальной Studio (тестовая сборка, временный каталог данных, тестовый пароль, изолированная сеть): вход/выход/таймаут, 401, 405/403,
чужой Host/Origin, отсутствие cookie и секретов Studio, все 12 экранов с реальными значениями или «НЕТ ДАННЫХ», метки финансов,
хранилище браузера, SW, CSP, clickable-sweep (запись отключена). Код Studio не менялся.
