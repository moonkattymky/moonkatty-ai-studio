# Как подключать Studio Intelligence

Модуль: `studio-intelligence/`. Это библиотека, не второй сервер и не второй исполнитель. В `server.js` она намеренно не вшита: этот файл меняют ветки десктопа и безопасности.

Язык идентификаторов — английский. Тексты ошибок для человека — русские.

## Запуск рядом с панелью

```js
const { openStudioIntelligence } = require('./studio-intelligence');

// Тот же handle, что уже открыт в server.js (better-sqlite3 или lib/db.js).
const si = openStudioIntelligence({ db });

// Если своего соединения ещё нет — тот же путь, что DB_PATH панели.
// const si = openStudioIntelligence({ dbPath: process.env.DB_PATH || 'data/studio.db' });
```

Без `db` и без `dbPath` библиотека отказывается стартовать: файл по умолчанию она не выбирает, чтобы не появилась вторая база.

Если в дереве есть `lib/db.js` (ветка разработчика №1), файл открывается через него. Иначе используется `better-sqlite3`, а если модуль не установлен — встроенный `node:sqlite` (Node 22+).

Новые таблицы имеют префикс `si_`: записи и поиск, плюс `si_assets`, `si_asset_rights`, `si_asset_usage`, `si_approvals`, `si_approval_events`, `si_cost_entries`, `si_health_samples`, `si_qa_findings`. Полный список — в `studio-intelligence/contracts/storage-rules.json`. Таблицы `items` и `meta` не меняются.

## Участник и права

Вход делает существующий сервер. Сюда передаётся уже проверенная сессия:

```js
const session = getSession(req); // { user, exp } после проверки cookie / app-token
const owner = si.auth.principalFromSession(session);
const newsAgent = si.auth.principalFromSession(session, { agentId: 'news' });
```

Пароль и токен в этот вызов передавать нельзя: будет `SECRET_REJECTED`. Функция не проверяет пароль и не заводит пользователей.

Пространств три: `moonkatty_news`, `moonkatty_project`, `moonkatty_shared`. Первые два соответствуют проектам панели `news` и `main`. Общее пространство не ставится в очередь панели: задачи остаются в `news` или `main`.

Права по умолчанию (таблица `si_grants`):

| Агент | NEWS | PROJECT | SHARED |
|---|---|---|---|
| news, video | чтение и запись черновиков | нет | чтение |
| content | чтение | нет | чтение |
| games, pr | нет | чтение и запись черновиков | чтение |
| design3d | нет | чтение и запись черновиков | чтение и черновики |
| mkty, marketing, community | нет | чтение | чтение |
| social, publishing, analytics | чтение | чтение | чтение |
| director | чтение и черновики | чтение и черновики | чтение и черновики |

Владелец (`role: 'owner'`) читает все три пространства и только он ставит итог: публикация, мастер-модель, изменение рабочего проекта, расход, голос ведущего. Роль `editor` есть в схеме и выключена (`EDITORS_ENABLED = false`). Виды `decision`, `model_version`, `publication_version` агенту недоступны. Агент может рекомендовать утверждение и вернуть на доработку. `executed` при этом остаётся `false`.

Чужая запись для агента выглядит как `NOT_FOUND`, а не как чужое тело. Запрос чужого пространства по имени — `PERMISSION_DENIED`.

## Память

```js
const saved = si.memory.put({
  principal: owner,
  record: {
    namespace: 'moonkatty_project',
    kind: 'decision',
    title: 'Оригинал кота не подменяется',
    body: 'Новый кадр кота публикуется только после утверждения владельца.',
    status: 'approved',
    idempotencyKey: 'decision/brand/original-cat',
    sourcePath: null,
    payload: {}
  }
});
```

Повтор с тем же ключом и тем же телом возвращает ту же запись. Другое тело с тем же ключом — `IDEMPOTENCY_CONFLICT`, пока не передан `versionPolicy: 'bump'`. Тогда старая запись становится `superseded`, новая получает `version + 1` и `supersedes`.

Секреты (`access_token`, пароль, Bearer, токен Meta) в запись не кладутся.

Черновик агента не попадает в обычный список и в поиск, пока владелец не утвердит его отдельной записью (новым ключом или bump).

## Поиск

