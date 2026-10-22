# 4. Игровые API и инструменты

Все под `/api/game/*`, требуют сессию; RBAC: `role ∈ {OWNER, GAME_MANAGER}` + `project ∈ allowlist`.

| Метод | Путь | Назначение |
|---|---|---|
| GET | /api/me | пользователь, роль, разрешённые разделы |
| GET | /api/game/dashboard | сводка |
| GET | /api/game/projects | allowlist проектов |
| GET | /api/game/projects/:id/branches | ветки (+protected) |
| POST | /api/game/projects/:id/branches | создать `ai/alex/<slug>` от разрешённой базы |
| GET | /api/game/agents | игровые агенты |
| GET/POST | /api/game/tasks | очередь / новая задача |
| GET | /api/game/tasks/:id | статус, события, логи |
| POST | /api/game/tasks/:id/cancel · /retry | стоп/повтор |
| POST | /api/game/tests/run | тесты в sandbox |
| GET | /api/game/files?project&ref&path | чтение файлов |
| GET | /api/game/commits?project&ref | история |
| POST | /api/game/3d/run · GET /api/game/3d/projects | Blender по шаблону |
| POST | /api/game/releases | заявка на релиз (pending) |
| GET | /api/game/notifications | уведомления |
| — OWNER only — | /api/admin/users, /sessions/:id/revoke, /game-projects, /releases/:id/approve\|reject, /rollback, /audit | |

## Инструменты воркера (allowlist в коде воркера)
| Инструмент | ALEX | Ограничения |
|---|---|---|
| fs.read / fs.write | ✅ | только внутри worktree задачи; запрет `.git/`, `.github/workflows/`, `.env*`, `*.pem`, `*.key` |
| fs.search | ✅ | worktree |
| git.status/diff/add/commit | ✅ | через Git Broker |
| git.push | ✅ | только текущая рабочая ветка задачи |
| tests.run | ✅ | фиксированные команды из `game_projects.test_cmds` (npm test и т.п.), без произвольных аргументов |
| lint/build | ✅ | фиксированные команды |
| blender.template | ✅ | только `blender/templates/*.py` (vetted), параметры через scene-params.js |
| http.fetch | ❌ (кроме approved: registry npm read-only при установке зависимостей — по решению OWNER) | |
| shell / exec произвольный | ❌ | |
| secrets / keychain / env | ❌ | |
| publish / deploy / gh pr merge / workflow dispatch | ❌ | |
