# Update Center (macOS) — архитектура и процедуры

Флаг: `STUDIO_OPS_UPDATE=1` (по умолчанию **выключен**). Код: `lib/ops/update-center.js`, API в `lib/ops/protected.js`,
UI: `public/update-ui.js` (Настройки › «Центр обновлений»). Переиспользует `lib/ops/update.js` (schemaCheck, codesign/план)
и `lib/ops/backup.js` (бэкап с SHA-256 + тест-восстановление). Ничего не устанавливает автоматически.

## 1. Архитектура
```
UI (Settings) ──► /api/ops/update-center/*  (только владелец: сессия/app-token)
                     │
                     ▼
              update-center.js ── safeFetch ─► api.github.com/repos/<allowlist>/releases
                     │                        github.com/<allowlist>/releases/download/…  ─302─► *.githubusercontent.com
                     ├─ verifySig (Ed25519, ключ lib/ops/update-keys/release-ed25519.pub.pem)
                     ├─ download (.partial, Range-докачка, лимит размера, атомарное состояние)
                     ├─ SHA-256 против ПОДПИСАННОГО manifest → inspectZip (traversal/обрезка)
                     ├─ gate (подпись, downgrade, minUpgradeFrom, identity, схема БД, бэкап, согласие владельца)
                     ├─ preBackup → backup.js create + verify + testRestore (во временную папку)
                     └─ installPlan (ручной) / rollback (dry-run) / healthCheck (/api/health)
```
Состояние: `<data>/ops/update-center/update-center.json` (tmp+rename, 0600). Загрузки: `<data>/ops/update-center/downloads/<tag>/`.

| API | Что делает |
|---|---|
| `GET /api/ops/update-center` | текущая версия, доступная, релизы, бэкап, схема, флаги |
| `POST …/check` | запрос релизов из GitHub (allowlist) + проверка подписи |
| `POST …/:tag/download` | фоновая загрузка + проверка (202; прогресс через GET) |
| `POST …/:tag/clean` | удалить временные `.partial` |
| `POST …/backup` | проверенный бэкап (checksum + тест-восстановление) |
| `GET …/:tag/plan` | ручной план установки + отката |
| `POST …/:tag/approve` | согласие владельца (пароль) на замену сборки с тем же bundleId |
| `POST …/:tag/auto-install` | выключено без всех флагов (см. §6), по умолчанию dry-run |
| `POST …/rollback` | план отката (dry-run) |
| `GET …/health` | health-check текущего сервера |
| `POST …/nodes/:id/:tag/check`, `…/deliver` | обновление MOONKATTY NODE (§7) |

## 2. Механизм проверки
* Только репозитории из allowlist (`DEFAULT_REPOS = ['moonkattymky/moonkatty-ai-studio']`), владелец/имя проверяются регэкспом.
* Только `https:`, без логина/пароля и нестандартных портов в URL. Первый запрос — только `api.github.com/repos/<repo>/…`
  или `github.com/<repo>/releases/download/<tag>/<file>`. Редиректы обрабатываются вручную (`redirect: 'manual'`),
  каждый переход проверяется: разрешены только `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`,
  `github-releases.githubusercontent.com`. Любой иной хост (в т.ч. IP, 169.254.169.254, localhost) — отказ. URL из UI/запроса не принимаются вообще.
* Релиз «проверен», только если: есть `release-manifest.json` + `release-manifest.json.sig`, подпись Ed25519 проверяется закреплённым ключом,
  поля manifest валидны (контракт `docs/RELEASE_MANIFEST.md` ветки feat/v1.2.2-test-isolated), версия тега == `manifest.version`.
* Нет manifest/подписи → «не проверено, только вручную»: загрузка через Update Center запрещена. `.zip.sha256` / `MANIFEST.sha256`
  без подписи **не считаются доверенными** (их можно подменить вместе с архивом).
