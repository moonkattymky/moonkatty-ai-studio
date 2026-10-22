# Аудит feat/e2e-news-video-3d @ 78efc89 — ВЕРДИКТ: PASS

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
