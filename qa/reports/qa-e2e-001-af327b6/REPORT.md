# QA-E2E-001 @ af327b6 — повторный аудит N1–N3 + отдельный аудит N5 (28c2f3b)

HEAD: af327b6 (на feat/e2e-security-agents). Коммиты A: 16401d2, 9393e52, af327b6. Коммит B: 28c2f3b.
Среда: Node v22.23.4, test-flavor, 127.0.0.1, временные data-dir. Продуктовый код не изменялся.

---

# Часть A — N1–N3 (Approval Center)

## Вердикт A: PASS
N1 и N2 закрыты; N3 соответствует заявке (сравнение user@channel). Матрица эксплойтов PASS. Остаточные замечания — Low/Medium (DoS блокировки, пустой заголовок токена).

## Матрица (live-n123.out)
| Проверка | Результат | Вердикт |
|---|---|---|
| savings ± confirm, paid_ads/critical_settings + confirm | 403 needs_owner | PASS |
| fake_views + confirm | 403 forbidden | PASS |

## N1 — канал approve
| Вариант | Результат | Вердикт |
|---|---|---|
| чистый app token | 403 owner_session_required | PASS |
| app + поддельная cookie | 403 | PASS (закрыт обход 442a527) |
| app + **реальная** cookie | 403 | PASS |
| Bearer-сессия без токена | 200 (сессия через getSession) | PASS |
| Bearer + junk app-token | 403 | PASS |
| X-Studio-App-Token (регистр) + cookie | 403 (Node lowercases) | PASS |
| token=`0` + cookie | 403 | PASS |
| пустой / whitespace-only `x-studio-app-token` + валидная сессия | 200 как session | PASS* |

\* undici отдаёт whitespace как `""`; `!!""===false` → заголовок считается отсутствующим (`lib/world/index.js:250-254`). Это не обход N1 (нужна настоящая сессия). Заявка «любой запрос с заголовком» формально чуть шире кода — **Low/Info**.

`sessionUser` читает store через `getSession` (`server.js:160`); канал `session` только при совпадении user (`index.js:252`).

## N2 — лимитер пароля
| Проверка | Результат | Вердикт |
|---|---|---|
| канал проверяется до пароля | app + wrong pw → 403 owner_session_required, не 403 owner_reauth | PASS (`index.js:184` до `:186`) |
| 5 неверных → lock 15 мин | 5×403, 6-й и верный → 429 locked | PASS |
| попытки через app не считаются | 20 wrong via app, затем session approve → 200 | PASS |
| in-memory, сброс при рестарте | после kill/restart lock снят | PASS (как заявлено) |
| ключ лимитера | `pwFails` Map по **user** (`index.js:260-262`), не по IP | — |
| неверный пароль на unverified/app | не доходит до `pwFail` | PASS |

**N2-DoS — Medium.** Любой держатель валидной сессии владельца (украденная cookie / XSS / локальный процесс) 5 раз шлёт неверный пароль → владелец 15 минут не может одобрять (429 даже на верный). Login-лимитер (`server.js` fails Map) отдельно и не разделяется. Смягчение: общий лимитер, ключ user+IP, backoff, админ-сброс.

## N3 — requester ≠ approver
Сравнение полных строк `user@channel` (`index.js:257`, `:188`). Сессия не одобряет свой session-запрос (403). Bearer-create + cookie-approve = тот же `owner@session` → 403. Body-spoof requested_by не влияет. **PASS** (самоодобрение из той же браузерной сессии по-прежнему запрещено — UX-тупик, см. прошлую рекомендацию).

## Тесты A (Node 22.23.4)
| Набор | Заявлено | Факт |
|---|---|---|
| world-approval-test | 18/18 | 18/18 |
| world-approval-e2e-test | 25/25 | 25/25 |
| task-runners-test | 12/12 | 12/12 |
| test:security | 52/52 | 52/52 |
| test:policy | 46/46 | 46/46 |
| test:ops | 119/119 | 121: 119 pass, 2 skip, 0 fail |
| test:world | 62/63 | 62/63 (Ollama) |
| isolation / publish-guard | — | 65/65, 59/59 |
| Real-Mac | — | BLOCKED |

---

# Часть B — N5, commit 28c2f3b (task-runners / services)

**Примечание по скоупу:** ранее для ряда веток `lib/services.js` объявлялся вне скоупа. Здесь файл изменён в 28c2f3b и аудируется вместе с `lib/task-runners.js` как часть N5. Запись: out-of-scope claim для services.js на этой ветке **не применяется** к диффу 28c2f3b.

## Вердикт B: FAIL
Реальные раннеры без песочницы, с полным `process.env`, без Approval Center и с дырявым cancel. Допускать в prod-flavor в текущем виде нельзя.

## B1. opencode_task — Critical / High

**Запуск:** `lib/task-runners.js:56-60` — `spawn(bin, ['run', String(prompt)], { cwd: workDir, env: env \|\| process.env })`. Нет sandbox, seccomp, user-namespace, фильтра env.

