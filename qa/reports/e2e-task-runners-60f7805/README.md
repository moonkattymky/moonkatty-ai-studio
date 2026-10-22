# Повторный аудит N5 — feat/e2e-task-runners @ 60f7805

22.10.2026, Asia/Jerusalem (UTC+3). Node v22.23.3, Linux, bwrap. Продуктовый код не менялся; реальный opencode не запускался (fake на PATH); порты 4096/8787 не использовались; security-test запускался, только когда параллельно не шёл другой security-test.
Коммиты после e2bb78b: 2fdd6ca, eb819da, 64b4109, f6446c5, 60f7805 (6 файлов, +113/−35).

## Вердикт: **FAIL**
NEW-2 не исправлен для реальной раскладки упакованного приложения: Electron запускает `Resources/app.asar.unpacked/server.js` обычным Node (desktop/main.js:41), а `isPackaged()` этот путь не распознаёт → `MK_TEST_REAL_RUNNERS=1` по-прежнему включает реальные раннеры в упакованной TEST-сборке. Остальные заявки подтверждены.

## Статус по пунктам
| Пункт | Статус | Доказательство |
|---|---|---|
| NEW-1 песочница (Linux) | **PASS** | В bwrap: HOME=/home/sandbox (tmpfs); не читаются fake-$HOME/secret, `~/.config/gh/hosts.yml`, `data/app-token`, /etc/passwd, /etc/shadow, /workspace; корень = только bin dev etc home lib lib64 proc sbin tmp usr. Сеть: в /proc/net/dev только `lo` (свой netns); TCP к API Studio (порт пробы) — нет, к 127.0.0.1:11434 — нет, curl → 000. Запись «наружу» уходит в tmpfs /tmp песочницы — на хосте файла нет (проверено). В «data dir» внутри виден лишь пустой каркас tmpfs, app-token отсутствует. env: только allowlist. |
| NEW-1 профиль macOS | **BLOCKED** (исполнение), по коду — см. ниже | |
| NEW-3 TOCTOU | **PASS** | Гонка «файл↔symlink наружу»: 2000 запусков, принято 334, все с содержимым INSIDE, 0 OUTSIDE. Гонка подмены каталога-компонента (`real` ↔ symlink наружу): 3000 запусков, принято 469, 0 OUTSIDE. Ещё 3000 с symlink-каталогом: 484 принято, 0 OUTSIDE. ffmpeg запущен в bwrap (artifact sandbox=bwrap), видит только копию в workdir. |
| NEW-4 убийство дерева | **PASS (Linux)** / **BLOCKED (macOS)** | После HTTP cancel не растут файлы child, `setsid`-внука и обычного фонового внука; `ps` — 0 остатков. Таймаут 2 с → failed «timeout после 2 с», внуки мертвы. На macOS по коду: `detached:true` + `kill(-pgid)`; `setsid`-внук ушёл бы из группы — на Linux это закрывает pid-ns bwrap, на macOS — нет (см. M-2). |
| NEW-2 MK_TEST_REAL_RUNNERS в packaged | **FAIL** | Упакованная TEST-сборка (`FLAVOR=test scripts/package-mac-on-linux.sh`), дерево `…/Resources/app.asar.unpacked/server.js` запущено Node 22 как в desktop/main.js:41: flavor=test (FLAVOR_SOURCE=baked), но `isPackaged()` = **false**; с `MK_TEST_REAL_RUNNERS=1` задание opencode_task **done** (fake запущен в bwrap), без переменной — failed «отключено в TEST-сборке». Причина: `lib/task-runners.js` isPackaged — regex `app\.asar([\\/]|$)` не совпадает с `app.asar.unpacked`, `process.resourcesPath` и `electron` в дочернем Node отсутствуют. Юнит-тест (scripts/task-runners-test.mjs:76-77) проверяет только путь `app.asar/` и подставленный resourcesPath, поэтому зелёный. Исправление: опираться на `studio-config.FLAVOR_SOURCE === 'baked'` (или на наличие вшитого lib/flavor.baked.js). |
| NEW-5 retry | **PASS** | retry отменённого opencode_task → 403 needs_owner + новый approvalId; до одобрения повторного запуска нет; одобрение → **новое** задание; повтор одобрения → 409. retry render_segment → 403 needs_owner; если audio подменён на symlink → 400 с единой ошибкой. |
| security-test: случайный порт + mkdtemp | **PASS** | 2 прогона 52/52. |

