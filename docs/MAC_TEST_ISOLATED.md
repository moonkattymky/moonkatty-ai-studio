# Изолированная тестовая сборка v1.2.2-test на Mac mini

> **ТЕСТОВАЯ СБОРКА, НЕ ДЛЯ РАБОТЫ.** Она ставится **рядом** с рабочей v1.1.2 и ничего в ней не меняет. Установленную v1.1.2 не заменяем и не обновляем.

## 0. Чем тестовая сборка отличается от v1.1.2

| | v1.1.2 (рабочая) | v1.2.2-test |
|---|---|---|
| Приложение | `/Applications/MOONKATTY AI STUDIO.app` | `~/Applications/MOONKATTY AI STUDIO TEST.app` |
| Bundle ID | `com.moonkatty.aistudio` | `com.moonkatty.aistudio.test` |
| Папка данных | `~/Library/Application Support/MOONKATTY AI STUDIO/` | `~/Library/Application Support/MOONKATTY AI STUDIO TEST/` |
| Журналы | `~/Library/Logs/MOONKATTY AI STUDIO/` | `~/Library/Logs/MOONKATTY AI STUDIO TEST/` |
| launchd | `com.moonkatty.aistudio.server` | `com.moonkatty.aistudio.test.server` |
| Порт сервера | 127.0.0.1:**8787** | 127.0.0.1:**8687** |
| OpenCode server | 127.0.0.1:4096 | 127.0.0.1:**4097** (отдельный процесс, свой пароль) |
| Keychain service | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO.test` |
| Автозапуск сервера | вкл. | **выкл.** (сервер запускается кнопкой) |
| Проверка обновлений | вкл. | выкл. |
| Публикация в соцсети | есть | **полностью отключена** |

Защита в коде: если тестовой сборке передать путь внутри `~/Library/Application Support/MOONKATTY AI STUDIO/`, она откажется запускаться (код выхода 78, сообщение «ОТКАЗ …»). Это работает и для символических ссылок.

Во всех командах ниже `$HOME` — это ваша домашняя папка. Команды выполняются в «Терминале» по одной.

## 1. Резервная копия v1.1.2 (до установки теста)

```bash
B="$HOME/MK-backup-v1.1.2-$(date +%Y%m%d-%H%M)"; mkdir -p "$B"; echo "$B"
D="$HOME/Library/Application Support/MOONKATTY AI STUDIO"
```

1. **Приложение** (`ditto` сохраняет подпись и атрибуты):
   ```bash
   ditto "/Applications/MOONKATTY AI STUDIO.app" "$B/MOONKATTY AI STUDIO.app"
   ```
2. **База данных**: делаем согласованную копию через `sqlite3 .backup`. Это безопасно даже при работающем сервере.
   ```bash
   sqlite3 "$D/studio.db" ".backup '$B/studio.db'"
   sqlite3 "$B/studio.db" "PRAGMA integrity_check;"      # должно быть: ok
   ```
3. **Вся папка данных** (настройки `desktop.json`, `app-token`, `files/`, `backups/`, `launchd/`, `secret.key`, если есть):
   ```bash
   ditto "$D" "$B/AppSupport"
   ditto "$HOME/Library/Logs/MOONKATTY AI STUDIO" "$B/Logs" 2>/dev/null || true
   ```
4. **launchd**: копируем plist и текущее состояние службы.
   ```bash
   cp "$HOME/Library/LaunchAgents/com.moonkatty.aistudio.server.plist" "$B/" 2>/dev/null || echo "plist в LaunchAgents нет (автозапуск при входе выключен) — копия в AppSupport/launchd/"
   launchctl print "gui/$(id -u)/com.moonkatty.aistudio.server" > "$B/launchd-state.txt" 2>&1 || true
   ```
5. **Keychain**: секреты **не печатаем и не выгружаем**. Записываем только, какие элементы существуют (без `-w`, значение не выводится):
   ```bash
   for a in studio-master-key opencode-server-password; do security find-generic-password -s "MOONKATTY AI STUDIO" -a "$a" >/dev/null 2>&1 && echo "есть: MOONKATTY AI STUDIO / $a" || echo "нет: $a"; done > "$B/keychain-items.txt"
   security find-generic-password -s "MOONKATTY AI STUDIO Safe Storage" >/dev/null 2>&1 && echo "есть: MOONKATTY AI STUDIO Safe Storage" >> "$B/keychain-items.txt"
   cat "$B/keychain-items.txt"
   ```
   Элементы остаются в связке «Вход» (login), тестовая сборка их не читает и не меняет. Если хотите отдельную копию пароля OpenCode, откройте «Связка ключей» → элемент `MOONKATTY AI STUDIO` / `opencode-server-password` → «Показать пароль» и перенесите его в менеджер паролей. Не копируйте пароль в Терминал, файлы, чаты или скриншоты.
6. **Контрольные суммы копии** и их проверка:
   ```bash
   (cd "$B" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS)
   (cd "$B" && shasum -a 256 -c SHA256SUMS | grep -v ': OK$' || echo "ВСЕ ФАЙЛЫ OK")
   shasum -a 256 "$B/studio.db"      # запишите это значение
   ```

## 2. Скачивание и проверка тестовой сборки

Скачайте ассеты релиза **v1.2.2-test**: zip, `.sha256` и `release-manifest.json` в папку «Загрузки».
```bash
cd ~/Downloads && shasum -a 256 -c "MOONKATTY-AI-STUDIO-TEST-1.2.2-test-arm64-mac.zip.sha256"   # → OK
```
Значение должно совпасть с SHA-256 в описании релиза.

## 3. Установка (под другим именем, в ~/Applications)

1. Распакуйте zip двойным щелчком в Finder (Archive Utility). Получится `MOONKATTY AI STUDIO TEST.app`.
2. Перенесите его в `~/Applications` (папка «Программы» внутри домашней; создайте её, если нет). Тогда `/Applications/MOONKATTY AI STUDIO.app` точно не будет перезаписан.
   ```bash
   mkdir -p ~/Applications && ditto ~/Downloads/"MOONKATTY AI STUDIO TEST.app" ~/Applications/"MOONKATTY AI STUDIO TEST.app"
   ls -d "/Applications/MOONKATTY AI STUDIO.app"       # рабочая версия на месте
   ```
3. **Открытие через Gatekeeper обычным способом** (сборка подписана ad-hoc, без нотаризации). `xattr` и отключение Gatekeeper **не используем**:
   - двойной щелчок по `MOONKATTY AI STUDIO TEST.app` → macOS сообщит, что не может проверить разработчика → «Готово»;
   - «Системные настройки» → «Конфиденциальность и безопасность» → внизу «Приложение “MOONKATTY AI STUDIO TEST” заблокировано» → **«Всё равно открыть»** → введите пароль;
   - снова откройте приложение → «Открыть».

## 4. Пароль OpenCode для теста (отдельный элемент Keychain)

Тестовая сборка читает пароль **только** из элемента `MOONKATTY AI STUDIO.test` / `opencode-server-password`. Добавьте его интерактивно: `-w` стоит **последним и без значения**, поэтому `security` спросит пароль сам, и пароль не попадёт ни в историю команд, ни в список процессов:
```bash
security add-generic-password -U -s "MOONKATTY AI STUDIO.test" -a opencode-server-password -l "MOONKATTY AI STUDIO TEST — OpenCode" -w
# password data for new item: (вводится скрыто)   retype password: (ещё раз)
```
Придумайте **новый** тестовый пароль, не такой, как у рабочей версии. Можно не выполнять эту команду, а ввести пароль в тестовом приложении («Настройки → OpenCode server»): оно сохранит его в тот же тестовый элемент.

Запуск отдельного OpenCode server для теста (порт 4097; рабочий на 4096 не трогаем). Это отдельное окно Терминала, его не закрывать:
```bash
MK_FLAVOR=test ~/Applications/"MOONKATTY AI STUDIO TEST.app"/Contents/Resources/app.asar.unpacked/opencode/serve.sh
```

## 5. Запуск теста

1. Убедитесь, что порты свободны и рабочая версия работает:
   ```bash
   lsof -nP -iTCP:8787 -sTCP:LISTEN   # v1.1.2 (может работать — это нормально)
   lsof -nP -iTCP:8687 -sTCP:LISTEN   # должно быть пусто до запуска теста
   ```
2. Откройте `MOONKATTY AI STUDIO TEST`. На стартовом экране сервер **не запущен** (автозапуск выключен) → нажмите «Запустить сервер» → «Открыть панель». Создайте администратора (отдельного, тестового).
3. Проверка изоляции:
   ```bash
   launchctl print "gui/$(id -u)/com.moonkatty.aistudio.test.server" | grep -E "state|path"
   curl -s http://127.0.0.1:8687/api/health     # "flavor":"test","product":"MOONKATTY AI STUDIO TEST","schemaVersion":4
   curl -s http://127.0.0.1:8787/api/health     # рабочая v1.1.2, без "flavor"
   lsof -p "$(pgrep -f 'MOONKATTY AI STUDIO TEST.app/Contents/Resources/node/node')" | grep "Application Support"   # только … STUDIO TEST/
   ```
4. «Настройки → OpenCode server»: URL `http://127.0.0.1:4097`, логин `opencode` → «Проверить» → «Подключено (Basic Auth)». В «3D Studio → Окружение» укажите путь к Blender (`/Applications/Blender.app/Contents/MacOS/Blender`) и модель OpenCode (например `ollama/qwen2.5-coder:7b`) → «Сохранить».
5. В **3D Studio** введите: **«Создай тестовую 3D-сцену, сохрани проект Blender и сделай PNG-рендер»** → «Создать 3D-модель».

