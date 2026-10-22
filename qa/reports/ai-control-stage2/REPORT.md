# AI CONTROL, этап 2: независимый аудит

Итог: **PASS**. Блокирующих дефектов нет.

Проверен коммит `538e80fd6a33663c977e199d0fe45f9f6e31ee9c` ветки `feat/ai-control-pwa` (родитель `28e80fc`). Код прокси и PWA лежит в `ai-control/`. Эта ветка, `main`, v1.1.2 и код v1.3.0-test не менялись. Слияния и публикации нет.

Студия за прокси: `d1adf4d86d09384d2cc322920d360eb87797c1de`, тестовый flavor, временные каталоги данных. Прокси по умолчанию смотрит на `http://127.0.0.1:8687` и слушает `127.0.0.1:8697`. Отчёт разработчика: `ai-control/docs/STAGE2_VERIFICATION.md`.

На `127.0.0.1:8787` всё время аудита стоял свой сентинел. Он отвечал 599 и записывал каждый запрос. До явной проверки флага соединений не было. После двух намеренных входов с `AIC_ALLOW_PROD=1` в журнале ровно два `POST /api/auth/login`. Набор LIVE и остальные атаки эту цифру не увеличили.

## Пункты

| Пункт | Статус | Доказательство |
| --- | --- | --- |
| DEMO, набор разработчика | PASS | Полный прогон 195 прошло, 3 таймаута при параллельной нагрузке на ВМ. Повтор этих трёх в WebKit: 3/0. Вместе 198/0. |
| LIVE, набор разработчика | PASS | 124 прошло, 0 отказов, 2 пропуска. Пропуски: bypass на WebKit (HTTP-тест один раз, на Chromium) и скриншоты на Chromium. |
| Обход записи у разработчика | PASS | В логе LIVE: 136 атак, регистратор видел только login и четыре allowlist GET. |
| Studio `test:security` на d1adf4d | PASS | 52/0. |
| Studio `test:isolation` на d1adf4d | PASS | 65/0, включая неизменность производственной папки данных. |
| Запись блокируется на сервере | PASS | Свой сырой HTTP: 398 запросов. Чужие методы, override, traversal, кодирование, Host и CSRF до Studio не доходят. |
| 8787 без флага | PASS | Старт с `STUDIO_URL` на 8787 завершается с кодом 1, пока `AIC_ALLOW_PROD` не равен строке `1`. |
| Редирект, Host, DNS | PASS | 302 на 8787 не выполняется. Чужой Host даёт 421. Имена не из loopback-списка процесс не запускают. |
| DEMO не входит в подтверждённую выручку | PASS | Кэш $125.50 с чипом ПОДТВЕРЖДЕНО. $40.00 и $10.00 с чипом ОЦЕНКА. `DEMO $99.00` и `DEMO USD 12.50` только с чипом DEMO. |
| Секреты в бандле, SW, storage, cookie | PASS | 49 файлов dist. Пароля и `mk_session` нет. SW-кэш из 49 статических файлов, `/api` и `/aic` не кэшируются. |
| CSP и флаги cookie | PASS | CSP без `unsafe-inline` и `unsafe-eval`. Cookie: HttpOnly, SameSite=Strict. Secure появляется при `AIC_COOKIE_SECURE=1`. |
| iPhone 16 Pro, Playwright WebKit 402×874 | PASS | 12 экранов, 1206×2622. Ширина 402, горизонтального скролла нет, заголовок y=84, таб-бар 93 px у низа 874. |
| Физический iPhone | NOT TESTED | В этой среде нет телефона. Safe area в WebKit задаётся классом `preview-safe` (62/34), потому что Playwright не выставляет `env(safe-area-inset-*)`. |
| Живая v1.1.2 на 8787 | NOT TESTED | На порту был сентинел, не процесс владельца. Код v1.1.2 и его данные не открывались. |

## Наборы

DEMO (`test/playwright.config.mjs`, `AIC_MODE=demo`, WebKit и Chromium, 402×874 @3): первый полный прогон шёл одновременно с атаками и дал три таймаута по 240 с. Это `approve / rework` (тост «Отменить» не успел стать стабильным), переход на `#/games` и `#/games/players`. Повтор только этих трёх в WebKit: 3/0 за 11.5 с. Остальные 195 в том прогоне прошли. Заявку 198/0 этот повтор подтверждает.

