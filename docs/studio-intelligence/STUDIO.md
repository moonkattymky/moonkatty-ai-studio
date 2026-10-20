# Контракт с основной студией

Ветка основной студии: `feat/v1.2.0`, документ `docs/ROADMAP_3D_CHARACTER.md`. Их код отсюда не редактируется.

Они владеют моделью, ригом, анимацией и `MOONKATTY_MASTER.blend`. Мы храним реестр: SHA-256, замок версии, права на референсы, `voiceProfileId`.

Их задача `character_animate` на входе ждёт утверждённый `voiceProfileId` и `masterAssetVersion`. Оба читаются отсюда:

```js
si.voices.forStudio({ principal })
si.character.forStudio({ principal })
```

`prepareFacialUse` проверяет, что карточка `MOONKATTY_MASTER_CHARACTER` утверждена, хеш совпадает с заблокированной версией, а голос утверждён. Использование пишется в `moonkatty_news`. `executed` остаётся `false`. Blender не вызывается.

Скрипт `studio-intelligence/scripts/character-layout.js` печатает найденные пути `.blend` и референсов. Эти пути владелец передаёт основной студии. Скрипт файл не создаёт.
