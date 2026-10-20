# Changelog

## 1.2.0-mac-preview — «Autonomous 3D Production», этапы A и B (2026-10-21)
**Этап A: исполнитель-агент через OpenCode server API**
- Director назначает 3D-задачи агенту **3D DESIGN** (агент включён, больше не «в разработке»). Задачу можно создать из чата Director или кнопкой «Создать 3D-модель» в 3D Studio.
- Новый клиент OpenCode server (`lib/opencode-client.js`) работает через `/global/health`, `/config`, `/session`, `/session/:id/prompt_async`, `/permission` + `/permission/:id/reply`, `/session/status`, `/session/:id/message`, `/session/:id/abort` и SSE `/event`. Basic Auth использует пароль из Keychain; версия OpenCode должна быть ≥ 1.1 (проверено с 1.19.3).
- Политика разрешений `lib/policy.js`:
  - shell запрещён;
  - доступ только к папке проекта;
  - защищённые файлы Blender агент не трогает;
  - удаление и публикация требуют подтверждения;
  - перед запуском проверяется конфиг сервера.
- Новый движок заданий `lib/jobs.js` хранит задания в отдельных таблицах SQLite `jobs`/`job_events`: статус, этап, попытки, лимиты повторов, checkpoint, артефакты, ошибка, heartbeat, журнал действий с id правил. Есть таймауты, отмена, повтор (автоматически 1 раз для временных ошибок, вручную до 3) и **продолжение после перезапуска с текущего этапа**; сиротские процессы Blender убиваются.
- Общий API: `POST/GET /api/jobs`, `/api/jobs/:id/{cancel,retry,confirm}`; внутренние модули `lib/services.js` (`jobsApi`, `blenderService`, `host3d`).
- Тяжёлые операции (Blender, Ollama) сериализованы (`lib/heavy-lock.js`).

**Этап B: Blender Automation Service**
- `lib/blender.js`: поиск Blender (macOS `/Applications`, PATH, путь из настроек), проверка версии ≥ 4.2 и Python API (движки, экспорт GLB/FBX) в фоновом режиме, запуск `-b --factory-startup --python-exit-code 3`, таймаут/отмена, разбор ошибок Python.
- Проверенный шаблон `blender/templates/scene_basic.py`:
  - сцена (стилизованный кот MOONKATTY или примитив), материалы, свет (three_point/sun/studio), камера, фон, анимация turntable (до 48 кадров);
  - сохранение `.blend`, **повторное открытие в новом процессе**, рендер PNG (Cycles CPU / EEVEE / Workbench), экспорт GLB/FBX.
- Версии проекта `projects3d/<id>/vNNN` с резервной копией предыдущего `.blend`; `project.json`; артефакты с sha256.

**3D Studio UI (минимум, RU/EN/UK):** поле задачи, «Создать 3D-модель», этапы и статус, журнал, PNG-превью, отмена, повтор, подтверждение, состояние Blender/OpenCode, настройки пути и модели. Референсы, утверждение/доработка/отклонение и экспорт из UI помечены «В разработке».

**Тесты:** `test:3d` с реальным opencode serve 1.19.3 + Basic Auth (мок-LLM вместо Ollama) и реальным Blender 5.2.2 headless; `test:policy`. Существующие тесты security, opencode, runner и smoke проходят.
