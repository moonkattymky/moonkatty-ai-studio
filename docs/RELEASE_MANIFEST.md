# release-manifest.json — формат

Каждый релиз (начиная с `v1.2.2-test`) содержит ассет `release-manifest.json`. Его генерирует `scripts/release-manifest.mjs`, вызов идёт из `scripts/package-mac-on-linux.sh`. Значения берутся из `lib/studio-config.js` (имена/ID), `server.js` (`DB_SCHEMA_VERSION`), `package.json` и git.

| Поле | Тип | Описание |
|---|---|---|
| `manifestVersion` | number | Версия формата (сейчас `1`) |
| `version` | string | Версия приложения (`package.json`), например `1.2.2-test` |
| `channel` | `"test"` \| `"preview"` \| `"stable"` | `test` — изолированная тестовая сборка; `preview` — версия с суффиксом; `stable` — без суффикса |
| `sourceCommit` | string | Полный SHA коммита, из которого собрано |
| `branch` | string | Ветка сборки |
| `arch` / `platform` | string | `arm64` / `darwin` |
| `bundleId` | string | `CFBundleIdentifier` |
| `appName` | string | Имя приложения (`<appName>.app`) |
| `dataDirName` | string | Имя папки в `~/Library/Application Support/` (и в `~/Library/Logs/`) |
| `dataDir`, `logDir` | string | Полные пути (с `~`) |
| `launchdLabel` | string | Label LaunchAgent фонового сервера |
| `keychainServicePrefix` | string | Service всех элементов Keychain этой сборки |
| `keychainItems` | `[{service, account}]` | Все элементы Keychain (мастер-ключ, пароль OpenCode) |
| `defaultPort` | number | Порт локального сервера (127.0.0.1) |
| `opencodeUrl` | string | Адрес OpenCode server по умолчанию |
| `dbSchemaVersion` | number | Версия схемы SQLite (см. ниже) |
| `minUpgradeFrom` | string \| null | Минимальная версия, поверх данных которой можно ставить; `null` — сборка не обновляет чужие данные (свежая установка) |
| `isolated` | boolean | `true` — своя папка данных, Keychain, launchd, bundle id |
| `isolatedFrom` | string[] | bundle id, с которыми сборка НЕ делит данные |
| `electron` | string | Версия Electron |
| `signing` | `"adhoc"` | Подпись (`rcodesign`, без сертификата Apple) |
| `notarized` | boolean | Нотаризация (`false`) |
| `assets` | `[{name, size, sha256}]` | Остальные ассеты релиза (zip, .sha256, MANIFEST.sha256, sbom.cdx.json, BUILD-INFO.txt) |

## Версии схемы БД (`dbSchemaVersion`)

До v1.2.2 явной метки версии в БД не было. Значение определяется по схеме (`lib/db-backup.js → detectVersion`), а с v1.2.2 записывается в `meta.schemaVersion`.

| Схема | Что в ней | Версии |
|---|---|---|
| 1 | только `items` + `meta` | v1.0 – v1.1.x (**v1.1.2 = 1**) |
| 2 | + `jobs`, `job_events` | ранние сборки v1.2.0 |
| 3 | + колонки `jobs.resource_class/requires_node/idempotency_key/safe_to_retry/input`, миграция `mig_120_design3d` | v1.2.0 – **v1.2.1 = 3** |
| 4 | + `meta.schemaVersion`, автоматический бэкап перед миграцией | v1.2.2-test … v1.2.4-test = 4 |
| 5 | + `world_journal`, `world_ledger`, `world_approvals` | v1.3.0-test, до выплаты |
| 6 | ledger: `payout_id`, `currency`, `state`, `confirmation_source`; уникальность `(platform, payout_id)` | **v1.3.0-test = 6** |

Перед любой миграцией существующей БД (схема ниже текущей) сервер делает `VACUUM INTO backups/pre-migration-v<from>-to-v<to>-<время>.db` и рядом кладёт `.sha256`.

## Сборки, которые делят данные (не изолированы)

**v1.1.2-mac-preview** и **v1.2.1-mac-preview** — одно и то же приложение с точки зрения macOS:

| | v1.1.2 | v1.2.1 | v1.2.2-test |
|---|---|---|---|
| channel | preview | preview | test |
| bundleId | `com.moonkatty.aistudio` | `com.moonkatty.aistudio` | `com.moonkatty.aistudio.test` |
| папка данных | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO` (та же) | `MOONKATTY AI STUDIO TEST` |
| launchd | `com.moonkatty.aistudio.server` | `com.moonkatty.aistudio.server` (тот же) | `com.moonkatty.aistudio.test.server` |
| Keychain service | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO` (тот же) | `MOONKATTY AI STUDIO.test` |
| порт | 8787 | 8787 | 8687 |
| dbSchemaVersion | 1 | 3 | 4 |
| isolated | false | false | true |

Если поставить v1.2.1 поверх v1.1.2, она откроет ту же БД и выполнит миграцию схемы 1 → 3 (без автоматического бэкапа, его в v1.2.1 нет). Тестовая сборка v1.2.2-test данных v1.1.2 не касается.

Пример: ассет `release-manifest.json` релиза `v1.2.2-test`.
