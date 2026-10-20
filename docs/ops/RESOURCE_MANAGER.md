# Resource Manager (24 ГБ unified memory)

Включение: `STUDIO_OPS_RESOURCES=1`. Без флага runner работает как раньше.

## Профиль `PROFILE_24GB`
- Всего 24 ГБ, резерв macOS/сервер/браузер 6 ГБ → бюджет задач **18 ГБ**; heavy-задача не стартует, если реально свободно (vm_stat) станет < 2 ГБ.
| Класс | Оценка RAM | Параллельно |
|---|---|---|
| light | 0.5 ГБ | 4 (+2 для `urgent`) |
| llm-large | 10 ГБ | 1 |
| render (Blender) | 8 ГБ | 1 |
| video (ffmpeg) | 6 ГБ | 1 |
- `llm-large` и `render` взаимоисключающие.
- Модели, загруженные в Ollama (`GET /api/ps`, `size_vram`), учитываются в бюджете для не-LLM задач.
- При `OPS_RM_UNLOAD_OLLAMA=1`, если render/video ждёт памяти, занятой Ollama, модели выгружаются запросом `POST /api/generate {"model": "...", "keep_alive": 0}`.

## Поведение
- `runner.tick()` берёт первую по приоритету задачу агента, прошедшую `admit()`; остальные остаются `queued` (в журнал пишется причина ожидания один раз).
- `release()` вызывается всегда в `finally` (успех, ошибка, остановка).
- `renderQueue(tasks)` — порядок рендера: urgent → high → normal → low → FIFO.
- Temp: `tempDir(taskId)` создаёт `<DATA_DIR>/ops/tmp/<id>` (0700) с маркером. Очистка раз в час удаляет **только** папки с маркером внутри этого корня (без перехода по symlink), старше TTL или сверх квоты (сначала самые старые), кроме активных задач. Пользовательские данные, `files/`, бэкапы не трогаются.
- Состояние: `GET /api/ops/status` и блок `resources` в `/api/mobile/summary`.

Оценки RAM — стартовые; уточните на Mac по фактическим замерам (см. MAC_CHECKLIST.md).
