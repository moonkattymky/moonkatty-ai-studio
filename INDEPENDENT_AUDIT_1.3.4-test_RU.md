# Независимый аудит 1.3.4-test

Аудитор не является автором кода этой ветки. Код продукта не менялся. В ветку `cursor/handover-v1334-test-fb63` ничего не отправлялось. `main` не изменялся.

- Объект: черновик PR https://github.com/moonkattymky/moonkatty-ai-studio/pull/10
- Ветка кода: `cursor/handover-v1334-test-fb63`, HEAD на момент проверки `d2abd8a0cdd8e5f5b52a574fe5226419acd94325`
- База линии: `fix/v1.3.3-news-video` = `5013621`
- Версия в `package.json`: `1.3.4-test`
- Отчёт автора: `HANDOVER_REPORT_2026-10-23_RU.md` (самопроверка, не независимый аудит)
- Среда: Linux, не Mac. Статус **VERIFIED ON DEVICE не ставится**.
- `main`: `e87bd32f904faf676e8316fbf38ef8805727c7fc`. Тег `v1.1.2-mac-preview`: `3f9bd9038a3245a362b355565c4ba2a860c6ba3c`. Оба не сдвигались.

Прогон тестов продукта: `/tmp/qa-logs/*.txt`, коды выхода `/tmp/qa-logs/*.exit`. Отдельный зонд обхода: `node /tmp/qa-probe.mjs` (файл зонда вне репозитория).

## Итоговый вердикт: PASS WITH ISSUES

Проверенные контуры новостей, субтитров, утверждений, публикации, обновлений и голоса ведут себя так, как заявлено. Архив с `a3b2117` совпал с заявленным SHA-256 байт в байт. Оба старых FAIL Studio 4 на `5013621` (жёсткая версия в тестах) закрыты. Есть один дефект средней тяжести: System Doctor запускает бинарник Blender вне гейта 3D, из‑за этого `scripts/design3d-disabled-test.mjs` завершается с кодом 1. Утверждение отчёта «оба набора прошли» для этого скрипта неверно. Проверка на Mac не выполнялась.

## Дефекты

### Средняя

1. **Spawn Blender вне гейта 3D.** `lib/ops/doctor/checks/blender.js` (`runBlender`, строка 26) вызывает `spawn(bin, …)` и не проходит через `DESIGN3D_ENABLED`. Комментарий в файле прямо говорит, что гейт студии остаётся закрытым, а диагностика бьёт в бинарник сама. `checks/index.js` `full()` вызывает `blender.check()`. HTTP: `POST /api/ops/doctor/full` и `POST /api/ops/doctor/blender` (`lib/ops/doctor/mount.js`). `POST /api/ops/doctor/quick` Blender не вызывает. Это ломает инвариант теста: «единственный spawn Blender — `lib/blender.js` `runProc`». Набор `design3d-disabled` : **exit 1**, ровно один FAIL. Маршруты студии 3D при этом по-прежнему отвечают 403 (53 варианта в том же прогоне). На этой машине успешный рендер Blender не наблюдался: провал статический, по инвентаризации исходников.

### Низкая

2. **Браузерный allowlist не смотрит порт.** `desktop/external-hosts.js` `externalHref` пускает `https://www.nasa.gov:8443/a`, потому что `hostname` равен `www.nasa.gov`. Загрузчик лент `safeFetch` тот же URL отвергает (`u.port && u.port !== '443'`). Это не переход на чужой хост. `https://www.nasa.gov/%2e%2e` разбирается WHATWG в `https://www.nasa.gov/` — тот же разрешённый хост, не обход.

### Замечания, не отдельные дефекты продукта

- Путь `runner.js` `runOpencode` в коде остаётся. В HTML чекбокса `enableOpenCode` нет. На Linux он ещё требует `STUDIO_OPENCODE_UNSANDBOXED=1`. `POST /api/jobs` с типом `opencode_task` закрыт константой `OPENCODE_TASK_ENABLED = false` (`server.js:449`) и в тесте даёт 403. Плист TEST эту переменную не ставит.
- SHA-256 четырёх роликов в отчёте автора на этой машине не совпали. Потоки, размер кадра, метод прожига и отсутствие `freeze_start` совпали. Повторное кодирование x264 не обязано быть побайтовым.
- Zip собран из `a3b2117`, не из `d2abd8a`. Отчёт автора это уже пишет. Отчётный коммит в архив не входит.