```js
const found = si.retrieval.search({
  principal: newsAgent,
  query: 'лунная база',
  namespace: 'moonkatty_news'
});
// found.answer — только выдержки из найденного
// found.citations[] — { recordId, filePath, version, namespace, title, snippet }
```

Пустой результат: `citations: []` и фраза «В разрешённой области ничего не найдено.» Модель здесь не вызывается, эмбеддингов нет.

Индекс внутренних документов (владелец):

```js
si.retrieval.indexDocs({ principal: owner, root: 'docs' });
```

Без явного `namespace` файл попадает в NEWS, если в относительном пути есть каталог или имя с `news`. Остальное — в PROJECT. Повторный индекс того же текста не плодит записи. Пропавший фрагмент помечается `superseded` и из поиска уходит.

## Задачи для Agent Runtime (разработчик №1)

Адаптер только собирает объект. `runner.tick`, `start` и OpenCode отсюда не вызываются.

```js
const task = si.runtime.handoff({ principal: owner, task: handoff });
put('tasks', task); // коллекция панели, как делает server.js
```

Соответствие полей:

| Контракт | Задача `runner.js` |
|---|---|
| `namespace: moonkatty_news` | `project: 'news'` |
| `namespace: moonkatty_project` | `project: 'main'` |
| `executor: 'runtime'` | `status: 'queued'`, без `kind` |
| `requiresOwnerApproval` или `executor: 'human'` | `status: 'waiting_approval'` |
| `executor: 'opencode'` | `kind: 'code'`, `codeApproved: false`, `status: 'blocked'` |
| непустой `dependsOn` | `status: 'blocked'`, причина начинается с «Зависимости не выполнены» |

Задачу OpenCode может поставить только владелец. Пока человек не вызовет уже существующий `POST /api/tasks/:id/approve-code`, исполнитель её не выполнит: при `codeApproved !== true` он сам ставит блок.

Зависимости — чистая функция, как `core.schedulerTick`. Хост применяет патчи до `runner.tick()`:

```js
for (const patch of si.runtime.reconcileDependencies(list('tasks'))) {
  const task = get('tasks', patch.id);
  Object.assign(task, patch.changes);
  put('tasks', task);
}
```

Функция снимает только блокировку с причиной про зависимости, когда все `dependsOn` в статусе `done`. Блокировку OpenCode и `waiting_approval` она не трогает.

Отмена тоже ничего не пишет:

```js
const plan = si.runtime.cancellationPlan(task, request);
if (plan.action === 'runtime.stop') {
  runner.stop(plan.agentId, request.requestedBy); // вернёт задачу в queued
  Object.assign(get('tasks', plan.taskId), plan.then); // затем cancelled
  put('tasks', get('tasks', plan.taskId));
}
if (plan.action === 'patch') put('tasks', Object.assign(task, plan.changes));
```

`runner.stop` сам по себе возвращает задачу в очередь. Довести её до `cancelled` должен хост, иначе исполнитель возьмёт её снова. `done` и `failed` отменить нельзя (`INVALID_STATE`).

Прогресс — только добавление, без обновления и удаления:

```js
si.progress.append({
  principal: newsAgent,
  event: {
    id: 'prog1', taskId: task.id, namespace: 'moonkatty_news',
    kind: 'started', message: 'Взята в работу', actorId: 'news'
  }
});
```

`actorId` обязан совпадать с участником.

Файл и текст результата становятся черновиками памяти, не утверждёнными публикациями:

```js
for (const record of si.runtime.fileResultToRecords(fileResult)) {
  si.memory.put({ principal, record });
}
```

## Медиа-ветка (разработчик №2)

`NewsEngine` и `VideoFactory` не импортируются. После человеческого `approve(storyId, by)` владелец может положить решение:

```js
si.memory.put({
  principal: owner,
  record: {
    namespace: 'moonkatty_news',
    kind: 'decision',
    title: story.headline,
    body: story.summary,
    status: 'approved',
    sourceRecordId: story.id,
    idempotencyKey: 'news/story/' + story.id,
    payload: { reviewStatus: story.reviewStatus }
  }
});
```

