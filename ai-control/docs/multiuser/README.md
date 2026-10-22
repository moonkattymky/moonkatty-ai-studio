# MOONKATTY AI CONTROL — многопользовательский режим (OWNER + ALEX)

Статус: **ДИЗАЙН, без реализации.** Ветка `design/ai-control-multiuser` (от `feat/ai-control-pwa`). `main`, v1.1.2, установленная v1.3.0-test и настройки Tailscale не затрагиваются.

| № | Документ |
|---|---|
| 1 | [01-architecture.md](01-architecture.md) — архитектура |
| 2 | [02-permission-matrix.md](02-permission-matrix.md) — матрица прав OWNER/ALEX |
| 3 | [03-alex-ui.md](03-alex-ui.md) — UI Алекса (10 разделов) |
| 4 | [04-game-api-tools.md](04-game-api-tools.md) — игровые API и инструменты |
| 5 | [05-task-isolation.md](05-task-isolation.md) — изоляция игровых задач |
| 6 | [06-mac-mini-integration.md](06-mac-mini-integration.md) — изменения в desktop Studio (по реальному коду) |
| 7 | [07-security-test-plan.md](07-security-test-plan.md) — план тестов безопасности |
| 8 | [08-estimate.md](08-estimate.md) — оценка в AI-часах |
| 9 | [09-repos-branches-draft.md](09-repos-branches-draft.md) — черновик репозиториев и веток на утверждение |

Принцип: **права проверяются только на сервере** (каждый запрос + повторно перед исполнением каждой AI-задачи + в воркере на уровне инструментов). UI лишь скрывает недоступное; скрытие не является защитой.
