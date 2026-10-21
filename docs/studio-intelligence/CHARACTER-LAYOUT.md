# Раскладка персонажа на Mac mini

Целевой корень: `~/Documents/MOONKATTY-ASSETS/CHARACTERS/MASTER/`.

Внутри девять каталогов: `references`, `models`, `textures`, `rigs`, `animations`, `outfits`, `renders`, `versions`, `metadata`.

Поиск по всем веткам git на 20 октября 2026: файла `MOONKATTY_MASTER.blend` в репозитории нет. Картинки в `public/img/` — значки интерфейса (`cat-logo.jpg` и обложки). Это не мастер-модель. Скрипт их не переносит.

Скрипт по умолчанию ничего не создаёт и ничего не двигает. С `--apply` он создаёт только недостающие каталоги. Если на месте каталога уже лежит файл, путь попадает в список «не тронуто».

## Команды на Mac mini

Из корня репозитория, сначала только отчёт:

```bash
node studio-intelligence/scripts/character-layout.js
```

Если файлы лежат не в домашнем `Documents`, укажите корень и дополнительные папки:

```bash
node studio-intelligence/scripts/character-layout.js \
  --root "$HOME/Documents/MOONKATTY-ASSETS" \
  --scan "$HOME/Documents/MOONKATTY-ASSETS"
```

Скрипт печатает абсолютные пути `MOONKATTY_MASTER.blend` и картинок внутри каталогов с именем `references`, рядом SHA-256. Эти строки передайте основной студии. Реестр памяти сам модель не собирает.

Когда пути проверены и владелец хочет создать пустые каталоги:

```bash
node studio-intelligence/scripts/character-layout.js --apply
```

Повторный запуск с `--apply` существующие каталоги не перезаписывает.
