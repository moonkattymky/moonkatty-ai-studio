# 6. План интеграции с Mac mini (desktop Studio)

Проверено по коду `moonkatty-ai-studio` (ветка feat/ai-control-pwa, коммит 28e80fc).

## Что уже есть
| Компонент | Где | Как используем |
|---|---|---|
| Движок заданий SQLite `jobs`/`job_events` | `lib/jobs.js`, `server.js:388-401` (`GET/POST /api/jobs`, `/:id/cancel`, `/retry`, `/confirm`) | основа игровой очереди |
| Сериализация тяжёлых операций | `lib/heavy-lock.js` (`withHeavy`/`tryHeavy`) | Blender/Ollama в игровых задачах |
| Политики | `lib/policy.js`, `lib/security.js` | расширить ролями |
| Blender | `lib/blender.js`, `blender/templates/scene_basic.py`, `probe.py`, `lib/scene-params.js`; API `/api/studio3d/*`, `/api/projects3d/*` | «ограниченный Blender» = только эти шаблоны |
| OpenCode (no shell, workspace-only, пароль из Keychain) | `lib/opencode-client.js`, `lib/opencode-auth.js` | агент кода в воркере |
| Workspace | `lib/workspace.js` | основа per-project worktree |
| Egress | `lib/egress.js` | allowlist сети |
| Ноды | `lib/ops/nodes-server.js` (`/api/ops/nodes/*`) | Алексу — полностью закрыто |
| Агенты | `server.js:303-304` `/api/agents/:id/start|stop` | пометить game-агентов |
| Auth | `server.js:169-192` (один владелец, `req.user` = строка) | расширить до users+roles |

## Необходимые изменения (точный список)
1. `lib/db.js`: миграция `mig_200_multiuser` — таблицы `users`, `webauthn_creds`, `game_projects`, `locks`, `release_requests`, `audit`; в `jobs` — `project_id`, `author_id`, `branch`.
2. `server.js` auth middleware (стр. ~189): `req.user` → объект `{id, role}`; сессии с `user_id`, проверка `revoked_at` на каждом запросе; `appTokenUser` только OWNER.
3. Новый `lib/rbac.js`: таблица маршрут → требуемая роль (deny-by-default); подключить глобально **до** всех `app.*` маршрутов, включая `meta.js`, `lib/world`, `lib/ops/nodes-server.js`.
4. `lib/jobs.js`: `createJob` принимает `author`, `project`; `run()` вызывает `rbac.reauthorize(job)` перед стартом и между шагами.
5. Новый `lib/game/orchestrator.js` (ветки, worktree, locks), `lib/game/git-broker.js` (scoped credential из Keychain владельца), `lib/game/worker-supervisor.js` (запуск от `_mkgame` через launchd + sandbox-exec).
6. `lib/policy.js`: инструментальный allowlist по роли автора задачи (enforced в воркере).
7. Маршруты `/api/game/*` и `/api/admin/*` (см. док. 4).
8. Агенты: флаг `domain: 'game'` у Game Dev / QA / 3D DESIGN.
9. Установщик (только по approve OWNER, позже): создание пользователя `_mkgame`, профиль `mkgame.sb`, launchd plist. **Не применяется** к v1.1.2 и установленной v1.3.0-test.
10. `ai-control/server.mjs`: из read-only прокси → BFF с собственной аутентификацией пользователей; allowlist GET для ALEX сужается до игровых путей; POST только на `/api/game/*`.

Ограничения: никаких изменений Tailscale, main, установленных сборок до отдельного утверждения.
