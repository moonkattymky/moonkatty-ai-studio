# Аудит OpenCode и 3D Studio, ab97d37

Независимая проверка PR https://github.com/moonkattymky/moonkatty-ai-studio/pull/6. Ветка `fix/opencode-3d-v130`, коммит `ab97d371b462bcf00445857599870e440de90472` (2026-10-21 23:07:15 +0000). Родитель — `d1adf4d86d09384d2cc322920d360eb87797c1de`. `git merge-base --is-ancestor d1adf4d ab97d37` истинен. Diff против `d1adf4d`: 19 файлов, +515/−57. Продуктовые деревья были отсоединёнными checkout. Ветка `fix/opencode-3d-v130` и `main` не менялись. Слияния и публикации не было. Пароли только тестовые. В отчёт и в журналы ниже значения паролей не копировались. `ownerApproval` никому не ставился.

Хост: Linux, Node v22.23.3. OpenCode 1.19.3. Blender 4.2.9 LTS. `STUDIO_SQLITE=node`. `STUDIO_FLAVOR` задавали только сами скрипты. Флаги автообновления были сняты.

## Вердикт

**PASS.** Блокирующих дефектов в `ab97d37` нет.

Заявленный SHA-256 архива `MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip` совпал с независимой пересборкой:

`72c5440dd0a993610323c204a1ae5cdac13b5ada3026133dbcac17cfe045be7e`

## Пункты

| Пункт | Вердикт |
| --- | --- |
| Секрет отсутствует в журналах, argv, ответах HTTP и файлах данных студии | PASS |
| OpenCode не стартует без пароля | PASS |
| Запуск не занимает порт 4096 и не убивает чужой PID | PASS |
| Проверка по адресу по умолчанию ходит на 127.0.0.1:4097 | PASS |
| Изоляция: порт 8687, `com.moonkatty.aistudio.test`, Keychain `MOONKATTY AI STUDIO.test`, учётная запись `opencode-server-password` | PASS |
| На 8787 этот прогон ничего не слушал | PASS |
| CSRF, чужой Origin, Origin `null`, Sec-Fetch-Site `cross-site` | PASS |
| Вызов запуска без сессии | PASS |
| Подмена порта и команды в теле запуска | PASS |
| Обход пути в id проекта и в имени файла сцены | PASS |
| Запасной путь не подменяет 401, отказ политики и завершённый запрещённый инструмент | PASS |
| Подпись запасного пути честная | PASS |
| Модель по умолчанию `ollama/qwen3:8b` | PASS |
| Кнопка «Проверить» вызывает реальный `POST /api/opencode/test` | PASS |
| Кнопка «Запустить OpenCode» есть только в тестовой сборке | PASS |
| Независимый SHA-256 zip | PASS |
| Регрессия относительно `d1adf4d` | PASS |
| `npm run test:ops:studio` | FAIL, тот же `QA-NODE-005`, что на `d1adf4d` |
| Запуск `.app` на macOS Apple Silicon | BLOCKED, прогон на linux/x64 |
| Живая модель Ollama | MOCK, как в прогоне world на `d1adf4d` |

## Запуск и секрет

`POST /api/opencode/serve` стоит после проверки CSRF и после проверки сессии. Тело запроса (`url`, `pid`, `command`) обработчик не читает: берётся сохранённый URL интеграции и имя пользователя.

Независимый прогон, 39 проверок, 0 отказов (`logs/attack.out`):

