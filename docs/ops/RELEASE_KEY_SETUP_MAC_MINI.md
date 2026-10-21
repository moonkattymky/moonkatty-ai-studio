# Ключ подписи релизов на Mac mini — пошагово (MOONKATTY AI STUDIO v1.3.0-test)

Цель: владелец сам создаёт пару ключей Ed25519 на Mac mini, хранит **приватный** ключ офлайн, а в Update Center
добавляет **только публичный**. Пока публичного ключа нет, Update Center показывает
**`BLOCKED: нет публичного ключа владельца`** — проверка подписи закрыта (fail-closed), установка через Update Center
невозможна, но остальное приложение и страница «Центр обновлений» работают как обычно. Локальное тестирование сборки
v1.3.0-test этим не блокируется.

> **Никогда** не отправляйте приватный ключ, его пароль или содержимое файла `*.key` в GitHub, в логи, в архивы сборки,
> в чаты, в письма и в сообщения AI-агентам (включая этого бота). Агентам можно показывать только `keyId` и `.pub.pem`.

Скрипты: `scripts/release-keygen.mjs` (генерация), `scripts/release-sign.mjs` (подпись `release-manifest.json`).
Формат подписи и keyring: `lib/ops/update-keys/README.md`, `docs/ops/UPDATE_CENTER.md` §1b.

---

## Шаг 0. Подготовка
1. Откройте «Терминал» на Mac mini, перейдите в клон репозитория: `cd ~/moonkatty-ai-studio` (ваш путь).
2. Убедитесь, что Node 20+ установлен: `node -v`.
   **Проверка:** выводится `v20.x` или новее.
3. Убедитесь, что рабочее дерево чистое: `git status --short`.
   **Проверка:** вывод пустой.

## Шаг 1. Место для приватного ключа ВНЕ репозитория
Вариант А (рекомендуется): зашифрованный USB-накопитель (APFS, зашифрованный) — например `/Volumes/MK-KEYS`.
Вариант Б: зашифрованный образ диска: Дисковая утилита → Файл → Новый образ → Пустой образ, формат «APFS», шифрование
«256-бит AES», имя `MK-KEYS`; затем дважды щёлкните `.dmg`, чтобы смонтировать.

```bash
mkdir -p /Volumes/MK-KEYS/moonkatty && chmod 700 /Volumes/MK-KEYS/moonkatty
```
**Проверка:** `ls -ld /Volumes/MK-KEYS/moonkatty` → `drwx------`; `diskutil info /Volumes/MK-KEYS | grep -i encrypt` → `Yes`.
Папка **не** должна находиться внутри репозитория, iCloud Drive, Dropbox или папки, которая синхронизируется.

## Шаг 2. (Рекомендуется) Отключить сеть на время генерации
Выключите Wi-Fi/Ethernet в строке меню.
**Проверка:** `ping -c1 -t2 1.1.1.1` → `Request timeout` / `No route to host`.

## Шаг 3. Сгенерировать пару ключей
```bash
node scripts/release-keygen.mjs --channel prod --out /Volumes/MK-KEYS/moonkatty
```
Скрипт спросит пароль (минимум 12 символов, дважды). Пароль **не вводите в командную строку** и не передавайте агентам.
Скрипт сам откажется писать в папку внутри репозитория.

**Проверка:**
* вывод содержит `keyId: <16 hex-символов>` — запишите keyId (это не секрет);
* `ls -l /Volumes/MK-KEYS/moonkatty` показывает два файла:
  `release-prod-<keyId>.key` с правами `-rw-------` (600) и `release-prod-<keyId>.pub.pem` с правами `-rw-r--r--`;
* `head -1 /Volumes/MK-KEYS/moonkatty/release-prod-<keyId>.key` — первая строка должна говорить ENCRYPTED PRIVATE KEY
  (ключ зашифрован паролем). Содержимое файла дальше не выводите и никуда не копируйте;
* `git status --short` в репозитории — по-прежнему пусто.

Если права не 600: `chmod 600 /Volumes/MK-KEYS/moonkatty/release-prod-*.key`.

## Шаг 4. Пароль ключа — в Связку ключей macOS (по желанию)
```bash
security add-generic-password -s moonkatty-release-key -a "prod-<keyId>" -w
```
(без значения после `-w` — macOS спросит пароль интерактивно, он не попадёт в историю shell.)
**Проверка:** `security find-generic-password -s moonkatty-release-key -a "prod-<keyId>"` находит запись (пароль не печатается).
Сам файл `.key` остаётся на зашифрованном носителе; в Связке ключей — только пароль к нему.

## Шаг 5. Резервная копия приватного ключа
1. Подключите **второй** зашифрованный носитель (например `/Volumes/MK-KEYS-BACKUP`).
2. `cp -p /Volumes/MK-KEYS/moonkatty/release-prod-<keyId>.key /Volumes/MK-KEYS-BACKUP/`
3. Пароль ключа запишите на бумаге и храните отдельно от носителей (сейф).

**Проверка:** `shasum -a 256 /Volumes/MK-KEYS/moonkatty/release-prod-<keyId>.key /Volumes/MK-KEYS-BACKUP/release-prod-<keyId>.key`
→ два одинаковых хэша; `ls -l` на копии → `-rw-------`.
Не делайте копии в облако, Time Machine без шифрования, почту, мессенджеры.

