# 2. Матрица прав OWNER / ALEX (GAME_MANAGER)

✅ — разрешено, ❌ — запрещено (403 + запись в audit), 🔶 — с ограничением.

| Область / действие | OWNER | ALEX |
|---|---|---|
| Вход, своя сессия, свой passkey, свои настройки (язык, уведомления) | ✅ | ✅ |
| Просмотр Games Dashboard, проектов из allowlist | ✅ | ✅ |
| Просмотр репо вне allowlist (studio, site, backups, …) | ✅ | ❌ |
| Создание задач игровым AI-агентам | ✅ | 🔶 только game-агенты, только allowlist-проекты |
| Задачи не-игровым агентам (NEWS, SMM/social, marketing, finance, video, crypto) | ✅ | ❌ |
| Изменение кода игры через AI в рабочих ветках | ✅ | 🔶 `ai/alex/*`, `game/*` |
| Commit / push | ✅ любые | 🔶 только рабочие ветки, через Git Broker |
| Push/merge в `main`, `master`, `release/*`, production, protected | ✅ | ❌ |
| Запуск тестов | ✅ | ✅ (в sandbox) |
| Blender | ✅ все | 🔶 только vetted-шаблоны, лимиты, без удаления версий |
| Файлы/логи/история задач игры | ✅ | ✅ (свои + общие игровые; чужие логи не-игровых — ❌) |
| Retry упавших задач | ✅ | 🔶 свои и игровые без lock-конфликта |
| Остановить задачу | ✅ любую | 🔶 только свою |
| Отправить релиз на утверждение | ✅ | ✅ |
| Утвердить релиз / публикация / deploy / Telegram / Pages | ✅ | ❌ |
| Откат (rollback) | ✅ | ❌ (может запросить) |
| Finance, Revenue, crypto/MKTY | ✅ | ❌ |
| Терминал, shell | ✅ | ❌ |
| Системные настройки, обновления приложения | ✅ | ❌ |
| Ноды (iMac / MacBook / Mac mini), /api/ops/* | ✅ | ❌ |
| Секреты, токены, Keychain, /api/opencode/auth, /api/meta/config, integrations | ✅ | ❌ |
| Backup / restore / reset / demo/remove | ✅ | ❌ |
| Пользователи и роли, свои права, allowlist игр | ✅ | ❌ |
| Audit log | ✅ весь | 🔶 только свои действия |
| Отзыв сессий | ✅ любых, мгновенно | 🔶 только своих |

Правило по умолчанию: всё, что не перечислено как ✅/🔶 для ALEX, — ❌.

## Решения владельца (22.10.2026)
| Репозиторий / ветки | ALEX |
|---|---|
| moonkatty-game: рабочие ветки `ai/alex/**`, `game/**` | чтение + запись через Git Broker |
| moonkatty-game: `main` (protected) | только чтение |
| moonkatty-horizons (предварительно, после проверки) — рабочие ветки | чтение + запись через Git Broker |
| moonkatty-horizons: `master`, `world-v40`, `world-v40-final`, `world-v42` | только чтение, прямая запись запрещена |
| moonkatty-horizons-play | только просмотр |
| moonkatty-world-preview | нет доступа |
| остальные репо | нет доступа |
