# MOONKATTY NODE на MacBook Pro Retina 13" Early 2015 (Intel, macOS Monterey 12.7.6) — MONITOR NODE (пошагово)

> **Актуальная инструкция — [MONITOR_NODE_MACBOOK.md](MONITOR_NODE_MACBOOK.md)** (пакет 0.2.0 `darwin-x64-monterey`, Node 22 LTS, Tailscale serve, лимиты RAM/CPU). Характеристики: Intel Core i5 2,7 ГГц 2 ядра, 8 ГБ DDR3, Intel Iris 6100, macOS Monterey 12.7.6, x86_64.

Профиль **MONITOR NODE** (`role: monitor`). Задачи: мониторинг центральной студии, проверка результатов задач, технический анализ видео через ffprobe, уведомления (настраиваются только на самом MacBook: `NODE_NTFY_URL` в node-agent.env), лёгкие проверки сайтов/сервисов, статистика, X: только аналитика и черновики (никаких автопостов, лайков, подписок). Тяжёлые модели и 3D — никогда.

**macOS: Monterey 12.7.6** (подтверждено). Node 24 не поддерживается (нужна 13.5) — используется Node 22 LTS.
Каждый шаг заканчивается **Проверкой** — не переходите дальше, пока проверка не прошла. Ничего не ставится автоматически: автозапуск включается только вашим `yes`.
Обозначения: команды «на Mac mini» выполняются в Терминале Mac mini, «на MacBook» — на MacBook.

## Шаг 1. Узнать характеристики MacBook (только чтение)
Скопируйте `scripts/node/detect-specs.sh` на MacBook (AirDrop/флешка) и выполните **на MacBook**:
```
bash ~/Downloads/detect-specs.sh > ~/Desktop/moonkatty-specs-macbook.txt; tail -3 ~/Desktop/moonkatty-specs-macbook.txt
```
**Проверка:** последняя строка `verdict:` — для macOS 11/12 «Node.js 22 LTS x64 … содержит его». Если `verdict` про 10.15 или старше — остановитесь: обновите macOS до 12 Monterey (Apple → Об этом Mac → Обновление ПО) или пришлите файл мне. Пришлите мне этот файл (секретов в нём нет).

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

## Шаг 3. Зарегистрировать MacBook (на Mac mini)
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H 'content-type: application/json' \
  -H "x-studio-app-token: $APP" -d '{"id":"macbook","role":"monitor","name":"MacBook"}'
```
В ответе `token` (`nk_macbook.…`) — показывается **один раз**, никому не отправляйте. Скопируйте сертификат на MacBook: файл `"$DATA/ops/nodes-tls.crt"` (AirDrop), он не секретный.
**Проверка:** `curl -s http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H "x-studio-app-token: $APP" | grep -o '"id":"macbook"[^}]*"status":"[a-z-]*"'` → `never-seen`.

## Шаг 4. Собрать пакет на Mac mini и проверить его
В папке репозитория **на Mac mini**:
```
cd ~/moonkatty-ai-studio && git checkout feat/studio-operations && git pull && bash scripts/node/build-node-pkg.sh
cat dist-node/*.sha256
```
Перенесите `dist-node/moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz` и его `.sha256` на MacBook.
**Проверка на MacBook:**
```
cd ~/Downloads && shasum -a 256 -c moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz.sha256 && tar xzf moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz && bash moonkatty-node-0.2.0-darwin-x64-monterey/install.sh --verify-only
```
Ожидается `OK`, затем `OK` и строки BUILDINFO (версия Node 22, коммит). Любое «ОШИБКА» — стоп.

## Шаг 5. Установить (без автозапуска)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64-monterey/install.sh
~/moonkatty-node/bin/node -v && ~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js --info | head -20
```
**Проверка:** `v22.x`, затем JSON с вашими CPU/RAM/диском и `"tools"` (для проверки видео нужен ffprobe: `brew install ffmpeg`, если Homebrew есть; иначе задача ffprobe.check вернёт понятную ошибку).

## Шаг 6. Токен в Keychain и конфиг
```
security add-generic-password -s moonkatty-node-macbook -a node-token -w
```
(вставьте токен `nk_macbook.…` при запросе — в истории Терминала он не останется). Сертификат: `mv ~/Downloads/nodes-tls.crt ~/.moonkatty-node/coordinator.crt`.
Отредактируйте `~/.moonkatty-node/node-agent.env` (`open -e ~/.moonkatty-node/node-agent.env`):
```
NODE_ID=macbook
COORDINATOR_URL=https://192.168.1.10:8790
COORDINATOR_CERT=/Users/ВАШ_ПОЛЬЗОВАТЕЛЬ/.moonkatty-node/coordinator.crt
COORDINATOR_FINGERPRINT=<64 символа из шага 2>
NODE_STATUS_PORT=8791
```
**Проверка:** `ls -l ~/.moonkatty-node/node-agent.env` → `-rw-------`; `security find-generic-password -s moonkatty-node-macbook -a node-token >/dev/null && echo keychain-ok`.

## Шаг 7. Пробный запуск вручную
```
~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js
```
**Проверка:** в окне нет `TLS pin mismatch`/`токен отклонён`; откройте на MacBook http://127.0.0.1:8791 — экран **MONITOR NODE**, статус Online. На Mac mini в панели «Computers (Nodes)» (/studio.html) карточка MacBook — Online. Остановите Ctrl+C.

## Шаг 8. Тестовая задача с Mac mini
Проверка доступности студии и технический анализ видео:
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/jobs -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" \
  -d '{"capability":"site.check","input":{"urls":["https://example.com/"]},"preferNode":"macbook"}'
```
**Проверка:** задача `succeeded` на `macbook`; на экране MONITOR NODE — Recent Tasks «Completed», графики System Monitor заполняются. Для ffprobe.check (видео из студии) задачу ставит студия с файлом — MacBook скачивает его сам по SHA-256.

## Шаг 9. Автозапуск (только после успешных шагов 1–8)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64-monterey/install.sh --autostart
```
Введите `yes`. **Проверка:** `launchctl print gui/$(id -u)/com.moonkatty.node-agent | grep -E 'state|last exit'` → `state = running`; после перезагрузки MacBook карточка снова Online.

## Шаг 10. Управление из центра
Пауза/возобновление/стоп с Mac mini:
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/macbook/command -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"command":"pause"}'
```
(`run` — продолжить, `drain` — доделать текущую и не брать новые, `stop` — завершить агент). **Проверка:** на 127.0.0.1:8791 статус «Пауза», в панели — Paused.

## Откат
- Выключить автозапуск и удалить: `bash ~/moonkatty-node/uninstall.sh` (конфиг и архив сохранятся) или `--rollback` (вернуть предыдущую версию), `--purge` (удалить всё).
- Отозвать токен на Mac mini: `curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/macbook/revoke -H 'x-studio-request: 1' -H "x-studio-app-token: $APP"`; удалить из Keychain: `security delete-generic-password -s moonkatty-node-macbook`.
- На Mac mini выключить узлы: `"opsNodes": false` в desktop.json, перезапуск.

## Что прислать мне
`moonkatty-specs-macbook.txt`; вывод проверок шагов 2, 4, 5, 9; скриншот 127.0.0.1:8791 и /studio.html; результат шага 8. Без токенов (`nk_…`), паролей и содержимого app-token.
