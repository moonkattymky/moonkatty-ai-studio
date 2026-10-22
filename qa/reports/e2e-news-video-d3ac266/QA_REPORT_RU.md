# Независимый аудит Studio 4: NEWS → VIDEO, ветка feat/e2e-news-video-3d, коммит d3ac266 (база 3b72817)
Дата: 22.10.2026, 19:53–20:10 IDT (Asia/Jerusalem). Режим: только чтение кода продукта, публикаций нет. Клон без токена. Сервер TEST-flavor на временных data dir (порты 8697/8698/8699; чужой сервер на 8687 не трогался). Node 22.23.4.

## ВЕРДИКТ: **FAIL** (блокер QA-NV-001: собранное приложение d3ac266 не запускается)
Исходный код на Linux проходит полный сценарий с реальными интеграциями, но в app.asar отсутствуют модули, которые требует новый `lib/news-video.js` → `server.js` падает при старте.

| Модуль | Статус (критерии плана audit-e2e, раздел 0) |
|---|---|
| NEWS (автопоиск RSS → проверка → сценарий → правка → утверждение) | **TESTED** (полный реальный сценарий из исходников на Linux); INTEGRATED — **FAIL** (QA-NV-001) |
| VIDEO (video_render: TTS espeak-ng + ffmpeg → MP4/SRT/JPG, превью/экспорт) | **TESTED**; INTEGRATED — **FAIL** (QA-NV-001) |
| Связка NEWS→VIDEO (утверждение → episodes/<ref>.json → job) | **TESTED**; дефект целостности QA-NV-002 |
| VERIFIED ON DEVICE (Mac mini: say, qwen3:8b, Gatekeeper) | **BLOCKED** |
| PRODUCTION READY | **BLOCKED** (нет разрешения Игоря; фактчек LLM, см. §5) |

## 1. Объём изменений
`git diff --stat 3b72817 d3ac266`: 8 файлов, +408/−9 — `lib/news-video.js` (новый, 172 строки), `public/app.js`, `server.js` (`:156-162` выгрузка Ollama, `:509-510` монтирование), `package.json` (3 npm-скрипта), `scripts/newsvideo-{test,security-test,ui-e2e}.mjs`, `docs/MAC_MINI_E2E_NEWS_VIDEO_RU.md`.
`git diff --quiet 3b72817 d3ac266 -- lib/services.js lib/executors lib/blender.js lib/scene-params.js blender` → без изменений: **3D и lib/services.js не тронуты — PASS**.

## 2. Тесты (перезапуск Studio 4)
| Тест | Studio 3 | Studio 4 | Итог |
|---|---|---|---|
| test:newsvideo (фикстуры) | 34/34 | 34/34 | PASS |
| test:newsvideo-security (живой сервер) | 23/23 | 23/23 (при наличии черновика; без черновика 21/21 — 2 проверки условные) | PASS |
| test:newsvideo-e2e (Playwright, Chrome, живой RSS, Ollama qwen2.5:1.5b, espeak-ng, ffmpeg) | 11/11 | 11/11 | PASS |
| isolation | 65/65 | 65/65 | PASS (в `/workspace/out/regress/isolation-test.mjs.log` лежит старый прогон 64/65 до исправления — лог устарел, не доказательство) |
| security / policy / publish-guard / nodes | — | 52/0 · 46/46 · 59/0 · 52/0 | PASS |
| video (test:video) / wiring | — | 53/0 · 8/8 | PASS |
| opencode-json / runner | — | 22/22 · OK | PASS |
| test:world | 1 FAIL (нет qwen3:8b) | 62 PASS / 1 FAIL на d3ac266 **и** 62/1 на 3b72817 — тот же тест `runtime reports ollama` | окружение, не регрессия |
| smoke (Playwright) | таймаут 10 с, база не проверялась | d3ac266: exit 0 ×2; 3b72817: exit 0 ×2 (порт 8698) | PASS, регрессии нет; таймаут Studio 3 — нагрузка окружения |
| desktop-test, design3d, studio3c | dbus / SKIP | не перезапускались | NOT TESTED |
| Сборка `FLAVOR=test package-mac-on-linux.sh` на d3ac266 | — | zip sha256 a2fce468f211a3e6…, asar 920 записей; `lib/news-video.js`, `server.js`, `public/app.js` побайтно = исходникам | сборка PASS, запуск **FAIL** (QA-NV-001) |

