# Контракт с основной студией

Ветка основной студии: `feat/v1.2.0`, документ `docs/ROADMAP_3D_CHARACTER.md`. Их код отсюда не редактируется.

Они владеют моделью, ригом, анимацией и `MOONKATTY_MASTER.blend`. Мы храним реестр: SHA-256, замок версии, права на референсы, `voiceProfileId`.

Их задача `character_animate` на входе ждёт утверждённый `voiceProfileId` и `masterAssetVersion`. Оба читаются отсюда:

```js
si.voices.forStudio({ principal })
si.character.forStudio({ principal })
```

`prepareFacialUse` требует `masterAssetVersion` в запросе и не подставляет заблокированную версию сама. Отказ, если номера нет в реестре, версия не утверждена или голос не утверждён. Хеш заблокированной версии должен совпасть с карточкой `MOONKATTY_MASTER_CHARACTER`. Использование пишется в `moonkatty_news`. `executed` остаётся `false`. Blender не вызывается.

`mouthScale` — число от 0.5 до 2.0, диапазон задаёт основная студия. Тайминги и виземы берутся из схемы студии 2 `moonkatty/animation-cues/v1`, своего формата нет. `character_animate` в очереди заданий ещё нет: класс `gpu_heavy`, ключ идемпотентности назначает сервер. Код очередей здесь не меняется.

Граница с обеими сторонами: `docs/studio-intelligence/contracts/INTERFACES-STUDIO-STUDIO2.md`. Основная студия и студия 2 эти поправки согласовали. Схема cues предварительна до стадии D.

Скрипт `studio-intelligence/scripts/character-layout.js` печатает найденные пути `.blend` и референсов. Эти пути владелец передаёт основной студии. Скрипт файл не создаёт.