Готовый файл рендера передаётся как `file-result-handoff` (черновик). Публикация остаётся за очередью панели и за guardrails `public/social.js`. JSON-store медиа-модуля эта библиотека не читает и не подменяет. Поле `mediaLicense` у сюжета и проверка `license` у музыки остаются в медиа-ветке: каноническая карточка файла, его права и история использования живут в `si.assets` (ниже).

`Character3D` по-прежнему подключается в Video Factory. Схема 3D-сценария описывает шаги, но не рендерит. Мимика губ, глаз, головы и ушей в репозитории не считается: сюда пишется только разрешение использовать утверждённую модель.

## Безопасность (разработчик №3)

Новых пользователей, cookie и Keychain нет. CSRF, Host allowlist и редактирование журнала остаются в `lib/security.js`. Когда маршрут появится, он должен висеть за тем же `app.use('/api')`, что и остальная панель, и получать участника только из уже проверенной сессии.

Событие для шины, если она появится:

```js
si.contracts.envelope({
  type: 'studio.memory.written',
  principal: owner,
  namespace: 'moonkatty_project',
  payload: { recordId: saved.id }
});
```

Конверт не пишется в базу сам.

## Активы, права и использование

Карточка актива — один ряд на файл. Повтор с тем же SHA-256, тем же адресом источника (метки `utm_*` отбрасываются) или тем же ключом идемпотентности возвращает уже существующий ряд: `{ reused: true }`. Второй ряд не создаётся.

```js
const saved = si.assets.register({
  principal: newsAgent,
  asset: {
    namespace: 'moonkatty_news',
    kind: 'video',
    title: 'Кадр пуска',
    sourceName: 'NASA',
    sourceUrl: 'https://example.com/clip.mp4?utm_source=news',
    contentHash: sha256hex,
    idempotencyKey: 'news/clip/nasa-1',
    rights: {
      basis: 'licensed',          // own | licensed | generated | cc0 | unknown
      license: 'CC-BY-4.0',
      holder: 'NASA',
      attributionRequired: true,
      attributionText: 'NASA'
    }
  }
});

const again = si.assets.findReusable({
  principal: newsAgent,
  namespace: 'moonkatty_news',
  contentHash: sha256hex
});

si.assets.recordUsage({
  principal: newsAgent,
  usage: {
    assetId: saved.asset.id,
    namespace: 'moonkatty_news',
    whereUsed: 'shorts',          // publication | episode | render | shorts | reels | facial_animation | qa | music_bed | thumbnail
    publicationId: 'ep9',
    publicationVersion: 3,
    idempotencyKey: 'usage/ep9/shorts'
  }
});
```

Агент может оставить черновик и права при первой записи. Сменить права потом может только владелец (`addRights`). Статус `approved` агент поставить не может. Секрет в карточке даёт `SECRET_REJECTED`.

`whereUsed` отвечает на вопрос, где файл уже был: выпуск, нарезка, публикация. `usageOf` возвращает эту историю для читателя пространства.

## Бренд и мимика (разработчик №1)

Реестр бренда пишет владелец. Оригинал кота (`cat_image`) и мастер-модель (`master_model`) живут в `moonkatty_project`. Второй оригинал и смена уже записанного пути — `IDEMPOTENCY_CONFLICT`. Файл при этом не открывается и не подменяется.

```js
const model = si.brand.register({ principal: owner, asset: brandAsset });
si.assets.approvedCharacterModel({ principal: videoAgent });
```

Агент новостей не читает произвольные файлы проекта: `assets.get` на модель вернёт `NOT_FOUND`. Узкое исключение — `approvedCharacterModel`: её видит тот, кто читает новости или проект. Использование этой модели в выпуске пишется в `moonkatty_news`.

`prepareFacialUse` проверяет, что в запросе именно эта модель и что аудио — актив `moonkatty_news` вида `audio`, затем пишет `whereUsed: 'facial_animation'` с каналами `lip`, `eye`, `head`, `ear`, id выпуска и версией. `masterAssetVersion` обязателен: отсутствующий номер не заменяется заблокированной версией, неизвестный номер и неутверждённая версия запрос отклоняют. Возврат всегда `executed: false`. Кадры не считаются, Blender не вызывается. Запись делает агент с правом записи в новости (`video`). `design3d` модель видит, чужое аудио новостей — нет. `mouthScale` — от 0.5 до 2.0. Объект `voice` в файле cues сверяет `animationCues.assertVoice` с утверждённым профилем. Граница: `docs/studio-intelligence/contracts/INTERFACES-STUDIO-STUDIO2.md`.

