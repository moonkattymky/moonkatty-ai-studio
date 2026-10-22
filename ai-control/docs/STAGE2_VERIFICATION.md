# MOONKATTY AI CONTROL — этап 2: верификационный прогон

Дата: 2026-10-22 (Asia/Jerusalem). Базовый коммит: `28e80fc` (feat/ai-control-pwa). Studio: тестовая сборка `d1adf4d`
(`/workspace/aic-studio-d1adf4d`, код не менялся). Все прогоны — через `/workspace/mk-iso.sh` (своя netns + приватный /tmp),
временные БД, тестовый пароль `aic-live-test-only-7c1e9` (не настоящий). Node 22 (`/home/box/node22`), Playwright 1.56.1.
Артефакты: `/workspace/out/ai-control/stage2-verify/` (скрипты `sentinel.mjs`, `verify.sh`, `verify.mjs`, `verify-result.json`,
логи, хэши, скриншоты `screens/`).

## Итог

| # | Пункт | Результат |
|---|---|---|
| 1 | Полные наборы DEMO / LIVE / Studio security / isolation | PASS |
| 2 | Нет регрессий | PASS |
| 3 | Реальные данные из 8687, «НЕТ ДАННЫХ» задокументированы | PASS |
| 4 | 8787 (v1.1.2) не затронут | PASS |
| 5 | DEMO-финансы не попадают в «подтверждено» | PASS (+ новый тест) |
| 6 | Управление заблокировано на сервере | PASS после исправления (+ новый тест, 136 атак) |
| 7 | Секреты, CSP, заголовки, cookie | PASS |
| 8 | iPhone 16 Pro + WebKit | PASS, скриншоты перегенерированы |

## 1. Тесты

| Набор | Проекты | Результат |
|---|---|---|
| DEMO (`test/playwright.config.mjs`) | webkit-iphone16pro + chromium-iphone16pro (402×874 @3x, iOS 18 UA) | **198 passed**, 0 failed, 0 flaky, 0 skipped (4.2 мин) |
| LIVE (`test/live/live.config.mjs`, Studio d1adf4d на 8687 + 8688 seeded, прокси 8697/8698/8699) | webkit + chromium | **124 passed**, 0 failed, 2 skipped (8.9 мин) |
| Studio `npm run test:security` (d1adf4d) | — | **52 passed**, 0 failed |
| Studio `npm run test:isolation` (d1adf4d) | — | **65 passed**, 0 failed (вкл. «production data dir byte-for-byte unchanged») |

Skipped (ожидаемо): `live screenshots` на chromium (скриншоты только WebKit) и новый `bypass` на webkit (чистый HTTP-тест, один раз).

## 2. Регрессии

Предыдущие наборы: DEMO 196 тестов, LIVE 124 теста (123 pass + 1 skip). Сейчас DEMO 196 + 2 новых (`finance-demo.spec.mjs`
× 2 движка) = 198, LIVE 124 + 2 новых (`bypass.live.mjs`, 1 pass + 1 skip) = 126. Все прежние тесты проходят, flaky нет —
3 исправленных ранее теста (анимация 16 Pro, обход `#/notifications/l-x`) стабильны в полном прогоне. Регрессий нет.

## 3. Реальные данные из 8687 (WebKit, iPhone 16 Pro)

Пустая тестовая БД (8687) и seeded (8688: ledger confirmed $125.50 / estimate $40 / accrued $10 / demo $99, задача, эпизод).

