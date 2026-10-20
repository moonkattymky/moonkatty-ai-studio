# MOONKATTY AI STUDIO

Веб-панель управления AI-агентами проекта MOONKATTY («9 Lives. One Moon.»): Director + агенты NEWS, VIDEO, SOCIAL, PR, GAMES, MKTY, ANALYTICS, MARKETING (3D DESIGN — в разработке), задачи и расписания, конвейер выпусков MOONKATTY NEWS (EN/RU/UK), соцсети с утверждением постов, календарь, отчёты, журнал, интеграции с Ollama / OpenCode / Docker на Mac mini.

**Демо (браузерный режим, данные в localStorage):** https://moonkattymky.github.io/moonkatty-ai-studio/

## Языки
Интерфейс: RU (по умолчанию) / EN / UK — переключатель в верхней панели и на экране входа, выбор сохраняется. Все строки — через словарь `public/i18n-dict.js` (генерируется из `scripts/i18n_src.py`); названия MOONKATTY, MOONKATTY NEWS, Ollama, OpenCode, Docker не переводятся. Пользовательский контент (названия ваших задач/постов) не переводится.

## Два режима
| | Серверный (Node + SQLite) | Браузерный (GitHub Pages) |
|---|---|---|
| Данные | `data/studio.db` | localStorage этого браузера |
| Вход | логин/пароль, scrypt, сессии HttpOnly | локальный пароль (SHA-256), только в браузере |
| Проверка Ollama/Docker | реальный HTTP-запрос с сервера | запрос из браузера (обычно блокируется CORS/mixed content) |
| Director | Ollama `/api/chat` (qwen3:8b), иначе правиловой планировщик | то же, если Ollama доступна из браузера |
| Расписания, автоотчёт раз в 3 дня, ежедневный бэкап | сервер, всегда | только пока открыта вкладка (бэкап — экспорт) |
| Файлы | до 500 МБ, `data/files` | до 3 МБ |

## Запуск на Mac mini
```bash
git clone https://github.com/moonkattymky/moonkatty-ai-studio && cd moonkatty-ai-studio
npm ci --omit=dev
npm start                      # http://127.0.0.1:8787 — при первом входе создаётся администратор
```
Docker: `docker compose up -d --build` (в Settings укажите `http://host.docker.internal:11434` для Ollama).
Автозапуск: `deploy/com.moonkatty.aistudio.plist` → `~/Library/LaunchAgents/` (инструкция внутри файла).
Переменные: `PORT`, `HOST` (по умолчанию 127.0.0.1), `DB_PATH`, `STUDIO_ADMIN_USER`/`STUDIO_ADMIN_PASSWORD` (создать админа без UI).
Ollama: для доступа из Docker/браузера может понадобиться `OLLAMA_HOST=0.0.0.0` / `OLLAMA_ORIGINS`.

Безопасное подключение Mac к серверу: [docs/CONNECT_MAC.md](docs/CONNECT_MAC.md).

## Честность данных
Никаких выдуманных просмотров, подписчиков и статусов: всё, что не подключено, помечено «Не подключено», нереализованные функции — «в разработке» и кнопки отключены. Отчёты строятся только из реальных задач/журнала. Арт в интерфейсе (коты, превью) — из концепта, превью помечено как концепт.

## В разработке
Автономное выполнение задач агентами, автопоиск новостей, TTS-озвучка, рендер/экспорт видео, автосубтитры, публикация в соцсети и статистика платформ, запуск рекламы, 3D Studio, терминал, web push.

## Тесты
`node scripts/smoke.mjs <url> <prefix> <user> <pass>` — headless Chrome (playwright-core): вход, чат с Director, задачи с расписанием, старт агента, выпуск и этапы, утверждение поста, отчёт, тест Ollama, скриншоты всех разделов (десктоп + iPhone) в `screenshots/`.


## Facebook & Instagram module

«Соцсети» → tabs: FB/IG pages (4 workspaces: MOONKATTY NEWS FB/IG, MOONKATTY FB/IG), unified queue (YouTube, TikTok, X, Telegram, Facebook, Instagram), analytics (actual vs forecast kept separate), community (reply drafts with approval).

- Official Meta OAuth (Facebook Login for Business, Graph API v26.0), server-side only; tokens encrypted (AES-256-GCM).
- Manual approval ON, autopublish OFF by default. Guardrails: fact-check, source attribution, image rights, dedup.
- Env: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_CONFIG_ID` (optional), `META_GRAPH_VERSION`, `STUDIO_SECRET_KEY` (optional).
- Demo data: «Загрузить демо-данные» creates items marked `[ДЕМО]`; they are never published and can be removed in one click.
- Guide (RU): [docs/CONNECT_META.md](docs/CONNECT_META.md).


## macOS desktop app (branch `feat/macos-app`)

Electron shell + background server (launchd LaunchAgent). Window loads only the local server (127.0.0.1). Agent runner executes queued tasks for started agents (real actions only; LLM tasks via Ollama qwen3:8b, otherwise «Заблокировано»). OpenCode tasks require per-task approval and run in a sandbox dir.

- Run from source: `npm ci && npx electron .`
- Package on Linux: `scripts/package-mac-on-linux.sh` (needs `rcodesign`) · on a Mac: `scripts/build-mac.sh` (zip + dmg)
- Tests: `xvfb-run -a node scripts/desktop-test.mjs`, `node scripts/runner-test.mjs`
- Guide (RU): [docs/INSTALL_MAC.md](docs/INSTALL_MAC.md)
- Env: `STUDIO_DATA_DIR`, `STUDIO_SQLITE=node|better`, `STUDIO_BRAND`, `STUDIO_KEYCHAIN=0`

### OpenCode server password (1.1.2)

Settings → «OpenCode — доступ к серверу»: URL (loopback only), username (`opencode`), password for `OPENCODE_SERVER_PASSWORD`. The password is stored only in the macOS Keychain (unavailable → «Не подключено», no fallback). Not yet tested on a real Mac. Details: `docs/SECURITY_AUDIT.md`.

### Security (1.1.1)
See [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md). Tests: `node scripts/security-test.mjs`, `xvfb-run -a node scripts/desktop-test.mjs`. Build: [docs/BUILD_MAC.md](docs/BUILD_MAC.md), signing: [docs/APPLE_SIGNING.md](docs/APPLE_SIGNING.md), Mac checklist: [docs/MAC_TEST_CHECKLIST.md](docs/MAC_TEST_CHECKLIST.md). Env: `STUDIO_ALLOWED_HOSTS` (Tailscale `*.ts.net` names), `STUDIO_OPENCODE=1` (off by default).
