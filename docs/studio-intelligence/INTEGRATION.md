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

Новые таблицы: `si_meta`, `si_records`, `si_records_fts`, `si_idempotency`, `si_grants`, `si_progress`. Правила лежат в `studio-intelligence/contracts/storage-rules.json`.

## Участник и права

Вход делает существующий сервер. Сюда передаётся уже проверенная сессия:

```js
const session = getSession(req); // { user, exp } после проверки cookie / app-token
const owner = si.auth.principalFromSession(session);
const newsAgent = si.auth.principalFromSession(session, { agentId: 'news' });
```

Пароль и токен в этот вызов передавать нельзя: будет `SECRET_REJECTED`. Функция не проверяет пароль и не заводит пользователей.

Пространства имён только два: `moonkatty_news` и `moonkatty_project`. Они соответствуют проектам панели `news` и `main`.

Права по умолчанию (таблица `si_grants`):

| Агент | NEWS | PROJECT |
|---|---|---|
| news, video | чтение и запись черновиков | нет |
| content | чтение | нет |
| games, pr, design3d | нет | чтение и запись черновиков |
| mkty, marketing, community | нет | чтение |
| social, publishing, analytics | чтение | чтение |
| director | чтение и черновики | чтение и черновики |

Владелец (`role: 'owner'`) читает оба пространства и только он ставит `status: 'approved'`. Виды `decision`, `model_version`, `publication_version` агенту недоступны. Агент не утверждает свои черновики.

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

Готовый файл рендера передаётся как `file-result-handoff` (черновик). Публикация остаётся за очередью панели и за guardrails `public/social.js`. JSON-store медиа-модуля эта библиотека не читает и не подменяет.

`Character3D` по-прежнему подключается в Video Factory. Схема 3D-сценария описывает шаги, но не рендерит.

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

## Сценарии, бренд, утверждение

Это схемы и проверка формы. Исполнения нет.

```js
si.workflow.describe('news');      // шаги, без запуска
si.workflow.run();                 // NOT_IMPLEMENTED
si.brand.validateAsset(asset);     // форма; check/register — NOT_IMPLEMENTED
si.approval.validateRequest(req);  // autoExecute обязан быть false
si.approval.request();             // NOT_IMPLEMENTED
si.approval.decide();              // NOT_IMPLEMENTED
```

Шаг, у которого `requiresOwnerApproval`, `executor: 'human'` или `executor: 'opencode'`, в описании сценария имеет `autoExecute: false`. Оригинал кота (`kind: 'cat_image'`) в схеме заблокирован: `locked: true`, `substitutionPolicy: 'owner_approval_required'`. Подмена (`action: 'substitute'`) помечается как требующая владельца и тоже не выполняется.

Утвердить в журнале может только `actorRole: 'owner'`. Таблицы журнала нет: событие можно проверить формой `approval-event`, записать его пока некуда. Так сделано специально, чтобы утверждение нельзя было «случайно» исполнить.

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

Коды ошибок: `VALIDATION`, `PERMISSION_DENIED`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, `NOT_IMPLEMENTED`, `SECRET_REJECTED`. Поле `retryable` у этих ошибок `false`. Объект `err.toJSON()` совпадает со схемой `error`.

## Тесты

Корневой `package.json` не менялся. Запуск:

```bash
node --disable-warning=ExperimentalWarning --test studio-intelligence/test/*.test.js
```

Предупреждение `ExperimentalWarning` относится к `node:sqlite`, если в окружении нет `better-sqlite3`. На машине с `npm ci` откроется `better-sqlite3`, предупреждения не будет.