### Заблокировано средой (не дефект и не VERIFIED ON DEVICE)

Окно Electron второй копии, `launchctl`, живая Связка ключей, живой `whisper-cli`, нотаризация, открытие `.app`, `bwrap` на Mac. Скрипт `newsvideo-security` против живого сервера с паролем не запускался (`SKIP: set PW_FILE`). Второй процесс, слушающий именно порт 8687, не поднимался.

---

## 1. Видео — PASS

Исходная ошибка воспроизведена на ffmpeg 7.1, собранном с `--disable-libass` (`/tmp/ffmpeg-nolibass`). Цитата из `/tmp/qa-logs/ass-error.txt`:

```
[AVFilterGraph] No option name near 'subs.ass'
Error parsing filterchain 'ass='subs.ass''
quoted_exit:234
[AVFilterGraph] No such filter: 'ass'
filename_exit:8
```

Форма `ass=filename=subs.ass` на этой сборке падает уже как «фильтра нет» (код 8), и код уходит в SVG. Системный ffmpeg 6.1.1 **с** libass форму `ass='subs.ass'` принимает (exit 0), если файл существует: короткий синтаксис в 6.1 ещё жив. Историческая строка «No option name near» на 6.1.1 поэтому не печатается; на 7.1 без libass она печатается на кавычках, а рабочий путь `filename=` до фильтра не доходит и заменяется SVG.

`node scripts/subtitle-burn-test.mjs` при `FFMPEG_NOLIBASS=/tmp/ffmpeg-nolibass/bin/ffmpeg`: **28 passed, 0 failed, exit 0**.

| Файл | Метод | Поток | mean volume |
| --- | --- | --- | --- |
| news-1920x1080-libass.mp4 | libass | h264 1920×1080, aac 48000, mov_text | −21.1 dB |
| news-1080x1920-libass.mp4 | libass | h264 1080×1920, aac 48000, mov_text | −21.1 dB |
| news-1920x1080-nolibass.mp4 | svg | h264 1920×1080, aac 48000, mov_text | −21.1 dB |
| news-1080x1920-nolibass.mp4 | svg | h264 1080×1920, aac 48000, mov_text | −21.1 dB |

Автовыбор без указания метода: системный ffmpeg → libass, сборка без фильтра `ass` → svg.

Полный демо-выпуск `node scripts/news-episode-render.mjs` (сначала системный ffmpeg, затем `FFMPEG_BIN_DIR=/tmp/ffmpeg-nolibass/bin`). Оба прогона **exit 0**, `qaOk: true`, `qaError: null`, TTS `espeak-ng`.

| Файл | Метод | Байты | SHA-256 этой машины | ffprobe |
| --- | --- | --- | --- | --- |
| news-youtube-system.mp4 | libass | 8194070 | `195258adff485cf9eef983482f27b1d9aa54a07972193f59bee9e02e9512ab3b` | h264 1920×1080, aac 48000, mov_text |
| news-shorts-system.mp4 | libass | 7122477 | `9a5f1f9a1eae03e6cdc2c58726eb45d8a30b93b884b707dda651704917d2b0e5` | h264 1080×1920, aac 48000, mov_text |
| news-youtube-nolibass.mp4 | svg | 8002954 | `b3ecb1eac9abd37e24517c55245ba88ced4b82efc0214abae05b1d39e5637f4d` | h264 1920×1080, aac 48000, mov_text |
| news-shorts-nolibass.mp4 | svg | 7165001 | `a247838063fdc6a5c5694867a5d8620dcf9b6394f9eab30bd458718bac415611` | h264 1080×1920, aac 48000, mov_text |

Независимый `ffmpeg -vf freezedetect=n=-60dB:d=2.5` по этим четырём файлам не напечатал ни одной строки `freeze_start` / `freeze_end`. Длительность каждого: `00:00:34.07`. Заявленные в отчёте автора хеши (`a5c2cee6…`, `b405ed00…`, `a0086f5a…`, `f14bad88…` и короткие `ee37bc56…`) **не совпали** — см. замечание выше. Порог детектора в diff относительно `5013621` не менялся.

Пути с пробелом, апострофом, двоеточием и кириллицей. Каталог `/tmp/qa 'dir':кириллица [x]`, файл `кадр's:one.srt`, текст — длинный URL NASA и длинный хештег без пробелов. Зонд: `weird path libass burn` → метод `libass`; `weird path svg burn` → метод `svg`. Оба файла на диске есть.

