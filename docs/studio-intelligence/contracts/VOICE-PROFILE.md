# Профиль голоса ведущего

Студия 2 отдаёт файл `docs/media-automation/exports/master-voice.studio5.json` (коммит `551f361` на `feat/media-automation`, только чтение). Эта ветка пишет черновик в `si_voice_profiles`. Утверждение из файла не копируется.

Идентификатор черновика: `MOONKATTY_NEWS_MASTER_VOICE`. Пространство: `moonkatty_news`.

## Что кладётся в базу

| Поле у нас | Откуда |
|---|---|
| `voiceProfileId` | `id` экспорта. Поле `voiceProfileId` в файле пустое и не используется |
| `engine` | согласованное короткое имя `kokoro`. В файле `engine.name` = `kokoro-82m`, `engine.runtime` = `kokoro-onnx`. Отдельных колонок под них нет |
| `voice` | ключ `voice.blend` со значением 1. В этом файле это `am_fenrir` |
| `speed` | `voice.speed` (1) |
| `pitchShift` | `voice.pitchSemitones` (0) |
| `sampleRate` | 48000. В файле `voice.sampleRateHz` = 24000, а строка доставки — wav 48 кГц. В базу кладётся частота доставки |
| `recognizer` | `tts-timing`. В экспорте такого поля нет |
| `gain` | 1. В экспорте числа нет, `gain` только в списке `emotionControls` |
| `mouthScale` | 1. В экспорте поля нет |
| `modelSha256` | `engine.model.sha256` |
| `voicesSha256` | `engine.voicesPack.sha256` |
| `status` | всегда `draft` при импорте. `status: locked` и блок `approval` не переносятся |

Хеш, если он задан, — 64 hex-символа. Пустое значение допустимо. Плохая строка отклоняется до записи.

`importMasterVoiceDraft` вызывает только `voices.define`. `approve` вызывает владелец отдельно. `executed` остаётся `false`. Повтор того же id возвращает уже записанную строку и вторую не создаёт.
