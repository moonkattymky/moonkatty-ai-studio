# 9. Черновик репозиториев и веток — на утверждение владельцу

Данные GitHub на 2026-10-22 (read-only).

| Репозиторий | Описание | Default | Последний push (Иерусалим) | Protected | Предложение для ALEX |
|---|---|---|---|---|---|
| moonkatty-game | MOONKATTY: 9 Lives — Mission to the Moon | main | 21.10 02:50 | **main** | ✅ allowlist (подтверждён) |
| moonkatty-horizons (private) | MOONKATTY New Horizons — Telegram Mini App game (WebGL) | **master** | 16.10 10:35 | нет | ✅ кандидат №1 на Horizons — **нужно подтверждение** и включение protection на `master` |
| moonkatty-horizons-play | New Horizons — playable build (test) | main | 17.10 21:17 | нет | 🔶 кандидат: собранный билд (dist), не исходники; доступ только read или не давать |
| moonkatty-world-preview | 9 Lives — 3D world test scene (preview) | main | 21.10 01:33 | нет | ❓ на усмотрение владельца |
| moonkatty-ai-studio | AI agents control panel | main | 22.10 02:31 | нет | ❌ |
| moonkatty-site | official site | main | 14.10 20:08 | нет | ❌ |
| moonkatty-backups (private) | Daily D1 backups | main | 22.10 03:52 | нет | ❌ |

Разрешённые ветки для ALEX (предложение): создание/push только `ai/alex/**` и `game/**`. Запрещено: `main`, `master`, `release/**`, `production`, `gh-pages`, `pre-launch-backup`, `source-only/**`.

Требуется от владельца до реализации: (1) подтвердить репо Horizons; (2) включить branch protection на `moonkatty-horizons:master` (и `main` в preview-репо при включении); (3) решение по world-preview и horizons-play; (4) создать GitHub App / fine-grained токен только на утверждённые репо.
