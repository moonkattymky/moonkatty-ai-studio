# ФИНАЛЬНЫЙ аудит candidate/v1.3.2-test @ b50a1b0 (диапазон 7f0129f..b50a1b0)

Node 22.23.3, Linux. Код продукта не менялся; в server/jobs* и server/blender* ничего не писалось; реальных внешних вызовов нет (для NEWS-рендера RSS подставлялся тестовым preload `rssmock.cjs`, остальной не-loopback fetch падал как без сети). Порты 4096/8787 не трогались. security-test запускался только когда параллельного не было.

## Итоговый вердикт: **FAIL** (одна функциональная находка, не безопасность)

3D-гейт, упаковка, approvals, регрессия — **PASS**. FAIL только из-за F-1: заявленное в диапазоне исправление S5-NV-01 («длинные слова — все пресеты») не работает для 16:9: рендер NEWS 16:9 с 64-символьным словом детерминированно падает. Это не регрессия (на 7f0129f падает хуже), но заявленный фикс не выполнен.

## Пункты

| Пункт | Статус | Детали |
|---|---|---|
| sha256 поставленного zip | PASS | 6b11979e…148e1e совпадает (оригинал скопирован, не изменялся) |
| Пересборка FLAVOR=test из b50a1b0 (отдельный worktree) | PASS | **побайтно идентична**: тот же sha256 zip |
| Info.plist | PASS | CFBundleIdentifier com.moonkatty.aistudio.test, CFBundleShortVersionString/Version 1.3.2-test |
| build-info | PASS | commit b50a1b06c75a…, version 1.3.2-test, flavor test |
| Содержимое asar/unpacked | PASS | нет task-runners, scripts/, тестов, токенов (поиск ghp_/github_pat_/sk-/xox — 0). Есть только намеренно включённые: `media-automation/fixtures/platforms-snapshot.sample.json` (mock, указан в build.files), `lib/ops/update-keys/stub-test-ed25519.pub.pem` (публичный ключ-заглушка), `node-agent.env.example` |
| c25c25d merge | PASS | `git show --remerge-diff`: единственный конфликт — scripts в package.json (оба скрипта сохранены), других ручных правок нет |
| 64d4fd0 гейт | PASS | httpGuard на /api с нормализацией (регистр, `//`, `/` в конце, decodeURIComponent), choke-point в put(tasks), runner.start, world/plan |
| b50a1b0 video → агент video | PASS | см. ниже |
| Пробы на УПАКОВАННОМ сервере (порт 8971) | PASS **134/134**, 5xx = 0 | 38 старых (19×сессия/app-token, включая все 13 прежних промахов) — все 403 feature_disabled; 80 новых вариантов (%2F, %2e, %73, `..`, `//`, `;params`, `?q`, PATCH/PUT/DELETE, /api/tasks, world/plan, agents/design3d/start, `DESIGN3D`, массив) — 403 feature_disabled либо 404/400 (маршрут не достигнут); HEAD/OPTIONS — 404; 8 relabel-атак — 403. 3D-задач и 3D-заданий в БД — 0 |
| Релейбл / legacy (b50a1b0) | PASS | PUT agentId→design3d, kind→3d/design3d, type→blender_template на задачах агентов video и news (сессия и app-token) — 403, задача не изменена. Создать задачу design3d/3d (в т.ч. agentId video + kind 3d) — 403. Legacy-путь (по коду): нестрогий режим только для **уже существующих** строк kind video_render/opencode_task/render_segment; новые строки строгие; смена status/kind/agentId 3D-задачи клиентом — 403 (middleware /api/tasks); раннер отказывает агенту design3d; video_render идёт через startVideoJob (ffmpeg), не Blender. Новой дыры нет. Живьём legacy-строку не создавал (нельзя без правки БД) — эта часть по коду |
| Логин | PASS | 200; 5 неверных паролей 401, далее 429 (throttle) |
| confirm:true → 403 | PASS | /api/world/savings и /api/world/action с confirm:true → 403 needs_owner |
| approval / self-approval | PASS | world-approval 18/18, approvals e2e 45/45, owner-approval-real на упакованном сервере 4/5 прогонов 7/7 (см. flake) |
| opencode_task | PASS | 403 feature_disabled (сессия и app-token) |
| NEWS 16:9 → MP4 | PASS | упакованный сервер: rendered, ffprobe h264 1920×1080 + aac, 26.5 с |
| Shorts с длинным словом | PASS | rendered, ffprobe h264 1080×1920 + aac, 65.1 с; SRT ≤ 28 символов, слово разбито (26/26) |
| video_render end-to-end | PASS | задания video_render с агентом **video**, done (403 больше нет) |
| video-deps | PASS | 33/33; живой статус: ffmpeg/ffprobe/rsvg найдены, renderReady true |
| Запуск .app на реальном Mac | BLOCKED | |

## Находки
- **F-1 (Medium, функциональная, не регрессия).** NEWS 16:9 (preset youtube) с 64-символьным словом: `render_failed: subtitle validation failed: cue 7: too short 0.48s` — 2 из 2 прогонов. На 7f0129f то же падает сильнее (строки 64/82 > 46 + короткий cue). То есть разбивка длинных слов в 16:9 улучшена, но порождает слишком короткий cue, валидатор отклоняет. Shorts (9:16) с тем же текстом — проходит. Лог: logs/video-169*.log.
- **owner-approval-real flake — только тайминг.** 1-й прогон на свежем сервере: `waitForFunction` 15 с (ожидание кнопки «approve» в UI) — timeout; при этом сервер approval создал (pending, видно в /api/world/approvals). Прогоны 2–5: 7/7. Серверной ошибки/неверного порядка нет; холодный старт Chrome/первая отрисовка > 15 с. Рекомендация: увеличить таймаут/ждать загрузки Approval Center.
- Инфо: в пакете mock-фикстура платформ и публичный stub-ключ (намеренно, в build.files).

## Счётчики
| Набор | Результат |
|---|---|
| design3d-disabled | **107/107** PASS |
| security | **52/52 ×2** |
| world-approval | 18/18 |
| approvals e2e | 45/45 |
| owner-approval-real | исходник без REAL_URL — SKIP; на упакованном сервере: 1-й прогон timeout, 4×7/7 |
| newsvideo | 62/0 |
| newsvideo-security (живой упакованный) | 21/0 |
| video-deps | 33/33 |
| isolation | 65/65 |
| ops | 119 / 0 / 2 skip |
| policy | 46/46 |
| update-center | 79/0 |
| build-files | 96/96 модулей |
| пробы гейта (упакованный) | 134/134, 5xx 0 |
| longword Shorts (живой) | 26/26 |
