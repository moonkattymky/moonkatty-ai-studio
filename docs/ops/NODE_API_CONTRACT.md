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

## F. 0.2.1 — подключение по одноразовому коду (enrollment), `protocol: 1`
Версионирование: `protocol: 1`; поддерживаемые агенты `agentVersion` **>=0.2.0 <0.3.0**. `hello` возвращает `protocol` и `agentVersionRange`; версия вне диапазона в `hello`/`pull` → **426 `E_AGENT_VERSION`**; отсутствие версии (старые агенты) допускается.

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
- `POST /api/nodes/enroll/status` `{requestId, requestSecret, ts, sig: sig("status:<rid>:<ts>")}` (±120 с) → `{status:"pending"|"rejected"}` или один раз `{status:"enrolled", nodeId, role, token:"nk_<id>.<secret>", protocol:1}`.
- Подключённый узел подписывает **каждый** запрос: `x-node-ts`, `x-node-sig` = Ed25519 над `METHOD\nPATH\nts\nsha256hex(body)` (±120 с). Без подписи/чужим ключом → 401. Узлы 0.2.0 (прямой токен, без ключа устройства) работают как раньше.
- `POST /api/nodes/rotate` (только enrolled; иначе 409 `E_NOT_ENROLLED`) → `{token}`; старый токен сразу недействителен. `pull` возвращает `rotate: true`, когда владелец запросил ротацию.

**Коды ошибок:** `E_BAD_REQUEST` 400 · `E_BAD_SIGNATURE` 401 · `E_UNAUTHORIZED` 401 · `E_CODE_INVALID` 403 · `E_NOT_FOUND` 404 · `E_METHOD` 405 · `E_CODE_USED` 409 · `E_NOT_ENROLLED` 409 · `E_CODE_EXPIRED` 410 · `E_REQUEST_LOCKED` 423 (5 неверных попыток) · `E_TLS_REQUIRED` 426 · `E_AGENT_VERSION` 426 · `E_RATE_LIMIT` 429 · `E_IP_LOCKED` 429 (10 ошибок за 15 мин → блок 15 мин).

**Хранение:** код — HMAC(серверный ключ, rid:код), TTL 5 мин, одноразовый; `requestSecret` и токен — только SHA-256 на сервере; на узле токен, секрет запроса и закрытый ключ устройства — только в Keychain.
