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

## 1a. Идентичность запущенного приложения (QA-UC-001)
`lib/ops/app-identity.js` определяет её при запуске, без констант в коде Update Center: 1) `Contents/Info.plist` (CFBundleIdentifier) бандла, внутри которого работает сервер;
2) `STUDIO_APP_BUNDLE_ID`; 3) `package.json build.appId` (dev). Bundle id сопоставляется с известным профилем:

| профиль | каналы | bundleId | папка данных | launchd | Keychain | порт | путь |
|---|---|---|---|---|---|---|---|
| prod | preview, stable | com.moonkatty.aistudio | MOONKATTY AI STUDIO | com.moonkatty.aistudio.server | MOONKATTY AI STUDIO | 8787 | /Applications/MOONKATTY AI STUDIO.app |
| test | test | com.moonkatty.aistudio.test | MOONKATTY AI STUDIO TEST | com.moonkatty.aistudio.test.server | MOONKATTY AI STUDIO.test | 8687 | /Applications/MOONKATTY AI STUDIO TEST.app |

Неизвестный bundle id, `STUDIO_FLAVOR`, противоречащий bundle id, или имя бандла не по профилю → `known=false` → любая установка заблокирована.
Manifest обязан совпадать с профилем своего канала (все 5 идентификаторов + `isolated`); test-manifest с prod-идентификаторами отклоняется.
Замена возможна только для того же профиля (bundleId = запущенному), путь установки = `/Applications/<appName>.app` профиля и обязан совпасть с путём запущенного
приложения. Другой профиль — только «рядом», если сборка полностью изолирована. Prod `.app` никогда не заменяется из test-manifest, и наоборот.

## 1b. Ключи подписи (keyring)
`lib/ops/update-keys/keyring.json`: наборы **prod** (каналы preview/stable) и **test**; у каждого ключа `keyId` (16 hex SHA-256 SPKI), `status`
(`active`/`next`/`retired`), список `revoked`. Подпись — JSON `{v:1, alg:"ed25519", keyId, sig}`; проверяется только названный ключ и только из
набора канала manifest. Подпись без keyId не принимается. Ключ-заглушка помечен `stub: true`, лежит только в наборе test и для prod отклоняется кодом.
**Набор prod пуст**: реальный ключ создаёт владелец офлайн (`scripts/release-keygen.mjs`, см. §8).

### 1c. Статус подписи и ключ владельца (v1.3.0-test)
* `GET /api/ops/update-center` → `signature: {state, message}`. Пустой prod-набор → `state: "BLOCKED"`,
  `message: "BLOCKED: нет публичного ключа владельца"`; подпись не принимается (fail-closed), остальное приложение работает.
* Публичный ключ владельца без коммита: `OPS_UPDATE_KEYRING_DIR=<папка с keyring.json + .pub.pem>` (только добавляет ключи/отзывы;
  приватный ключ отклоняется). Пошагово: `docs/ops/RELEASE_KEY_SETUP_MAC_MINI.md`.
  Fail-closed (QA-UC-007): папка 0700, владелец — текущий uid, без симлинков (папка, keyring.json, .pub.pem; lstat), файлы не group/other-writable;
  любое нарушение → `BLOCKED: внешний keyring … отклонён — <причина>`, внешние ключи не загружаются.
  TOCTOU (QA-UC-009): realpath вычисляется один раз; папка и файлы открываются с `O_NOFOLLOW` (папка — `O_DIRECTORY`), права/владелец/тип —
  через `fstat` того же дескриптора, содержимое читается из него же; после чтения dev/ino папки сверяются повторно; родительские папки,
  доступные на запись всем без sticky-бита, → BLOCKED.
* Собранное приложение (QA-UC-008): сервер работает из `app.asar.unpacked`, поэтому `desktop/build-info.json` распаковывается
  (`build.asarUnpack`). Режим «собрано» определяется по пути кода (`app.asar` / `app.asar.unpacked`); если там build-info нет или он не читается —
  релиз **не проверен** (`BLOCKED: собранное приложение без читаемого desktop/build-info.json …`). В dev-запуске — только предупреждение.
* Подписанная версия (anti-rollback): `version` берётся только из подписанного manifest и должна совпадать с тегом и именем `.zip`;
  версия ≤ текущей → релиз не проверен; `builtAt` в будущем (> 5 мин) или старше `builtAt` текущей сборки (`desktop/build-info.json`) → не проверен.
* Подписанное поле manifest `builtAt` (ISO) **обязательно** (QA-UC-006): без него релиз не проверен; участвует в проверке возраста (берётся более старая дата). `release-sign.mjs` добавляет его перед подписью.

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
* SHA-256 архива сверяется с `assets[].sha256` из **подписанного** manifest; размер больше заявленного — обрыв. **Повторно** SHA-256 и разбор архива выполняются при каждом построении плана/автоустановки (QA-UC-003); если файл подменён — статус `tampered`, блок.
* Симлинки в архиве (QA-UC-002): цель читается из архива; абсолютная, с `..` за пределы `.app` или в другой каталог верхнего уровня — архив отклоняется.
* Согласие владельца привязано к SHA-256 подписанного manifest: новый manifest под тем же тегом аннулирует согласие. Тег должен быть ровно `v<version>` (или `v<version>-mac-preview` для preview); версия с `-test` только в канале test. Релиз старше 365 дней не ставится заменой (защита от replay).
* Схема (QA-UC-005): если запущенный код считает текущую БД неподдерживаемой (`schemaCheck.ok=false`), установка блокируется; неизвестная `dbSchemaVersion` (не 1–4) — блок.
* Health URL — только `http://127.0.0.1|localhost:<порт>/api/health`; Electron больше не проверяет GitHub сам при запуске (QA-UC-004), только пункт меню.
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
Код есть (`autoInstall`): требует manifest `signing: "developer-id"` + `notarized: true`; распаковка `ditto -x -k` во ВРЕМЕННУЮ staging-папку → `codesign --verify --deep --strict` → `spctl --assess --type execute` → `codesign -dv` содержит `Authority=Developer ID Application` → только затем bootout → mv в `-previous.app` → mv staged → bootstrap → health → откат. Карантин не снимается.
Включится только при ВСЕХ: `OPS_UPDATE_AUTO_INSTALL=1`, `OPS_UPDATE_SIGNATURE_READY=1` (боевой ключ на месте), `OPS_UPDATE_BACKUP_VERIFIED_READY=1`,
`OPS_UPDATE_ROLLBACK_TESTED_ON_MAC=1` (откат проверен на реальном Mac). Даже тогда действует gate (§3). Не тестировалась на macOS.