LIVE (`test/live/live.config.mjs`, `STUDIO_DIR` указывает на worktree `d1adf4d`): 124/0 и 2 пропуска, 8.9 мин. Bypass разработчика: `[bypass] 136 attack requests`, регистратор увидел `POST /api/auth/login`, `GET /api/health`, `GET /api/tasks`, `GET /api/jobs?limit=5`, `GET /api/agents`.

`npm run test:security` и `npm run test:isolation` запускались в каталоге `d1adf4d`. Lockfile совпадает с уже собранным `node_modules`. Исходники студии не правились.

## Запись

Прокси пропускает к Studio только GET из allowlist. Единственные исходящие POST: `/api/auth/login` и `/api/auth/logout`. Пароль в ответе клиенту не возвращается, `mk_session` остаётся в памяти прокси.

Свой клиент слал сырые байты запроса, без нормализации URL библиотекой. Методы POST, PUT, PATCH, DELETE, OPTIONS, TRACE, HEAD, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK, SEARCH, QUERY, PURGE, LINK, UNLINK по 17 путям (`/api/tasks`, approve, start, import, install, backups, users, login, logout, queue, posts, comments, health, approvals, enroll) получили 405. Регистратор эти запросы не видел.

`X-HTTP-Method-Override`, `X-HTTP-Method`, `X-Method-Override` и `_method` в теле или query не превращают запись в GET и не уходят наверх. На allowlist GET чужие query-ключи отбрасываются: на Studio ушёл `/api/jobs?limit=5&status=done`, без `next` и `_method`.

Обходы пути (`/../`, `%2e%2e`, `%2f`, `%00`, `//api`, `/API/`, `/api/HEALTH`, `/api/%68ealth`, absolute-form `http://127.0.0.1:8787/api/backup`) дают 403 или 400. Битый `%` даёт 400. Регистратор их не видел.

CSRF на `/aic/login` и `/aic/logout`: нет `X-AIC-Request`, Origin `https://evil.example`, Origin `null`, `Sec-Fetch-Site: cross-site` и `same-site` отвечают 403. Studio при этом login не получала.

Метод `FOO` и строчное `get` обрываются разбором Node с 400, `CONNECT` закрывает сокет без ответа приложения. `/%2fapi/health` тоже закрывается парсером. До фейковой Studio эти байты не дошли. Смешение `Content-Length` и `Transfer-Encoding` ответ приложения не открыло.

Ответ фейковой Studio с полями `password`, `token`, `apiKey`, `dbPath` после прокси этих полей не содержит. `Set-Cookie` Studio наружу не копируется.

В DEMO кнопка «утвердить» пишет только `localStorage` ключ `aic.state.v1` и подписана DEMO. В LIVE те же кнопки disabled и сеть не вызывают. Клиентский `fetch` с методом POST есть только у `/aic/login` и `/aic/logout`.

## 8787 и флаг

`GET /aic/config` без `STUDIO_URL` возвращает `studio.port` 8687 и `prod: false`.

`STUDIO_URL=http://127.0.0.1:8787` без флага, с пустым флагом и со значениями `0`, `true`, `yes`, `YES`, `01`, пробел вокруг `1` и `1` с переводом строки: процесс сразу выходит с кодом 1, текст «STUDIO_URL points to PRODUCTION». То же для `localhost:8787` и `[::1]:8787`.

Флаг открывает шлюз только при точном `AIC_ALLOW_PROD=1`. Тогда config показывает `prod: true`, и один `POST /aic/login` доходит до 8787. Это зафиксировал сентинел. Без этого флага за весь прогон LIVE и все обходы сентинел молчал.

На старте отвергаются `127.1`, десятичный и hex-адрес, `127.0.0.1.nip.io`, userinfo, путь в URL, `https`, чужой хост, `0.0.0.0`, IPv4-mapped IPv6 и `file:`. Строка `http://127.0.0.1:8687?` принимается: у неё пустой query и тот же loopback-origin, это не адрес 8787.

