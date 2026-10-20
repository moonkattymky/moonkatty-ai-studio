# Чек-лист проверки на Mac (то, что нельзя проверить на Linux)

Отмечайте результат и версию macOS. Используйте **тестовые** ключи/пароли. Сначала — сборка из исходников (`docs/BUILD_MAC.md`) или VM.

## Установка и Gatekeeper
- [ ] `codesign --verify --deep --strict --verbose=2 "/Applications/MOONKATTY AI STUDIO.app"` — без ошибок.
- [ ] `npx @electron/fuses read --app "/Applications/MOONKATTY AI STUDIO.app"`: RunAsNode **Disabled**, EnableNodeOptionsEnvironmentVariable **Disabled**, EnableNodeCliInspectArguments **Disabled**, EnableCookieEncryption **Enabled**, OnlyLoadAppFromAsar **Enabled**, EnableEmbeddedAsarIntegrityValidation **Enabled**.
- [ ] Загруженный релиз: SHA-256 совпадает; Gatekeeper блокирует при обычном открытии (ожидаемо); «Всё равно открыть» работает.
- [ ] Иконка в Dock, меню на русском, «О программе» показывает версию и коммит.
- [ ] Приложение стартует (проверка целостности ASAR не мешает запуску).

## Фоновый сервер (launchd)
- [ ] Первый запуск: экран проверки → сервер стартует → панель открывается.
- [ ] `launchctl print gui/$(id -u)/com.moonkatty.aistudio.server` — state = running; путь программы = `…/Resources/node/node`.
- [ ] `ps aux | grep server.js` — один процесс; после повторного открытия приложения — по-прежнему один.
- [ ] Закрыть окно и выйти из приложения → `curl http://127.0.0.1:8787/api/health` отвечает.
- [ ] `kill -9 <pid сервера>` → через ~10 с launchd перезапускает (новый pid).
- [ ] Автозапуск при входе: включить → plist в `~/Library/LaunchAgents/`; перезайти в систему → сервер работает без открытия окна. Выключить → plist удалён из LaunchAgents.
- [ ] Выключение/перезагрузка Mac не задерживается.
- [ ] `lsof -iTCP:8787 -sTCP:LISTEN` — только `127.0.0.1`.

## Keychain и секреты
- [ ] При первом сохранении секрета появляется запись «MOONKATTY AI STUDIO» в «Связке ключей»; `data/secret.key` переименован в `.migrated-to-keychain` (если был).
- [ ] На экране проверки: «Ключ шифрования: macOS Keychain».
- [ ] В `studio.db` нет открытого текста тестового App Secret (`strings studio.db | grep FAKE` — пусто).

## Безопасность окна
- [ ] В панели нельзя открыть DevTools (в упакованной сборке пункт отсутствует).
- [ ] Кнопка «+ Создать страницу» открывает facebook.com/instagram.com в браузере по умолчанию; прочие внешние ссылки не открываются.
- [ ] «Выйти» → показывается вход по паролю (без автоматического повторного входа).
- [ ] Открытие `http://127.0.0.1:8787` в Safari: требуется вход по паролю; запросы с других сайтов не проходят.

## Агенты
- [ ] Ollama не запущена → задачи News/Content «Заблокировано: Ollama недоступна».
- [ ] `ollama pull qwen3:8b`, запустить → Content создаёт черновик со статусом «Ждёт утверждения».
- [ ] OpenCode по умолчанию: задача «Заблокировано: OpenCode отключён».
- [ ] (Опционально, на тестовой учётке) `enableOpenCode: true` в `desktop.json`, перезапуск сервера: задача выполняется через `sandbox-exec`; попытка записи вне папки задачи и чтения `studio.db` — отказ (проверить журналом/тестовой задачей).

## Обновления
- [ ] «Проверить обновления…» показывает версию и SHA-256 и открывает страницу релиза в браузере; ничего не скачивает само.

## Tailscale
- [ ] `tailscale serve --bg 8787`; добавить `"allowedHosts": ["<mac>.<tailnet>.ts.net"]` в `desktop.json`, перезапустить сервер; вход с телефона по паролю работает; без записи в allowedHosts — ответ 421.
