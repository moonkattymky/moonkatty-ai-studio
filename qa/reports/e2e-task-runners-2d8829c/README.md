# Ре-аудит N5 (e2e task runners) — HEAD 2d8829c

Ветка `feat/e2e-task-runners`, коммит 2d8829c. Node 22.23.3, Linux (bwrap). Код продукта не изменялся; реальный opencode не запускался; порты 4096/8787 не использовались.

## Итоговый вердикт: **PASS** (Linux-проверяемая часть); проверки на реальном Mac — **BLOCKED**

Все заявленные исправления M-1, M-2 (Linux-часть), L-1, L-2, fast-fail подтверждены живыми пробами. Блокирующих находок нет. Одна новая находка Low (N3-1) касается только macOS.

## Статус по пунктам

| Пункт | Статус | Доказательство |
|---|---|---|
| M-1 (dec765a) fail-closed isPackaged | PASS | Упакованная TEST-сборка, `server.js` из `Resources/app.asar.unpacked`, `NODE_ENV=test MK_TEST_REAL_RUNNERS=1 MK_TEST_LLM_STUB=1`: job failed «отключено в TEST-сборке», ничего не запущено. `isPackaged()=true` даже при FLAVOR_SOURCE=`env:*` (по пути); `devOverride=false`; `llmChannel()=null`. |
| L-1 (48014f5) бинарь в $HOME | PASS | `OPENCODE_BIN=~/opencode` → «sandbox unavailable», не запущен. Симлинк вне $HOME → `~/opencode` тоже отклонён. `~/bin/opencode`, `~/.opencode/bin/opencode` — запуск ок, `~/secret.txt` НЕ читается. |
| L-2 (9e3cd50) TOCTOU audioPath | PASS | race.cjs (подмена файла симлинком) 3000 итераций: ok 898 / rej 2102 / **outside 0**; race3.cjs (подмена родительского каталога) 3000: ok 535 / rej 2465 / **outside 0**. |
| f212351 kill tree (Linux) | PASS | cancel: процесс, setsid-внук, gc2 мертвы, ps leftovers 0; timeout 2 с → failed, дерево мертво. |
| ec9d75e llm_unavailable fast-fail + heavy-lock | PASS | Без стаба: failed `llm_unavailable` за 56 мс от approve, процесс не порождён; сразу после этого render_segment → done (лок освобождён). |
| Регресс песочницы Linux | PASS | Нет чтения $HOME / gh hosts / data / /etc/passwd / /workspace; сеть только `lo`, Studio/Ollama недоступны; env только allowlist; HOME=/home/sandbox. |
| Retry / Approval | PASS | retry отменённого opencode → 403 needs_owner; без approve не перезапускается; approve → новый job; replay → 409; retry render после подмены audio симлинком → 400. |
| macOS профиль (48014f5) — ревью | PASS (ревью) / исполнение BLOCKED | `(deny default)`, exec только literal бинаря, сеть не разрешена, запись только workDir и /dev/null, mach-lookup ограничен. Замечания ниже. |
| mac-sandbox-check.sh (bb54046) | NOT TESTED (BLOCKED, нужен Mac) | `bash -n` ок; 7 проверок по коду адекватны, кроме случая N3-1. |
| Сборка пакета FLAVOR=test | PASS | `scripts/package-mac-on-linux.sh`, exit 0, `MOONKATTY AI STUDIO TEST.app`. |
| Boot упакованного server.js | PASS | /health ok, flavor test, 1.3.1-test, db ok. Запуск Electron/.app на Mac — BLOCKED. |

## Счётчики тестов (заявлено → получено)

| Набор | Заявлено | Получено |
|---|---|---|
| runners | 50/50 | **50/50** PASS |
| runners-http | 20/20 | **20/20** PASS |
| security | 52/52 | **52/52 ×2** PASS (запускался, когда параллельного security-test не было) |
| policy | 46/46 | **46/46** PASS |
| ops | 119/119 | **119 pass / 0 fail / 2 skipped** PASS |
| world | 62/63 | **62/63** — 1 FAIL ожидаемый: «модель qwen3:8b не установлена» (нет Ollama на стенде, как и в прошлых раундах) |

## Находки

- **N3-1 (Low, только macOS, исполнение BLOCKED).** `descendants()` ищет потомков обходом ps по ppid. Процесс, сделавший double-fork + setsid (промежуточный родитель завершился, внук переподчинён init/launchd), в дерево не попадает и не входит в process group → переживает cancel/timeout. Воспроизведено на хосте без песочницы (`orph.cjs`: `desc:[]`, сирота жив после kill). На Linux закрыто pid-namespace bwrap + `--die-with-parent` (проба: всё убито). На macOS у sandbox-exec нет pid-ns. Тест 7 в mac-sandbox-check.sh проверяет только setsid с живым родителем и этот случай не покрывает. Практический риск низкий: в боевой сборке opencode не запускается вовсе (llm_unavailable).
- **Инфо.** При `llmChannel()=null` вне dev+стаба opencode_task в любой сборке завершается `llm_unavailable` до запуска: функционально выключен, но безопасен. Это согласуется с оценкой прошлого раунда.
- **Инфо (macOS профиль, функционально).** Нет доступа к TMPDIR (`/private/var/folders`), exec только самого бинаря (bash/git/rg из opencode не запустятся). С точки зрения безопасности это не дефект.
- **Инфо.** `services.js:117` проверяет `MK_TEST_REAL_RUNNERS` напрямую, но вместе с `TR.isPackaged()`, а fail-closed isPackaged закрывает обход. Подтверждено живьём.

## Пробы (в этой папке)
probe6.mjs (Linux: побег, kill, retry, $HOME-варианты, fast-fail/лок), probe5.mjs (упакованный гейт), race.cjs / race3.cjs, orph.cjs (N3-1).
