# Отдельный аудит безопасности N5 — feat/e2e-task-runners @ e2bb78b

Аудитор: независимый QA/security. Дата: 22.10.2026 (Asia/Jerusalem, UTC+3). Node v22.23.3, Linux (bwrap 0.x, ffmpeg есть).
База ветки: `git merge-base HEAD origin/feat/e2e-security-agents` = af327b6 (3b72817 — предок; diff от него шире: 14 файлов, т.к. включает N1/N2 из security-agents).
Diff af327b6..e2bb78b: 9 коммитов (3efeda5 … e2bb78b), 9 файлов, +170/−35. Продуктовый код не менялся; в server/jobs*, server/blender* не писалось; порты 4096/8787 не трогались; реальный opencode не запускался (fake на PATH).

## Итоговый вердикт: **FAIL**
Причина: остаточная HIGH-проблема силы песочницы (NEW-1) — обязательная песочница есть, но дочерний процесс читает $HOME (включая конфиг gh с токеном) и имеет открытую сеть, включая loopback к API Studio. Остальные исходные пункты закрыты (PASS), macOS-часть — BLOCKED.

## Статус исходных находок (28c2f3b)
| # | Находка | Статус | Доказательство |
|---|---|---|---|
| 1 | CRITICAL: дочернему процессу весь process.env | **PASS** | fake opencode увидел только `HOME LANG LC_ALL LOGNAME PATH PWD TERM TMPDIR USER` (PWD ставит sh). STUDIO_SECRET_KEY, STUDIO_ADMIN_PASSWORD/USER, ADMIN_TOKEN, GITHUB_TOKEN, GH_TOKEN, OPENCODE_SERVER_PASSWORD, OPENCODE_PASSWORD, OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, MK_TEST_REAL_RUNNERS — отсутствуют. HOME/TMPDIR = workDir. |
| 2 | CRITICAL: нет песочницы для `opencode run` | **PASS (наличие/обязательность)**, но сила профиля — **FAIL → NEW-1** | Linux: реально bwrap (PID1 в pid-ns = `/usr/bin/bwrap … --unshare-all --share-net --die-with-parent --new-session`), artifact.sandbox=`bwrap`. Без bwrap на PATH → job failed «sandbox unavailable…», fake не запускался. macOS sandbox-exec — **BLOCKED** (нет Mac), профиль проверен только чтением кода. |
| 3 | HIGH: prompt → флаги argv | **PASS** | argv = `run`, `--`, `<prompt>` одной строкой; `--version`, `-x`, ` --help` (после trim) → 400; `"hello --version --model evil"` и `"a\n--dangerously-skip"` остаются позиционным аргументом после `--`. |
| 4 | HIGH: HTTP cancel не убивал child | **PASS (Linux)** / **BLOCKED (macOS)** | Cancel по HTTP: child и `setsid`-внук перестали писать, `ps` — 0 остатков (bwrap pid-ns + die-with-parent). На macOS дерево не убивается гарантированно (NEW-4), проверить нельзя. |
| 5 | HIGH: любой авторизованный создаёт задания, нет Approval Center | **PASS** | opencode_task и render_segment через POST /api/jobs → 403 needs_owner + approvalId, задание не создаётся. app-token approve → 403; без пароля → 403; неверный пароль → 403; повтор approve → 409 consumed; reject после approve → 409; `approvalId` в теле POST /api/jobs игнорируется (403 needs_owner); /api/world/action agent_code_execution → approve даёт `not_wired`, задание не создаётся; executor проверяет params_hash (approvalExecuting: approved+consumed+без exec_status+тот же hash). Self-approval: сессия→та же сессия с паролем в окне 15 мин = 200 (задокументированный step-up владельца, единственный пользователь), не дыра. |
| 6 | HIGH: нет test/prod гейта | **PASS с оговоркой → NEW-2** | TEST по умолчанию: opencode_task и render_segment → failed «отключено в TEST-сборке», ничего не спавнится (исходники и упакованный app). Но env `MK_TEST_REAL_RUNNERS=1` включает реальные раннеры и в упакованной TEST-сборке (проверено: job done, sandbox bwrap). |
| 7 | HIGH: audioPath вне media/, оракул существования | **PASS** (конфайнмент и единая ошибка) / остаток **NEW-3** (TOCTOU) | Матрица: абсолютный вне, несуществующий вне/внутри, `../app-token`, `../nope`, symlink наружу, symlink на /etc/passwd, каталог, symlink-каталог наружу, NUL, число → все 400 с одним и тем же текстом; валидный → 403 needs_owner. Подмена файла на symlink между запросом и approve → executor failed (повторная проверка). Но гонка check→spawn ffmpeg воспроизведена. |
| 8 | opencode_task без heavy-lock | **PASS** | render_segment, одобренный пока opencode держит lock → `queued`; после cancel opencode → done. Обе ветки идут через `withHeavy(kind+':'+id)` (services.js:129). |
| — | Таймауты | **PASS** | timeoutSec=2 → failed «timeout после 2 с», внук не живёт. |