## 3. Собственный полный сценарий (API, TEST-сервер 8699, temp data dir)
1. `POST /api/newsvideo/search` → живой RSS: status ok, fetched 156, 0 ошибок, 142 кандидата (NASA/ESA и др.).
2. Черновик из 2 новостей (RS-25, APOD) через Ollama qwen2.5:1.5b — 49 с; provider `ollama:qwen2.5:1.5b`.
3. Утверждение → `media/episodes/nv-a94dfaa413fe27c8.json`.
4. Рендер youtube: во время рендера сервер был убит внешним SIGTERM (не продукт; на машине работают другие агенты). После рестарта job восстановилась и завершилась `succeeded` — устойчивость PASS.
5. Экспорт через `/file?kind=mp4|srt|jpg&download=1` → 200.
**ffprobe собственного MP4** (`/workspace/out/qa-nv/qa_flow.mp4`, 12 807 208 Б): h264 1920×1080 30 fps + AAC 48 kHz, 57.27 с. Shorts: 1080×1920, 57.27 с. SRT синхронизирован с текстом. Ollama после рендера: `/api/ps` → `models: []` (выгрузка сработала).
Артефакты Studio 3 (`/workspace/out/e2e-artifacts/`): 3 MP4 (40.17 с, 40.17 с, 55.27 с; h264+AAC, −20.8/−20.3 dB), SRT, JPG, PNG, ui_test_results.json — CONFIRMED, согласуются с ffprobe.txt.