| Находка | Severity | file:line | Доказательство |
|---|---|---|---|
| **Полный process.env уходит в дочерний процесс** | **Critical** | task-runners.js:19, :59 | Live: в ENVNAMES ребёнка есть `STUDIO_SECRET_KEY`, `STUDIO_ADMIN_PASSWORD` (имя), а также токены окружения хоста (`GITHUB_TOKEN_*`, `CLOUDFLARE_API_TOKEN`, `GH_WORKFLOW_TOKEN`…). Keychain-пароли через argv не передаются (`keystore.js` пишет в stdin) — в env их нет, если только не задан `STUDIO_SECRET_KEY`. `OPENCODE_SERVER_PASSWORD` выставляется дочернему `opencode serve` (`opencode-serve.js:33`), не обязательно parent; если кто-то положит его в env сервера — утечёт так же. |
| **Нет песочницы → доступ к FS сервера** | **Critical** | task-runners.js:56-60; services.js:107-118 | workDir = `<media>/opencode-tasks/<jobId>`, но CLI с правами сервера может читать/писать любые пути пользователя процесса (в т.ч. соседние data-dir, `secret.key`, prod-данные). «Prod 4096» напрямую не монтируется — защита только OS permissions. |
| **Prompt → argv injection** | **High** | task-runners.js:59 | `['run', String(prompt)]`; prompt `--version` / `--help` → ARGV=`[run] [--version]`. Зависит от парсера OpenCode; нужны `--` перед prompt или передача через stdin/файл. |
| **Cancel не убивает процесс** | **High** | server.js:424-426 vs services.js:56,107 | HTTP cancel для `opencode_task` идёт в ветку `design3d.cancelJob` (только status=cancelled), **не** вызывает `services.jobsApi.cancelJob` → AbortController не abort → ребёнок жив (ps до/после cancel, live-n5b.out). |
| **Нет Approval Center / owner gate** | **High** | server.js:422; services.js TYPES | Любая аутентифицированная сессия: `POST /api/jobs {type:opencode_task}` → 201. Unauth → 401. |
| **Работает в prod-flavor** | **High** | server.js:151; services.js:104-118 | Нет `CFG.IS_TEST` gate на `startTaskJob` / типы. |
| **jobId path traversal** | PASS | jobs.js create | id = `job_`+hex; path.join(mediaRoot,'opencode-tasks',id) безопасен. |
| **Рекурсивный вызов opencode** | Medium/Info | — | При наличии сетевых/shell tools у CLI теоретически возможен; не воспроизводилось (нет бинарника). |
| **heavy-lock** | Info | services.js:118 | `opencode_task` **не** под withHeavy — может пересечься с Blender/Ollama. |

## B2. render_segment — High / Medium

| Находка | Severity | file:line | Доказательство |
|---|---|---|---|
| **audioPath не ограничен media/** (признанный gap, подтверждён) | **High** | task-runners.js:35, :47 | `validateSegment`: достаточно `existsSync`; `/etc/passwd` → ok=true (oracle существования); `/tmp/secret-audio.wav` → ok, API createJob 201. Произвольный readable-файл может уйти во вход ffmpeg и в выходной mp4. |
| **ffmpeg без shell, текст через textfile=** | PASS | task-runners.js:40-51 | spawn argv; script → файл; `drawtext=...textfile=`. Инъекция `"; touch /tmp/pwned` → pwned отсутствует. |
| **Cancel path тот же баг** | High | server.js:424-426 | Не вызывается services.cancelJob; status может стать cancelled/failed, SIGTERM ребёнку не гарантирован. |
| **SIGTERM→SIGKILL, AbortController, timeout** | PASS (на уровне run()) | task-runners.js:20-27 | unit: cancel→cancelled, timeout→timeout. Ломается HTTP-маршрутом (выше). |
| **outPath** | PASS | services.js:112 | `path.join(mediaRoot,'segments',id+'.mp4')`, id серверный. |
| **runTemplate (engine=blender)** | PASS | services.js:110 | Шаблон фиксирован `scene_basic`, params `{}`. |
| **heavy-lock** | PASS | services.js:118 | render_segment под `withHeavy`. |
| **Запись в server/jobs* или server/blender*** | PASS | — | Каталога `server/` в репо нет; раннеры пишут только под DATA_DIR/media. |

## B3. Рекомендации (N5)
1. Не наследовать `process.env`: явный allowlist (PATH, HOME, LANG, OPENCODE_BIN, FFMPEG_BIN); никогда SECRET/PASSWORD/TOKEN/KEY.
2. Песочница: отдельный user / bubblewrap / Docker; workDir + read-only system; запрет выхода за media.
3. Prompt: `opencode run -- <prompt>` или stdin; reject `/^--/`.
4. `audioPath`/`stillPath`: resolve + `path.relative(mediaRoot)` без `..`.
5. HTTP cancel: для всех kinds вызывать `services.jobsApi.cancelJob` (abort AC).
6. Owner Approval Center или хотя бы prod-flavor disable / feature-flag для `opencode_task` и `render_segment` с произвольным audioPath.
7. Отдельный тест на: env leak, argv injection, path escape, cancel kills child.

## Итог
| Часть | Вердикт |
|---|---|
| A (N1–N3 @ af327b6) | **PASS** (N1/N2/N3 закрыты; N2-DoS Medium) |
| B (N5 @ 28c2f3b) | **FAIL** |
| QA-E2E-001 (confirm bypass) | по-прежнему **ЗАКРЫТ** |
| Real-Mac | BLOCKED |

