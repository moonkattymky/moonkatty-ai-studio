# MOONKATTY AI STUDIO TEST v1.2.4-test — узлы iMac (NEWS NODE) и MacBook (MONITOR NODE)

Это тестовая сборка. Она ставится **рядом** с рабочей v1.1.2 и не трогает её данные, Keychain, порты и launchd. Подробности изоляции описаны в `docs/MAC_TEST_ISOLATED.md`. Здесь только то, что добавилось в 1.2.4: подключение двух узлов через Tailscale.

| Что | v1.1.2 (рабочая) | v1.2.4-test |
|---|---|---|
| Панель | 127.0.0.1:8787 | 127.0.0.1:**8687** (только loopback) |
| Node API (TLS) | — | **8690**: 127.0.0.1 + адрес Tailscale Mac mini |
| ID узлов | — | `imac-test`, `macbook-test` |
| Keychain на узле | — | `moonkatty-node-imac-test` / `moonkatty-node-macbook-test`, account `node-token` |

Безопасность: Node API слушает только 127.0.0.1 и один адрес Tailscale (100.x.y.z). Он не открывается на 0.0.0.0, в LAN или в интернет. **Не включайте** `tailscale serve` и `tailscale funnel`, они не нужны. Подключения не с loopback и не из Tailscale получают 403.

Узлы используют **только агент 0.2.0** (0.2.x). Одноразовых кодов подключения нет: токен выдаёт владелец в панели, и он показывается **один раз**.

---

## 1. Резервная копия (на Mac mini, до всего)
1. Сделайте снимок Time Machine или выполните `tmutil startbackup --block`.
2. Сделайте копию данных v1.1.2 (только чтение, рабочую сборку не останавливаем):
   ```
   ditto "$HOME/Library/Application Support/MOONKATTY AI STUDIO" "$HOME/Backups/MOONKATTY-v1.1.2-$(date +%Y%m%d-%H%M)"
   ```
3. На iMac и MacBook резервная копия не нужна: агент ставится в отдельные папки `~/moonkatty-node` и `~/.moonkatty-node`.

## 2. Установка тестового приложения рядом с v1.1.2 (Mac mini)
1. Скачайте `MOONKATTY-AI-STUDIO-TEST-1.2.4-test-arm64-mac.zip` и `.sha256` из пре-релиза v1.2.4-test. Проверьте:
   ```
   shasum -a 256 -c MOONKATTY-AI-STUDIO-TEST-1.2.4-test-arm64-mac.zip.sha256
   ```
   Ожидается `OK`, а значение должно совпасть с SHA-256 из заметок к релизу.
2. Распакуйте архив в `~/Applications` (не в /Applications и не поверх v1.1.2).
3. Первый запуск: правый клик → «Открыть», затем в «Системные настройки → Конфиденциальность и безопасность» нажмите «Всё равно открыть». **Атрибуты карантина вручную не снимайте.**
4. Сборка подписана ad-hoc, не нотаризована и требует macOS 13 или новее.
5. При первом запуске создайте пользователя-владельца теста (пароль отдельный, тестовый).

## 3. Включение Node API на Mac mini
1. Узнайте адрес Tailscale:
   ```
   tailscale ip -4      # или /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4
   ```
   Ответ вида `100.x.y.z`.
2. В приложении откройте **«Узлы (Nodes)»** и сделайте следующее:
   - в поле «Адрес Tailscale» укажите `100.x.y.z`;
   - отметьте «Включить Node API»;
   - введите пароль владельца и слово-подтверждение `СОХРАНИТЬ`, затем нажмите «Сохранить настройки».
   Другие адреса (0.0.0.0, 192.168…, 10…, публичные) панель отклонит.
3. Меню → «Остановить фоновый сервер», затем снова запустите сервер из приложения.
4. Если macOS спросит «Разрешить входящие подключения?», ответьте «Разрешить». Порт виден только в Tailscale.
5. Проверка (только чтение):
   ```
   lsof -nP -iTCP:8690 -sTCP:LISTEN   # ожидается ровно 127.0.0.1:8690 и 100.x.y.z:8690, НЕ *:8690
   lsof -nP -iTCP:8687 -sTCP:LISTEN   # ожидается только 127.0.0.1:8687
   tailscale serve status             # ожидается «No serve config»
   tailscale funnel status            # ожидается «No serve config»/выключено
   ```
6. В разделе «Узлы» должно быть «Включено · слушает: 127.0.0.1:8690, 100.x.y.z:8690» и отпечаток SHA-256. Запишите отпечаток.
7. Нажмите **«Скачать сертификат координатора»** (`coordinator.crt`). Это публичный сертификат, не секрет.

## 4. Регистрация узлов (Mac mini, панель «Узлы»)
1. Зарегистрируйте NEWS NODE:
   - ID `imac-test`, роль `imac` (NEWS NODE), название «iMac NEWS NODE (test)»;
   - введите пароль владельца и слово `ВЫДАТЬ`, нажмите «Зарегистрировать».