| Экран | Пример реальных значений | «НЕТ ДАННЫХ» (empty / seeded) |
|---|---|---|
| 1 Главная | AI-агенты 17 · ПОДТВЕРЖДЕНО; задачи 0 → 1 «на проверке»; выручка $125.50 ПОДТВЕРЖДЕНО (seeded) | 3 / 1 (выручка без ledger, рост) |
| 2 AI-агенты | Director, NEWS, VIDEO, SOCIAL … (17 из `/api/agents`) | 18 / 18 — нагрузка агента (нет эндпоинта) |
| 3 Задачи | «TEST: проверить выпуск», статус «На проверке» (seeded) | 1 / 0 |
| 4 Контент | queue/posts/files пусты в тестовой БД | 1 / 1 |
| 5 Аналитика | подписчики — DEMO (fixture read-api); просмотры/ряды — нет | 11 / 9 |
| 6 Финансы | $125.50 ПОДТВЕРЖДЕНО; оценка $40.00 ОЦЕНКА; начислено $10.00 ОЦЕНКА; DEMO $99.00 DEMO (исключено) | 21 / 14 (7/90 дней, YouTube NEWS/TikTok/X, прогноз) |
| 7 Игры | growth не подключён | 5 / 5 |
| 8 Новости | «TEST выпуск #1» (seeded) | 2 / 2 (план, сценарии/темы) |
| 9 Соцсети | каналы YouTube NEWS и др. из `/api/channels` (connected:false) | 1 / 1 |
| 10 Уведомления | логи Studio: auth · info, backup · info, episodes · info, tasks · info | 0 / 0 |
| 11 Настройки | Профиль igor ПОДТВЕРЖДЕНО, Mac mini (uptime, CPU 30 %, диск), Update Center 1.3.0-test | 0 / 0 |
| 12 Ещё | Документы (`/api/reports`, mission 1.3.0-test), бэкапы count=1 | 0 / 0 |

Сырые ответы прокси (seeded): все 20 allowlisted GET → 200, например `/api/health` `{"ok":true,"flavor":"test",…}`,
`/api/backups` `{"count":1,"latest":"backup-…json"}`, `/api/ops/update-center` `{"current":"1.3.0-test","flavor":"test",…}`.
Пробелы и причины — см. STAGE2_INTEGRATION.md §5.

## 4. 8787 (v1.1.2) не затронут

* Конфигурация по умолчанию: `GET /aic/config` без `STUDIO_URL` → `{"mode":"live","studio":{"port":8687,"prod":false}}`.
* `STUDIO_URL=http://127.0.0.1:8787` без `AIC_ALLOW_PROD=1` → сервер не стартует (exit 1, «STUDIO_URL points to PRODUCTION»).
  В коде 8787 встречается только в этой проверке, в списке запрещённых портов и в комментариях.
* Сентинел-сервер на 127.0.0.1:8787 внутри netns во время DEMO, LIVE и verify-прогонов: **0 соединений, 0 запросов**.
* `/workspace/moonkatty-ai-studio/data` (studio.db, secret.key, app-token, backups/): sha256 манифеста
  `22da45549f9cf7df7cffab9d345d85e8a112bea7e27a6836610facde7c7a657c` до (09:11) и после всех прогонов — **идентичен**
  (studio.db `12cd601e…b384`). main, v1.1.2 и установка v1.3.0-test не трогались.

## 5. DEMO-финансы ≠ подтверждено

Код: в DEMO-режиме `demo()` рисует только чип «DEMO», `tagChip('CONFIRMED')` вызывается только при `isLive()`; в LIVE
«подтверждено» берётся из `command-center.revenue.{day,month,year}` и `platforms[].revenue`, которые Studio считает через
`revenue.isCash()` (`kind=income && state=confirmed && payout_id && !demo`). DEMO-строки ledger идут только в отдельный блок
`finance.demo` с меткой DEMO; модуль `demo-data.js` в LIVE не подмешивается (кроме статичных названий разделов игр).
Тесты: новый `test/finance-demo.spec.mjs` (DEMO: финансы, главная, аналитика, 5 карточек источников, профиль, все периоды ×
все валюты — 0 элементов `[data-tag=CONFIRMED]`, нет текста «ПОДТВЕРЖДЕНО/Подтверждённая выручка») + существующий LIVE-тест
seeded: $40/$10/$99 никогда не рядом с CONFIRMED.

