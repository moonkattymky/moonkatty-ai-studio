# Первый тест v1.2.1 на Mac (Apple Silicon)

Сборка: `MOONKATTY-AI-STUDIO-1.2.1-arm64-mac.zip` (релиз `v1.2.1-mac-preview`, prerelease, коммит `42d3fd5`).
SHA-256: `ae87d263c9aac16f929112a35401046833df96a578210b396d2e9c0aed7c8b42`.
Подпись ad-hoc, **без нотаризации** → Gatekeeper предупредит при первом запуске. Это ожидаемо.

> ⚠️ ВАЖНО: v1.2.1 и v1.1.2 используют **одинаковые** bundle id (`com.moonkatty.aistudio`), имя приложения,
> папку данных (`~/Library/Application Support/MOONKATTY AI STUDIO/`), launchd‑метку (`com.moonkatty.aistudio.server`)
> и записи Keychain (`MOONKATTY AI STUDIO`). «Установить рядом» можно только как файл .app под другим именем;
> **запускать одновременно нельзя**, данные общие. v1.2.1 при первом запуске добавит таблицы `jobs`/`job_events`
> в `studio.db` (только добавление, старые таблицы не меняются), поэтому сначала — резервная копия.

## 1. Резервная копия v1.1.2
1. Закройте приложение (меню → Quit). В «Настройки → Сервер» остановите фоновый сервер или выполните:
   `launchctl bootout gui/$(id -u)/com.moonkatty.aistudio.server` (ошибка «не найдено» — нормально).
2. Скопируйте приложение и данные:
   ```bash
   mkdir -p ~/MK-backup-1.1.2
   ditto "/Applications/MOONKATTY AI STUDIO.app" ~/MK-backup-1.1.2/"MOONKATTY AI STUDIO 1.1.2.app"
   ditto ~/Library/Application\ Support/MOONKATTY\ AI\ STUDIO ~/MK-backup-1.1.2/data
   ditto ~/Library/Logs/MOONKATTY\ AI\ STUDIO ~/MK-backup-1.1.2/logs 2>/dev/null
   cp ~/Library/LaunchAgents/com.moonkatty.aistudio.server.plist ~/MK-backup-1.1.2/ 2>/dev/null
   ```
3. Дополнительно: в приложении «Настройки → Резервная копия → Экспорт» (JSON).

## 2. Установка v1.2.1
1. Скачайте zip, проверьте: `shasum -a 256 MOONKATTY-AI-STUDIO-1.2.1-arm64-mac.zip` — должно совпасть с SHA выше.
2. Распакуйте (двойной клик). Переименуйте в `MOONKATTY AI STUDIO 1.2.1.app` и положите в `/Applications`
   (старое приложение 1.1.2 остаётся на месте, но **не запускайте его**, пока тестируете 1.2.1).
3. Открытие с соблюдением Gatekeeper: **правый клик → «Открыть» → «Открыть»**.
   Если macOS не даёт: «Системные настройки → Конфиденциальность и безопасность» → внизу «Всё равно открыть».
   **Не** выполняйте `xattr -d com.apple.quarantine`, **не** отключайте Gatekeeper (`spctl --master-disable`) и SIP.
4. Проверьте «О программе»: версия 1.2.1.

## 3. Запуск OpenCode
1. Задайте пароль сервера OpenCode в приложении: «Настройки → OpenCode → Пароль» (хранится только в Keychain).
2. В Терминале из клона репозитория (ветка `feat/v1.2.0`; внутри .app скрипт упакован в asar и недоступен):
   ```bash
   ./opencode/serve.sh
   ```
   Скрипт сам берёт пароль из Keychain (macOS спросит доступ — «Разрешить») и передаёт его только через окружение.
   Пароль вручную в командную строку **не вводите**.
   Сервер слушает только `127.0.0.1:4096`. Не меняйте hostname на `0.0.0.0`.
3. В приложении «Настройки → OpenCode → Проверить» → ожидается «Подключено, версия 1.19.x».
4. Blender 4.2+ установлен в `/Applications/Blender.app`; «3D Studio → Проверка» должна показать версию.
5. Ollama (`qwen3:8b`) — желательно. Без неё параметры сцены берутся «по правилам» (это пишется в журнал).

## 4. Первый безопасный тест (end‑to‑end)
В чате Director напишите:
**«Создай тестовую 3D-сцену, сохрани проект Blender и сделай PNG-рендер»**

Ожидаемо:
1. Director создаёт задачу 3D DESIGN (kind=3d) → в «3D Studio» появляется задание.
2. Этапы в журнале: Проверка → Параметры (qwen3:8b или «по правилам») → OpenCode пишет `scene_params.json`
   (может потребоваться кнопка «Разрешить») → проверка схемы → Blender сохраняет `.blend` → второй процесс рендерит PNG (+GLB) → «Ждёт утверждения».
3. Файлы: `~/Library/Application Support/MOONKATTY AI STUDIO/projects3d/<проект>/v001/`:
   `scene_params.json`, `scene.blend`, `preview.png`, `.glb`; в карточке версии — размер и SHA-256.
4. PNG открывается в Просмотре; `.blend` открывается в Blender (по двойному клику).
5. Время: 1–5 минут (Cycles на CPU/GPU).

Что сфотографировать (Cmd+Shift+4) и прислать:
- «О программе» (версия), «Настройки → OpenCode» (статус, **без пароля**), «3D Studio → Проверка».
- Чат Director с ответом; карточку задания со всеми этапами; журнал задания (особенно при ошибке).
- Finder с папкой `v001/`; превью PNG; GLB‑просмотр в приложении.
- Любое окно Gatekeeper / ошибки.

Если ошибка — **не повторяйте много раз**: скопируйте `~/Library/Logs/MOONKATTY AI STUDIO/server.log` и журнал OpenCode из Терминала.

Не тестировать пока: `video_render` (в 1.2.1 отсутствует), рендер EEVEE/Workbench (не проверены), «Восстановить из копии»/«Сброс».

## 5. Откат на v1.1.2
1. Quit приложения 1.2.1; `launchctl bootout gui/$(id -u)/com.moonkatty.aistudio.server`; остановите `serve.sh` (Ctrl+C).
2. Удалите `MOONKATTY AI STUDIO 1.2.1.app` в Корзину.
3. Верните данные:
   ```bash
   mv ~/Library/Application\ Support/MOONKATTY\ AI\ STUDIO ~/MK-1.2.1-data-$(date +%s)
   ditto ~/MK-backup-1.1.2/data ~/Library/Application\ Support/MOONKATTY\ AI\ STUDIO
   cp ~/MK-backup-1.1.2/com.moonkatty.aistudio.server.plist ~/Library/LaunchAgents/ 2>/dev/null
   ```
4. Запустите `/Applications/MOONKATTY AI STUDIO.app` (1.1.2), проверьте задачи/настройки.
   Записи Keychain общие и совместимы — их трогать не нужно.
