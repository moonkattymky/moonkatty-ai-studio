# NODE API CONTRACT (v1) — координация с Grok #1 (`feat/v1.2.0`) и узлами

Статус: согласовано с Grok #1 (поля jobs). Его ветка пока локальная; адаптер терпит отсутствие полей. Тесты: `test/contract/studio-jobs.contract.test.js`; против его ветки: `scripts/ops/contract-against-branch.sh feat/v1.2.0` (временный worktree, ветка не изменяется).

## A. Studio job (Grok #1, runner.js: таблицы jobs + job_events)
Поля: `id, type, agent, input(JSON), status, attempt, maxAttempts, timeoutSec, checkpoint, heartbeatAt, files[], error, createdAt, updatedAt`.
Статусы: `queued | running | needs_approval | succeeded | failed | cancelled`. API: `createJob({type,agent,input,timeoutSec,maxAttempts}) → {jobId}`, `getJob`, `cancelJob`, `listJobs({status})`.
Необязательные (добавит Grok #1): `resourceClass: 'gpu_heavy'|'llm'|'light'`, `requiresNode`, `artifacts[] {path, sha256, kind}`, `idempotencyKey`, `safeToRetry`.
Мы **не пишем** в `server/jobs*`, `server/blender*`; наш код — `lib/ops/*`.

## B. Правила маршрутизации (lib/ops/jobs-adapter.js)
- Всегда на Mac mini: `type ∈ {opencode_task, blender_template, render_segment}`, `requiresNode = 'mac-mini'`, `resourceClass ∈ {gpu_heavy, llm}`.
- Нет `resourceClass` → `light`; нет `safeToRetry` → `false`; нет `idempotencyKey` → null; `maxAttempts` 1..10; `timeoutSec` 10..86400.
- Классы: наш `llm-large`↔`llm`, `render`/`video`↔`gpu_heavy`, `light`↔`light`.
- Статусы узла → Studio: `queued→queued`, `leased→running`, `succeeded`, `failed`, `cancelled`, `needs_approval`.
- Артефакты: `{ path: 'ops-node-files/<sha256>', sha256, kind }` (файл лежит в `<DATA>/ops/node-files/<sha256>`).

## C. Bridge для исполнителя Grok #1 (`ops.nodeBridge`, null если флаг выключен)
```
dispatch(job)        → { local: true, reason } | { nodeJobId, duplicate }
poll(nodeJobId)      → { status, attempt, heartbeatAt, error, updatedAt, artifacts[], node }
wait(nodeJobId, signal) → Promise<тот же объект>   (abort → cancel)
cancel(nodeJobId)    → обновление со status 'cancelled'
```
Исполнитель Grok #1 вызывает `dispatch`; при `local:true` выполняет сам; иначе пишет `job_events` по `poll/wait`. Для задач студии (`tasks`) используется `task.node = { capability, input, safeToRetry, maxAttempts, timeoutSec, preferNode }` — runner.js отправляет их через `ctx.runViaNode`.

## D. Node HTTP API (TLS, отдельный порт 8790, `Authorization: Bearer nk_<id>.<secret>`)
| Метод | Путь | Тело → ответ |
|---|---|---|
| POST | `/api/nodes/hello` | `{info}` → `{node, role, title, caps, leaseMs, command}` |
| POST | `/api/nodes/pull` | `{info, state}` → `{command, job: null \| {id, leaseId, capability, input, files[{sha256,name}], timeoutSec, attempt, leaseMs}}` |
| POST | `/api/nodes/jobs/:id/heartbeat` | `{leaseId, checkpoint:{progress}}` → `{ok, cancel, command}` / 409 |
| POST | `/api/nodes/jobs/:id/complete` | `{leaseId, result, artifacts[{sha256,name,kind}]}` → `{ok}` / `{ok, duplicate}` / 409 / 422 |
| POST | `/api/nodes/jobs/:id/fail` | `{leaseId, error, retryable}` → `{ok}` |
| PUT | `/api/nodes/files/:sha256` | бинарные данные (≤512 МБ) → `{ok, sha256, size}` / 422 при несовпадении |
| GET | `/api/nodes/files/:sha256` | только для файлов арендованной задачи → данные / 403 |
`info`: `hostname, os, arch, model, cpuModel, cpus, cpuPct, memTotal, memAvailable, diskFree, diskTotal, load1, node, agentVersion, tools[]`. `command ∈ run|pause|drain|stop`.

## E. Admin API (сессия владельца, основное приложение)
`GET /api/ops/nodes` · `POST /api/ops/nodes {id, role: news|monitor, name, caps?}` → токен (один раз) · `POST /api/ops/nodes/:id/command {command}` · `POST /api/ops/nodes/:id/revoke` · `POST /api/ops/nodes/jobs {capability, input, idempotencyKey, safeToRetry, maxAttempts, timeoutSec, requires, preferNode, files}` · `POST /api/ops/nodes/jobs/:id/cancel|retry` · `GET /api/ops/nodes/route?capability=`.

## F. 0.2.1/0.2.2 — подключение по одноразовому коду (enrollment), `protocol: 2` (0.2.2)
Версионирование: `protocol: 2` (0.2.2; в 0.2.1 был 1); поддерживаемые агенты `agentVersion` **>=0.2.0 <0.3.0**. `hello` возвращает `protocol` и `agentVersionRange`; версия вне диапазона в `hello`/`pull` → **426 `E_AGENT_VERSION`**; отсутствие версии (старые агенты) допускается.

**Владелец (сессия панели, `cache-control: no-store`):**
| Метод | Путь | Ответ |
|---|---|---|
| POST | `/api/ops/nodes/enroll` `{role: news\|monitor, name, nodeId?}` | `{requestId, code: "RID5-XXXXX-XXXXX", expiresAt, ttlSec:300, nodeId, role, reenroll, fingerprint, fingerprintShort}` — код показывается один раз |
| GET | `/api/ops/nodes/enroll` | список запросов: state `awaiting_code\|pending\|confirmed\|enrolled\|rejected\|expired\|locked\|superseded`, `device{deviceId, pubKeyFingerprint, pubKeyShort, hostname, model, os, arch, agentVersion, ip}` |
| POST | `/api/ops/nodes/enroll/:rid/confirm` · `/reject` | только из `pending` |
| POST | `/api/ops/nodes/:id/rotate` | помечает ротацию; узел получит `rotate:true` |
| POST | `/api/ops/nodes/:id/revoke` | токен и ключ устройства аннулируются |
| GET | `/api/ops/nodes/audit` | журнал (без секретов) |

**Узел (порт 8790, только TLS — по HTTP → 426 `E_TLS_REQUIRED`; лимит 30 запросов/мин с IP):**
- `POST /api/nodes/enroll` `{code, deviceId: "dev_<32hex>", devicePubKey: PEM Ed25519, proof: sig("enroll:<rid>:<deviceId>"), info}` → `{requestId, status:"pending", requestSecret, pollMs, nodeId, role}`.
- `POST /api/nodes/enroll/status` `{requestId, requestSecret, ts, nonce, sig: sig("status:<rid>:<ts>:<nonce>")}` (±30 с, nonce одноразовый) → `{status:"pending"|"rejected"}` или один раз `{status:"enrolled", nodeId, role, token:"nk_<id>.<secret>", protocol:1}`.
- Подключённый узел подписывает **каждый** запрос: `x-node-ts`, `x-node-nonce` (одноразовый, 22–64 символа base64url), `x-node-sig` = Ed25519 над `METHOD\nPATH\nts\nnonce\nsha256hex(body)`; окно **±30 с**; повтор nonce → 401 `E_REPLAY`. Подписанный запрос без nonce (агент 0.2.1) → 426 `E_AGENT_VERSION` — обновить до 0.2.2. Проверка токена и подписи — фиксированный объём работы (без тайминг-оракула). Узлы 0.2.0 (прямой токен) работают как раньше; новые прямые токены панель выдаёт только при `STUDIO_NODES_LEGACY_TOKENS=1`.
- `POST /api/nodes/rotate` (только enrolled — иначе 409 `E_NOT_ENROLLED`; только после кнопки владельца — иначе 409 `E_ROTATE_NOT_REQUESTED`) → `{token}`; старый токен сразу недействителен. `pull` возвращает `rotate: true`, когда владелец запросил ротацию.

**Лимиты по источнику (0.2.2):** счётчик ведётся по устройству Tailscale (`tailscale whois` адреса пира; за `tailscale serve` — по `X-Forwarded-For`, только если сокет loopback), иначе по `Tailscale-User-Login` (только loopback), иначе по IP; без идентификатора за serve — общий bucket `loopback`. Счётчики и блокировки сохраняются в `nodes.json` (0600) и переживают перезапуск. Один процесс координатора на каталог (`nodes.lock`).

**Подтверждение паролем (428 → `/api/ops/confirm`):** `node-confirm`, `node-revoke`, `node-rotate`, `node-legacy-token` — и без флага Security Center. `POST /api/ops/nodes` (прямой токен 0.2.0) → 403 `E_LEGACY_DISABLED`, если `STUDIO_NODES_LEGACY_TOKENS≠1`.

**Коды ошибок:** `E_BAD_REQUEST` 400 · `E_BAD_SIGNATURE` 401 · `E_REPLAY` 401 · `E_ROTATE_NOT_REQUESTED` 409 · `E_LEGACY_DISABLED` 403 · `E_UNAUTHORIZED` 401 · `E_CODE_INVALID` 403 · `E_NOT_FOUND` 404 · `E_METHOD` 405 · `E_CODE_USED` 409 · `E_NOT_ENROLLED` 409 · `E_CODE_EXPIRED` 410 · `E_REQUEST_LOCKED` 423 (5 неверных попыток) · `E_TLS_REQUIRED` 426 · `E_AGENT_VERSION` 426 · `E_RATE_LIMIT` 429 · `E_IP_LOCKED` 429 (10 ошибок за 15 мин → блок 15 мин).

**Хранение:** код — HMAC(серверный ключ, rid:код), TTL 5 мин, одноразовый; `requestSecret` и токен — только SHA-256 на сервере; на узле токен, секрет запроса и закрытый ключ устройства — только в Keychain.

**v1.2.4-test (MOONKATTY AI STUDIO.test) — отличия от Studio 3:** Node API (TLS) на порту **8690**, слушает только `127.0.0.1` и один адрес Tailscale (`100.64.0.0/10` или `fd7a:115c:a1e0::/48`; октеты проверяются строго), запросы с других адресов → 403. Идентификаторы узлов оканчиваются на `-test` (по умолчанию `imac-test` / `macbook-test`; прод-id отклоняются). Владелец: `POST /api/ops/nodes/enroll` требует `confirm: "ПОДКЛЮЧИТЬ"` + пароль владельца, `…/confirm` — `confirm: "ПОДТВЕРДИТЬ"` + пароль, `…/:id/rotate` — `confirm: "СМЕНИТЬ"` + пароль (для узла 0.2.1 — только пометка `rotate:true`; для узла 0.2.0 — новый токен сразу, один раз), `…/:id/revoke` — `confirm: "ОТОЗВАТЬ"` + пароль (с 0.2.2). HMAC-ключ одноразовых кодов хранится только в памяти процесса (не на диске): перезапуск сервера аннулирует невыданные коды.

**v1.2.4-test — 0.2.2 (protocol 2):** `hello`/`pull`/`enroll/status` отдают `protocol: 2`; диапазон `agentVersion` по-прежнему **>=0.2.0 <0.3.0** (как в Studio 3), подписанный запрос узла, подключённого по коду, без `x-node-nonce` (агент 0.2.1) → 426 `E_AGENT_VERSION`. Подтверждение паролем владельца в тестовой сборке — полем `password` в теле запроса (не через 428 → `/api/ops/confirm`): enroll, confirm, rotate, revoke, выдача прямого токена. Прямые токены 0.2.0 (`POST /api/ops/nodes` и мгновенная смена токена узла 0.2.0) — только при `STUDIO_NODES_LEGACY_TOKENS=1`, иначе 403 `E_LEGACY_DISABLED`. `nodes.lock` (pid, 0600) в `<data>/ops/`. Проверка Funnel (Security Center) не переносилась: тестовая сборка не использует `tailscale serve/funnel`, Node API слушает только 127.0.0.1 и адрес Tailscale.
