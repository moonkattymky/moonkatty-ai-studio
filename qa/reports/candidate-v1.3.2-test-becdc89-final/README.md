# ФИНАЛЬНЫЙ дельта-аудит candidate/v1.3.2-test @ becdc89 (диапазон b50a1b0..becdc89)

Дата прогона: 2026-10-22 (Asia/Jerusalem). Node 22.23.3, Linux.  
Коммит: `becdc89a1d281e14730236bd4e60f32e3182f088` — merge `9efce6e` (F-1 subtitle min duration) в `candidate/v1.3.2-test`.

Правила соблюдены: код продукта не менялся; в `server/jobs*` и `server/blender*` ничего не писалось; секреты не трогались; реальные внешние вызовы отсутствуют (RSS для NEWS — preload `rssmock.cjs`); процессы останавливались только по точному PID (без pkill/killall); порты **8687 / 8787 / 4096** не трогались; `security-test` не параллелился с другими аудиторами.

Поставленный zip: `/workspace/mk-candidate-build/dist/MOONKATTY-AI-STUDIO-TEST-1.3.2-test-arm64-mac.zip` — скопирован в `/tmp/fin2/`, оригинал не изменялся.

## Итоговый вердикт: **PASS**

F-1 закрыт на упакованном сервере: NEWS 16:9 с 64-символьным словом успешно рендерится; SRT без коротких cue и без перекрытий. Гейт 64d4fd0 и метка video-агента b50a1b0 сохранены после merge. Дельта содержит только файлы `9efce6e`. Все запрошенные наборы — PASS (или честный SKIP unit-части без PW_FILE, с повторным живым прогоном где нужно).

## Пункты

| Пункт | Статус | Детали |
|---|---|---|
| sha256 поставленного zip | PASS | `6b076fb2a22325d64106e539047a1d48569267747cc64697613acbe28b4ec0a1` — совпадает с заявленным; оригинал не менялся |
| Пересборка FLAVOR=test из becdc89 (отдельный worktree `/workspace/finbuild`) | PASS | **побайтно идентична**: тот же sha256 zip; `app.asar`, `subtitles.js`, `factory2.js`, `feature-gate.js`, `services.js`, `build-info.json` — same |
| Info.plist | PASS | `CFBundleIdentifier` = `com.moonkatty.aistudio.test`, версия `1.3.2-test` |
| build-info | PASS | commit `becdc89a1d281e14730236bd4e60f32e3182f088`, version `1.3.2-test`, flavor `test`, appId `com.moonkatty.aistudio.test` |
| Diff b50a1b0..becdc89 | PASS | только 2 коммита: `9efce6e` + merge `becdc89`. Файлы: `media-automation/src/video/factory2.js` (+1), `subtitles.js` (+normalizeCues), `package.json` (scripts), `scripts/owner-approval-real-test.mjs` (timeout 45s), `scripts/subtitle-mindur-test.mjs` (новый). `git show --remerge-diff`: конфликт только в scripts package.json — **оба набора сохранены** (`test:opencode-task-disabled`, `test:design3d-disabled`, `test:video-deps`, `test:subtitle-mindur`) |
| 64d4fd0 гейт после merge | PASS | `httpGuard` + `normPath` (lower, trailing slash, decode) в `lib/feature-gate.js` на месте; `NON3D_JOB_KINDS`, `is3dTask` lenient — на месте |
| b50a1b0 video-agent label | PASS | `lib/services.js` createJob: non-3D → `agentId: 'video'` (не design3d); `is3dType` gate перед create |
| Упакованный сервер (порт 8991) — 16:9 NEWS + 64-симв. слово | PASS | status=rendered; ffprobe **1920×1080**, ~21.8 с; SRT min cue **3.891 с** (≥0.8 / допуск 0.6); overlaps=0; фрагмент long-word присутствует. Лог: `logs/long169.log`, `artifacts/news169-long.*` |
| Shorts + длинное слово | PASS | rendered; ffprobe **1080×1920**; SRT min **0.800 с**, overlaps=0. `logs/shorts.log` |
| 16:9 обычный текст | PASS | rendered; ffprobe **1920×1080**. `logs/norm169.log` |
| Пробы гейта 134 варианта | PASS | **134/134**, 5xx=0; все blocked пути → 403 `feature_disabled` (или 404/400 без исполнения); HEAD/OPTIONS <500. `logs/gate.log` SUMMARY |
| Релейбл | PASS | 8× PUT (agentId→design3d, kind→3d/design3d, type→blender_template) на video/news задачах → 403; 3D-задач/jobs в БД = 0 |
| Логин | PASS | 200 `{"ok":true,"user":"igor"}` |
| confirm:true → 403 | PASS | `/api/world/savings` confirm:true → 403 `needs_owner` (сессия и app-token). `/api/world/action` с неверным type → 403 `forbidden` (не дыра). Покрыто также world-approval / approvals-e2e |
| approvals / self-approval | PASS | world-approval **18/18**, approvals e2e **45/45** (в т.ч. self_approval 403 / consume-once 409); owner-approval-real ×3 на свежем сервере (8992) — все **7/7** (таймаут 45s из 9efce6e устранил прежний flake) |
| opencode | PASS | `opencode_task` job → 403 `feature_disabled` (сессия и app-token) |
| video-deps | PASS | suite **33/33**; на упакованном video_render не 403 (валидация полей → 400 без gate) |

## Наборы тестов

| Набор | Результат |
|---|---|
| design3d-disabled | **107/107** PASS |
| security (не параллельно) | **52/52** PASS |
| world-approval | **18/18** |
| approvals e2e | **45/45** |
| owner-approval-real ×3 (свежий упакованный :8992) | **3×7/7**, exit 0 |
| newsvideo | **62/0** |
| newsvideo-security (живой :8993 + PW_FILE) | **21/0** |
| subtitle-mindur | **36/0** (unit; реальные рендеры — отдельно в long169/shorts) |
| longword | **19/0** (unit; живые Shorts/16:9 — отдельно) |
| video-deps | **33/33** |
| isolation | **65/65** |
| ops | **119 pass / 0 fail / 2 skip** |
| policy | **46/46** |
| update-center | **79/0** |
| build-files | **96/96** модулей |
| пробы гейта (упакованный) | **134/134**, 5xx=0 |

## Находки

- **Нет блокирующих / FAIL.** F-1 из аудита b50a1b0 закрыт коммитом `9efce6e` (`normalizeCues` в `buildSrt` / factory2): на упакованном becdc89 16:9+64-симв. слово → rendered, min cue 3.891 s.
- **owner-approval-real flake устранён** увеличением waitForFunction до 45s (в дельте): 3/3 свежих прогона 7/7 без timeout.
- Инфо: в первом прогоне `npm run test:newsvideo-security` без `PW_FILE` → SKIP; повтор с `PW_FILE`+упакованным сервером — 21/0. Честно отмечено в логах.
- Порт 8687 слушал чужой node (pid 926997) — **не трогался**.

## Артефакты

- `logs/` — все suite-логи, gate, long169, shorts, norm169, smoke, owner-approval-real, package
- `artifacts/` — SRT и ffprobe для 16:9 long-word, Shorts long-word, 16:9 normal

## Вердикт по честности

Все шаги из ТЗ выполнены и имеют PASS (или повторно прогнаны после SKIP). Ничего не помечено PASS без прогона. **Итог: PASS.**
