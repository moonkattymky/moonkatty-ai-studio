# Studio Intelligence

Память проекта и поиск по ней для MOONKATTY AI STUDIO. Отдельного сервера, входа и исполнителя задач здесь нет.

Документы на русском:

- [Аудит](../docs/studio-intelligence/AUDIT.md)
- [Подключение](../docs/studio-intelligence/INTEGRATION.md)
- [Нагрузка](../docs/studio-intelligence/LOAD.md)
- [Риски](../docs/studio-intelligence/RISKS.md)

Контракты: `contracts/*.schema.json`. Код: `src/`.

```bash
node --disable-warning=ExperimentalWarning --test studio-intelligence/test/*.test.js
```

База — тот же `data/studio.db`, таблицы `si_*`.