## 4. Проверки безопасности
| Проверка | Результат |
|---|---|
| Auth на всех 10 новых маршрутах | 401 без сессии (security-test) — PASS |
| CSRF | без X-Studio-Request/Origin → 403; cross-origin → 403 на всех POST/PUT — PASS |
| Host-check | `Host: evil.example.com` → 421 — PASS (глобальный middleware; маршруты смонтированы после него, `server.js:509-510`) |
| Path traversal в выдаче файлов | `kind` — только enum mp4/srt/jpg (`lib/news-video.js:164`); id — `/^[a-z0-9]{6,40}$/` (`:43,151`). Проверено: `..%2F`, `%2F`, `%00`, `/etc/passwd`, `....//`, сырой `../` (`--path-as-is`) → 400/404. **Symlink**: mp4-артефакт заменён симлинком на /etc/passwd → 403 «outside media root» (`:167`, realpath). Абсолютные пути из запроса не принимаются вовсе — путь берётся из БД job. PASS |
| SSRF | Источники — жёсткий `Object.freeze` список из 6 https-лент (`:19-26`); клиентские `url/sources` игнорируются (проверено: 169.254.169.254 не запрашивается). Редиректы вручную, ≤4 хопа, только https + allowlist-хост, без userinfo, порт 443 (`:30-40`). PASS. Замечание QA-NV-005 |
| Публикация | В диффе нет publish/upload/YouTube/Telegram/TikTok; модуль без вызовов publisher; `/api/queue/:id/publish` в TEST → 403 (`server.js:200`) — PASS |
| Command injection из текста новости | Все внешние вызовы через `execFile` без shell (`:116`); имя карточки — `[^a-z0-9]` вычищено (`:119`), цвет — из словаря (`:120`). Текст с `$(touch /tmp/pwn5)`, `` `touch /tmp/pwn6` ``, `'`, `:`, `%`, `\` отрендерен (MP4 36.83 с), строки попали в SRT буквально, файлов /tmp/pwn* нет — PASS |
| Ollama unload + heavy-lock | Выгрузка только loopback (`server.js:158-159`), ошибки не фатальны; выполняется внутри `withHeavy('video_render:'+id)` (`lib/services.js:87`); генерация Ollama тоже под `withHeavy('ollama')` (`runner.js:21,69`) → LLM и рендер не идут одновременно — PASS. Замечание QA-NV-003 |
| XSS в UI | Текст/заголовки через `esc()`, ссылки через `safeUrl()` (diff `public/app.js`) — PASS |
| Лимиты ресурсов | ≤6 новостей, текст ≤1200, заголовок ≤110, лента ≤3 МБ, один поиск одновременно, ffmpeg timeout 60 с, история ≤200, runs ≤100 — частично; см. QA-NV-004/005 |

## 5. Выдумывание фактов маленькой LLM
Воспроизведено: для APOD (источник — только навигационный текст страницы) qwen2.5:1.5b написала «revealing its green hue, which is not common among other stars» — утверждения нет в источнике; числовой фильтр (`lib/news-video.js:92-93`) это не ловит (проверяет только числа). Для RS-25 текст точен.
**Решение:** не блокирует IMPLEMENTED/TESTED/INTEGRATED — сценарий требует ручного утверждения владельцем (`approve`, `:126-135`), а правка возвращает в draft. **Блокирует PRODUCTION READY**, пока: (а) черновик LLM не помечается в UI как «требует фактчека» с показом исходного текста рядом, (б) нет проверки имён/утверждений (не только чисел) или (в) на Mac не подтверждено качество qwen3:8b. Severity: **Medium**.

## 6. Находки
| ID | Severity | Где | Суть |
|---|---|---|---|
| **QA-NV-001** | **Critical (блокер)** | `package.json:78-90` (build.files) vs `lib/news-video.js:12-13,16` | В `files` нет `media-automation/src/news/**` и `media-automation/src/orchestrator/**`. В собранном app.asar d3ac266 их нет (asar list); запуск `server.js` из распакованного asar: `Error: Cannot find module '../media-automation/src/news'` — **сервер TEST-приложения не стартует вообще** (регрессия относительно 3b72817). Тесты из исходников это не ловят. Исправление: добавить пути в `files` + проверка запуска из asar в CI |
| QA-NV-002 | Medium | `lib/news-video.js:136-140` (sync), `:144` (render) | После рендера правка черновика ставит `draft`, но следующий же GET/PUT вызывает `sync()`, который по последнему успешному job возвращает статус `rendered`; рендер разрешён из `rendered` → новый рендер без повторного утверждения. Воспроизведено: PUT → `draft`, GET → `rendered`, POST render → `rendering`. Рендерится старый утверждённый episode JSON, т.е. в UI неутверждённая правка выглядит «отрендеренной» — нарушена целостность статусов утверждения |
| QA-NV-003 | Low/Medium | `server.js:158-161` | Выгрузка снимает **все** модели Ollama (`/api/ps`), включая чужие. На Mac mini Ollama общая с prod v1.1.2 (8787) → рендер TEST выгружает модель prod (на боксе выгружена модель другого агента). Нарушение изоляции test↔prod по ресурсам; выгружать только модель TEST |
| QA-NV-004 | Low | `lib/news-video.js:102`, `:146` | Создание черновика синхронно держит HTTP-запрос до 6×(до 600 с) без signal/отмены; число черновиков и рендеров не ограничено (state.json и media растут без квот) |
| QA-NV-005 | Low | `lib/news-video.js:37` | `r.text()` читает тело целиком до проверки размера, если нет content-length (только allowlist-хосты, риск низкий) |
| QA-NV-006 | Low | `media-automation/src/video` / субтитры | Длинная фраза без пауз → `render_failed: subtitle validation failed: cue 1: too long 7.62s`; ошибка показывается корректно, но текст из правки владельца может «ломать» рендер — нужна авторазбивка |
| QA-NV-007 | Info | `lib/news-video.js:13` | `fetchWithRetry` импортируется, но не используется |
| QA-NV-008 | Info | `/workspace/out/regress/isolation-test.mjs.log` | Лог показывает 64/65; заявленные 65/65 подтверждены только перезапуском Studio 4 |
| QA-NV-009 | Info | счётчики поиска | Первый поиск на пустом data dir: `new 0, duplicates 156` (Studio 3: 144 новых) — счётчик «новых» ненадёжен для отчёта |

## 7. Проверка отчёта Studio 3 (`/workspace/out/audit-e2e/e2e_completion_report_ru.md`)
CONFIRMED: 3D/services не тронуты; 34/34; 23/23; UI 11/11; isolation 65/65 (перезапуск); world-class падает и на базе; артефакты и ffprobe; нет публикации; выгрузка Ollama.
DISCREPANCY: smoke — не регрессия (проходит на обоих коммитах у Studio 4); не обнаружен QA-NV-001 (сборка не запускалась); QA-NV-002 не описан; лог isolation устарел.
Статусы Studio 3 не завышены (Mac — BLOCKED).

## 8. Что нужно для повышения статуса
1. Исправить QA-NV-001, пересобрать, запустить сервер из asar (smoke против собранного приложения) → INTEGRATED.
2. Исправить QA-NV-002 (sync не должен переопределять draft после правки; render только из approved с актуальным episode).
3. Mac mini M5 Pro: `say`, qwen3:8b, рендер MP4 + ffprobe, скриншоты, mac-diagnose, prod 8787 и его модель Ollama не затронуты → VERIFIED ON DEVICE (BLOCKED).
4. Разрешение Игоря, бэкап, откат, решение по фактчеку (§5) → PRODUCTION READY.