`media-automation/test/freeze-motion.test.js`: exit 0, около 2.4 с.

## 2. NEWS — PASS

`node scripts/external-hosts-test.mjs`: **25 passed, 0 failed, exit 0**.

`node scripts/newsvideo-test.mjs`: **68 passed, 0 failed, exit 0**. В хвосте лога: демо нельзя утвердить и нельзя превратить в выпуск.

Ленты на диске после загрузки: `/tmp/qa-logs/nasa.rss` (277186 байт, `application` RSS NASA, XML) и `/tmp/qa-logs/esa.rss` (RSS ESA). Это успешные ответы серверов NASA и ESA в этом прогоне, не цитата отчёта.

`safeFetch` отверг: `http://`, чужой хост, userinfo, `www.nasa.gov.evil.example`, порт 8443, `127.0.0.1`. Сообщение: `source not allowed`.

Обход утверждения (зонд, локальный HTTP):

| Тело | Ответ |
| --- | --- |
| только `contentHash` | 422 `fact_check_required` |
| `factChecked: "true"` и `1` | 422 `fact_check_required` |
| `factChecked: true` без хеша | 409 `content_changed` |
| верный хеш, но `0000…` | 409 `content_changed` |
| честный `factChecked: true` и верный хеш | 200, статус approved |
| демо, даже с `kind: draft` и чужим текстом `REAL NASA 9999` | сценарий демо, клиентский текст отброшен |
| approve демо | 422 `demo_not_approvable` |
| правка JSON выпуска (`factChecked: true`, `demo: false`) и render | 409 `demo_corrupt` |
| снять `kind` в `state.json` и approve | 422 `demo_not_approvable` |

Лишнее поле `factCheck: { checked: true, required: false }` вместе с честным чекбоксом и верным хешем дало 200. `approve()` это поле не читает: решают только `body.factChecked === true` и совпадение `contentHash`. Это не ослабление. `git diff 5013621 HEAD -- lib/news-video.js` показывает, что тело `factCheck()` (перекрытие предложений, флаги слабой опоры) не переписывалось; добавлены ветки демо. Для демо в ответе API `required: false`, и такой черновик утвердить нельзя. Для обычного черновика по-прежнему `required: true` и чекбокс владельца.

`node scripts/newsvideo-security-test.mjs`: exit 0, текст `SKIP: set PW_FILE (and STUDIO_URL)`. Живой сервер с паролем — **NOT CHECKED**.

## 3. Approval Center — PASS

`node scripts/world-approval-test.mjs`: **ALL PASS, exit 0**. Запрещённое действие отклоняется даже при наличии approval.

Зонд на `lib/world/permissions.js`:

- `tierOf('merge_to_main')` = `forbidden`; `gate` → `deny`.
- Смена параметров → `params_mismatch`. Чужое действие → `action_mismatch`. Чужой пользователь отклонён.
- Повторное использование после consume отклонено.
- Исполнитель `agent_diff` не делает merge. В `wiring.js` исполнителя `merge_to_main` нет.

`node scripts/publish-desk-test.mjs`: **14 passed, exit 0**. Подтверждённая отправка всё равно `403 publish_not_enabled`.

## 4. Агенты (этап E) и 3D — FAIL

Изоляция, команды и OpenCode API прошли. Пункт в целом FAIL из‑за spawn Blender вне гейта (дефект 1).

`node scripts/agent-task-test.mjs`: **18 passed, 0 failed, exit 0**. В логе: отказ пути наружу, отказ git argv, `merge_to_main` запрещён, approval не сливает ветку, текст оболочки не исполняется, diff вне песочницы отвергнут, нет `bwrap` — задача не стартует, HTTP отвергает команду, cancel убивает переусыновлённого внука.

Повторный `bwrap --unshare-all --tmpfs /tmp` с попыткой записать маркер в `/tmp` хоста: внутри песочницы запись в свой `/tmp` удалась (`hostTmp: wrote`), файл маркера на хосте после выхода **отсутствует** (`/tmp/qa-escape-marker-*` нет). `/etc` — `ENOENT`, `/etc/shadow` — `ENOENT`, сеть — `ENETUNREACH`. Утверждение зонда «hostTmp !== wrote» было слишком жёстким и не означает дыру: tmpfs поглотил запись.

