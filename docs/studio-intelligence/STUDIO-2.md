# Контракт со студией 2

Студия 2 задаёт профиль голоса ведущего и карточки лицензионных файлов. Мимику считает основная студия, не эта ветка.

```js
si.voices.define({ principal: videoAgent, profile })
si.voices.approve({ principal: owner, voiceProfileId })
```

Черновик может записать агент `video`. Утверждает только владелец. Второй утверждённый профиль снимает предыдущий (`superseded`). Поля для основной студии: `id`, `approved`, `sampleRate`, `recognizer`, `gain`, `mouthScale`.

Повтор файла: `assets.register` и `assets.findReusable`. Совпадение хеша в видимой области возвращает ту же карточку и не копирует байты. История использования: `recordUsage` с `whereUsed` `shorts`, `reels`, `episode` или `publication`.

Платный синтез и скачивание стоков отсюда не вызываются.