- POST без заголовка `X-Studio-Request` получает 403 `CSRF check failed` до обработчика.
- POST с этим заголовком и без сессии получает 401 `auth required`.
- GET без сессии получает 401 `auth required`.
- Чужой `Origin`, `Origin: null` и `Sec-Fetch-Site: cross-site` получают 403.
- Без пароля в Keychain ответ 409, процесс не создаётся, слушатель на 4096 получает 0 соединений.
- Сохранённый URL `http://127.0.0.1:4096` даёт 400 «Отказ: этот порт принадлежит рабочему OpenCode. Тестовая сборка его не запускает и не проверяет.» Процесс не создаётся, соединений с 4096 нет.
- Имя `opencode;touch /tmp/oc3d-pwn` отклоняется с 400. Файл не появляется.
- Путь с `$(touch …)` сохраняется как `http://127.0.0.1:4097/$(touch%20/tmp/oc3d-pwn)`. Файл не появляется. argv остаётся `serve --hostname 127.0.0.1 --port 4097`.
- Пароль есть только в окружении дочернего процесса (`pwSet` истина, `leaked` ложь). В argv, в ответе запуска, в stdout/stderr сервера, в файлах каталога данных и в argv поддельного `security` пароля нет.
- Чужой `sleep` и чужой HTTP-слушатель доживают до конца прогона.
- Сборка с `STUDIO_FLAVOR=prod` на отдельном порту отвечает 403 «Запуск OpenCode из приложения есть только в тестовой сборке. Рабочий порт не используется.»

Их `npm run test:opencode-serve`: 21/0. Скрипт `opencode/serve-test.sh` вызывает абсолютный `/usr/bin/security`, порт в скрипте 4097, при упоминании 4096 выходит с отказом и пароль в вывод не печатает. Без пароля процесс не стартует.

Идентичность тестовой сборки: flavor `test`, `appId` `com.moonkatty.aistudio.test`, порт 8687, Keychain `MOONKATTY AI STUDIO.test`, account `opencode-server-password`, OpenCode `http://127.0.0.1:4097`, модель `ollama/qwen3:8b`. Рабочие константы на месте: порт 8787, OpenCode `http://127.0.0.1:4096`, Keychain `MOONKATTY AI STUDIO`. `opencode/opencode-studio.json`: `model` и `small_model` равны `ollama/qwen3:8b`. `npm run test:isolation`: 65/0, в том числе отсутствие литералов рабочего порта и рабочего имени вне `studio-config.js`.

Кнопка `#s3ref` «Проверить» делает `POST /api/opencode/test`, затем `GET /api/studio3d/status?refresh=1`. Кнопка `#s3ocstart` «Запустить OpenCode» рисуется, когда `serve.allowed` истина, и вызывает `POST /api/opencode/serve`.

### Сохранённый URL 4096

Запуск и проверка по адресу по умолчанию порт 4096 не открывают. Если аутентифицированный владелец сохранит URL `http://127.0.0.1:4096`, уже существующий `POST /api/opencode/test` откроет туда соединение и отправит Basic с паролем тестовой связки. В прогоне это один хит и ответ 200 от подставного слушателя. Новый запускатель такой URL отвергает и соединение не открывает. Свежая тестовая база при старте переписывает сохранённый рабочий URL на тестовый (`test_oc_url`). Это наблюдение про поле URL, которое и раньше принимало loopback с любым портом. Блокирующим дефектом `ab97d37` оно не является: путь запуска и путь проверки по умолчанию остаются на 4097.

## Запасной путь scene_params.json

`lib/executors/design3d.js` пишет запасной файл только для кодов `refused`, `timeout` и `network`. Перед записью снова проверяет лишние файлы агента и схему. `paramsBy` заканчивается на `+fallback`. Событие содержит «Агент OpenCode не записал scene_params.json» и «запасной путь». В панели строка `paramsBy` с суффиксом `+fallback` показывается как «запасной путь (проверенные параметры студии)».

Независимые задания:

- Закрытый порт: статус `waiting_approval`, `paramsBy` `rules+fallback`, на месте `scene.blend` и PNG, в тексте события обе честные фразы.
- Политика с `bash`/`edit`/`webfetch` в `allow`: статус `blocked`, текст начинается с «Конфигурация OpenCode server не соответствует политике студии», файла сцены нет.
- Завершённый инструмент `write`: статус `failed`, «Агент OpenCode выполнил запрещённый инструмент (write:completed) — задание остановлено», файла сцены нет.
- HTTP 403 на `/global/health`: статус `failed`, «OpenCode HTTP 403», запасного файла нет.
- HTTP 401: статус `blocked`, «неверный логин или пароль (HTTP 401)», запасного файла нет.