## Новые находки
- **M-1 MEDIUM — NEW-2 не закрыт** (см. выше), `lib/task-runners.js` `isPackaged()` + `lib/services.js:117`.
- **L-1 LOW — каталог бинарника монтируется целиком.** `sandboxed()` добавляет `realDir(bin)` и `dirname(bin)` в ro-маунты. Если opencode лежит прямо в $HOME (`OPENCODE_BIN=~/opencode`) — весь $HOME читается из песочницы (live: fake-secret читается = yes; gh hosts вне этой папки — нет). Типовые установки (`~/.opencode/bin`, `/usr/local/bin`) открывают только свою папку. Рекомендация: монтировать только файл бинарника (+ известные каталоги рантайма), не родителя, если это $HOME.
- **L-2 LOW (теоретический) — copyConfined** берёт `lstat(rp)` уже после realpath; при подмене промежуточного каталога между realpath и lstat оба (lstat и open) увидят внешний файл и dev/ino совпадут. В 6000 попытках гонки не сработало. Рекомендация: сравнивать с идентичностью, полученной при realpath, или открывать по компонентам через openat/O_NOFOLLOW (или проверить realpath fd через /proc/self/fd / F_GETPATH после open).
- **M-2 MEDIUM (macOS, BLOCKED) — профиль sandbox-exec по коду:** `(deny default)`, чтение только системных каталогов + каталог бинарника + workdir, запись только workdir, сети нет — направление верное. Замечания: (а) `(allow process-exec process-fork signal (target same-sandbox))` — фильтр `target` допустим только для `signal`; профиль может не скомпилироваться (fail-closed — задание просто упадёт) — проверить на Mac; (б) нет `mach-lookup`/`ipc` — opencode (Bun) и ffmpeg на macOS, вероятно, не запустятся; (в) глобальный `file-read-metadata` — оракул существования/метаданных для любого пути, включая $HOME (низкий риск); (г) `setsid`-внуки на macOS покидают группу и переживут cancel.
- **Оценка признанного ограничения (сеть выключена):** opencode в песочнице не может обратиться ни к Ollama (127.0.0.1:11434 — проверено: недоступен), ни к облачным провайдерам; конфиг/ключи opencode из ~/.config, ~/.local/share тоже не видны. Фактически opencode_task безопасен, но **функционально нерабочий**: задание упадёт с ошибкой провайдера или провисит до таймаута (по умолчанию 1800 с, занимая heavy-lock). Это не уязвимость, а продуктовое ограничение (INFO/MEDIUM по доступности). Предложение: отдельный unix-socket/HTTP-прокси только к Ollama (allowlist одного upstream), пробрасываемый в bwrap как файл сокета, при сохранении `--unshare-net`; на macOS — `(allow network-outbound (remote ip "localhost:11434"))` только для этого порта (при этом API Studio остаётся закрыт); и короткий таймаут/быстрый отказ, если LLM недоступна.
- **INFO — загрязнение ops-тестов:** после упаковки в рабочем дереве остаётся игнорируемый `desktop/build-info.json`; с ним 14 тестов update-center падают («подписанный builtAt старше сборки»). Без файла — 119/0/2. Не регрессия продукта, но тесты зависят от артефакта сборки.

## Счётчики (Node 22.23.3)
| Набор | Studio 2 | Получено |
|---|---|---|
| runners | 36/36 | **36/36** |
| runners-http | 20/20 | **20/20** |
| security | 52/52 | **52/52** ×2 |
| policy | 46/46 | **46/46** |
| ops | 119/119 | **119 pass / 0 fail / 2 skip** (чистое дерево); первый прогон 105/14 — из-за оставшегося build-info.json (см. INFO) |
| world | 62/63 | **62/63** (FAIL 3 — нет модели Ollama qwen3:8b, окружение) |

## Сборка/запуск
`FLAVOR=test scripts/package-mac-on-linux.sh` → exit 0. `Resources/app.asar.unpacked/server.js` из упакованного .app запускается (Node 22, 127.0.0.1, temp data): /api/health ok, flavor=test, 1.3.1-test, db ok. Запуск на реальном Mac — BLOCKED.

## Артефакты
`probe4.mjs` (побег из песочницы, cancel/timeout, retry), `probe5.mjs` (packaged gate), `race.cjs`/`race3.cjs` (TOCTOU), `logs/`.
