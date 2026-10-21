# Отчёт перед слиянием PR #1

Слияние не выполнялось. `main` не менялся. `server.js`, `server/jobs*` и `server/blender*` не менялись. Чужие ветки не редактировались.

Снимок `git diff --stat origin/main...HEAD` снят на коммите голоса `0d66218` (105 файлов, +7941). Этот отчёт добавляется следующим коммитом и в таблицу ниже не входит.

## 1. Ветка и PR

- PR: https://github.com/moonkattymky/moonkatty-ai-studio/pull/1
- Ветка: `feat/studio-intelligence`
- База PR: `main`
- Черновик. В `main` не влит.

## 2. Файлы относительно main

Команда: `git diff --stat origin/main...HEAD` на `0d66218`.

```
 docs/studio-intelligence/AUDIT.md                  | 181 +++++++
 docs/studio-intelligence/CHARACTER-LAYOUT.md       |  35 ++
 docs/studio-intelligence/FINAL_AUDIT.md            | 120 +++++
 docs/studio-intelligence/INTEGRATION-PLAN.md       |  27 +
 docs/studio-intelligence/INTEGRATION.md            | 407 +++++++++++++++
 docs/studio-intelligence/LOAD.md                   |  38 ++
 docs/studio-intelligence/MIGRATIONS.md             |  16 +
 docs/studio-intelligence/RISKS.md                  |  35 ++
 docs/studio-intelligence/ROADMAP.md                |  73 +++
 docs/studio-intelligence/STUDIO-2.md               |  16 +
 docs/studio-intelligence/STUDIO-3.md               |   9 +
 docs/studio-intelligence/STUDIO-4.md               |  21 +
 docs/studio-intelligence/STUDIO.md                 |  16 +
 .../contracts/CHARACTER-REGISTRY.md                |  29 ++
 .../contracts/PROJECT-ATTRIBUTION.md               |  72 +++
 .../studio-intelligence/contracts/VOICE-PROFILE.md |  26 +
 studio-intelligence/README.md                      |  23 +
 .../contracts/approval-event.schema.json           |  20 +
 studio-intelligence/contracts/approval-policy.json |  10 +
 .../contracts/approval-request.schema.json         |  20 +
 .../contracts/asset-record.schema.json             |  19 +
 .../contracts/asset-rights.schema.json             |  18 +
 .../contracts/asset-usage.schema.json              |  18 +
 .../contracts/brand-asset.schema.json              |  20 +
 .../contracts/brand-check.schema.json              |  21 +
 .../contracts/cancellation.schema.json             |  15 +
 .../contracts/character-version.schema.json        |  33 ++
 .../contracts/content-version.schema.json          |  18 +
 .../contracts/cost-entry.schema.json               |  19 +
 .../contracts/editorial-decision.schema.json       |  16 +
 studio-intelligence/contracts/error.schema.json    |  16 +
 .../contracts/event-envelope.schema.json           |  33 ++
 .../contracts/facial-animation-request.schema.json |  25 +
 .../contracts/file-result-handoff.schema.json      |  38 ++
 .../contracts/health-sample.schema.json            |  14 +
 .../contracts/idempotency-record.schema.json       |  15 +
 .../contracts/memory-record-input.schema.json      |  20 +
 .../contracts/memory-record.schema.json            |  27 +
 .../contracts/panel-log-entry.schema.json          |  17 +
 .../contracts/permission-check.schema.json         |  33 ++
 .../contracts/permission-decision.schema.json      |  12 +
 .../contracts/progress-event.schema.json           |  18 +
 .../contracts/project-resolution.schema.json       |  17 +
 .../contracts/publication-notice.schema.json       |  17 +
 .../contracts/qa-finding.schema.json               |  17 +
 .../contracts/retrieval-result.schema.json         |  33 ++
 .../contracts/rights-lookup.schema.json            |  32 ++
 .../contracts/source-history-entry.schema.json     |  16 +
 studio-intelligence/contracts/storage-rules.json   |  27 +
 .../contracts/studio-daily-report.schema.json      | 171 ++++++
 .../contracts/studio3-ledger-entry.schema.json     |  22 +
 .../contracts/task-dependency.schema.json          |  19 +
 .../contracts/task-handoff.schema.json             |  40 ++
 .../contracts/voice-profile-for-studio.schema.json |  23 +
 .../contracts/voice-profile.schema.json            |  27 +
 .../contracts/workflow-pipeline.schema.json        |  29 ++
 studio-intelligence/scripts/bench.js               |  56 ++
 studio-intelligence/scripts/character-layout.js    |  47 ++
 studio-intelligence/src/approval.js                | 218 ++++++++
 studio-intelligence/src/assets.js                  | 576 +++++++++++++++++++++
 studio-intelligence/src/audit-feed.js              |  55 ++
 studio-intelligence/src/auth.js                    |  48 ++
 studio-intelligence/src/brand.js                   |  58 +++
 studio-intelligence/src/character-layout.js        |  80 +++
 studio-intelligence/src/character-registry.js      | 129 +++++
 studio-intelligence/src/constants.js               | 121 +++++
 studio-intelligence/src/editorial.js               |  95 ++++
 studio-intelligence/src/errors.js                  |  23 +
 studio-intelligence/src/index.js                   | 109 ++++
 studio-intelligence/src/ledger-adapter.js          | 135 +++++
 studio-intelligence/src/ledger-stub.js             |  34 ++
 studio-intelligence/src/master-voice.js            |  40 ++
 studio-intelligence/src/memory.js                  | 165 ++++++
 studio-intelligence/src/migrate-v3.js              | 149 ++++++
 studio-intelligence/src/notices.js                 |  68 +++
 studio-intelligence/src/permissions.js             | 102 ++++
 studio-intelligence/src/progress.js                |  67 +++
 studio-intelligence/src/projects.js                |  70 +++
 studio-intelligence/src/qa-memory.js               |  40 ++
 studio-intelligence/src/reports.js                 | 142 +++++
 studio-intelligence/src/retrieval.js               | 216 ++++++++
 studio-intelligence/src/runtime-adapter.js         | 173 +++++++
 studio-intelligence/src/secrets.js                 |  15 +
 studio-intelligence/src/sqlite.js                  | 407 +++++++++++++++
 studio-intelligence/src/validate.js                |  86 +++
 studio-intelligence/src/versions.js                |  79 +++
 studio-intelligence/src/voices.js                  | 146 ++++++
 studio-intelligence/src/workflow.js                |  87 ++++
 studio-intelligence/test/contracts-only.test.js    | 119 +++++
 studio-intelligence/test/contracts.test.js         |  51 ++
 .../test/daily-report-contract.test.js             | 136 +++++
 studio-intelligence/test/facial-contract.test.js   | 165 ++++++
 studio-intelligence/test/helpers.js                |  27 +
 studio-intelligence/test/ledger-contract.test.js   | 100 ++++
 .../test/media-reuse-contract.test.js              | 114 ++++
 studio-intelligence/test/memory-scope.test.js      | 229 ++++++++
 studio-intelligence/test/memory.test.js            | 159 ++++++
 studio-intelligence/test/migrate-v3.test.js        | 111 ++++
 .../test/qa-rights-contract.test.js                | 122 +++++
 studio-intelligence/test/real-ledger.test.js       |  96 ++++
 studio-intelligence/test/retrieval.test.js         |  77 +++
 studio-intelligence/test/runtime-adapter.test.js   | 125 +++++
 studio-intelligence/test/same-database.test.js     |  38 ++
 studio-intelligence/test/upstream-db.test.js       | 124 +++++
 studio-intelligence/test/voice-profile.test.js     | 163 ++++++
 105 files changed, 7941 insertions(+)
```

