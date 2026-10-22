# Аудит feat/e2e-ollama-proxy @ 2dd6239 (база 2d8829c)

Node 22.23.3, Linux. Код продукта не менялся. Реальная Ollama на 11434 только читалась (version/probe); все атаки — против фейкового апстрима на 19134–19161. Порты 4096/8787 не трогались.

## Вердикт: **PASS** (с замечаниями Low / тестовый шум)

Прокси и N3-1 sweep делают то, что заявлено. Блокирующих дыр (выход на другой хост/порт, pull/delete, чужие модели, утечка заголовков, сеть из песочницы мимо сокета) не найдено. Два замечания не ломают fail-closed.

## Пункты

| Пункт | Статус | Детали |
|---|---|---|
| Upstream 127.0.0.1, не конфигурируется | PASS | `UPSTREAM_HOST` константа; клиентский `Host` игнорируется, на апстрим уходит `127.0.0.1:<port>` |
| Allowlist путей | PASS | Разрешены только POST /api/chat, /api/generate, /v1/chat/completions и GET /api/tags. pull/delete/create/push/copy/embed/ps/version/show → 403. Закодированный pull (`%70ull`), `../pull`, `%2e%2e`, `//`, `;params`, регистр, absolute-URI (в т.ч. на Studio), CONNECT → 403 или обрыв (code 0) |
| Allowlist моделей | PASS | evil/llama3/пусто/`../x` → 403; qwen3:8b и `ollama/qwen3:8b` → 200; GET /api/tags отфильтровал evil:1b |
| Лимит тела 1 МБ | PASS | Content-Length > 1 МБ → 413; chunked oversize → соединение рвётся (code 0), до апстрима не доходит |
| Concurrency ≤ 2 | PASS | 5 параллельных: 200,200,429,429,429 |
| Rate 60/мин | PASS | в окне: 200≈45 + 429≈25 (с учётом предыдущих запросов в той же минуте) |
| Заголовки с нуля | PASS | Authorization / Cookie / X-Studio-App-Token / CRLF-Host / X-Smuggled на апстрим не попали; только host/accept/connection/content-type/content-length |
| TE/CL conflict | PASS | апстрим видит только пересобранные заголовки |
| Редирект апстрима | PASS | 302 → 502 `upstream redirect refused` |
| Absolute-URI / CONNECT | PASS | 403 / обрыв; апстрим не другой хост |
| Сокет 0600, каталог 0700 | PASS | mode 600 / 700; group/other биты = 0; тот же uid подключается |
| Cleanup close() | PASS | unlink после close() |
| Stale после kill -9 | PASS | файл остаётся; повторный startProxy снимает stale и снова слушает |
| Песочница: только сокет | PASS | через llm-bridge внутри bwrap: TCP к bridge 11434 есть; к фейковому апстрим-порту и в интернет — нет; tags через bridge OK; /api/pull → 403 |
| N3-1 sweep (хост, без bwrap) | PASS | double-fork+setsid orphan находится по MK_TASK_MARK/cwd; `run()`+abort убивает (left=[]) |
| macOS прокси | BLOCKED | по дизайну llm_unavailable (нет netns у sandbox-exec) |
| mac-check 7b/7c | BLOCKED / NOT TESTED | нужен Mac; `bash -n` не гонялся отдельно в этом раунде — скрипт есть в дереве |
| MK_TEST_OLLAMA_PORT=1 | PASS (не ослабляет) | в task-runners-test при STUDIO_FLAVOR=test / isPackaged=false порт 1 даёт быстрый llm_unavailable; кейс прошёл. Вне теста, если isPackaged()=true, override игнорируется (fail-closed) — это не ослабление |
| Упакованная TEST | PASS | zip 1.3.1-test собран; ollama-proxy.js + llm-bridge.js внутри. После approve opencode_task → failed «отключено в TEST-сборке», **сокет не создавался**, прокси не стартовал |
| Slowloris | PASS | неполные заголовки не блокируют легитимный GET /api/tags (headersTimeout 10 с) |

## Находки
- **N-OP-1 (Low, тестовый шум).** `test:isolation` 64/65: static-скан ругается на строку ROUTES в `lib/ollama-proxy.js:10` (`/api/chat`, `/api/generate`) как на «вызов Ollama вне withHeavy». Это ключи маршрутов, не вызов. Реальный `runOpencode` уже под `withHeavy` в services.js. Нужно исключить ollama-proxy из скана или искать реальные `http.request` к Ollama.
- **Инфо.** CONNECT и chunked-oversize закрывают сокет без HTTP-ответа (code 0) — для атакующего это отказ, не обход.
- **Инфо.** Studio в своём отчёте не гоняла packaged Electron с прокси; здесь подтверждено: в TEST-сборке прокси не поднимается из-за гейта реальных раннеров.

## Счётчики
| Набор | Результат |
|---|---|
| ollama-proxy | **50/50** PASS |
| runners | **50/50** PASS (в т.ч. llm_unavailable + MK_TEST_OLLAMA_PORT=1) |
| runners-http | **20/20** PASS |
| security | **52/52** (после 1 флака ECONNREFUSED на random port при параллельной нагрузке) |
| policy | **46/46** |
| isolation | **64/65** — FAIL только N-OP-1 (static) |
| ops | **119 pass / 0 fail / 2 skip** |
| world | **62/63** — ожидаемый FAIL «qwen3:8b не установлена» |
| живые атаки (хост) | attack.log ~40 PASS; attack2 18 PASS / 0 FAIL по сути (sandbox nc отсутствовал — перекрыто sandbox-bridge) |
| sandbox+bridge | tags/pull/сеть PASS; evil-model в том прогоне сорвался из-за неверного Content-Length в пробе (на хосте evil → 403) |

Файлы проб: attack.mjs/log, attack2.cjs/log, sandbox-bridge.cjs/log, fake-ollama.mjs.