`brand.check` по-прежнему `NOT_IMPLEMENTED`: сходство и подмена не исполняются.

## Утверждения

Журнал пишется. Решение ничего не запускает: в `si_approvals.auto_execute` стоит проверка `= 0`, `decide` возвращает `executed: false` и не создаёт строк в `items`.

```js
const pending = si.approval.request({ principal: director, request });
const decided = si.approval.decide({
  principal: owner, approvalId: pending.id, action: 'approved', comment: 'можно в эфир'
});
// decided.executed === false
```

Повтор того же решения идемпотентен. Агент запрос создать может, решить — нет. Регистрация бренда и утверждённого актива сразу дописывает событие `approved` от владельца и тоже ничего не публикует.

## Дневной отчёт (разработчик №3, чтение)

`core.buildReport` и `/api/mobile/summary` на ветке операций читают коллекции панели и сторож. Этот модуль их не заменяет. Сводка по памяти — отдельное чтение:

```js
const report = si.reports.daily({
  principal: analyticsAgent,
  from: '2026-10-20T00:00:00.000Z',
  to: '2026-10-21T00:00:00.000Z',
  compact: true
});
```

Считаются задачи, события прогресса, версии публикаций, использования `publication|shorts|reels|episode`, провалы прогресса и технической проверки, журнал утверждений. Стоимость и здоровье компонентов есть в отчёте, только если их записал владелец (`recordCost`, `recordHealth`). Пустое окно даёт нули и `available: false`, а не выдуманную сумму. `compact: true` — вид для телефона: не больше 8 строк внимания и без текста `detail`. Агент `games` видит только `moonkatty_project`.

## Техническая проверка перед выпуском (разработчик №4)

`video/qa.js` и проверка субтитров остаются в медиа-ветке и отсюда не вызываются. В память кладётся результат и чтение прав:

```js
const rights = si.qa.rightsForPublication({
  principal: videoAgent, namespace: 'moonkatty_news', publicationId: 'ep4'
});
// rights.blocking === true, если лицензии нет, основание unknown или срок вышел
// warning === 'no_assets_recorded', если к выпуску ничего не привязано; blocking при этом false

si.qa.recordFinding({
  principal: videoAgent,
  finding: {
    namespace: 'moonkatty_news', publicationId: 'ep4', publicationVersion: 1,
    checkName: 'corrupted_frames', // sound | subtitles | format | corrupted_frames | rights
    ok: false, detail: 'кадр 10 не читается'
  }
});
```

`recordFinding` возвращает `executed: false` и ролик не открывает.

## Сценарии, бренд, утверждение

Сценарий по-прежнему только описывается. `workflow.run` отвечает `NOT_IMPLEMENTED`.

```js
si.workflow.describe('news');
si.workflow.run();                 // NOT_IMPLEMENTED
si.brand.check(check);             // NOT_IMPLEMENTED
si.approval.decide({ principal: owner, approvalId, action: 'approved' }); // executed: false
```

Шаг, у которого `requiresOwnerApproval`, `executor: 'human'` или `executor: 'opencode'`, в описании сценария имеет `autoExecute: false`. Оригинал кота (`kind: 'cat_image'`) в схеме заблокирован: `locked: true`, `substitutionPolicy: 'owner_approval_required'`. Подмена (`action: 'substitute'`) помечается как требующая владельца и не выполняется.

Сценарии:

| id | Пространство | Шаги |
|---|---|---|
| `news` | `moonkatty_news` | search → factcheck → script → video → qa → approval → publish → analytics |
| `studio3d` | `moonkatty_project` | references → model → materials → animation → render → likeness → approval |
| `games` | `moonkatty_project` | test → bug_found → fix (OpenCode, только после владельца) → retest → approval |

## Схемы

Каталог `studio-intelligence/contracts/*.schema.json`. Проверка без новых зависимостей: `si.contracts.validate(name, value)`.

