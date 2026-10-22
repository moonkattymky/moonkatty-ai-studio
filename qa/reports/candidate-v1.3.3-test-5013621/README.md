# Аудит кандидата v1.3.3-test @ 5013621 (ветка fix/v1.3.3-news-video, диапазон becdc89..5013621)

Дата: 2026-10-23 (Asia/Jerusalem). Linux, Node 22.23.3. Аудитор: Studio 4 (независимый QA).
Коммит: `5013621501b9766c0cc710806d5716962e4b1835`. ZIP: `/workspace/mk-candidate-build/dist/MOONKATTY-AI-STUDIO-TEST-1.3.3-test-arm64-mac.zip`.

Правила соблюдены: код продукта не менялся; main / v1.1.2 не трогались; порты 8687/8787/4096 не использовались — все серверы и фейковые «старые» серверы запускались в отдельном сетевом namespace (`mk-iso.sh`, `unshare -rnm`) на портах 18731–18743, 18991–18993; процессы останавливались только по своему PID; pkill/killall не использовались; server/jobs* и server/blender* не трогались; базы не удалялись; секретов в отчёте нет.

## Итоговый вердикт: **FAIL**

Фикс версии сервера (service.js / server.js) работает и пересборка побайтно совпадает, регрессий нет. Но два заявленных в ТЗ ожидания не выполнены: (1) single-instance в main.js не изменён — новая копия по-прежнему молча закрывается при открытом старом окне; (2) утверждение черновика новости без ffmpeg по-прежнему даёт **500 «ffmpeg: spawn ffmpeg ENOENT»**, а не 424 `video_deps_missing`.

## Пункты 1–8

| # | Пункт | Вердикт | Кратко |
|---|---|---|---|
| 1 | Ревью diff becdc89..5013621 | PASS | 1 коммит, 5 файлов: desktop/main.js, desktop/service.js, server.js, package.json, package-lock.json (только версия). Лишних изменений нет, секретов нет, auth / approval / gate не затронуты. Замечания F-3, F-4 (Low) |
| 2 | sha256 + проверка архива + пересборка | PASS | sha256 `91498af1…8503a5` совпадает. Info.plist 1.3.3-test, `com.moonkatty.aistudio.test`. build-info: commit 5013621, flavor test. `app.asar` (service.js, main.js, server.js) и `app.asar.unpacked/server.js` совпадают с репо. Пересборка `FLAVOR=test scripts/package-mac-on-linux.sh` в отдельной копии: **тот же sha256**, сборка побайтно идентична |
| 3 | Порт занят старой или той же версией | PASS | 17/17 (`logs/scen-result.json`): health с 1.3.0-test → stale; health без версии → stale («?»); та же версия → переиспользуется; та же версия с другим commit → stale; flavor prod / чужое приложение → foreign; waitHealthy не принимает stale. Упакованный server.js: второй экземпляр той же версии → exit 0 «уже запущен»; порт занят 1.3.0-test → exit 3 «занят другой версией сервера (v1.3.0-test…)»; порт занят сервером без версии → exit 3 (текст «vundefined», F-3). Реальный launchd `kickstart -k` на Mac — BLOCKED |
| 4 | single-instance при открытом старом окне | FAIL | `desktop/main.js:25` не изменён: `if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }` — без диалога. Открытое старое окно в `second-instance` просто получает фокус. Проверка на реальном Mac — BLOCKED (F-1) |
| 5 | Утверждение черновика без ffmpeg | FAIL | Воспроизведено на упакованном сервере: `POST /api/newsvideo/drafts/:id/approve` → **500 `{"error":"ffmpeg: spawn ffmpeg ENOENT"}`**. 424 `video_deps_missing` есть только у `/render`, а до него дело не доходит (409 «Сначала утвердите сценарий») (F-2) |
| 6 | Гейт 3D выключен, 134 варианта | PASS | Упакованный сервер: **134/134**, 5xx = 0, 3D-задач и jobs в БД = 0. Как и в аудите becdc89: 76 [new]-вариантов + 38 [old] → 403 `feature_disabled`; 10 → 404, 2 → 400 (не исполняются); HEAD/OPTIONS < 500. Буквально «все 403» не выполняется — критерий тот же, что был в прошлом аудите |
| 7 | Регрессия | PASS | Все наборы из becdc89 зелёные (таблица ниже). Два набора проверяют жёстко заданную версию 1.3.2 (F-5) |
| 8 | Текст инструкции «⌘Q старой TEST» и проверка версии через ⌘I | NOT TESTED | Текста для v1.3.3 нет ни в репо (`git log --all -S"⌘Q"` пусто), ни в `/workspace/out/v1.3.3-test-fix/`; есть только инструкция для v1.3.2. Замечания по сути — F-6. Шаги на Mac — BLOCKED |

## Наборы тестов (5013621, Node 22)