## 6. Управление заблокировано на сервере

Новый `test/live/bypass.live.mjs`: фейковая Studio-регистратор (8686) за отдельным прокси (8696), сырые HTTP-запросы с
**валидной** сессией. 136 атак: POST/PUT/PATCH/DELETE/OPTIONS/TRACE/HEAD/PROPFIND × 9 путей → 405; X-HTTP-Method-Override /
X-HTTP-Method / X-Method-Override и `_method=` → 405 (для записи) или обычный GET без этих заголовков; traversal
(`/../`, `%2e%2e`, `%2f`, `;`, `%00`, `\`), двойные слэши (`//api/…`, `/api//…`), регистр (`/API/`, `/Api/`, `/api/HEALTH`),
absolute-form (`http://127.0.0.1:8787/api/backup`) → 403 (битые %-последовательности → 400). Регистратор увидел только
`POST /api/auth/login` и `GET /api/health`, `/api/tasks`, `/api/jobs?limit=5`, `/api/agents` — без override-заголовков и
чужих query-ключей. Плюс прежний LIVE-тест 405/403/421/CSRF против настоящей Studio.

**Исправление (server.mjs):** раньше `//api/…`, `/api/%2e%2e/…`, `/API/…`, `/api/%68ealth` давали 404 из статической ветки
или нормализовывались молча (до Studio не доходили, но ответ не был 403), а битый `%` давал 500. Теперь: только origin-form
путь (не `//`, без `\`), неканонический путь (dot-segments) → 403, %-escape и регистр в `/api`,`/aic` → 403, битый escape → 400.

## 7. Секреты и заголовки

* Бандл `dist/` (49 файлов): нет тестового пароля, `mk_session`, токенов, ключей, Keychain; совпадения «password» — только
  подписи формы входа (`name="password"`, i18n).
* После входа и обхода 12 экранов (WebKit): localStorage `{}`, sessionStorage `{}`, IndexedDB — нет баз, `document.cookie` пуст
  (cookie HttpOnly), SW-кэш `aic-static-…` — 49 статических файлов, `/api` и `/aic` не кэшируются.
* Ответы 20 эндпоинтов: нет пароля, токена, `passwordHash`, `dbPath`, `dataDir`, ключей; `Set-Cookie` Studio не пробрасывается,
  `Cache-Control: no-store`.
* Cookie: `aic_sid=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, `Secure` добавляется при `AIC_COOKIE_SECURE=1`.
* Заголовки: CSP `default-src 'self'; script-src 'self'; style-src 'self'; … object-src 'none'; base-uri 'none'; form-action 'none';
  frame-ancestors 'none'`, nosniff, X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy, COOP/CORP same-origin.

## 8. iPhone 16 Pro + Safari (WebKit)

Скриншоты (1206×2622): `/workspace/out/ai-control/stage2-verify/screens/` — `00-login.png`, `01…12-*.png` (пустая БД),
`seeded-01…12-*.png`. Для логина и всех 12 экранов: портрет 402×874@3, `scrollWidth = 402` (нет горизонтального скролла),
ни одна кнопка/ссылка/заголовок не пересекает Dynamic Island (126×37 @ top 11), заголовки начинаются с y=84 (ниже safe-area 62),
таб-бар 93 px прижат к низу (включая home-indicator 34). Главная — hero-изображение под статус-баром, как в дизайне.
Примечание: ошибки CSP «Refused to apply a stylesheet» в verify-скрипте — это стиль, который вставляет `page.screenshot()`
Playwright; наборы с guard() (без скриншотов) фиксируют 0 ошибок консоли/CSP.

## Исправления в этом прогоне

1. `ai-control/server.mjs` — ужесточение request-target (см. §6).
2. Новые тесты: `test/finance-demo.spec.mjs`, `test/live/bypass.live.mjs`.
