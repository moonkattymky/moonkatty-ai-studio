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
