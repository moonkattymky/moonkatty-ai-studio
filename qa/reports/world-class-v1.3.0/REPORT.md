# v1.3.0-test — WORLD CLASS MODE

Прогон 2026-10-21 на Linux x64, Node 22, `STUDIO_SQLITE=node`. База ветки: `322023f` (тег `v1.2.4-test` не двигался). Ветка: `feature/world-class-revenue`. Релиз не публиковался, тег не ставился, `main` не менялся.

Память в этом прогоне: **fallback** (`world_mem`). Модуля `studio-intelligence` на диске нет, путь `studio-intelligence` не вызывался.

Чтение площадок: **fixture-demo**. Фикстура взята на время теста командой `git show f74f07e:media-automation/fixtures/platforms-snapshot.sample.json` и не записана в репозиторий. Живой `media-automation/src/platforms/read-api.js` отсутствует, путь `studio2-read-api` не вызывался.

`public/i18n.js`, `public/i18n-dict.js`: **0 hunks**. Файла `monetization-adapters.js` нет ни на этой базе, ни в коммите: **0 hunks**.

## Сводка 15 пунктов

| # | Проверка | Статус |
| --- | --- | --- |
| 1 | Запуск macOS Apple Silicon | BLOCKED. Прогон на linux/x64. `rcodesign` нет, zip не собран |
| 2 | Dashboard | PASS. API и браузер: Revenue Command Center и Million Audience |
| 3 | Ollama | MOCK. `ECONNREFUSED` на 127.0.0.1:11434, модель не выдумывалась |
| 4 | Агенты | PASS. CEO, creative, revenue, growth добавлены, прежний набор на месте |
| 5 | Загрузка миссии | PASS. SHA-256 `1bfb455135837c1a24d30173d037e361cf065c7d7fdc952fdd1cb341db34d409` |
| 6 | CEO | PASS. План дня, идемпотентность за сутки, задачи переживают рестарт |
| 7 | QC | PASS. Клиентские 100 баллов игнорируются; новость без фактчека блокируется; пустые доказательства = 0; лимит 3 |
| 8 | Revenue Director | PASS. См. целостность выручки |
| 9 | Задачи сохраняются | PASS |
| 10 | Рестарт | PASS. Миссия, задачи и выплата PAY-80 на месте |
| 11 | Допуски | PASS. auto выполняется; owner не вызывает внешнее действие; botting, bought_followers, platform_evasion, fake_followers запрещены |
| 12 | Ошибки | PASS. Плохой CSV и неизвестное действие отклоняются; HTTP не ставит published |
| 13 | Секреты в конфиге | PASS. В config и lib/world нет ключей |
| 14 | Регрессия v1.2.4 | PASS по запущенным наборам. 3D/E2E/OpenCode JSON — NOT TESTED (нет бинарей). Zip — BLOCKED |
| 15 | Инструкция установки | PASS по тексту `docs/MAC_MINI_v1.3.0-test.md`. Сам .app NOT TESTED |

## Revenue integrity

| Правило | Статус | Что проверено |
| --- | --- | --- |
| 1. Три состояния не смешиваются | PASS | Месяц `$80.50` только кэш. Оценка `$50.00` «не подтверждено». Начислено `$10.00` «начислено, не кэш» |
| 2. Просмотры и охват не выручка | PASS | `kind: views` и reach → 403 `fake_financials` |
| 3. Нет двойного счёта | PASS | Повтор того же `(platform, payout_id)` → imported 0, duplicates 1. Другие поля → 409 |
| 4. Обязательные поля | PASS | PAY-80: payout_id, platform, amount_cents 8050, currency USD, date, confirmation_source `owner:statement`, state confirmed |
| 5. Начисление отдельно от кэша | PASS | accrued не входит в месяц |
| 6. DEMO отдельно | PASS | DEMO $5.00 исключён из факта при смешанном импорте |
| 7. Нет подключения → «НЕТ ДАННЫХ» | PASS | Instagram и moonkatty.com confirmed «НЕТ ДАННЫХ». fb-news в каналах студии «НЕТ ДАННЫХ» |
| 8. Рестарт и backup/restore | PASS | JSON-копия содержит worldLedger. После восстановления месяц `$80.50`, начислено `$10.00` |

Фикстура read-api не входит в факт: youtube-news confirmed подписан `DEMO`. Facebook — оценка «не подтверждено», без payout id. `viewsAreRevenue` ложь.

## Million Audience

