# Повторная проверка безопасности v1.2.3-test

Ответ на отчёт Studio 4 `qa/reports/security-recheck-v1.2.2-final/REPORT.md` (ветка `feat/quality-automation`, коммит `bfa720a`; проверялся `7327a1e`). Изоляция та же, что у 1.2.2-test: `com.moonkatty.aistudio.test`, Keychain `MOONKATTY AI STUDIO.test`, папка данных `MOONKATTY AI STUDIO TEST`, порты 8687/4097, launchd `com.moonkatty.aistudio.test.server`. Предыдущий отчёт: `docs/SECURITY_RECHECK_v1.2.2-test.md`.

## Что исправлено (по замечаниям Studio 4)
| № в отчёте | Замечание | Исправление | Проверка |
|---|---|---|---|
| 3 (Low) | HMAC-ключ `meta.publishSealKey` хранится в той же `studio.db` | Ключ хранится только в Keychain: сервис текущей сборки, учётная запись `publish-seal-key`, запись через stdin `security -i` (`-X` hex), в argv его нет. При запуске копия из БД переносится в Keychain и удаляется (`secure_delete`, `VACUUM`). Без Keychain ключа нет: строки с печатью не принимаются, а `sealPublication` отказывает. Ключ создаётся только при первой настоящей публикации | publish-guard B: ключ в поддельном Keychain, отсутствует в argv и в байтах `studio.db`/WAL; без Keychain ключ всё равно удалён из БД, и даже строка с действительной печатью понижается |
| 2 (Medium) | Строки `published` без `publication` («наследованные») пропускаются, правка заголовка сохраняет `published` | Исключение `legacyPublished` удалено. При каждом запуске строки со статусом `published`, `externalId`, `publishedAt` или `publication` без действительной печати переводятся в `historical_*` и `pending_approval` (событие `unsealed_published_demoted`). `put()` отклоняет любую такую строку без действительной печати: правка через HTTP получает 403 | publish-guard B/B2: БД формата v1 со строкой `old-pub` после миграции и правки заголовка остаётся `pending_approval`; прямая запись в БД при работающем сервере: правка получает 403, после перезапуска строка понижена; печать чужим ключом и подменённый `externalId` понижаются |
| 4 (Low) | Распакованный `lib/flavor.baked.js` можно переписать | Нужны три согласованных маркера: `flavor.baked.js`, `flavor.lock.json` (SHA-256 файла `flavor.baked.js`) и `studioFlavor` + `studioFlavorSha256` в `package.json`. Если один отсутствует или не совпадает, сервер завершается с кодом 78. Значения по умолчанию нет, `NODE_ENV` не влияет, переменные окружения в пакете не учитываются. Electron-оболочка (`desktop/flavor-guard.js`) сверяет распакованные маркеры с `desktop/flavor.lock.json` внутри `app.asar`, который защищён ASAR integrity, и при расхождении завершается с кодом 78 | publish-guard C (9 вариантов подделки исходников) и E (подделка собранного бандла) |
| 5 (Info) | `meta.js` входит в тестовый zip | В TEST-сборке `meta.js` нет: исключён из `files`, упаковщик проверяет его отсутствие. Сам `meta.js` отказывается загружаться, если сборка не prod. Prod-сервер без `meta.js` завершается с кодом 78. Если согласованно переписать все маркеры в пакете на prod, сервер всё равно завершится с кодом 78, потому что модуля публикации нет, а Electron-проверка откажет по замку в asar | publish-guard D/E |
| 3 в «Remaining» (Low) | `POST /api/comments` сохраняет `status:"approved"` | Не меняли: в TEST `/reply` отвечает 403. Вынесено в задачи v1.2.4 | — |

Остаточный риск: тот, кто может писать в `.app` и одновременно подделать `app.asar` (тогда ASAR integrity не сойдётся и Electron не запустится) или запустить распакованный `server.js` напрямую с подброшенным `meta.js` и всеми маркерами prod, обходит любую локальную проверку. Защиту от этого даёт только подпись Developer ID и нотаризация, которых у тестовой сборки нет.

## Один прогон всех наборов (точные числа)
Код: коммит `79b7d585eba103d3cb76b51422c129261ec934f3` (в коммите с этим документом код не менялся). Linux x64, Node v22.23.3, Blender 5.2.2 (`/workspace/tools/blender-5.2.2-linux-x64/blender`), opencode-ai (`/workspace/tools/oc`). `dist/` с TEST-сборкой этого коммита присутствовал, поэтому проверки бандла в `test:publish-guard` выполнялись. Начало прогона: 2026-10-21 13:10:59 (UTC+3).

Команды (по одной, последовательно, в корне репозитория):
```
npm run test:security
npm run test:runner
npm run test:opencode
npm run test:policy
npm run test:video
npm run test:publish-guard
npm run test:isolation
npm run test:3d
npm run test:3c
npm run test:e2e-test-build
```
| Набор | PASS | FAIL | SKIP | Код выхода |
|---|---|---|---|---|
| test:security | 52 | 0 | 0 | 0 |
| test:runner | 5 | 0 | 0 | 0 |
| test:opencode | 51 | 0 | 0 | 0 |
| test:policy | 46 | 0 | 0 | 0 |
| test:video | 45 | 0 | 0 | 0 |
| test:publish-guard | 73 | 0 | 0 | 0 |
| test:isolation | 65 | 0 | 0 | 0 |
| test:3d | 53 | 0 | 0 | 0 |
| test:3c | 61 | 0 | 0 | 0 |
| test:e2e-test-build | 11 | 0 | 0 | 0 |
| **Итого** | **462** | **0** | **0** | |

Число PASS посчитано как количество строк `^PASS` в выводе каждого набора.

## Почему у Studio 4 было 304
Studio 4 запускали 7 наборов: policy 46 + video 45 + runner 5 + security 52 + opencode 51 + publish-guard 41 (с бандлом) + isolation 64 = **304**. Наборы `test:3d` (53), `test:3c` (61) и `test:e2e-test-build` (11), всего 125 проверок, у них завершились с кодом 2 (SKIP), потому что на их машине нет `opencode` и Blender. 304 + 125 = 429, это наш итог для 7327a1e.

Разница с текущими 462 (+33): `test:publish-guard` 41 → 73 (+32: Keychain-ключ, миграция v1, прямые записи в БД, подделка маркеров и бандла) и `test:isolation` 64 → 65 (+1: «NODE_ENV не влияет»). Если повторить у Studio 4 без OpenCode и Blender, ожидается 304 − 41 − 64 + 73 + 65 = **337**.

## Не проверено
- macOS: настоящий Keychain (здесь использовалась поддельная утилита `security`), launchd, Gatekeeper, `sandbox-exec`, проверка flavor-guard при настоящем запуске Electron. Модуль проверялся из извлечённого `app.asar`.
- Настоящая публикация с печатью (нужны настоящие токены). В TEST она невозможна.