**Ожидаемый результат** (≈1–5 мин; Blender и Ollama никогда не работают одновременно):
- Задание проходит этапы «Проверка Blender и OpenCode → Параметры → Агент OpenCode → Проверка → Сборка (.blend) → Рендер PNG → Проверка» и останавливается в статусе «Ждёт утверждения».
- Файлы: `~/Library/Application Support/MOONKATTY AI STUDIO TEST/projects3d/<проект>/v001/scene.blend` и `…/v001/renders/preview.png`. SHA-256 каждого файла указан в «Журнале действий» и в артефактах задания. Сверить можно командой `shasum -a 256 <файл>`.
- Превью PNG видно в панели 3D Studio.
- Если Ollama занята или в это время рендерит Blender, чат Director отвечает «Студия занята … запрос поставлен в очередь». Это ожидаемое поведение.

**Пришлите скриншоты:**
1. стартовое окно тестового приложения (версия 1.2.2-test, порт 8687);
2. вывод команд из п. 5.3;
3. «Настройки → OpenCode server» после «Проверить»;
4. 3D Studio с завершённым заданием и превью;
5. «Журнал действий» задания (видны этапы и SHA-256);
6. рабочая v1.1.2 после теста: открывается, данные на месте.

## 6. Откат (удаление тестовой сборки; v1.1.2 не затрагивается)

