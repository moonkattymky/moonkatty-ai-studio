# Предлагаемая вставка в server.js

Файл `server.js` не менялся. Ниже — текст, который панель может взять сама. Пока его нет в `main`, JSON `dump()` по-прежнему пишет только `core.COLLECTIONS` из `items` и таблицы `si_*` не содержит. `POST /api/restore` эти таблицы тоже не трогает.

Рядом уже есть вызовы, панель может использовать без правки `server.js`:

- `si.persistence.exportSi()` — JSON `{ kind: 'moonkatty-si-export', version: 1, tables }`
- `si.persistence.importSi(payload)` — кладёт эти строки в уже мигрированную базу, `items` не трогает
- `si.persistence.snapshot(dest)` — `VACUUM INTO`, цельный файл открытой базы

Вставка, если панель захочет положить `si_*` в тот же JSON:

```diff
--- a/server.js
+++ b/server.js
@@
-const dump = () => ({ app: 'moonkatty-ai-studio', version: 1, exportedAt: core.now(), data: Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)])) });
+const { exportSi, importSi } = require('./studio-intelligence/src/si-export');
+const dump = () => ({
+  app: 'moonkatty-ai-studio',
+  version: 1,
+  exportedAt: core.now(),
+  data: Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)])),
+  si: exportSi(db)
+});
```

И в `POST /api/restore`, после цикла по `core.COLLECTIONS`:

```diff
   db.transaction(() => { for (const c of core.COLLECTIONS) if (Array.isArray(d[c])) { db.prepare('DELETE FROM items WHERE col = ?').run(c); for (const o of d[c]) if (o && o.id) put(c, o); } })();
+  if (req.body && req.body.si) importSi(db, req.body.si);
```

Версия пакета при этом не меняется. Пока вставка не принята, панель вызывает `exportSi` / `importSi` / `snapshot` отдельно.