Все строки — добавления. Удалений относительно `main` нет. `server.js` в списке нет.

## 3. Тесты

Команда из корня, Node v22.23.3, Linux, `node:sqlite`:

```bash
node --disable-warning=ExperimentalWarning --test studio-intelligence/test/*.test.js
```

Результат этого прогона:

```
# tests 43
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 473.112013
```

Новые тесты голоса прошли: миграция старой таблицы, круг записи и чтения, отказ в плохом хеше, импорт черновика `MOONKATTY_NEWS_MASTER_VOICE` и отдельное утверждение владельцем (`executed: false`).

## 4. Совместимость с форматом студии 2

Файл только читался: `docs/media-automation/exports/master-voice.studio5.json` @ `551f361` на `feat/media-automation`. Ветка не менялась.

Импорт пишет черновик. `status: locked` и блок `approval` (в том числе `approvedBy: Igor`) в базу не переносятся. Утверждение — только `voices.approve` с принципалом владельца. Код сам профиль не утверждает.

| Поле у нас | Значение, которое кладётся | Поле в экспорте | Совпадает |
|---|---|---|---|
| `voiceProfileId` | `MOONKATTY_NEWS_MASTER_VOICE` | `id` | да. Поле `voiceProfileId` в файле `null`, оно не используется |
| `engine` | `kokoro` | `engine.name` = `kokoro-82m`, `engine.runtime` = `kokoro-onnx` | короткое имя по договорённости. Отдельных колонок под имя модели и runtime нет |
| `voice` | `am_fenrir` | `voice.blend.am_fenrir` = 1 | да, берётся ключ смеси со значением 1 |
| `speed` | 1 | `voice.speed` = 1 | да |
| `pitchShift` | 0 | `voice.pitchSemitones` = 0 | да, другое имя |
| `sampleRate` | 48000 | `voice.sampleRateHz` = 24000; доставка «wav 48kHz» | нет. В базу кладётся 48000, частота доставки, не 24000 из `sampleRateHz` |
| `recognizer` | `tts-timing` | поля нет | добавлено у нас. Рядом по-прежнему допустимы `phonetic` и `pocketSphinx` |
| `gain` | 1 | числа нет; слово `gain` есть в `emotionControls` | значение по умолчанию 1 |
| `mouthScale` | 1 | поля нет | значение по умолчанию 1 |
| `modelSha256` | `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5` | `engine.model.sha256` | да, байт в байт |
| `voicesSha256` | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` | `engine.voicesPack.sha256` | да, байт в байт |
| `label` | `MOONKATTY NEWS anchor` | `displayName` | да |
| `status` | `draft` | `locked` | намеренно нет |

Хеш, если задан, должен быть 64 hex-символа. Иначе запись не создаётся.

## 5. Конфликты с тестовыми ветками

Точных имён `v1.2.4-test` и `v1.3.0-test` (и `feat/v1.2.4-test`, `feat/v1.3.0-test`) на origin нет. Поиск: `git ls-remote --heads origin`.

Ближайшие:

- `feat/v1.2.4-test-nodes` @ `322023f` — проверен локальным `git merge-tree --write-tree` против `0d66218`. Код выхода 0, конфликтов нет. Общая база `e87bd32` (`main`). Общих путей нет: эта ветка добавляет `studio-intelligence/` и `docs/studio-intelligence/`, у `feat/v1.2.4-test-nodes` таких путей нет.
- `feat/v1.2.3.1-test-fix` — есть, пробное слияние не делалось.
- `feat/v1.2.2-test-isolated` — есть. Её не открывали и не сливали: это отдельная тестовая сборка Studio.
- Веток с `v1.3` или `1.3.0` нет.

Пробное слияние ref не двигало и на origin не отправлялось.

## 6. Миграции и откат

Номер схемы остаётся 4. Повторный `migrate` безопасен: `CREATE TABLE IF NOT EXISTS`, колонки через `PRAGMA table_info` и `ALTER TABLE` только если их ещё нет, гранты и `si_projects` — `INSERT OR IGNORE`.

Таблицы `si_*`: `si_meta`, `si_records`, виртуальная `si_records_fts`, `si_idempotency`, `si_grants`, `si_progress`, `si_assets`, `si_asset_rights`, `si_asset_usage`, `si_approvals`, `si_approval_events`, `si_cost_entries`, `si_health_samples`, `si_qa_findings`, `si_asset_events`, `si_asset_tasks`, `si_asset_files`, `si_voice_profiles`, `si_source_history`, `si_editorial_decisions`, `si_content_versions`, `si_publication_notices`, `si_projects`, `si_character_versions`.

`ALTER` на уже существующем файле:

- `si_voice_profiles`: `sample_rate`, `recognizer`, `gain`, `mouth_scale`, `engine`, `voice`, `speed`, `pitch_shift`, `model_sha256`, `voices_sha256`. Все допускают NULL.
- `si_cost_entries`: `direction` (по умолчанию `expense`), `project_id`.

Переход 2 → 3 пересобирает `si_records`, `si_assets`, `si_approvals`, `si_approval_events`, если в `CHECK` нет новых значений. Это копирование строк, не `ALTER` ограничения. `items` и `meta` не меняются.

Обратного SQL нет. Откат — замена файла `data/studio.db`. Скрипты `studio-intelligence/scripts/backup-db.js` и `rollback-db.js` лежат в PR #3, не в этом PR. Без `--apply` они ничего не пишут. С `--apply` откат удаляет соседние `-wal` и `-shm`, затем копирует файл. JSON-копии `backup-*.json` таблицы `si_*` не содержат и память не откатывают. Копия — `copyFileSync` закрытого файла, не онлайн-backup. На открытой базе работающего сервера WAL может быть несогласован. На Mac это не проверялось.

На этой ветке после того абзаца добавлены `persistence.snapshot` (`VACUUM INTO` открытой базы) и JSON `persistence.exportSi` / `importSi`. `server.js` не менялся. Текст, который панель может вставить сама: `docs/studio-intelligence/patches/server-dump-include-si.md`. Проверка на временной базе — пункт 7.

## 7. Чеклист владельца

Слияние не выполнялось. `server.js`, `server/jobs*`, `server/blender*`, `main` и чужие ветки не менялись. `feat/v1.2.2-test-isolated` не открывалась.

Прогон после этих правок, Node v22.23.3:

```bash
node --disable-warning=ExperimentalWarning --test studio-intelligence/test/*.test.js
```

```
# tests 50
# suites 0
# pass 50
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 505.65437
```

| # | Проверка | Статус | Что выяснилось |
|---|---|---|---|
| 1 | Ветка `feature/world-class-revenue` на origin | PASS | Ветки нет. `git ls-remote --heads` не нашёл имён с `revenue`, `world`, `feature/` и `integ/` |
| 2 | `integ/v1.3.0-test` | BLOCKED | Ветки ещё нет. База, которую назвала Studio, — `322023f`. `scripts/check-compat.sh` без аргумента печатает `BLOCKED` и выходит с кодом 2. Ветку скрипт не создаёт |
| 3 | Резервная копия и восстановление на временной базе | PASS | JSON в форме `dump()` панели сохраняет строку `workspaces` и не содержит профиль голоса. `VACUUM INTO` и копия закрытого файла сохраняют счётчики `si_*` и строку `MOONKATTY_NEWS_MASTER_VOICE` |
| 4 | Выживают ли `si_*` и профили голоса | PASS | Через JSON панели — нет. Через `persistence.snapshot` и через копию закрытого файла — да, включая черновик голоса. `importSi` возвращает ту же строку голоса в новую базу и `items` не пишет |
| 5 | Добавка к бэкапу без правки `main` | PASS | Модули `si-export.js` и `db-snapshot.js`. Версия пакета не менялась. Правка `server.js` лежит файлом-предложением и не применена |
| 6 | Импорт голоса, чужое утверждение, замок и снятие | PASS | Импорт остаётся черновиком. Не-владелец получает `PERMISSION_DENIED`. Владелец утверждает, `executed: false`. Второй черновик переводит первый в `superseded`. Снятую строку утвердить снова нельзя. `locked` из экспорта студии 2 в статусы базы не пишется |
| 7 | `INTERFACES-STUDIO-STUDIO2.md` | PASS | Основная студия и студия 2 отмечены как согласовавшие поправки. Схема cues не скопирована. Валидатор сверяет только объект `voice` с утверждённым профилем |

Пункт 2 остаётся BLOCKED, пока Studio не создаст `integ/v1.3.0-test`. Слияние из-за этого не предлагается.
