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

## Проверка прав папки внешнего keyring на Mac mini (QA-UC-007)
Скрипт `scripts/mac-keyring-check.sh` работает **только** во временной папке внутри `$TMPDIR` (создаёт её через `mktemp` и удаляет
в конце), создаёт одноразовый **публичный** тест-ключ в памяти, не читает ваши настоящие ключи и не меняет системные настройки.

1. **Открыть репозиторий.** `cd ~/moonkatty-ai-studio && git log --oneline -1`.
   **Проверка:** коммит ветки `feat/update-center` (или сборки v1.3.0-test), `git status --short` пусто.
2. **Посмотреть $TMPDIR.** `echo $TMPDIR; cd "$TMPDIR" && pwd -P; cd -`.
   **Проверка:** путь вида `/var/folders/…/T/`, а `pwd -P` показывает `/private/var/folders/…` (на macOS `/var` — ссылка на `/private/var`;
   это нормально и **не** должно блокировать keyring — блокируется только сама папка-ссылка).
3. **Запустить проверку.** `bash scripts/mac-keyring-check.sh`.
   **Проверка:** в первой строке `ОС: Darwin`, права `700` и ваш uid (`id -u`) — их выводит BSD `stat -f '%Lp' / '%u'`.
4. **Сверить результаты.** Ожидается `PASS` в каждой строке:
   0700 → READY (оба пути: через `$TMPDIR` и через realpath); 755 / 777 / 750 → BLOCKED; папка-ссылка → BLOCKED;
   `.pub.pem`-ссылка наружу → BLOCKED; `keyring.json`-ссылка → BLOCKED; файл 666 → BLOCKED; чужой владелец (симуляция uid) → BLOCKED.
   **Проверка:** последняя строка `Итого: ВСЕ PASS`, код выхода `echo $?` → `0`.
5. **Убедиться, что следов нет.** `ls "$TMPDIR" | grep mk-keyring-check`.
   **Проверка:** пусто (временная папка удалена).
6. **Если есть FAIL** — пришлите разработчику только вывод скрипта (в нём нет секретов: только публичный тест-ключ, права и uid).
   Настоящий keyring в это время оставьте без изменений; Update Center при любом нарушении показывает `BLOCKED`.

Реальный «чужой владелец» требует `sudo chown` — скрипт этого **не** делает (симулирует uid). Вручную, по желанию:
`D=$(mktemp -d); sudo chown root "$D"; OPS_UPDATE_KEYRING_DIR=$D node -e 'const U=require("./lib/ops/update-center.js");console.log(U.signatureStatus(U.loadKeyrings({env:process.env})).message)'; sudo rm -rf "$D"`
→ `BLOCKED: … владелец папки uid 0 …`.

## Anti-rollback в собранном приложении
`scripts/build-mac.sh` записывает `desktop/build-info.json` (`scripts/write-build-info.mjs`, `builtAt` = время последнего коммита),
файл упаковывается в `app.asar` (`build.files: desktop/**`). Update Center собранного приложения отклоняет релизы с версией ≤ текущей и
с подписанным `builtAt` старше сборки. **Проверка:** Настройки › «Центр обновлений» — строки «проверка возраста сборки недоступна» **нет**;
`npx asar list "/Applications/MOONKATTY AI STUDIO.app/Contents/Resources/app.asar" | grep build-info` → `/desktop/build-info.json`.
В dev-запуске (без сборки) статус показывает `⚠ проверка возраста сборки недоступна …` — это ожидаемо.