* SHA-256 архива сверяется с `assets[].sha256` из **подписанного** manifest; размер больше заявленного — обрыв.
* Архив проверяется по central directory (zip64 поддерживается): нет EOCD/обрезка → отказ; `..`, абсолютные пути, `\`, `C:` → отказ; обязана быть `MOONKATTY AI STUDIO.app`.
* Прерванная загрузка: `.partial` остаётся, статус `interrupted`, повтор идёт с `Range`. Если сервер игнорирует Range — начинает с нуля. Если сервер упал посреди загрузки — при старте статус становится `interrupted`. «Очистить временные файлы» удаляет `.partial`.

## 3. Правила установки (gate)
1. Неподписанные/непроверенные — никогда.
2. Версия должна быть строго новее текущей (защита от downgrade/replay старого подписанного релиза); `minUpgradeFrom` соблюдается.
3. **v1.1.2 и v1.2.1 используют один bundleId `com.moonkatty.aistudio`, одну папку данных «MOONKATTY AI STUDIO» и один launchd-агент
   `com.moonkatty.aistudio.server`.** Поэтому установка 1.2.1 поверх рабочей 1.1.2 разрешена только при: проверенном бэкапе
   (checksum + тест-восстановление), пройденной проверке схемы БД (`dbSchemaVersion` из manifest ≥ текущей; миграция 1.1.2→1.2.1 лишь
   добавляет таблицы `jobs`, `job_events`) и явном согласии владельца (пароль). Без любого пункта — блок.
4. Изолированная тестовая сборка (v1.2.2-test: `com.moonkatty.aistudio.test`, своя папка, `…test.server`, Keychain-префикс `.test`)
   ставится **рядом**, текущая не затрагивается. Частичное совпадение идентичности (например, тот же каталог данных при другом bundleId) — блок.
5. `dbSchemaVersion` отсутствует → совместимость «не подтверждена», только вручную. Схема релиза старше текущей → блок.

## 4. Бэкап и откат
* «Сделать проверенный бэкап» = `backup.js create` (VACUUM INTO, файлы, desktop.json; secret.key исключён или зашифрован паролем) → `verify` (SHA-256 всех файлов + manifest) → `testRestore` во временную папку (`PRAGMA integrity_check`, совпадение количеств записей). Живые данные не трогаются.
* Ручная установка: остановить launchd-агент (`launchctl bootout gui/$UID/com.moonkatty.aistudio.server`), закрыть приложение,
  переименовать текущую в `MOONKATTY AI STUDIO-previous.app`, перетащить проверенную .app, открыть через Finder, `launchctl bootstrap`, `curl /api/health`.
* Откат: остановить агент, неудачную .app **переименовать** (не удалять), вернуть `-previous.app`, запустить, health. Если миграция схемы уже применилась — восстановить бэкап в пустую папку (`node ops/backup.js restore <id> --to <папка>`), старую папку данных переименовать (не удалять).
* Не затрагиваются никогда: Ollama (`~/.ollama`, сервис Ollama), OpenCode (127.0.0.1:4096), Keychain, папка данных, узлы.
* Gatekeeper/карантин не обходятся: никаких `xattr -d com.apple.quarantine`, `spctl --master-disable`. При отказе Gatekeeper — правый клик → «Открыть» после проверки, либо дождаться нотаризованной сборки.

## 5. Health check
`GET http://127.0.0.1:8787/api/health` → `app == "moonkatty-ai-studio"`, `db != false`, `version == ожидаемая`. Автоустановка ждёт до 15 попыток и откатывает при провале.

## 6. Автоустановка (выключена)
Код есть (`autoInstall`): bootout → mv в `-previous.app` → `ditto -x -k` → `codesign --verify --deep --strict` → bootstrap → health → откат при ошибке.
Включится только при ВСЕХ: `OPS_UPDATE_AUTO_INSTALL=1`, `OPS_UPDATE_SIGNATURE_READY=1` (боевой ключ на месте), `OPS_UPDATE_BACKUP_VERIFIED_READY=1`,
`OPS_UPDATE_ROLLBACK_TESTED_ON_MAC=1` (откат проверен на реальном Mac). Даже тогда действует gate (§3). Не тестировалась на macOS.

## 7. MOONKATTY NODE (iMac / MacBook)
Выключено: `OPS_UPDATE_NODES=1`. Сначала `…/nodes/:id/:tag/check` — сравнение `arch`, версии macOS (iMac Intel 12.5.1 ⇒ требования manifest `node.minMacOS`), версии Node с секцией `node` подписанного manifest. Только после успешной проверки `deliver` ставит job `node.update` (safeToRetry=false, 1 попытка, idempotency key) в режиме «download-verify-manual». Агент узла пока **не реализует** `node.update`, а пресеты ролей его не содержат — job останется в очереди; это следующий шаг.

## 8. План ввода подписанных обновлений
1. **Ключ офлайн**: на отключённом от сети Mac `openssl genpkey -algorithm ed25519 -out release.key` (или `minisign -G`, затем экспорт сырого Ed25519); приватный ключ — на зашифрованный носитель + резервная копия в сейфе. Публичный: `openssl pkey -in release.key -pubout > release-ed25519.pub.pem` → коммит в `lib/ops/update-keys/` через ревью. Текущий ключ в репозитории — заглушка (приватная часть уничтожена), поэтому сейчас ни один релиз не проходит проверку.
2. **Подпись в CI**: job release собирает zip, считает SHA-256, формирует `release-manifest.json`, подписывает `openssl pkeyutl -sign -rawin -inkey release.key -in release-manifest.json | base64 > release-manifest.json.sig`. Ключ — в защищённом environment GitHub с ручным approve (или подписывать вручную офлайн и загружать .sig). CI-шаг сразу проверяет подпись публичным ключом из репо.
3. **Apple Developer ID**: позже — `codesign --options runtime --timestamp` с Developer ID Application, `notarytool submit --wait`, `stapler staple`; в manifest `notarized: true`. До этого Gatekeeper будет предупреждать — не обходим.
4. **Поэтапный rollout**: канал `test` (изолированная сборка на Mac mini рядом) → `preview` (Mac mini, ручная установка по плану, 3–7 дней наблюдения) → `stable`; узлы — по одному (сначала MacBook, потом iMac). Автоустановку включать только после записанного успешного отката на реальном Mac.
5. Ротация ключа: новый публичный ключ добавляется файлом рядом (поддерживается несколько ключей), старый удаляется после перехода.
