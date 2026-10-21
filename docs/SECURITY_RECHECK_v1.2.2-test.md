# Повторная проверка безопасности v1.2.2-test (Studio 4: блокеры перед тестом)

Дата: 2026-10-21. Базовый коммит: `f2440e1`. Проверено на Linux x64, Node v22.23.3, Blender 5.2.2, opencode-ai (npm). Все учётные данные в тестах поддельные.

## 1. `published` ставит только внутренний модуль публикации
- Метод `sealPublication(item, {platform, responseId}, caller)` определён в `server.js` и передаётся **только** в `meta.js` (через `ctx`). Модуль вызывает его лишь после проверенного ответа Graph API: в ответе должен быть ID, иначе ошибка.
- Проверяется право вызывающего: `caller === 'meta-publisher'`. Проверяется формат ID: facebook `^\d{5,32}(_\d{5,32})?$`, instagram `^\d{5,32}$`.
- Сохраняется происхождение публикации `publication = {platform, responseId, at, callerModule, seal}`. `seal` — это HMAC-SHA256 по ключу из таблицы `meta` (ключ наружу не отдаётся).
- Единая точка контроля: `put('queue', …)` отклоняет любой элемент со статусом `published`, `externalId` или `publication` без действительной печати. Записи, опубликованные до v1.2.2 без печати, остаются как есть только при неизменном `externalId`.
- HTTP: PUT с `status:"published"`, с `externalId` или с `publication` отклоняется с кодом **403 `published_internal_only`** во всех сборках. POST всегда создаёт элемент в статусе `pending_approval`. Поля `externalId`, `publishedAt`, `publication` и `historical_*` защищены (PROTECTED).

## 2. Восстановление из резервной копии
- Каждый восстановленный элемент очереди получает статус `pending_approval`. Прежние `status`, `externalId` и `publishedAt` сохраняются в `historical_status`, `historical_externalId` и `historical_publishedAt` **только для аудита**: через CRUD их не записать, публиковать на их основании нельзя.
- Поддельные `externalId`, `publication` (в том числе с поддельной печатью) и `nextRetryAt` удаляются. В историю элемента добавляется событие `restored_pending_approval`.

## 3. Режим TEST вшит при сборке
- Упаковщик требует явный `FLAVOR=test|prod`, значения по умолчанию нет: без него выход с кодом 2. Он генерирует `lib/flavor.baked.js` (константа, попадает в app.asar) и пишет `studioFlavor` в упакованный `package.json`.
- `lib/studio-config.js`: если есть вшитая константа, никакие переменные окружения (`STUDIO_FLAVOR`, `NODE_ENV`, `MK_FLAVOR`, `FLAVOR`), настройки (`desktop.json`) и аргументы командной строки не учитываются. Неверная константа даёт `null`, и сервер не запускается.
- `server.js` без вшитой сборки и без `STUDIO_FLAVOR` (в исходниках `STUDIO_FLAVOR` учитывается только при `NODE_ENV=test`) **отказывается запускаться** с кодом 78 и сообщением «сборка не определена». Для разработки есть `npm run start:dev`. `npm run dist:mac` теперь отказывает и отсылает к скриптам упаковки.

## 4. TEST: публикация полностью отключена
- `meta.js` (модуль публикации, Graph API, планировщик, маршруты `/api/meta/*`) в TEST-сборке **не загружается**. Мастер-ключ при этом создаётся в Keychain `MOONKATTY AI STUDIO.test`.
- `lib/egress.js`: в TEST из белого списка исключены все соцсети (`graph.facebook.com`, `graph.instagram.com`, `api.telegram.org`). Остаются `api.github.com`, `ollama.com` и `registry.ollama.ai`.
- `/api/queue/:id/publish` и `/api/comments/:id/reply` возвращают 403 `publishing_disabled`.

## 5. Изоляция (повторно)
Bundle ID `com.moonkatty.aistudio.test`, Keychain `MOONKATTY AI STUDIO.test`, данные `~/Library/Application Support/MOONKATTY AI STUDIO TEST/`, порты 8687/4097, launchd `com.moonkatty.aistudio.test.server`. Проверяется в `test:isolation` и `test:e2e-test-build`, а после сборки также по Info.plist и release-manifest.json.

## 6. Результаты тестов (до сборки)
| Набор | Результат |
|---|---|
| test:security | 52/52 PASS |
| test:runner | 5/5 PASS |
| test:opencode | 51/51 PASS |
| test:policy | 46/46 PASS |
| test:video | 45/45 PASS |
| test:publish-guard (новый) | 38/38 PASS (проверки бандла пропущены без dist; запускаются после сборки) |
| test:isolation | 64/64 PASS |
| test:3d (Blender 5.2.2 + OpenCode) | 53/53 PASS |
| test:3c | 61/61 PASS |
| test:e2e-test-build | 11/11 PASS |
| **Итого** | **426/426 PASS, 0 FAIL** |

## Не проверено
- Реальная публикация в Facebook/Instagram с печатью (нужны настоящие токены и страница). Проверены отказы и статический путь `meta.js` → `sealPublication`.
- Запуск на macOS/Apple Silicon: Gatekeeper, настоящий Keychain, launchd. Это проверяется на Mac mini по `docs/MAC_TEST_ISOLATED.md`.
- Электрон в режиме разработки (без упаковки) теперь не определяет сборку и не запустит сервер. Так и задумано (fail-closed).