## Шаг 6. Пробная подпись (проверка, что ключ и пароль работают)
```bash
mkdir -p /tmp/mk-sigtest && cd /tmp/mk-sigtest
printf '{"channel":"preview","version":"0.0.0"}' > release-manifest.json
node ~/moonkatty-ai-studio/scripts/release-sign.mjs --key /Volumes/MK-KEYS/moonkatty/release-prod-<keyId>.key --manifest release-manifest.json
```
**Проверка:** вывод `подписано: release-manifest.json.sig (keyId <keyId>, канал preview)`; в `.sig` поле `"keyId"` равно вашему keyId.
Затем `rm -r /tmp/mk-sigtest`.
(С паролем из Связки: `RELEASE_KEY_PASSPHRASE="$(security find-generic-password -s moonkatty-release-key -a prod-<keyId> -w)" node …` —
пароль не печатается и не попадает в историю.)

## Шаг 7. Извлечь носитель
Верните сеть только **после** извлечения: Finder → «Извлечь» `MK-KEYS`.
**Проверка:** `ls /Volumes` — `MK-KEYS` отсутствует.

## Шаг 8. Добавить ТОЛЬКО публичный ключ в Update Center
Есть два способа. Оба используют только `.pub.pem` и запись keyring.

### 8а. Локально на Mac mini, без коммита (для тестов v1.3.0-test)
```bash
KR="$HOME/Library/Application Support/MOONKATTY AI STUDIO/update-keys"
mkdir -p "$KR" && chmod 700 "$KR"
cp /путь/к/release-prod-<keyId>.pub.pem "$KR/"   # обычный файл, НЕ символическая ссылка
cat > "$KR/keyring.json" <<'JSON'
{ "version": 1,
  "keys": { "<keyId>": { "file": "release-prod-<keyId>.pub.pem", "set": "prod", "status": "active" } },
  "revoked": [] }
JSON
chmod 700 "$KR" && chmod 600 "$KR/keyring.json" "$KR"/*.pub.pem
```
**Проверка прав (обязательно, иначе BLOCKED):** `ls -ld "$KR"` → `drwx------` и ваш пользователь;
`ls -l "$KR"` → оба файла `-rw-------`, ваш пользователь, без `->` (ссылок). Update Center **отклоняет** внешний keyring
(статус `BLOCKED: внешний keyring (OPS_UPDATE_KEYRING_DIR) отклонён — <причина>`), если: права папки не 700; владелец не текущий
пользователь; папка, `keyring.json` или любой `.pub.pem` — символическая ссылка; файл доступен на запись группе/другим;
имя файла ключа содержит путь. Путь в `OPS_UPDATE_KEYRING_DIR` указывайте без символических ссылок.

Добавьте в окружение launchd-агента (plist `EnvironmentVariables`) `OPS_UPDATE_KEYRING_DIR` = путь `$KR` (полный, без `~`)
и перезапустите: `launchctl kickstart -k gui/$UID/com.moonkatty.aistudio.server`.
Эта папка только **добавляет** публичные ключи и отзывы к встроенному `lib/ops/update-keys/keyring.json`.
Файл, содержащий приватный ключ, будет отклонён с ошибкой «это ПРИВАТНЫЙ ключ».

**Проверка:** Настройки › «Центр обновлений» → «Проверка подписи: READY»;
или `curl -s -b <cookie> http://127.0.0.1:8787/api/ops/update-center | jq .signature` → `{"state":"READY",…}`;
`keyring.problems` пуст.

### 8б. В репозитории (для общей сборки, через ревью)
Скопируйте `release-prod-<keyId>.pub.pem` в `lib/ops/update-keys/`, добавьте запись в `lib/ops/update-keys/keyring.json`
(`"set": "prod"`, `"status": "next"`, после первого релиза — `"active"`), сделайте коммит **только** этих двух файлов.
**Проверка:** `git diff --cached --name-only` → только `.pub.pem` и `keyring.json`; `npm run test:ops` проходит
(тест `release-keys.test.js` проверяет, что в git и в списке файлов сборки нет приватных ключей).

## Шаг 8в. Подпись релиза и `builtAt`
`release-manifest.json` **обязан** содержать подписанное поле `builtAt` (дата сборки ISO 8601). `scripts/release-sign.mjs` сам добавляет
`builtAt` (текущее время), если его нет, и только потом подписывает. Manifest без `builtAt` Update Center считает непроверенным и не
даёт скачать (QA-UC-006). **Проверка:** после подписи `grep builtAt release-manifest.json` показывает дату; файл manifest после подписи
не редактировать (иначе подпись не пройдёт).

## Шаг 9. Что остаётся выключенным
Автоустановка остаётся выключенной: все четыре флага `OPS_UPDATE_AUTO_INSTALL`, `OPS_UPDATE_SIGNATURE_READY`,
`OPS_UPDATE_BACKUP_VERIFIED_READY`, `OPS_UPDATE_ROLLBACK_TESTED_ON_MAC` по умолчанию не заданы (включает только точное значение `1`).
Неподписанные/непроверенные релизы никогда не устанавливаются автоматически; подписанные — только загрузка + проверка
SHA-256 + ручной план установки.

## Отзыв ключа (компрометация)
Добавьте keyId в `"revoked"` (в 8а — в локальный `keyring.json`, в 8б — коммитом), перезапустите сервер.
**Проверка:** «Проверка подписи: BLOCKED…», релизы этого ключа — «ключ … отозван». Затем повторите шаги 1–8 с новым ключом.

## Защита от утечки
* `.gitignore` исключает `*.key`, `*.p8`, `*.p12`, `*.pfx`, `*.priv`, `*private*.pem`, `*secret*.pem`.
* `package.json › build.files` исключает те же шаблоны из архива приложения.
* Тест `test/ops/release-keys.test.js` сканирует файлы git и упаковываемые каталоги на приватные ключи.
