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