`node scripts/opencode-task-disabled-test.mjs`: **ALL PASS, exit 0**. Тип и kind `opencode_task`, в том числе с app token, → 403, задача не создаётся. `OPENCODE_TASK_ENABLED = false`.

`node scripts/ollama-proxy-test.mjs`: **16 passed, exit 0**.

`node scripts/design3d-disabled-test.mjs`: **exit 1**. Версия `/api/health` совпала с `package.json` (`1.3.4-test`). 53 варианта путей (регистр, слэш, кодирование) → 403 `feature_disabled`. Задач 3D не создано. Единственный FAIL — инвентаризация spawn, см. дефект 1. `DESIGN3D_ENABLED = false` в `lib/feature-gate.js`.

`node --test --test-concurrency=1 test/ops/doctor.test.js`: **exit 0**, около 5.7 с. Этот набор провал инвентаризации не ловит.

## 5. Telegram / YouTube — PASS

`publish-desk` 14/14 и зонд:

- Нет Связки ключей: 424, `connected: false`, статус «Не подключено», токен не сохранён.
- Токена нет в каталоге данных и в буфере лога. Форма `\d{5,}:[A-Za-z0-9_-]{20,}` в логах зонда не найдена.
- Файл проверок сам по себе не делает коннектор «подключённым» (`tokenStored: false`, `keychain: false`).
- Dispatch без подтверждения: 422. С подтверждением: 403, отправки нет. Смена текста: 409.

Живой бот и OAuth YouTube — **BLOCKED** (нет Keychain, токен в тест не подставлялся). Ложного «подключено» в прогнанных проверках нет.

## 6. Update Center / System Doctor / голос — PASS

`npm run test:update-center`: **exit 0**, около 17.6 с.

Зонд `createUpdateCenter` при пустом env:

- `autoInstall.enabled === false`, нет всех четырёх флагов `OPS_UPDATE_*`.
- Подпись: `BLOCKED`, «нет публичного ключа владельца», `failClosed: true`.
- `autoInstall(..., { dryRun: false })` бросает `AUTO_INSTALL_DISABLED`.
- `rollback({ dryRun: true })` возвращает команды и `dryRun: true`, ничего не выполняет.
- `rollback({ dryRun: false })` на Linux: `NOT_MAC`.

Плист TEST содержит `STUDIO_OPS_UPDATE` и порт 8687. Плист prod Update Center не включает (тест голоса: «prod launchd does not enable Update Center»).

Голос `node scripts/voice-input-test.mjs`: **10 passed, exit 0**. Зонд: отказ микрофона → пустой текст, `autoSend: false`; в теле `command` / `autoSend: true` → 400 `command_forbidden`, текст пустой; нет `whisper-cli` → 424 `voice_unavailable`, текст `""`, `autoSend: false`. `prepareUtterance` при разрешении не ставит флаг исполнения команды. Распознавание настоящей речи — **BLOCKED**. `say` на Linux нет; `scripts/tts-say-fallback-test.mjs` **3 passed**, запасной путь — `espeak-ng`.

Кнопка System Doctor в браузере на этой машине — **NOT CHECKED**. Код и `doctor.test.js` (exit 0) проверены. Автоустановки из прогнанных вызовов нет.

## 7. Запуск и версия сервера — PASS

`node scripts/server-identity-test.mjs`: **14 passed, exit 0**.

- Нет версии в health → в тексте `v?`, не `vundefined`. Пример: `Порт 8687 занят другой версией сервера (v?, pid 9); эта версия v1.3.4-test не запущена`.
- Та же версия и тот же commit → exit 0. Другой commit → exit 3. Чужой flavor → exit 3.
- `server.pid` не совпал с pid из health → отказ. pid 0 → отказ. Поддельный pid в health → отказ.
- Живой `server.js`: health без версии → exit 3 и `v?`. Совпадающая версия без commit с обеих сторон → exit 0 (порты слушателя в тесте были случайные, не 8687).

`node scripts/single-instance-test.mjs`: **9 passed, exit 0**. Текст решения: «Открыта другая версия TEST (v1.3.0-test). Закройте её (⌘Q) и запустите снова.» Неизвестная версия → `v?`. Та же сборка не выходит молча. `main.js` передаёт версию в `additionalData` и больше не выходит по замку с пустым сообщением.

`desktop/startup.html`: «⌘Q и закрытие окна не останавливают фоновый сервер и не освобождают порт»; кнопка «Запустить сервер».

