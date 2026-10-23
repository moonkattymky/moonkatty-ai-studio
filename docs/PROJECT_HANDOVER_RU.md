# Продолжение MOONKATTY AI STUDIO — инструкция для следующего разработчика

Срез на 23.10.2026. Это не независимый аудит и не проверка на Mac mini. Статус VERIFIED ON DEVICE не ставить. Самопроверка агента не заменяет прослушивание и не заменяет чужой отчёт.

Версия в `package.json` на ветке `cursor/handover-v1334-test-fb63`: **1.3.4-test**.

Снимок до правок этой передачи лежит в корне: `PROJECT_HANDOVER_RU.md` (коммит `395acb371222dfdbbac6d5610621927269a96a4e`). Итог самопроверки A–F: `HANDOVER_REPORT_2026-10-23_RU.md`. Этот файл — куда идти дальше.

## Запреты

- Не коммитить в `main` и не сливать туда ветки. `main` сейчас `e87bd32f904faf676e8316fbf38ef8805727c7fc` (старая панель v1, не линия 1.3).
- Не двигать тег `v1.1.2-mac-preview` = `3f9bd9038a3245a362b355565c4ba2a860c6ba3c`. Рабочее приложение на Mac mini не подменять.
- Центр подтверждений не ослаблять: без обхода, без повторного использования одобрения, без смены параметров после одобрения. `merge_to_main` запрещён.
- Не включать OpenCode и 3D «для демо», если нет изоляции. `OPENCODE_TASK_ENABLED` в `server.js` остаётся `false`.
- Не публиковать из TEST. Не класть токены в git, argv и открытую базу.
- Не отключать Gatekeeper и не называть сборку проверенной на устройстве.
- Коммита `e15a4d9` в этом клоне нет (`git cat-file` — «Not a valid object name»). На него не опираться.
- Архив arm64 пока не пересобирать, пока независимый аудит не посмотрит текущий. Независимо проверенного архива нет.

## Ветки и PR, которые важны сейчас

Проверено `git ls-remote --heads origin` и `gh pr list` в момент этого коммита.

| Что | Ветка | Хеш | PR |
|---|---|---|---|
| Линия передачи, TEST 1.3.4 | `cursor/handover-v1334-test-fb63` | `d2abd8a0cdd8e5f5b52a574fe5226419acd94325` плюс коммит этого файла | черновик #10 → `fix/v1.3.3-news-video` |
| Озвучка NEWS, WIP | `cursor/news-voice-kokoro` | `c4e357d7ff2eccc18900c38b15a8ae657e947d25` | черновик #11 → `cursor/handover-v1334-test-fb63` |
| Этап G, WIP | `cursor/social-stage-g-wip-d94e` | `d9a23071b336ad990f1af2e4541a8d7fef9c20ba` | черновик #12 → `cursor/handover-v1334-test-fb63` |
| База видео 1.3.3 | `fix/v1.3.3-news-video` | `5013621501b9766c0cc710806d5716962e4b1835` | — |
| Кандидат 1.3.2 | `candidate/v1.3.2-test` | `becdc89a1d281e14730236bd4e60f32e3182f088` | — |
| System Doctor (исходный PR) | `feat/e2e-system-doctor` | `a9ae8daf9cbc737b96f9fce737a45dd8827101d3` | черновик #9 → `candidate/v1.3.2-test` |
| Независимый аудит 1.3.4, файл `INDEPENDENT_AUDIT_1.3.4-test_RU.md` | в `origin` ветки и файла нет | — | в работе, статус неизвестен |

Этап G: в #12 только `SOCIAL_STAGE_G_RU.md`. TikTok, X, Instagram и Facebook в стол не встроены, код не писался, публикация не включалась. Четыре сети в том отчёте помечены BLOCKED.

Аудит 1.3.4: отдельной ветки с `INDEPENDENT_AUDIT_1.3.4-test_RU.md` на origin нет. Старый реаудит 1.3.0 — это другое: ветка `qa/reaudit-stab-v130` @ `c8d4dd86b73fbb63e6879b1e512e907e1debae16`, черновик PR #8. Его PASS не переносить на 1.3.4-test.

