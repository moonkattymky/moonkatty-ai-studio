# Update Center — проверка на Mac mini (пошагово)

После каждого шага — **Проверка**. Если результат не совпал — остановиться, ничего не устанавливать.
Ничего из этого не отключает Gatekeeper и не снимает карантин.

0. **Подготовка.** `cd ~/moonkatty-ai-studio && git fetch && git checkout feat/update-center && npm ci`.
   Проверка: `git log -1 --oneline` показывает коммит ветки; `node -v` ≥ 20.
1. **Тесты.** `npm test`.
   Проверка: `# fail 0` для node:test, `{"passed":…,"failed":[]}` у security; runner/opencode — все PASS.
2. **Текущее состояние.** `launchctl print gui/$UID/com.moonkatty.aistudio.server | head -5`; `curl -s http://127.0.0.1:8787/api/health`.
   Проверка: агент запущен; JSON `app: moonkatty-ai-studio`, `version: 1.1.2`. Запишите это — точка отката.
3. **Включить флаг.** Добавьте в окружение launchd-агента (plist `EnvironmentVariables`) `STUDIO_OPS_UPDATE=1` и `STUDIO_OPS_BACKUP=1`, перезапустите: `launchctl kickstart -k gui/$UID/com.moonkatty.aistudio.server`.
   Проверка: `curl -s -H 'x-studio-request: 1' http://127.0.0.1:8787/api/ops/status` → `"update":true`.
3a. **Идентичность.** `curl -s -H 'x-studio-request: 1' -b <cookie> http://127.0.0.1:8787/api/ops/update-center | jq .identity`.
   Проверка: `flavor: prod`, `source: Info.plist`, `known: true`, `bundleId: com.moonkatty.aistudio`. На тестовой сборке (порт 8687): `flavor: test`, путь `/Applications/MOONKATTY AI STUDIO TEST.app`. Ключи: prod — «нет (нужен ключ владельца)», test — «ЗАГЛУШКА».
4. **UI.** Откройте панель → ⚙ Настройки → «Центр обновлений».
   Проверка: «Текущая версия v1.1.2», «схема БД 1», «Автоустановка: выключена».
5. **Проверка обновлений.** Кнопка «Проверить обновления».
   Проверка: список релизов с GitHub; для релизов без `release-manifest.json(.sig)` — «не проверено», «Установка: заблокирована», кнопки «Скачать обновление» нет.
6. **Бэкап.** «Сделать проверенный бэкап».
   Проверка: «проверен · checksum OK · тест-восстановление OK»; папка `~/Library/Application Support/MOONKATTY AI STUDIO/ops/backups/<id>` есть; `node ops/backup.js verify <id>` → ok.
7. **Подписанный тестовый релиз** (когда в CI появится подпись; до этого шаг пропустить). «Скачать обновление».
   Проверка: прогресс-бар растёт; затем «загружено и проверено SHA-256 + подпись». Выключите Wi-Fi посреди загрузки → статус «interrupted»; включите, снова «Скачать» → докачка, «проверено».
8. **Проверка порчи.** В `…/ops/update-center/downloads/<tag>/` допишите байт в готовый zip и снова нажмите «Скачать».
   Проверка: zip перекачан/или «SHA-256 не совпадает — файл удалён». Ничего не установлено.
9. **План установки.** «План установки».
   Проверка: для v1.2.1 поверх v1.1.2 — «заблокирована», пока нет одобрения владельца; после «Разрешить замену (владелец)» с паролем — шаги ручной установки + отката; в плане нет `xattr`, `spctl --master-disable`, `rm -rf`.
10. **Изолированная тестовая сборка** (v1.2.2-test). Проверка: режим «рядом (изолированная)», текущая сборка/данные не трогаются.
11. **Сервисы (dry-run).** «План отката» → только команды (dry-run). Проверка: команды `launchctl bootout/bootstrap`, `mv … -previous.app`; Ollama (`curl -s 127.0.0.1:11434/api/tags`) и OpenCode продолжают работать.
12. **Ручная установка** (только при одобрении владельца, после шага 6 и 9) — строго по шагам из плана. После: `curl -s http://127.0.0.1:8787/api/health` → `version` новая; кнопка «Health» → ok. Ollama-модели на месте (`ollama list`), пароль OpenCode в Keychain на месте (`security find-generic-password -s <service> >/dev/null && echo ok`).
13. **Откат (репетиция)**: по плану отката вернуть `-previous.app`. Проверка: `/api/health` → `1.1.2`, данные на месте (кол-во задач совпадает с шагом 2). Только после успешной репетиции можно выставить `OPS_UPDATE_ROLLBACK_TESTED_ON_MAC=1`.
13a. **Автопроверка отключена.** Запустите приложение, подождите 1 мин. Проверка: окна «Доступно обновление» нет, `lsof -i -n | grep -i github` пусто; пункт меню «Проверить обновления…» работает вручную.
14. **Узлы.** С выключенным `OPS_UPDATE_NODES` — `deliver` отвечает «выключены». С включённым: `check` для iMac (Intel, macOS 12.5.1) показывает ok/проблемы; `deliver` без успешного check — отказ.
15. **Выключение.** Уберите `STUDIO_OPS_UPDATE=1`, перезапустите. Проверка: `/api/ops/update-center` → 404; раздел в Настройках исчез.