| Проверка | Статус |
| --- | --- |
| Цель 1 000 000 и `merge_youtube: false` в mission.yaml | PASS |
| Семь каналов, два YouTube не складываются | PASS. `youtubeMerged: false`. NEWS `DEMO 100`, MOONKATTY `DEMO 137` |
| Снимок цели в памяти | PASS. `memory.path` fallback, goal 1000000 |
| Реальный прогресс по фикстуре | PASS как «НЕТ ДАННЫХ»: dataMode mock, процент не считается |
| Вехи 1K, 10K, 100K, 500K, 1M | PASS в коде. На mock это «DEMO пройдено/не пройдено», не факт |
| Рост день/неделя/месяц | PASS на синтетических реальных точках (+10/+20/+30). Точка DEMO 999999 игнорируется. Один снимок фикстуры даёт «НЕТ ДАННЫХ» |
| Удержание, CTR, форматы | PASS как «НЕТ ДАННЫХ». В read-api этих полей нет. Это не ноль |
| Охват и вовлечение | Считаются только из присутствующих полей и помечаются DEMO, если источник mock |
| Органические рекомендации | PASS. Текст запрещает покупку подписчиков, ботов, спам и обход правил |
| Эксперимент | PASS. hypothesis, metric, durationDays. Оценка «НЕТ ДАННЫХ», пока нет dataMode real. `followers_bought` → 403 |
| Связь с выручкой | PASS. Только confirmed payout того же id. У youtube-news в тесте нет owner payout → «НЕТ ДАННЫХ» |
| Директора | PASS. ceo, marketing, creative, revenue читают аудиторию, `publishes: false` |
| Неподключённый источник | PASS. `report({ api: null })` → подписчики «НЕТ ДАННЫХ» на обоих YouTube |
| Секция панели | PASS в браузере на 127.0.0.1:8687. Карточка показывает DEMO и фразу «не складываются». Мобильная ширина NOT TESTED |

Запреты в `lib/world/permissions.js`: spam, fake_followers, fake_views, platform_evasion, key_disclosure, unauthorized_access, fake_financials, dangerous_production, botting, bought_followers. Тест вызывает botting, bought_followers, platform_evasion, fake_followers.

## Регрессия

| Набор | Статус |
| --- | --- |
| test:world | PASS, fail 0 |
| test:isolation | PASS 65/65 |
| test:publish-guard | PASS 59/59. Проверка собранного .app пропущена: dist нет |
| test:policy | PASS 46/46 |
| test:security | PASS 52/52 |
| test:runner | PASS. OpenCode по умолчанию выключен |
| test:video | PASS 45/45. Исполнитель по-прежнему «Не подключено» |
| test:opencode | PASS 51/51 |
| test:nodes | PASS 52/52 |
| test:ops | PASS 40/40 |
| test:3d, test:3c, test:e2e-test-build | NOT TESTED. exit 2, нет `/workspace/tools/oc/node_modules/.bin/opencode` |
| test:opencode-json | NOT TESTED. exit 2, нет Blender |
| test:ops:studio | NOT TESTED |
| Сборка zip | BLOCKED. В скрипте нет `rcodesign`. SHA-256 нет |

## Что настоящее, что заглушка

Настоящее в этом дереве: миссия и её проверка, CEO-план в очереди задач, QC по доказательствам, журнал допусков, ledger с тремя состояниями, импорт CSV/JSON, Command Center, снимок памяти fallback, чтение фикстуры read-api с меткой DEMO.

Заглушки и отсутствие данных, подписанные честно:

- Живых подписчиков нет, пока на диске нет Studio 2 read-api и владелец не даст реальные analytics.
- Удержание, CTR и лучшие форматы — «НЕТ ДАННЫХ».
- Выручка месяца без owner payout — «НЕТ ДАННЫХ». Прогноз не выдаётся за факт.
- Подтверждение владельца не публикует, не платит и не шлёт почту (`executed: false`).
- `video_render` по-прежнему без исполнителя.
- Игровой API только через импорт. Код игры не менялся.
- Голос, видеофабрика и соцпубликатор Studio 2 не копировались и не подключались.
- Путь памяти Studio 5 не проверялся.

## Исправленные ошибки этого прогона

- Тест изоляции писал «schemaVersion 6», а сравнивал с 5. Сравнение исправлено на 6. Имя копии: `pre-migration-v1-to-v6`.
- Фикстура `fake-security.mjs` не стартовала: `keystore` и `opencode-auth` дают дочернему процессу PATH `/usr/bin:/bin`, а shebang ищет `node`. Для фикстуры (не для `/usr/bin/security`) в PATH добавлен каталог текущего Node. После этого isolation и publish-guard проходят. На macOS путь production не расширяется.

Не закрыто: zip и запуск .app. Мобильная вёрстка карточки не снята отдельным прогоном.