Окно Electron и второй процесс, занявший именно 8687, — **NOT CHECKED**. Логика конфликта и pid-файла проверена, в том числе на живом `server.js`.

## 8. Архив — PASS

Повторная сборка уже была выполнена до этого среза (новую не запускал). Команда в отдельном worktree на `a3b2117b73709c9d9901d67ff0ddf421ff185864`:

`PATH=$HOME/.local/bin:$PATH FLAVOR=test scripts/package-mac-on-linux.sh`

`rcodesign` 0.29.0. Лог `/tmp/qa-logs/package.txt`, **EXIT 0**.

Независимый `sha256sum` того же файла:

```
4b873c13fc82b9000b8639603c53f2f899fe7deeee26857a778dd4d4337d2205
/tmp/mk-a3b2117/dist/MOONKATTY-AI-STUDIO-TEST-1.3.4-test-arm64-mac.zip
```

Размер 170169415 байт. Совпадает с заявленным SHA-256 и с тем, что скрипт напечатал сам. Сборка на этом прогоне оказалась детерминированной.

Info.plist собранного `.app`:

- `CFBundleIdentifier` = `com.moonkatty.aistudio.test`
- `CFBundleShortVersionString` = `1.3.4-test`
- `CFBundleName` / DisplayName = `MOONKATTY AI STUDIO TEST`
- `NSMicrophoneUsageDescription` присутствует (текст про диктовку без автовыполнения)

`rcodesign`: флаги `ADHOC`, identifier `com.moonkatty.aistudio.test`; вложенный node — `ADHOC|RUNTIME`, identifier `node`. `release-manifest.json`: `signing: adhoc`, `notarized: false`, `defaultPort: 8687`, `isolatedFrom: ["com.moonkatty.aistudio"]`, commit `a3b2117…`, branch в манифесте `HEAD` (worktree был отсоединён). Продуктовый bundle id `com.moonkatty.aistudio` идентификатором этого plist не является.

Архив не подменяет v1.1.2: другой bundle id, пометка isolated, `main` и тег превью не двигались. На Mac архив не открывался. **VERIFIED ON DEVICE нет.**

## 9. Регрессии относительно 5013621 — FAIL

Оба старых FAIL Studio 4 по версии **исправлены** и на 1.3.4-test проходят:

- На `5013621` `scripts/world-class-test.mjs` требовал `/^1\.3\.[012]-test$/`. Это отсекает `1.3.3-test` и `1.3.4-test`. Сейчас `/^1\.3\.\d+-test$/` и сверка с `package.json`. `node scripts/world-class-test.mjs`: **exit 0**.
- На `5013621` `scripts/design3d-disabled-test.mjs` требовал `h.version === '1.3.2-test'`. Сейчас сверка с `package.json`. Это утверждение в прогоне **PASS** (`version matches package.json in /api/health`).

Новый провал того же скрипта — инвентаризация Blender (дефект 1). Его на `5013621` не было: файл `lib/ops/doctor/checks/blender.js` пришёл с этапом F. Поэтому пункт регрессий — FAIL, хотя два названных FAIL версии закрыты.

Прочие заявленные F-1…F-4 и текст F-6 подтверждены тестами разделов 3 и 7 и `scripts/video-deps-test.mjs` (**35 passed, exit 0**): approve без ffmpeg → 424, черновик не утверждается. F-5 в части версии подтверждён; в части «гейт 3D не ослаблен» HTTP 403 подтверждён, а инвариант «Blender не стартует нигде, кроме `runProc`» — нет. Фраза отчёта «Оба набора прошли на 1.3.4-test» для `design3d-disabled` **ложна** (exit 1).

`qa/reports/world-class-v1.3.0/results.json` тест перезаписал локально. В этот аудит файл не входит и в ветку кода не коммитился.

## Что не проверялось

- Живой listener и вторая копия именно на порту 8687.
- `newsvideo-security` против сервера с паролем.
- Mac: диалог, `launchctl`, Связка ключей, whisper, нотаризация, запуск `.app`, песочница без `bwrap`.
- Успешный прогон бинарника Blender (его на этой машине инвентаризация только читает в исходниках).
- Повторный обход всех запасных URL NASA/ESA по HTTP сверх уже скачанных RSS и тестов allowlist. Кнопки Doctor в Chrome.

Код продукта этим аудитом не исправлялся.
