# 5. Схема изоляции игровых задач

1. **Отдельный macOS-пользователь `_mkgame`** (не admin, без sudo, без доступа к `~` владельца, Keychain владельца недоступен). Воркер запускается через `launchd` от имени `_mkgame`.
2. **sandbox-exec профиль** (`mkgame.sb`): запись только в `/Users/_mkgame/work/<project>/<task>` и `/tmp/mkgame-<task>`; чтение системных библиотек, Node, Blender.app; deny `process-exec` кроме allowlist бинарей (node, git, blender, npm-тест-раннер); network deny, кроме loopback к Git Broker и approved-хостов.
3. **Per-project workdirs/worktrees**, по одному worktree на задачу; удаление по завершении (артефакты копируются в хранилище результатов).
4. **Лимиты**: CPU (nice + `taskpolicy -b`), RAM (ulimit -v / мониторинг RSS, kill при превышении), время (таймаут на задачу, по умолчанию 30 мин, Blender 15 мин), диск (квота на workdir). Тяжёлые операции — через существующий `lib/heavy-lock.js`.
5. **Нет платных операций**: LLM только локальный (Ollama) или явно разрешённый OWNER провайдер; счётчик/запрет платных API в egress.js.
6. **Git Broker** (процесс владельца-сервиса, не `_mkgame`): держит fine-grained PAT/GitHub App токен (repos: только allowlist; contents:write; без administration/workflows). Принимает от воркера запрос «push ветки X проекта Y», проверяет: X соответствует задаче, X не protected, Y ∈ allowlist. Токен воркеру и Алексу не передаётся.
7. **Блокировки**: `locks(repo, branch)` — одна активная задача на ветку; вторая задача ставится в очередь или получает конфликт 409. Worktree на задачу исключает порчу общего checkout. Lock с TTL + heartbeat.
8. **Защита от prompt-injection**: агент может «попросить» что угодно, но воркер исполняет только инструменты из allowlist с проверкой аргументов; путь нормализуется (realpath) и проверяется на нахождение внутри worktree; перед каждым инструментом — проверка, что задача не отменена и права автора актуальны.
9. **Остановка владельцем**: `cancel` → SIGTERM, через 10 с SIGKILL группы процессов, lock освобождается, событие в audit и уведомление автору.
10. **Rollback**: OWNER откатывает релиз (revert-коммит/предыдущий тег) — только из OWNER-пути.
