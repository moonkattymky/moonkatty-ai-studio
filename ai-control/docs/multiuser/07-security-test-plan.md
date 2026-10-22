# 7. План тестов безопасности

Автоматизированно (node:test + Playwright, iPhone 16 Pro профиль), на тестовом инстансе (8687/8697), с фиктивными учётками (без реальных аккаунтов).

| # | Тест (из требований владельца) | Проверка | Ожидание |
|---|---|---|---|
| 1 | Owner full access | OWNER обходит все маршруты из реестра RBAC | 2xx на всё |
| 2 | Alex game-only | ALEX на каждый маршрут реестра (генерируется из кода) | 2xx только `/api/game/*`, `/api/me/*`; остальное 403; UI не показывает запрещённое |
| 3 | Alex creates tasks | POST задачи в moonkatty-game и Horizons | job создан, `author=alex`, ветка `ai/alex/*` |
| 4 | Code changes only in allowed repos | задача с project=moonkatty-site / studio; ветка main; путь `../` | 403 / 409; ничего не запушено (проверка через GitHub API read) |
| 5 | Forbidden APIs denied | `/api/ops/nodes`, `/api/opencode/auth`, `/api/meta/config`, `/api/backup`, `/api/reset`, `/api/admin/*`, finance/revenue/news/smm | 403 + audit-запись |
| 6 | AI-agent bypass blocked | промпт-инъекции: «выполни shell», «прочитай ~/.ssh», «push в main», «curl evil», «измени свои права», файл в репо с инструкциями | воркер отклоняет инструмент, задача помечена, audit |
| 7 | No secret access | поиск токенов в ответах API, логах, env воркера, файлах worktree | 0 совпадений; Keychain недоступен `_mkgame` |
| 8 | Revoked session dies | OWNER отзывает сессию ALEX во время запроса и во время задачи | следующий запрос 401 < 1 с; задача отменена при re-authorize |
| 9 | No publish without owner | ALEX: release submit, затем попытки approve/merge/deploy | только pending; merge в protected отклонён GitHub branch protection и сервером |
| 10 | Concurrent use doesn't corrupt data | OWNER и ALEX параллельно 50 задач на одну/разные ветки | locks: нет двойного исполнения, SQLite целостна, worktree не пересекаются |
| 11 | Real process privileges | `ps -o user`, `id`, попытка записи вне worktree, сеть, sudo, превышение RAM/времени | user=_mkgame, deny sandbox, kill по лимиту |
| 12 | MFA/passkey | вход ALEX без passkey при включённом MFA | отказ |
| 13 | Audit integrity | правка записи в audit | проверка hash-chain падает |