2. Скопируйте токен `nk_imac-test.…`. **Он показывается один раз**, сервер хранит только хэш. Нажмите «Я сохранил — скрыть».
3. Повторите для MONITOR NODE: ID `macbook-test`, роль `macbook`.
4. Передайте каждому узлу его токен и `coordinator.crt`, например через AirDrop или в заметке на самом узле. Токен не пересылайте почтой или в мессенджерах.

## 5. Установка агента на iMac (NEWS NODE, macOS Ventura 13.7.1)
1. Пакет: `moonkatty-node-0.2.0-darwin-x64.tar.gz` (Node 24, minos 13.5). Проверка:
   ```
   shasum -a 256 -c moonkatty-node-0.2.0-darwin-x64.tar.gz.sha256
   # ожидается 1f62643f5f64e114b913a57f802fd0b8b086ce7416664829d1ad121f0a71fee7
   tar xzf moonkatty-node-0.2.0-darwin-x64.tar.gz && cd moonkatty-node-0.2.0-darwin-x64
   shasum -a 256 -c MANIFEST.sha256
   ./install.sh          # без --autostart: сначала только проверка
   ```
2. Положите `coordinator.crt` в `~/.moonkatty-node/coordinator.crt`.
3. Отредактируйте `~/.moonkatty-node/node-agent.env` (chmod 600):
   ```
   NODE_ID=imac-test
   NODE_PROFILE=news
   NODE_TLS_MODE=pinned
   COORDINATOR_URL=https://100.x.y.z:8690
   COORDINATOR_CERT=/Users/<вы>/.moonkatty-node/coordinator.crt
   COORDINATOR_FINGERPRINT=<отпечаток из панели, 64 hex>
   ```
   Строку `NODE_TLS_MODE=tailscale` и URL `*.ts.net` из примера уберите: в этом тесте Serve не используется.
4. Токен положите в Keychain. Команда **спросит** токен, вставьте его. В командную строку токен не вписывайте:
   ```
   security add-generic-password -s moonkatty-node-imac-test -a node-token -w
   ```
5. Проверки (только чтение):
   ```
   ~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js --info
   ~/moonkatty-node/bin/node ~/moonkatty-node/app/studio-connection-test.mjs
   ```
   `studio-connection-test` делает только `GET /api/nodes/ping` и ничего не меняет. Ожидается «PASS» по TLS-пину, токену и ping.
6. Запустите агент на пробу в терминале:
   ```
   ~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js
   ```
   В панели узел `imac-test` должен стать «online» с версией агента 0.2.0. Остановите агент через Ctrl-C.
7. Автозапуск (по желанию, после успешной проверки): `./install.sh --autostart` и ввод `yes`. Метка launchd: `com.moonkatty.node-agent`, на этом iMac сейчас должен быть только тестовый узел.

## 6. Установка агента на MacBook (MONITOR NODE, macOS Monterey 12.7.6, Intel)
То же, что для iMac, со следующими отличиями:
- пакет `moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz` (Node 22, minos 11.0), SHA-256 `5748fe1257620412d1ac2dbcd0e1ac48ef01011a1c2e8753cfd7146797aada3c`;
- в env: `NODE_ID=macbook-test`, `NODE_PROFILE=monitor`;
- Keychain: `security add-generic-password -s moonkatty-node-macbook-test -a node-token -w`.

Функции X GROWTH (`x.analytics`, `x.draft`) по умолчанию выключены. Не включайте `NODE_X_GROWTH`. Публикация в тестовой сборке отключена полностью.

## 7. Что проверить в панели (только просмотр)
- Оба узла «online»: агент 0.2.0, ОС, CPU %, память и диск обновляются примерно раз в leaseMs/3.
- Кнопки «Пауза», «Drain» и «Run» меняют команду узла; в логе агента видно `pause` и `run`.
- Тяжёлые задачи (Blender, видео, большие модели, OpenCode) на узлы не уходят. Задачи с файлами ждут, пока Mac mini занят тяжёлой работой.

## 8. Откат
1. **Токены.** В панели «Узлы» нажмите «Отозвать» у `imac-test` и `macbook-test` (слово `ОТОЗВАТЬ`). Токены сразу перестанут работать.
2. **Узлы.** На каждом выполните:
   ```
   launchctl bootout gui/$(id -u)/com.moonkatty.node-agent 2>/dev/null
   ~/moonkatty-node/uninstall.sh
   security delete-generic-password -s moonkatty-node-imac-test -a node-token      # на MacBook: moonkatty-node-macbook-test
   rm -rf ~/.moonkatty-node ~/moonkatty-node
   ```
3. **Mac mini.**
   - В «Узлах» снимите «Включить Node API» и сохраните.
   - «Остановить фоновый сервер».
   - Удалите тестовое приложение по разделу «Откат» в `docs/MAC_TEST_ISOLATED.md`: приложение в `~/Applications`, папку `~/Library/Application Support/MOONKATTY AI STUDIO TEST` (вместе с `ops/`, где лежат сертификат и хэши токенов), элементы Keychain `MOONKATTY AI STUDIO.test` и launchd `com.moonkatty.aistudio.test.server`.
   - Проверьте, что `lsof -nP -iTCP:8690` ничего не показывает.
4. Рабочая v1.1.2 не затрагивается. Восстановление из копии описано в `MAC_TEST_ISOLATED.md`, §7.
