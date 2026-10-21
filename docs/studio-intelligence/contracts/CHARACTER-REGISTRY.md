# Реестр версии мастер-модели

Согласовано с основной студией, ветка `feat/v1.2.0`, документ `docs/ROADMAP_3D_CHARACTER.md` (только чтение, файл не менялся).

Основная студия владеет моделью, ригом, анимацией и файлом `.blend`. Эта ветка файл не создаёт, не копирует и не генерирует кота.

Постоянный id карточки: `MOONKATTY_MASTER_CHARACTER`, пространство `moonkatty_shared`.

## Что хранится

Поля совпадают с их `manifest.json`: `version`, `file`, `sha256`, `createdAt`, `approvedBy`, `sourceRefs`, `locked`. Плюс ссылка `voiceProfileId`.

`sourceRefs` — права на референсы, не сами картинки: `path`, `sha256`, `basis`, `license`, `holder`.

Утверждённая версия помечается `locked: true`. Следующая утверждённая версия снимает замок с предыдущей (`superseded`), строка не удаляется. Откат версии — новая запись, не перезапись файла.

`character.forStudio` отдаёт эти поля без байтов. Перед мимикой основная студия сверяет SHA-256 файла со значением реестра. Несовпадение блокирует их задачу `character_animate`. Здесь кадры не считаются.

## Голос

Студия 2 задаёт черновик профиля. Владелец утверждает. Для мимики основная студия читает:

```js
{ id, approved: true, sampleRate, recognizer, gain, mouthScale, engine, voice, speed, pitchShift, modelSha256, voicesSha256 }
```

`recognizer` — `phonetic`, `pocketSphinx` или `tts-timing`. Хеши модели и пакета голосов, если заданы, — 64 hex-символа. Синтез речи отсюда не вызывается. Платного голоса нет. Разбор экспорта студии 2: `docs/studio-intelligence/contracts/VOICE-PROFILE.md`.

Пока профиль не утверждён, `prepareFacialUse` не пишет использование.