Остальные открытые черновики (#1–#7) в `main` не влиты. Их базы — старые линии. Не сливать их в эту ветку пакетом.

## Коммиты линии 1.3.4-test

- `395acb371222dfdbbac6d5610621927269a96a4e` — снимок до правок
- `614a3ae853d996c24786402ba02b5c0383ac7b3e` — субтитры, демо, NASA/ESA
- `058ac2ba49793ee4f94cfe813f1adb2f75e117dc` — вторая копия TEST, версия 1.3.4-test
- `0bfa89b9a272746c93e82f1919267fadfa3dc533` — стол Telegram/YouTube без публикации
- `0822140053d23634844befe0884ccbac65d224f6` — карточка стола на вкладке соцсетей
- `3df4b8c3a5be652c5292ef1e52773263e0ea1838` — первая редакция отчёта (тогда QA заморозки ещё FAILED)
- `0dc4b565e8540ee9f1e9aa541a03db67912886bd` — зерно кадра, порог `freezedetect=n=-60dB:d=2.5` не менялся
- `a1049e54f16084665c848571e1e31c25676cbd2f` — задача агента в bwrap, без OpenCode
- `a3b2117b73709c9d9901d67ff0ddf421ff185864` — System Doctor, Update Center в launchd TEST, локальный голос. Этот коммит запечён в архив
- `d2abd8a0cdd8e5f5b52a574fe5226419acd94325` — отчёт `HANDOVER_REPORT_2026-10-23_RU.md`. В архив не входит

`9efce6e` и `becdc89` входят в историю. `2dd6239` (кончик `feat/e2e-ollama-proxy`) не входит: там нет кода раннера.

## Архив

Файл: `dist/MOONKATTY-AI-STUDIO-TEST-1.3.4-test-arm64-mac.zip`

- Размер: 170169415 байт
- SHA-256: `4b873c13fc82b9000b8639603c53f2f899fe7deeee26857a778dd4d4337d2205` (пересчитан на этой VM в момент инструкции)
- Commit внутри: `a3b2117b73709c9d9901d67ff0ddf421ff185864`
- Info.plist: версия `1.3.4-test`, bundle `com.moonkatty.aistudio.test`, есть `NSMicrophoneUsageDescription`
- ad-hoc, не нотаризован, собран на Linux. На Mac не запускался
- В git его нет: `dist/` в `.gitignore`. Лежит только на VM этой сессии: `/workspace/dist/MOONKATTY-AI-STUDIO-TEST-1.3.4-test-arm64-mac.zip`
- Независимо проверенного архива нет

Пересборка того же архива (не запускать, пока аудит не попросит):

```bash
git checkout a3b2117b73709c9d9901d67ff0ddf421ff185864
export PATH="$HOME/bin:$PATH"   # нужен rcodesign
FLAVOR=test scripts/package-mac-on-linux.sh
```

Дерево должно быть чистым по отслеживаемым файлам. Повтор с более новым коммитом даст другой SHA-256. `scripts/build-mac.sh` на Mac собирает только prod.

## Результаты самопроверки (не аудит)

Зелёные наборы запускал тот же агент, который писал код. Подробности и оговорки — в `HANDOVER_REPORT_2026-10-23_RU.md`, раздел 7.

- `subtitle-burn` 28/28
- `newsvideo` 68/68
- `external-hosts` 25/25
- `tts-say-fallback` 3/3 (подмена `say`, не настоящий macOS)
- `single-instance` 9/9
- `server-identity` 14/14
- `video-deps` 35/35
- `design3d-disabled` — PASS, 3D по-прежнему 403
- `world-class` — FAIL нет; запуск `.app` в том наборе BLOCKED
- `publish-desk` 14/14 на поддельном Keychain
- `freeze-motion` 3/3. Повторный `freezedetect=n=-60dB:d=2.5` по четырём новым MP4 не напечатал `freeze_start`
- `ollama-proxy` 16/16
- `agent-task` 18/18, включая bwrap
- `doctor` 17/17
- `voice-input` 10/10
- Chrome: карточка агента, отказ микрофона ничего не отправляет, быстрая проверка System Doctor показывает disk и `db.quick` OK
- Голос в панель: `POST /api/voice/transcribe` → 424 `voice_unavailable`, текст пустой, `autoSend: false` (whisper.cpp нет)
- Update Center при `STUDIO_OPS_UPDATE=1`: подпись BLOCKED, нет ключа владельца; автоустановка выключена

Четыре демо-MP4 после зерна (qaOk, espeak-ng, 34.066667 с, −21.2 / −1.9 dB) — хеши в отчёте, раздел 6. Файлы на VM: `/opt/cursor/artifacts/video/`. В git их нет.

## Статусы модулей

| Модуль | Статус |
|---|---|
| Озвучка NEWS (Kokoro) | WIP. Демо-ролики — espeak-ng. Код Kokoro в дереве есть, в рендер демо не входил. На VM модели поставлены, в git их нет. UI, три новых ролика, System Doctor и документ Mac не сделаны. Ветка `cursor/news-voice-kokoro`, PR #11, отчёт `VOICE_REPORT_RU.md`. Качество на слух не называлось проверенным |
| OpenCode | Выключен. `POST /api/jobs` с `opencode_task` → 403 `feature_disabled`. В песочницу агента shell не отдаётся. Без `bwrap` задача не стартует |
| Telegram / YouTube | Стол есть, секреты только через Keychain. На Linux Keychain нет → 424. «Подключено» только после живого getMe. Боевого входа не было. TEST не публикует (`publish_not_enabled`) |
| TikTok / X / Instagram / Facebook | Не встроены в этом прогоне. Этап G остановлен до кода: PR #12, `SOCIAL_STAGE_G_RU.md`. Черновики в старой панели соцсетей не равны публикации |
| Update Center | В исходниках. В launchd включается только у TEST (`STUDIO_OPS_UPDATE=1`, `STUDIO_OPS_BACKUP=1`). Prod флаг не получает. Подпись BLOCKED без ключа владельца. Автоустановка требует четыре флага `OPS_UPDATE_*` и они не заданы. HTTP-откат возвращает план и не выполняется |
| System Doctor | Встроен из PR #9 (файлы, не чужой `server.js`). Тесты 17/17. На Mac не запускался. Проверки Kokoro нет |
| Голосовой ввод RU/EN | Текст в поле, `autoSend` всегда false, отказ микрофона ничего не шлёт. `NSMicrophoneUsageDescription` есть. Распознавание на этой машине BLOCKED: нет whisper.cpp. macOS Speech не собран |

## Незавершённое и известные ошибки

- Озвучка: см. PR #11. espeak на демо — известный резерв, не баг субтитров. Kokoro как приоритет без ручных переменных не дописан.
- Этап G не начат кодом.
- Независимый аудит 1.3.4 в репозитории не найден.
- Диалог второй копии Electron, launchd, `say`, Gatekeeper, Keychain, микрофон Mac — не запускались.
- Архив не нотаризован и не лежит в git.
- Голос панели не распознаёт речь без `whisper-cli`.
- Песочница агента на Mac без `bwrap` обязана отказаться (`sandbox_unavailable`).
- Замок `media-automation/config/master-voice.json` (Kokoro `am_fenrir`, locked) панель NEWS не применяет. Его не снимать без владельца.
- Порог заморозки не ослаблять. Зерно `alls=14` статичное; временной шум `allf=t` не добавлять.

## Что сделать владельцу

- Не ставить TEST поверх v1.1.2. Рядом. SHA-256 архива — выше. Пока архив только на VM агента, на Mac его может не быть: тогда ждать копию или пересборку по команде выше после аудита.
- Токен Telegram и client id YouTube — только в Keychain на Mac, не в чат.
- Публичный ключ подписи обновлений — вне репозитория (`docs/ops/RELEASE_KEY_SETUP_MAC_MINI.md`).
- Прослушать будущие ролики Kokoro самому. Пока их нет.
- Не сливать #10, #11 и #12 в `main`.
