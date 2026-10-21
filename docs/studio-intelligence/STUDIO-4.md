# Контракт со студией 4

Процедуру проверки перед выпуском ведёт студия 4. Здесь только чтение прав и журнал.

```js
si.qa.rightsForPublication({ principal, namespace, assetIds, publicationId })
si.qa.recordFinding({ principal, finding })
```

`recordFinding` возвращает `executed: false`. Имена проверок, которые они могут записать: `sound`, `subtitles`, `format`, `corrupted_frames`, `rights`. ffmpeg не вызывается.

Поправка и опровержение:

```js
si.notices.record({ principal, notice })   // kind: correction | retraction, статус draft
si.notices.approve({ principal: owner, id })
```

Утверждение строки журнала не публикует текст и не снимает выпуск. Это делает их процедура после решения владельца.

История источников и редакционных решений: `editorial.recordSource`, `editorial.recordDecision`. Итог `approved` или `rejected` ставит только владелец. Решение тоже возвращает `executed: false`.