## 7. MOONKATTY NODE (iMac / MacBook)
Выключено: `OPS_UPDATE_NODES=1`. Сначала `…/nodes/:id/:tag/check` — сравнение `arch`, версии macOS (iMac Intel 12.5.1 ⇒ требования manifest `node.minMacOS`), версии Node с секцией `node` подписанного manifest. Только после успешной проверки `deliver` ставит job `node.update` (safeToRetry=false, 1 попытка, idempotency key) в режиме «download-verify-manual». Агент узла пока **не реализует** `node.update`, а пресеты ролей его не содержат — job останется в очереди; это следующий шаг.

## 8. План ввода подписанных обновлений
1. **Ключ офлайн (шаг владельца)**: на отключённом от сети Mac `node scripts/release-keygen.mjs --channel prod --out /Volumes/<зашифрованный носитель>/moonkatty-keys` (пароль ≥12 символов; скрипт отказывается писать внутрь репозитория). Приватный ключ (PKCS#8, AES-256, 0600) + резервная копия — в сейф. В репозиторий через ревью: только `.pub.pem` в `lib/ops/update-keys/` и запись в `keyring.json` (сначала `next`, затем `active`). Аналогично отдельный ключ для `--channel test`. Заглушка остаётся только в наборе test.
2. **Подпись**: `node scripts/release-sign.mjs --key <ключ> --manifest dist/release-manifest.json` → `release-manifest.json.sig` (JSON с keyId; скрипт сам проверяет подпись). Ключ — в защищённом environment GitHub с ручным approve (или подписывать вручную офлайн и загружать .sig). CI-шаг сразу проверяет подпись публичным ключом из репо.
3. **Apple Developer ID**: позже — `codesign --options runtime --timestamp` с Developer ID Application, `notarytool submit --wait`, `stapler staple`; в manifest `notarized: true`. До этого Gatekeeper будет предупреждать — не обходим.
4. **Поэтапный rollout**: канал `test` (изолированная сборка на Mac mini рядом) → `preview` (Mac mini, ручная установка по плану, 3–7 дней наблюдения) → `stable`; узлы — по одному (сначала MacBook, потом iMac). Автоустановку включать только после записанного успешного отката на реальном Mac.
5. Ротация: новый ключ → `next` в keyring (релиз, подписанный старым ключом, доставляет новый keyring) → подписывать новым и пометить `active` → старый `retired`; при компрометации — keyId в `revoked`. Ключ одного набора никогда не принимается для другого канала.


## 9. Интеграция в v1.3.0-test (ветка feat/update-center-v130)
* Маршруты монтирует `lib/ops/update-center-mount.js` (вызов в `server.js` после auth/CSRF) **только** при `STUDIO_OPS_UPDATE=1`; иначе 404.
  Без ops-стека (Security Center, ledger, costs, watchdog, nodes): обновление узлов в этой сборке не подключено.
* Идентичность: Info.plist запущенного бандла; в source-checkout — `CFG.appId` текущего flavor; `STUDIO_FLAVOR` должен совпадать.
* Бэкап перед обновлением: адаптер `lib/ops/update-backup.js` (VACUUM INTO + SHA-256 + тест-восстановление во временную папку).
* Совместимость схемы: поддерживается до `DB_SCHEMA_VERSION` сервера (6); известные схемы manifest 1–6.
* Пароль владельца обязателен для `approve` и `auto-install` (автоустановка всё равно выключена: 4 флага `OPS_UPDATE_*` не заданы).
* UI: `public/update-ui.js` (Настройки › «Центр обновлений») появляется, только если `GET /api/ops/update-center` ≠ 404.

### 9a. Ключ ≠ включение обновлений; QA-UC-010
* `signature.state = READY` (ключ владельца добавлен) включает **только проверку подписи**. Загрузка/одобрение/установка через
  Update Center требуют отдельного флага владельца `OPS_UPDATE_DOWNLOAD_ENABLED=1` **и** снятия жёсткого запрета в коде
  (`HARD_GATE.closed = true` в `lib/ops/update-center.js`) — переключателя через env/HTTP нет. Статус: `GET …/update-center` → `mechanism`.
* QA-UC-010 (гонка переименования папки тем же пользователем): файлы keyring читаются **относительно fd проверенной папки**
  (`/proc/self/fd/<fd>/<имя>` + `O_NOFOLLOW`, аналог openat) — `externalReadMode: "fd-relative"`. Стресс-тест (Linux, ~90 000 загрузок):
  режим path — 8 «смешанных» загрузок (байты не из проверенной папки), fd-relative — 0. На macOS `/dev/fd/<n>` не проходим как каталог →
  режим `path` (окно гонки ограничено только проверками dev/ino до/после) → жёсткий запрет остаётся.