Все команды содержат `TEST` или `.test`. Рабочие пути в них не встречаются.
```bash
osascript -e 'quit app "MOONKATTY AI STUDIO TEST"'
launchctl bootout "gui/$(id -u)/com.moonkatty.aistudio.test.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.moonkatty.aistudio.test.server.plist"
# остановите тестовый OpenCode server: Ctrl+C в его окне Терминала
rm -rf ~/Applications/"MOONKATTY AI STUDIO TEST.app"
rm -rf "$HOME/Library/Application Support/MOONKATTY AI STUDIO TEST" "$HOME/Library/Logs/MOONKATTY AI STUDIO TEST"
rm -rf "$HOME/Library/Caches/com.moonkatty.aistudio.test" "$HOME/Library/Preferences/com.moonkatty.aistudio.test.plist" "$HOME/Library/Saved Application State/com.moonkatty.aistudio.test.savedState" "$HOME/Library/HTTPStorages/com.moonkatty.aistudio.test"
security delete-generic-password -s "MOONKATTY AI STUDIO.test" -a studio-master-key 2>/dev/null || true
security delete-generic-password -s "MOONKATTY AI STUDIO.test" -a opencode-server-password 2>/dev/null || true
security delete-generic-password -s "MOONKATTY AI STUDIO TEST Safe Storage" 2>/dev/null || true
```
Проверка, что рабочая версия на месте: `curl -s http://127.0.0.1:8787/api/health` и `ls "$HOME/Library/Application Support/MOONKATTY AI STUDIO"`.

## 7. Восстановление v1.1.2 из резервной копии (только если понадобится)

```bash
B="$HOME/MK-backup-v1.1.2-ГГГГММДД-ЧЧММ"; D="$HOME/Library/Application Support/MOONKATTY AI STUDIO"
(cd "$B" && shasum -a 256 -c SHA256SUMS | grep -v ': OK$' || echo "копия цела")   # не продолжайте, если есть ошибки
osascript -e 'quit app "MOONKATTY AI STUDIO"'
launchctl bootout "gui/$(id -u)/com.moonkatty.aistudio.server" 2>/dev/null || true
mv "$D" "$D.before-restore-$(date +%Y%m%d-%H%M)"              # текущие данные не удаляем, а откладываем
ditto "$B/AppSupport" "$D"
rm -f "$D/studio.db-wal" "$D/studio.db-shm" && cp "$B/studio.db" "$D/studio.db"   # согласованная копия sqlite3 .backup
sqlite3 "$D/studio.db" "PRAGMA integrity_check;"               # ok
mv "/Applications/MOONKATTY AI STUDIO.app" "$HOME/.Trash/" 2>/dev/null; ditto "$B/MOONKATTY AI STUDIO.app" "/Applications/MOONKATTY AI STUDIO.app"
[ -f "$B/com.moonkatty.aistudio.server.plist" ] && cp "$B/com.moonkatty.aistudio.server.plist" "$HOME/Library/LaunchAgents/"
open "/Applications/MOONKATTY AI STUDIO.app"                    # приложение само загрузит launchd-службу
```
Элементы Keychain рабочей версии тест не трогал, восстанавливать их не нужно.
