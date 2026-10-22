# MOONKATTY NODE на iMac Retina 5K 27" 2017 (Intel, macOS Ventura 13.7.1) — NEWS NODE (пошагово)

> **УСТАРЕЛО для NODE 0.2.2 / v1.3.0-test.** Схема с `tailscale serve` (`*.ts.net:8443`, `NODE_TLS_MODE=tailscale`) для узлов НЕ используется и агентом 0.2.2 отклоняется. Актуальная инструкция: [../NODES_INSTALL_RU.md](../NODES_INSTALL_RU.md) — прямое подключение к адресу Tailscale 100.x с закреплённым сертификатом, без Serve и Funnel.


> **Актуальная инструкция — [NEWS_NODE_IMAC.md](NEWS_NODE_IMAC.md)** (пакет 0.2.0, Node 24 LTS, Tailscale serve, лимиты RAM). iMac Retina 5K 27" 2017. Характеристики: i5 3.4 GHz 4 ядра, 8 ГБ DDR4, Radeon Pro 570 4 ГБ, macOS Ventura 13.7.1, x86_64.

Профиль **NEWS NODE** (`role: news`). Задачи: сбор RSS и официальных источников, дедупликация, подготовка данных новостей, архивирование, лёгкая обработка изображений (sips), передача данных на Mac mini. Тяжёлые модели и 3D — никогда.
Каждый шаг заканчивается **Проверкой** — не переходите дальше, пока проверка не прошла. Ничего не ставится автоматически: автозапуск включается только вашим `yes`.
Обозначения: команды «на Mac mini» выполняются в Терминале Mac mini, «на iMac» — на iMac.

## Шаг 1. Узнать характеристики iMac (только чтение)
Скопируйте `scripts/node/detect-specs.sh` на iMac (AirDrop/флешка) и выполните **на iMac**:
```
bash ~/Downloads/detect-specs.sh > ~/Desktop/moonkatty-specs-imac.txt; tail -3 ~/Desktop/moonkatty-specs-imac.txt
```
**Проверка:** последняя строка `verdict:` — для iMac (Ventura 13.7.1) «пакет darwin-x64 (Node.js 24 LTS, мин. macOS 13.5)», `macos: macOS 13.7.1`, `arch: x86_64`, `ram_gb: 8`. Если иначе — остановитесь и пришлите файл мне. Пришлите мне этот файл (секретов в нём нет).

## Шаг 2. Включить Node Manager на Mac mini
Узнайте LAN-адрес Mac mini **на Mac mini**: `ipconfig getifaddr en0` (Ethernet) или `ipconfig getifaddr en1` (Wi-Fi). Например `192.168.1.10`.
Закройте приложение студии (Cmd+Q). Откройте `~/Library/Application Support/MOONKATTY AI STUDIO/desktop.json` и добавьте (сохранив остальные поля):
```
"opsNodes": true,
"opsNodesBind": "192.168.1.10",
"opsDashboard": true
```
Запустите приложение. **Проверка на Mac mini:**
```
DATA="$HOME/Library/Application Support/MOONKATTY AI STUDIO"; APP=$(cat "$DATA/app-token")
curl -s http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H "x-studio-app-token: $APP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("fingerprint:",d["fingerprint"])'
lsof -nP -iTCP:8790 -sTCP:LISTEN
```
Должен быть 64-символьный отпечаток и строка `192.168.1.10:8790 (LISTEN)` — **не** `*:8790`. Брандмауэр macOS: разрешите входящие подключения для приложения студии; проброс портов на роутере не делать.

## Шаг 3. Зарегистрировать iMac (на Mac mini)
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H 'content-type: application/json' \
  -H "x-studio-app-token: $APP" -d '{"id":"imac","role":"news","name":"iMac"}'
