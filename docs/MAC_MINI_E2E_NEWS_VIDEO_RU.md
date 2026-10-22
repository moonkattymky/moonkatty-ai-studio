# Проверка NEWS → VIDEO на Mac mini (ручной чек-лист)

Ветка: `feat/e2e-news-video-3d`. На Linux-боксе цепочка проверена целиком (espeak-ng + ffmpeg + Ollama qwen2.5:0.5b).
На Mac mini **не проверялось** — этот документ описывает, что сделать и что ожидать.

## 0. Подготовка
- Только TEST-флейвор: `NODE_ENV=test STUDIO_FLAVOR=test`, отдельный `STUDIO_DATA_DIR` (не prod-данные).
- Node 22, `npm ci`.
- `ffmpeg -version` и `rsvg-convert --version` должны работать (`brew install ffmpeg librsvg`).
- TTS: на macOS будет выбран `say` (если нет kokoro). Проверка: `say -v '?' | head`.
- Ollama: `ollama list` — модель из Настроек → Интеграции → Ollama (например qwen3:8b) должна быть установлена.

## 1. Запуск
```
STUDIO_DATA_DIR=~/mk-e2e-data NODE_ENV=test STUDIO_FLAVOR=test npm run start:dev
```
Ожидание: сервер слушает только 127.0.0.1 (и Tailscale-адрес, если включён) — как и раньше; `lsof -iTCP -sTCP:LISTEN | grep node`.

## 2. Проверки в UI (раздел «Новости»)
1. Блок окружения показывает: TTS = `say`, ffmpeg ✓, rsvg ✓, Ollama ✓ + имя модели.
2. «Автопоиск новостей» → появляются кандидаты с бейджами достоверности (high/medium/low) и даты. Ошибки отдельных лент видны, а не скрыты.
3. Отметить 2–3 истории → «Создать сценарий выпуска». Провайдер текста: `ollama:<модель>`; если стоит `local-extractive` — смотреть причину.
4. **Фактчек владельца**: «Редактировать», сверить текст с источниками, сохранить. Статус → `draft`.
5. «Утвердить» → статус `approved`, в `<DATA_DIR>/media/episodes/` появился JSON выпуска.
6. «Рендер 16:9» → `rendering` → `rendered` (1–3 мин). Во время рендера Ollama выгружается (keep_alive=0) — в журнале событие `ollama_unload`.
7. Превью `<video>` проигрывается, голос — `say` (не espeak). «Экспорт MP4» и «SRT» скачиваются.
8. Повторить «Рендер 9:16».
9. Раздел «Видео» показывает те же выпуски и кнопки.

## 3. Проверка артефактов
```
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,sample_rate -of compact <mp4>
ffmpeg -i <mp4> -af volumedetect -vn -f null - 2>&1 | grep volume
```
Ожидание: h264 1920×1080 (или 1080×1920) + AAC 48 kHz; mean_volume примерно −15…−30 dB (не −91 dB = тишина).

## 4. Автотесты на Mac
```
npm run test:newsvideo
STUDIO_URL=http://127.0.0.1:8687 PW_FILE=<файл с паролем, chmod 600> npm run test:newsvideo-security
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" PW_FILE=... OUT=/tmp/nv npm run test:newsvideo-e2e
npm run test:video && npm run test:isolation
```
Ожидание: все PASS.

## 5. Что зафиксировать в отчёте
Версию macOS, модель Ollama, выбранный TTS, длительность рендера, вывод ffprobe/volumedetect, скриншоты разделов «Новости» и «Видео».
