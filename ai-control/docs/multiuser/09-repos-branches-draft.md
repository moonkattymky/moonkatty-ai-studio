# 9. Репозитории и ветки — решения владельца (обновлено 22.10.2026)

| Репозиторий | Default | Protected сейчас | Решение для ALEX |
|---|---|---|---|
| moonkatty-game | main | main | ✅ только рабочие ветки (`ai/alex/**`, `game/**`); `main` не трогать |
| moonkatty-horizons (private) | master | нет | ✅ предварительно (см. проверку ниже); рабочие ветки; `master`, `world-v40`, `world-v40-final`, `world-v42` — только чтение |
| moonkatty-horizons-play | main | нет | 👁 только просмотр |
| moonkatty-world-preview | main | нет | ❌ нет доступа |
| moonkatty-ai-studio, moonkatty-site, moonkatty-backups | main | нет | ❌ |

Токен **сейчас не создаётся**. Позже — fine-grained PAT или GitHub App, только на утверждённые репо, хранится только на сервере (Keychain владельца, Git Broker); Алексу и воркеру не выдаётся.

## Проверка: moonkatty-horizons — актуальный исходник Horizons?
Сравнение 22.10.2026 (побайтово, `cmp`):

| Источник | Что это | Результат |
|---|---|---|
| `moonkatty-horizons` master `38cf0f4` (16.10 10:35, build `20261016-97a`), 124 коммита с 07.10 | исходники: `dist/`, `server/`, `site/`, `scripts/`, `tests/`, `docs/` | эталон |
| `moonkatty-horizons-play` `2df1c76` (17.10 21:14, build **`20261017-98a`**) | опубликованный билд | 189 файлов совпадают с `master:dist`, **18 отличаются** (`index.html`, `sw.js`, `reliability.js`, `team.js`, `character-sprites.js`, 13 файлов `i18n/*`), 1 лишний (`.nojekyll`) |
| `MOONKATTY_HORIZONS_v45_FULL.zip` (handoff v45, 11.10) | старый снимок | dist: 85 совпадают / 41 отличаются / 52 только в zip; server: 14/9. Коммит v45 (`cb07540`) есть в истории master — zip устарел |
| `/workspace/moonkatty-horizons` (локально) | клон того же репо (ветка `world-v2` без коммитов) | `server/` 35 совпадают / 2 отличаются; `site/` 5/5 совпадают |
| `/workspace/moonkatty-horizons-src` | текстовые дампы `FULL_CURRENT_CODE*.txt` | не репозиторий |

**Вывод:** `moonkatty-horizons` — единственный git-исходник Horizons и содержит всю историю до v45 и далее. **Но** он отстаёт на один билд: опубликованный `horizons-play` (98a, «leaderboard shows total players») собран из кода, которого нет в `master`. До подключения Алекса владельцу нужно закоммитить build 98a в `moonkatty-horizons` (из рабочей копии, где он собирался), иначе Алекс начнёт работу со старой базы.

## Спецификация защиты `master` (moonkatty-horizons) — подготовлено, НЕ включено
```json
PUT /repos/moonkattymky/moonkatty-horizons/branches/master/protection
{
  "required_status_checks": { "strict": true, "contexts": ["tests"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "require_code_owner_reviews": true, "dismiss_stale_reviews": true },
  "restrictions": { "users": ["moonkattymky"], "teams": [], "apps": [] },
  "allow_force_pushes": false, "allow_deletions": false, "required_linear_history": true, "required_conversation_resolution": true
}
```
+ `CODEOWNERS`: `* @moonkattymky`. То же (без PR-требования, только запрет push/force/delete) — для `world-v40`, `world-v40-final`, `world-v42` (или ruleset на шаблон `world-v4*`). Check `tests` требует CI-workflow (сейчас его нет — добавить отдельно). `enforce_admins: false` оставляет владельцу аварийный путь.