## Новые находки
- **NEW-1 HIGH — слабый профиль песочницы.** `lib/task-runners.js:30-32` (bwrap): `--ro-bind / /` + `--share-net`; скрыты только DATA_DIR и каталог БД. Live: из песочницы читаются реальный $HOME (fake secret = yes) и `~/.config/gh/hosts.yml` (yes, содержимое не читалось), сеть открыта, `fetch http://127.0.0.1:<port>/api/health` → 200 (доступен loopback: API Studio, opencode serve, Ollama). macOS `lib/task-runners.js:25`: `(allow default)` — сеть, exec, mach-lookup (Keychain) и чтение всего $HOME, кроме hideDirs, разрешены (только по коду; BLOCKED live). Комбинация «агент с LLM + чтение секретов пользователя + сеть» = возможность эксфильтрации. Рекомендация: tmpfs на $HOME (кроме нужного), явный allowlist чтения; сеть — только через egress-прокси/allowlist, без loopback (`--unshare-net` + прокси); на macOS `(deny default)`-профиль с явными разрешениями, `(deny network-outbound (remote ip "localhost:*"))`.
- **NEW-2 MEDIUM — env-байпас TEST-гейта.** `lib/services.js:117`: `process.env.MK_TEST_REAL_RUNNERS === '1'` включает реальные раннеры в TEST; упакованная сборка (флейвор вшит и env для флейвора игнорирует) этот переключатель уважает. Рекомендация: учитывать только в source-checkout (`FLAVOR_SOURCE` = env(source-checkout)) или вшивать при сборке.
- **NEW-3 LOW/MEDIUM — TOCTOU audioPath между realpath и open в ffmpeg.** `lib/task-runners.js:56-60, 73, 80`: проверяется realpath, но ffmpeg открывает путь сам и следует symlink. Гонка (замена файла в media на symlink наружу в цикле): из 44 принятых рендеров 5 открыли внешний файл. ffmpeg запускается **без песочницы**. Писать в media может, в частности, одобренный opencode-агент (workDir внутри media/opencode-tasks). Рекомендация: открывать с O_NOFOLLOW и передавать `/dev/fd/N`/pipe, либо копировать в приватный каталог задания; запускать ffmpeg тоже в bwrap.
- **NEW-4 MEDIUM (macOS, BLOCKED live) — cancel/timeout не убивает дерево на macOS.** `lib/task-runners.js:42-44`: spawn без `detached`, `p.kill()` шлёт сигнал только sandbox-exec→opencode; потомки (shell/LSP/инструменты агента) переживают отмену. На Linux закрыто bwrap pid-ns. Рекомендация: `detached:true` + `process.kill(-pid)`.
- **NEW-5 LOW — /api/jobs/:id/retry для opencode_task/render_segment.** `server.js:427-433`: задание уходит в design3d-runner (ответ `running`, затем `blocked` «Blender не найден»), а не в startTaskJob. Повторного запуска opencode/ffmpeg без нового approve не было (проверено, в т.ч. после рестарта) — обхода нет, но маршрут ошибочный; на Mac с Blender это запустит design3d-пайплайн для задачи без текста. Рекомендация: запретить retry для этих типов (нужен новый approval).
- **NOTE (вне N5)** — тип `design3d` через POST /api/jobs создаётся без Approval Center, а пайплайн включает OpenCode-агента. Стоит оценить отдельно.
- **NOTE — флейк security-test:** 1 из 7 прогонов 50/52 (FAIL «app token accepted from loopback without Origin», «password login re-enables app auto-login»), сразу после предыдущего прогона; 6 прогонов 52/52. Тест использует фиксированные порт 8795 и `/tmp/mk-sec-test` — возможна гонка с параллельными аудиторами на общем боксе. Не воспроизвелось.
- **NOTE — world-тест** при прогоне модифицирует отслеживаемый `qa/reports/world-class-v1.3.0/results.json` (мешает упаковке «дерево изменено»).

## Счётчики (Node 22.23.3)
| Набор | Заявлено | Получено |
|---|---|---|
| runners (task-runners-test) | 26/26 | **26/26 PASS** |
| runners-http | 18/18 | **18/18 PASS** |
| security ×2 | 52/52 | прогон1 **52/52**, прогон2 **50/52 FAIL** (флейк), прогоны 3–7 **52/52** |
| policy | 46/46 | **46/46 PASS** |
| ops | 119/119 | **119 pass / 0 fail / 2 skip** (121 всего) |
| world | 62/63 | **62/63** (FAIL 3: модель Ollama qwen3:8b не установлена — окружение) |

## Сборка и упакованный app
`FLAVOR=test scripts/package-mac-on-linux.sh` → exit 0, `MOONKATTY-AI-STUDIO-TEST-1.3.1-test-arm64-mac.zip`. app.asar (+unpacked) распакован, `server.js` запущен (Node 22, 127.0.0.1:8934, temp data dir): **загружается**, /api/health = ok, flavor=test, version 1.3.1-test, db ok. Без env раннеры отключены; с `MK_TEST_REAL_RUNNERS=1` — включены (NEW-2). Запуск .app на реальном Mac — **BLOCKED**.

## Не проверено / BLOCKED
- macOS sandbox-exec live, убийство дерева на macOS, Keychain — BLOCKED (нужен реальный Mac).
- Реальный opencode — NOT TESTED (запрещено правилами; использовался fake).

## Артефакты
`probe.mjs`, `probe2.mjs`, `probe3.mjs` (живые пробы), `race.cjs` (TOCTOU), `logs/` (выводы наборов, хвост упаковки). Секретов в отчёте нет (в пробах только dummy-значения).
