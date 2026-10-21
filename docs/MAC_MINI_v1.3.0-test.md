# Запуск v1.3.0-test на Mac mini

Тестовая сборка того же приложения. Она ставится рядом с рабочей версией и рядом с v1.2.4-test. Аккаунты соцсетей не подключаются. Публикация в тестовой сборке выключена. Ключи только в Связке ключей macOS, сервис `MOONKATTY AI STUDIO.test`.

| | v1.2.4-test и v1.3.0-test |
|---|---|
| Приложение | `~/Applications/MOONKATTY AI STUDIO TEST.app` |
| Bundle ID | `com.moonkatty.aistudio.test` |
| Данные | `~/Library/Application Support/MOONKATTY AI STUDIO TEST/` |
| Журналы | `~/Library/Logs/MOONKATTY AI STUDIO TEST/` |
| Порт | `127.0.0.1:8687` |
| Узлы | `8690` |
| OpenCode | `127.0.0.1:4097` |
| Автозапуск и автообновление | выключены |

Не копируйте папку данных в `~/Library/Application Support/MOONKATTY AI STUDIO/` (это рабочая версия). Тестовая сборка откажется её открыть.

## Запуск из исходников (если zip ещё нет)

На Mac mini, Apple Silicon, Node 22:

```bash
git clone https://github.com/moonkattymky/moonkatty-ai-studio
cd moonkatty-ai-studio
git checkout feature/world-class-revenue
npm ci
NODE_ENV=test STUDIO_FLAVOR=test npm start
```

Откройте http://127.0.0.1:8687 . Первый вход создаёт администратора. Раздел Revenue Command Center — в боковом меню. Пока нет импорта выплат, суммы показывают «НЕТ ДАННЫХ».

Проверка:

```bash
curl -s http://127.0.0.1:8687/api/health
```

Ожидается `"flavor":"test"`, `"version":"1.3.0-test"`, `"schemaVersion":6`.

## Установка zip

Когда zip собран скриптом `FLAVOR=test scripts/package-mac-on-linux.sh` (на Linux) или `scripts/build-mac.sh` (на Mac):

```bash
cd ~/Downloads
shasum -a 256 -c "MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip.sha256"
ditto -x -k "MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip" "$HOME/Applications"
open "$HOME/Applications/MOONKATTY AI STUDIO TEST.app"
```

Релиз не публикуется. Файл передаётся вручную.

Перед первым запуском 1.3.0-test поверх данных 1.2.4-test сервер сам копирует базу в `backups/pre-migration-v4-to-v6-….db` и кладёт рядом `.sha256`. База схемы 1 получает имя `pre-migration-v1-to-v6-….db`.

## Откат на v1.2.4-test

1. Закройте тестовое приложение и остановите службу, если она есть:

```bash
launchctl bootout "gui/$(id -u)/com.moonkatty.aistudio.test.server" 2>/dev/null || true
```

2. Верните приложение из zip **v1.2.4-test** (тег `v1.2.4-test`, коммит `322023fd6f8e98dbddd38341e07227ded149c1fb`) в `~/Applications`, как в `docs/MAC_TEST_ISOLATED.md`. Тег и релиз v1.2.4-test не перезаписываются.
3. База остаётся в тестовой папке. v1.2.4-test не читает таблицы `world_*` и при старте снова записывает `schemaVersion` = 4. Данные задач, очереди и 3D не стираются.
4. Если нужен файл базы ровно до миграции, возьмите `backups/pre-migration-v4-to-v6-*.db` (проверьте `.sha256`) и подмените `studio.db` только при остановленном сервере.
5. Рабочую v1.1.2 и её Keychain не трогайте.

Полное удаление таблиц 1.3.0, если когда-нибудь понадобится вручную (сервер остановлен):

```sql
DROP TABLE IF EXISTS world_approvals;
DROP TABLE IF EXISTS world_ledger;
DROP TABLE IF EXISTS world_journal;
DROP TABLE IF EXISTS world_mem;
DELETE FROM meta WHERE k IN ('worldMission','worldCeo','worldGrowth','worldSavings','worldSavingsPending','worldProposals','worldExperiments','worldAudienceReal');
```