```
В ответе `token` (`nk_imac.…`) — показывается **один раз**, никому не отправляйте. Скопируйте сертификат на iMac: файл `"$DATA/ops/nodes-tls.crt"` (AirDrop), он не секретный.
**Проверка:** `curl -s http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H "x-studio-app-token: $APP" | grep -o '"id":"imac"[^}]*"status":"[a-z-]*"'` → `never-seen`.

## Шаг 4. Собрать пакет на Mac mini и проверить его
В папке репозитория **на Mac mini**:
```
cd ~/moonkatty-ai-studio && git checkout feat/studio-operations && git pull && bash scripts/node/build-node-pkg.sh
cat dist-node/*.sha256
```
Перенесите `dist-node/moonkatty-node-0.2.0-darwin-x64.tar.gz` и его `.sha256` на iMac.
**Проверка на iMac:**
```
cd ~/Downloads && shasum -a 256 -c moonkatty-node-0.2.0-darwin-x64.tar.gz.sha256 && tar xzf moonkatty-node-0.2.0-darwin-x64.tar.gz && bash moonkatty-node-0.2.0-darwin-x64/install.sh --verify-only
```
Ожидается `OK`, затем `OK` и строки BUILDINFO (Node v24.x, `macOS >= 13.5`, коммит). Любое «ОШИБКА» — стоп.

## Шаг 5. Установить (без автозапуска)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64/install.sh
~/moonkatty-node/bin/node -v && ~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js --info | head -20
```
**Проверка:** `v24.x`, затем JSON с вашими CPU/RAM/диском и `"tools"` (sips есть всегда; ffprobe — если стоит ffmpeg).

## Шаг 6. Токен в Keychain и конфиг
```
security add-generic-password -s moonkatty-node-imac -a node-token -w
```
(вставьте токен `nk_imac.…` при запросе — в истории Терминала он не останется). Сертификат: `mv ~/Downloads/nodes-tls.crt ~/.moonkatty-node/coordinator.crt`.
Отредактируйте `~/.moonkatty-node/node-agent.env` (`open -e ~/.moonkatty-node/node-agent.env`):
```
NODE_ID=imac
COORDINATOR_URL=https://192.168.1.10:8790
COORDINATOR_CERT=/Users/ВАШ_ПОЛЬЗОВАТЕЛЬ/.moonkatty-node/coordinator.crt
COORDINATOR_FINGERPRINT=<64 символа из шага 2>
NODE_STATUS_PORT=8791
```
**Проверка:** `ls -l ~/.moonkatty-node/node-agent.env` → `-rw-------`; `security find-generic-password -s moonkatty-node-imac -a node-token >/dev/null && echo keychain-ok`.

## Шаг 7. Пробный запуск вручную
```
~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js
```
**Проверка:** в окне нет `TLS pin mismatch`/`токен отклонён`; откройте на iMac http://127.0.0.1:8791 — экран **NEWS NODE**, статус Online. На Mac mini в панели «Computers (Nodes)» (/studio.html) карточка iMac — Online. Остановите Ctrl+C.

## Шаг 8. Тестовая задача с Mac mini
Отправьте на iMac сбор новостей из **официальных** RSS (подставьте реальные ленты СМИ, которые вы используете):
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/jobs -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" \
  -d '{"capability":"news.collect","input":{"feeds":[{"url":"https://feeds.bbci.co.uk/news/world/rss.xml","source":"BBC"}]},"safeToRetry":true,"maxAttempts":3,"preferNode":"imac"}'
```
**Проверка:** через 5–20 с `GET /api/ops/nodes` показывает задачу `succeeded` на `imac`; на экране NEWS NODE — источник в News Collection и заголовки в Recent Headlines. Файлы вручную не копировались.

## Шаг 9. Автозапуск (только после успешных шагов 1–8)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64/install.sh --autostart
```
Введите `yes`. **Проверка:** `launchctl print gui/$(id -u)/com.moonkatty.node-agent | grep -E 'state|last exit'` → `state = running`; после перезагрузки iMac карточка снова Online.

## Шаг 10. Управление из центра
Пауза/возобновление/стоп с Mac mini:
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/imac/command -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"command":"pause"}'
```
(`run` — продолжить, `drain` — доделать текущую и не брать новые, `stop` — завершить агент). **Проверка:** на 127.0.0.1:8791 статус «Пауза», в панели — Paused.

## Откат
- Выключить автозапуск и удалить: `bash ~/moonkatty-node/uninstall.sh` (конфиг и архив сохранятся) или `--rollback` (вернуть предыдущую версию), `--purge` (удалить всё).
- Отозвать токен на Mac mini: `curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/imac/revoke -H 'x-studio-request: 1' -H "x-studio-app-token: $APP"`; удалить из Keychain: `security delete-generic-password -s moonkatty-node-imac`.
- На Mac mini выключить узлы: `"opsNodes": false` в desktop.json, перезапуск.

## Что прислать мне
`moonkatty-specs-imac.txt`; вывод проверок шагов 2, 4, 5, 9; скриншот 127.0.0.1:8791 и /studio.html; результат шага 8. Без токенов (`nk_…`), паролей и содержимого app-token.