| Набор | Результат |
|---|---|
| design3d-disabled | 106/107 — единственный FAIL: «version 1.3.2-test in /api/health» (тест ожидает старую версию, F-5); все проверки гейта PASS |
| security (+3 повтора, не параллельно) | 52/52 ×4 |
| world-approval | 18/18 |
| approvals e2e (world-approval-e2e) | 45/45 |
| owner-approval-real ×3 (упакованный сервер, свой порт) | 7/7 ×3 |
| newsvideo | 62/0 |
| newsvideo-security (упакованный сервер + PW_FILE) | 21/0 |
| subtitle-mindur | 36/0 |
| longword | 19/0 (реальный рендер 9:16 — SKIP, как и раньше) |
| video-deps | 33/33 |
| isolation | 65/65 |
| ops | 119 / 0 fail / 2 skip* |
| policy | 46/46 |
| update-center | 79/0* |
| build-files | 96/96 |

\* Первый прогон ops / update-center упал (10 и 8 тестов), потому что в копии дерева лежал игнорируемый артефакт сборки `desktop/build-info.json` (builtAt 2026-10-22T21:36) — фикстуры теста подписаны более ранней датой. Без этого файла (как в чистом checkout) — 119/0/2 и 79/0. К продукту это не относится (`logs/ops.nobi.log`, `logs/update-center.nobi.log`).
Вне запрошенного списка (для сведения, не оценивались): opencode-json, 3d, 3c, e2e-test-build, world (тоже проверяет версию 1.3.2), newsvideo-e2e, smoke, studio-intelligence, media-automation — exit ≠ 0 в этом окружении; логи в `logs/`.

## Находки

**F-1 (High) — single-instance: новая копия молча закрывается, остаётся старое окно.**
`desktop/main.js:25` в 5013621 не менялся. Блокировку по userData делят все TEST-сборки (один appId), поэтому при открытом окне 1.3.0-test новая 1.3.3-test выходит с кодом 0 без сообщения, а у старого окна срабатывает `second-instance` и оно выходит на передний план. Пользователь снова видит старый интерфейс — тот же сценарий, что и в исходном дефекте.
Воспроизведение (Mac, BLOCKED): открыть старую TEST → запустить новую .app → новая копия исчезает без диалога. Ожидалось: диалог «Открыта другая версия TEST (vX). Закройте её (⌘Q) и запустите снова» (например, сравнить версию через `additionalData` у `requestSingleInstanceLock`).

**F-2 (High) — approve без ffmpeg → 500 ENOENT вместо 424.**
`lib/news-video.js` `approve()` вызывает `card()`, которая запускает ffmpeg для фона карточки, до проверки `video-deps`. Проверка `video-deps` стоит только в `render()` и в исполнителе.
Воспроизведение: `scripts/nv5live.sh` — упакованный server.js, в PATH только node → `GET /api/newsvideo/status` показывает, что не хватает ffmpeg/ffprobe/rsvg-convert → search → drafts → `approve` → **500 `ffmpeg: spawn ffmpeg ENOENT`** (`logs/nv5-live.log`). То же на уровне модуля — `scripts/qa-nv5-enoent.mjs`. Это не регрессия diff (код NEWS в 5013621 не менялся), но фикс, ожидаемый по ТЗ, в коммит не вошёл.

**F-3 (Low) — в сообщении server.js «vundefined».** Если порт занят сервером того же приложения и flavor, но без поля `version`, в журнале: «Порт … занят другой версией сервера (vundefined, pid …)». В service.js / main.js для этого случая выводится «?»; в server.js этого нет. Воспроизведение: `scripts/scen.mjs`, порт 18743.

**F-4 (Low) — main.js (не macOS) шлёт SIGTERM на PID из ответа `/api/health`.** PID берётся из HTTP-ответа любого локального процесса, который выдаёт себя за `moonkatty-ai-studio` того же flavor. Это затрагивает только dev/Linux (на darwin используется launchctl), сигнал отправляется только от имени текущего пользователя. Рекомендация: сверять PID с `server.pid` в каталоге данных.

**F-5 (Low) — тесты не обновлены под 1.3.3.** `design3d-disabled-test` и `world-class-test` проверяют версию «1.3.2-test» → по 1 FAIL на каждый. Остальные проверки этих наборов PASS.

**F-6 (Info, к пункту 8) — по сути будущего шага инструкции.** ⌘Q закрывает только окно: фоновый сервер старой TEST запущен через launchd с `KeepAlive` и продолжает занимать 8687 (main.js:172 — «server keeps running either way»). Поэтому формулировка «⌘Q старой TEST — и порт свободен» была бы неточной. Корректный путь в 1.3.3 — открыть новую TEST и нажать «Запустить сервер»: по коду старый сервер перезапускается через `bootout` / `kickstart -k`. На Mac — BLOCKED. ⌘I (Свойства в Finder) покажет версию **1.3.3-test** — проверено по `CFBundleShortVersionString` в Info.plist архива.

## Артефакты
- `logs/` — все логи наборов, `gate.log` (SUMMARY 134/134), `scen-result.json`, `nv5-live.log`, `live.log` (newsvideo-security, owner-approval-real ×3, longword), `rebuild.log`, `suite-summary.txt`
- `scripts/` — сценарии аудита (scen.mjs, gate.mjs / gate-run.sh, live.sh, nv5live.*, qa-nv5-enoent.mjs)

## Честность
Mac / iPhone (launchd, реальный single-instance, Finder ⌘I, ⌘Q) — BLOCKED. Пункт 8 — NOT TESTED: проверяемого текста нет. Ничего не помечено PASS без прогона.