| Файл | О чём |
|---|---|
| `task-handoff` | передача задачи исполнителю |
| `file-result-handoff` | файлы и текст результата |
| `task-dependency` | зависимость `all_done` |
| `progress-event` | событие прогресса |
| `idempotency-record` | ключ идемпотентности |
| `error` | код ошибки |
| `cancellation` | просьба отменить |
| `permission-check`, `permission-decision` | проверка права |
| `memory-record-input`, `memory-record` | запись памяти |
| `retrieval-result` | ответ поиска с цитатами |
| `workflow-pipeline` | сценарий |
| `brand-asset`, `brand-check` | реестр бренда |
| `approval-request`, `approval-event` | утверждение и журнал |
| `event-envelope` | конверт события |
| `asset-record`, `asset-rights`, `asset-usage` | источник, права, где использован |
| `rights-lookup` | проверка прав перед выпуском |
| `facial-animation-request` | запрос мимики на утверждённую модель |
| `cost-entry`, `health-sample` | стоимость и состояние для отчёта |
| `qa-finding` | результат технической проверки |
| `studio-daily-report` | дневная сводка, в том числе короткий вид |

Коды ошибок: `VALIDATION`, `PERMISSION_DENIED`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, `NOT_IMPLEMENTED`, `SECRET_REJECTED`. Поле `retryable` у этих ошибок `false`. Объект `err.toJSON()` совпадает со схемой `error`.

## Тесты

Корневой `package.json` не менялся. Запуск:

```bash
node --disable-warning=ExperimentalWarning --test studio-intelligence/test/*.test.js
```

Предупреждение `ExperimentalWarning` относится к `node:sqlite`, если в окружении нет `better-sqlite3`. На машине с `npm ci` откроется `better-sqlite3`, предупреждения не будет.

## Журнал панели и таблицы si_

В `server.js` уже есть журнал коллекции `logs`: строка `{id, at, level, source, message, user}`, не больше 2000 записей, старые удаляются. Рядом на ветке безопасности текст ещё раз чистится от секретов. Этот модуль второй журнал не заводит.

Долгая история лежит в `si_approval_events`, `si_asset_events`, `si_source_history`, `si_editorial_decisions`, `si_content_versions`, `si_publication_notices`, `si_character_versions`. Короткая строка уходит в существующий журнал, если хост передал свою функцию:

```js
const si = openStudioIntelligence({ db, auditLog: log });
```

`log` — та же функция, что в `server.js`: `log(level, source, message, user)`. Потолок 2000 остаётся у хоста. В текст строки не кладутся хеши SHA-256: на ветке безопасности шаблон из 64 hex вычищается целиком. Секрет в комментарии отклоняется до записи (`SECRET_REJECTED`).

JSON-копия панели (`data/backups/backup-*.json`) собирает только коллекции `items` и в таблицы `si_*` не заглядывает. Долгая история переживёт обрезку журнала, только если копируется сам файл `data/studio.db`. Скрипт копии и отката — в отдельном черновике подключения, `server.js` здесь не меняется.

## Деньги

Источник правды — журнал Studio 3: `listEntries({ kind, direction, projectId, from, to })` в `lib/ops/ledger` и `GET /api/ops/ledger` (`feat/studio-operations` @ `e9a46bf`). Адаптер вызывает переданную функцию. Дата у них `YYYY-MM-DD` (включительно), сумма на проводе — строка, подтверждение — объект. `recordCost` не пишет в `si_cost_entries`. Факт, оценка и прогноз в отчёте лежат в разных полях. Неизвестный `projectId` становится `unassigned`, исходная строка не выбрасывается. Формат id: `docs/studio-intelligence/contracts/PROJECT-ATTRIBUTION.md`.

## Реестр мастер-модели

Основная студия владеет моделью, ригом, анимацией и файлом `.blend` (ветка `feat/v1.2.0`, `docs/ROADMAP_3D_CHARACTER.md`). Здесь хранятся только SHA-256, статус утверждения, права на референсы и ссылка `voiceProfileId`. Файл не создаётся и не копируется. Профиль голоса задаёт студия 2, для мимики его читает основная студия. Поля профиля для студии: `{id, approved, sampleRate, recognizer, gain, mouthScale, engine, voice, speed, pitchShift, modelSha256, voicesSha256}`. Импорт `MOONKATTY_NEWS_MASTER_VOICE` пишет только черновик. Утверждает владелец, `executed` остаётся `false`.
