# 1. Архитектура

## 1.1 Компоненты
```
iPhone (PWA, Safari/Home Screen)
   │ HTTPS, только через Tailscale (позже; сейчас 127.0.0.1)
   ▼
AI CONTROL server (ai-control/server.mjs, 127.0.0.1:8697)
   ├─ Auth: отдельные учётки OWNER / ALEX, сессии, WebAuthn (passkey) опционально
   ├─ RBAC-шлюз (policy engine, deny-by-default) — на КАЖДЫЙ запрос
   ├─ Audit log (append-only, hash-chain)
   ├─ Сейчас: read-only прокси к Studio TEST 127.0.0.1:8687 (allowlist GET)
   └─ Новое: Game API (/api/game/*) → Game Orchestrator
                                        │ (локальный unix-socket, mTLS-free, только loopback)
                                        ▼
Desktop Studio (Mac mini) — lib/jobs.js, lib/heavy-lock.js, lib/policy.js, lib/blender.js, lib/workspace.js
   ├─ Game Queue (общая очередь, таблица jobs + поля project/author/branch)
   ├─ Повторная RBAC-проверка перед стартом задачи (re-authorize)
   └─ Game Worker Supervisor ──► game worker (отдельный macOS-пользователь `_mkgame`, sandbox-exec профиль)
                                    ├─ per-project worktree: /Users/_mkgame/work/<project>/<task-branch>
                                    ├─ allowlist инструментов (в коде воркера, не в промпте)
                                    ├─ лимиты CPU/RAM/время, сеть только на approved hosts (egress.js)
                                    └─ git push только через Git Broker (scoped credential, Алекс его не видит)
```

## 1.2 Роли
- **OWNER** — всё, включая управление пользователями, allowlist игр, approve релизов, merge в protected-ветки, публикацию.
- **GAME_MANAGER (ALEX)** — только проекты из `game_projects` allowlist; только рабочие ветки по шаблону `ai/alex/*` и `game/*`; без публикации.

## 1.3 Поток игровой задачи
1. Alex → `POST /api/game/tasks` {project, agent, prompt, baseBranch}.
2. RBAC: роль, project ∈ allowlist, agent ∈ game-агенты, ветка не protected → запись в audit.
3. Orchestrator создаёт ветку `ai/alex/<project>/<taskId>` и worktree, берёт **lock** на (repo, branch).
4. Перед исполнением — **re-authorize** (сессия жива? права не отозваны? проект всё ещё в allowlist?).
5. Worker выполняет: OpenCode (policy: no shell, workspace-only) + разрешённые инструменты (tests, lint, Blender-шаблоны).
6. Git Broker коммитит/пушит в рабочую ветку от имени бота с fine-grained токеном (только repo из allowlist, contents:write, без admin/merge в protected — ветки защищены branch protection).
7. Alex: «Отправить на релиз» → `release_requests` (pending) → OWNER approve → merge/публикация выполняет только OWNER-путь.

## 1.4 Данные (SQLite, рядом с jobs)
`users`(id, name, role, disabled, created_by) · `sessions`(hash, user_id, exp, mfa, revoked_at) · `webauthn_creds` · `game_projects`(id, repo, default_branch, protected_patterns, workdir, blender_enabled, added_by) · `jobs`+(`project_id`, `author_id`, `branch`, `lock_id`) · `locks`(repo, branch, job_id, expires) · `release_requests` · `audit`(seq, ts, user, ip, action, target, decision, prev_hash, hash).

## 1.5 Принципы
deny-by-default; минимальные привилегии; секреты не покидают сервер/Keychain владельца; инструменты агента ограничены кодом воркера; всё — в audit.