Фейковая Studio на GET `/api/agents` ответила 302 с `Location: http://127.0.0.1:8787/api/health`. Прокси вернул 502 и Location клиенту не отдал. `fetch` вызывается с `redirect: manual`. Сентинел не вырос. Заголовок `Host: 127.0.0.1:8787` на порту прокси даёт 421 до любого исходящего запроса. `X-Forwarded-Host`, `Forwarded`, `X-Original-URL` и `X-Rewrite-URL` на upstream не копируются.

## Финансы

Временная тестовая база, импорт четырёх строк: confirmed $125.50, estimate $40.00, accrued $10.00, demo $99.00 со статусом confirmed и `demo: true`. Импорт шёл прямо в Studio. Чтение шло только через прокси.

`GET /api/world/command-center`: day, month и year равны 125.5. Оценка месяца 40, начислено 10. Блок demo: метка `DEMO $99.00`, `excludedFromActual: true`. Сумма `platforms[].revenue` равна 125.5. `viewsAreRevenue` равен false. Семь площадок read-api помечены mock.

WebKit после входа, экран «Финансы», текст страницы:

- «Подтверждённая выручка (кэш)» `$125.50` и чип `ПОДТВЕРЖДЕНО`
- «Не подтверждено (оценка)» `$40.00` и чип `ОЦЕНКА`
- «Начислено, не кэш» `$10.00` и чип `ОЦЕНКА`
- «DEMO (исключено из факта)» `DEMO $99.00` и чип `DEMO`
- YouTube main `$125.50` с чипом `ПОДТВЕРЖДЕНО`. Площадка X, куда легла demo-строка, показывает «НЕТ ДАННЫХ»
- «Площадки read-api»: `DEMO USD 12.50` с чипом `DEMO`

Рядом с чипом `ПОДТВЕРЖДЕНО` нет ни 99, ни 12.50.

## Секреты, CSP, cookie

В `dist/` 49 файлов. Шаблоны `mk_session`, `passwordHash`, приватный ключ, `apiKey`, `secret.key` не найдены. Слово password есть в подписи поля входа, строках i18n и аргументе `login()`. Пароль из поля стирается сразу после вызова и в storage не пишется.

После входа и обхода 12 экранов в WebKit: `localStorage` пуст, `sessionStorage` пуст, баз IndexedDB нет, `document.cookie` пуст. Кэш service worker `aic-static-…` содержит 49 файлов. Путей `/api` и `/aic` в кэше нет. `localStorage` заполняется только после действия пользователя (язык, переключатели) ключом `aic.state.v1`. Сессии Studio там нет.

Cookie по умолчанию: `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`. Флага Secure нет, пока не задан `AIC_COOKIE_SECURE=1`. С этим флагом в `Set-Cookie` есть Secure, HttpOnly и SameSite=Strict. Привязка сервера остаётся `http://127.0.0.1`, поэтому Secure по умолчанию выключен: иначе браузер не сохранил бы cookie.

Заголовки страницы: CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Дальше `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy без камеры, микрофона, геолокации и оплаты, COOP и CORP `same-origin`, `X-Robots-Tag: noindex, nofollow`. `Access-Control-Allow-Origin` нет.

## Экран 402×874

Playwright WebKit, viewport 402×874, deviceScaleFactor 3, iOS 18 UA. Снимки 1206×2622 лежат в `logs/`. На экранах кроме первого замера: `scrollWidth` 402, вылезающих элементов 0, верх заголовка 84 px (ниже зоны Dynamic Island при эмуляции 62 px), таб-бар высотой 93 px, нижний край 874. Набор разработчика с той же проверкой на повторе прошёл.

Снимки: `logs/live-home.png`, `logs/live-agents.png`, `logs/live-tasks.png`, `logs/live-content.png`, `logs/live-analytics.png`, `logs/live-finance.png`, `logs/live-games.png`, `logs/live-news.png`, `logs/live-social.png`, `logs/live-notifications.png`, `logs/live-settings.png`, `logs/live-more.png`.

Физический iPhone 16 Pro в руки не брался. Это NOT TESTED, не дефект вёрстки в WebKit.

## Что не мешает PASS

Первые три таймаута DEMO не повторились отдельно. Это нагрузка ВМ, не отказ продукта.

Неизвестный HTTP-метод режет уже парсер Node, ответом 400, до обработчика прокси. Запрос при этом не уходит в Studio.

`AIC_ALLOW_PROD=1` специально разрешает 8787. Без этой точной строки прокси к порту не подключается.
