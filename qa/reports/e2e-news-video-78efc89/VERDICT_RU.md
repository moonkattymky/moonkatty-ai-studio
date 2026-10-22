# Аудит feat/e2e-news-video-3d @ 78efc89 + d11c16c — ВЕРДИКТ: PASS

Коммиты: b3277e1 (QA-DD-001 UI), 852d1ea (security-test: случайный порт + mkdtemp), 6a74a18 (S5-NV-01), 78efc89 (S5-NV-02).

| Проверка | Результат |
|---|---|
| QA-DD-001 owner-approval-real-test, бэкенд b1073fd + app.js 78efc89 | PASS 7/7 (×2; ещё 7/7 ×3 с app.js 852d1ea) |
| То же с app.js dd03cae | 6/7 ×2 (падает «UI shows execution result»), регрессия подтверждена |
| UI после approve: результат сервера, без повторного запроса и 409, форма сбережений не переотправляется | PASS |
| params_hash напрямую через API: другие params → 403 not_approved; повтор после approve → 409 consumed; подменённые params в теле approve игнорируются (применено 222, не 888) | PASS |
| security-test | PASS 52/52 ×3 на 78efc89 (+52 ×4 на 852d1ea) |
| isolation 65/65, newsvideo 62/0, newsvideo-security 23/0 (live), build-files 93/93, subtitle-split 6/0, longword 19/0, offline-ui 9/0 | PASS |
| S5-NV-01 live Shorts (слова 42/66/45 симв., вкл. кириллицу) на собранном пакете | ИСПРАВЛЕНО: макс. строка SRT 28 (35 строк), ffprobe h264 1080×1920 + aac, 98.7 с; повторный рендер (r3) — тоже 28, 1080×1920 |
| S5-NV-02 offline toast | ИСПРАВЛЕНО: тост об ошибке «Поиск не удался…», ложного успеха нет |
| Пакет FLAVOR=test @ 78efc89, запуск | PASS; zip sha256 64013de2…160b4; build-info commit 78efc89, flavor test |
| Live NEWS 16:9: поиск → черновик → 422 без fact-check → approve → render → export, 1920×1080 | PASS |
| Diff: только UI/тесты/видео (factory*, graphics, subtitles, app.js, scripts/*) | PASS; no-network.cjs только в scripts/fixtures, в asar отсутствует |

## Замечания
- **Low (тест):** первый прогон owner-approval-real-test на свежем сервере падает по таймауту waitForFunction 15 с (на обоих бэкендах), последующие проходят. Флейк теста, не продукта.
- **Info:** `POST /api/jobs/:id/retry` для успешного задания → 400 (ожидаемо). Путь «retry после сбоя» не проверен: после фикса рендер не падает; вместо него выполнен повторный рендер. NOT TESTED для retry-after-failure.

Продуктовый код не менялся; merge/release/push в main не выполнялись.

## Дополнение: d11c16c (lib/video-deps.js), пакет собран и запущен из d11c16c
- Diff 78efc89..d11c16c: lib/news-video.js, lib/video-deps.js, package.json, public/app.js, scripts/video-deps-test.mjs, server.js — ожидаемо.
- Пакет FLAVOR=test @ d11c16c: zip sha256 59bdf4e2f83cf5cff7b91064e255edf95a612843ae211541656eec6c05bc9c8a; build-info commit d11c16c, flavor test; запуск OK. В asar нет no-network.cjs / longword-test / video-deps-test.
- test:video-deps: **33/33 PASS**.
- Только stat: в video-deps.js нет exec/spawn/child_process/install; statSync + isFile + accessSync(X_OK). **PASS**.
- Live: пакет с PATH без ffmpeg/ffprobe/rsvg-convert → /api/newsvideo/status: ffmpeg/ffprobe/rsvg=false, renderReady=false, missing=[3], hint «brew install ffmpeg librsvg»; POST render → **424 video_deps_missing**; задание не создано (jobs 3→3), renders 3→3, статус черновика rendered→rendered. **PASS**. Проверка выполняется после проверок approve/лимита и до createJob.
- С полным PATH: renderReady=true; Shorts r4 succeeded, макс. строка SRT 28, ffprobe h264 1080×1920 + aac (регресс S5-NV-01 на d11c16c — PASS).
- На d11c16c: security 52/52, newsvideo 62/0, newsvideo-security 23/0 (live) — PASS.
- UI: nvReady() использует renderReady, кнопки рендера отключаются — проверено статически; визуально NOT TESTED.

### Оценка безопасности добавления Homebrew-каталога в PATH
- Меняется только `process.env.PATH` текущего процесса сервера, и только при `env === process.env`. Каталог **добавляется в конец**, поэтому существующие записи PATH не перекрываются и подмена приоритета невозможна. Это изменение наследуют все дочерние процессы сервера (ffmpeg, раннеры, OpenCode), получая /opt/homebrew/bin или /usr/local/bin. Это стандартные каталоги, и обычный shell-PATH на macOS уже содержит их. — **Low/Info**.
- Ввод пользователя или запроса на список каталогов не влияет: каталоги заданы константой, а NV_DEPS_FALLBACK_DIRS (тестовый хук) читается только из env процесса. Имена бинарников фиксированы (DEPS frozen). — PASS.
- Проверяются обычный файл и бит X_OK. statSync следует по symlink, поэтому symlink на исполняемый файл принимается (так устроен Homebrew), а symlink на каталог или битый symlink отклоняется. Путь строится через path.join абсолютного каталога. Записи PATH могут быть относительными, но это наследуемый PATH процесса и в недоверенный ввод не превращается. — PASS.
- **Info:** права на запись в каталог (world/group-writable) и владельца код не проверяет. На Mac /opt/homebrew/bin принадлежит пользователю-админу, а /usr/local/bin может быть доступен пользователю на запись. Каталог стоит в конце PATH, поэтому риск ограничен случаем, когда бинарника нет раньше в PATH. Рекомендация (не блокер): проверять `!(mode & 0o022)` для fallback-каталога.
- Реальное поведение на macOS (GUI-запуск с минимальным PATH, Homebrew) — **BLOCKED** (нет Mac).