Их набор подтверждает то же: 401 остаётся блокировкой, два неверных JSON дают ровно два запроса и затем честный запасной путь, журнал студии пароль не содержит.

`npm run test:3d`: 54/0. `npm run test:3c`: 61/0. `npm run test:opencode-json`: 22/0. `npm run test:e2e-test-build`: 11/0. Сквозной прогон поднял тестовую студию на 8687 и настоящий `opencode serve` на 4097 с Basic из тестовой связки, прошёл панель 3D Studio, сохранил `.blend` с подписью `BLENDER` и PNG, сверил SHA-256 артефактов. Снимок панели: `logs/e2e.png`. На `d1adf4d` эти четыре команды были NOT TESTED.

## Регрессия против d1adf4d

Те же команды, что в `qa/reports/final-v1.3.0-test-r3/REPORT.md`. Числа `d1adf4d` взяты оттуда.

| Команда | d1adf4d | ab97d37 |
| --- | --- | --- |
| test:security | 52 / 0 | 52 / 0 |
| test:runner | 5 / 0 | 5 / 0 |
| test:opencode | 51 / 0 | 51 / 0 |
| test:policy | 46 / 0 | 46 / 0 |
| test:video | 45 / 0 и wiring 8 / 0 | 45 / 0 и wiring 8 / 0 |
| test:publish-guard | 73 / 0 | 73 / 0 |
| test:isolation | 65 / 0 | 65 / 0 |
| test:nodes | 52 / 0 | 52 / 0 |
| test:ops | 119 / 0 | 119 / 0 |
| Сумма того же набора | 516 / 0 | 516 / 0 |
| test:update-center | 79 / 0 внутри ops | 79 / 0 |
| test:world | 62 / 0, один BLOCKED, один MOCK | 62 / 0, один BLOCKED, один MOCK |
| test:opencode-serve | команды не было | 21 / 0 |
| test:opencode-json | NOT TESTED | 22 / 0 |
| test:3d | NOT TESTED | 54 / 0 |
| test:3c | NOT TESTED | 61 / 0 |
| test:e2e-test-build | NOT TESTED | 11 / 0 |

`test:publish-guard` шёл в дереве сборки после zip, вместе с проверками бандла. `test:update-center` — те же четыре файла, которые уже входят в 119 у `test:ops`; отдельный прогон дал 79 / 0. Копия `qa/reports/world-class-v1.3.0/results.json` в продуктовом дереве после world возвращена. Оба продуктовых дерева по отслеживаемым файлам чистые.

### Тот же известный отказ

`npm run test:ops:studio`: 0 пройдено, 1 отказ, 1 отменён. `TypeError: Cannot read properties of undefined (reading 'info')` в `test/ops/nodes.multiprocess.test.js:24`. Второй тест отменён на 90000 мс. Это `QA-NODE-005`. Файл вне diff `ab97d37`. На `d1adf4d` картина та же. Блокирующим дефектом этого PR отказ не является.

## Архив

Пересборка: `FLAVOR=test scripts/package-mac-on-linux.sh` в отсоединённом дереве `ab97d37`. `SOURCE_DATE_EPOCH` 1792624035. Electron 44.9.1, electron-builder 26.15.3, вложенный Node v24.22.0. Подпись ad-hoc, нотаризации нет. `WasmTrapHandlers` включён. `logs/BUILD-INFO.txt` называет коммит `ab97d371b462bcf00445857599870e440de90472`, flavor `test`, bundle id `com.moonkatty.aistudio.test`. `sha256sum` совпал с заявленным и со строкой в `BUILD-INFO.txt`. Упаковщик отслеживаемые файлы дерева сборки не изменил.

## Реестр

Новых записей нет. `ownerApproval` остаётся ложью. `QA-NODE-005` остаётся открытым.
