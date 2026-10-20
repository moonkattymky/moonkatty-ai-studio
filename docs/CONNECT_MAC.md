# Безопасное подключение Mac mini к рабочему серверу (Tailscale + SSH)

Цель: дать боту на рабочем Linux-сервере **ограниченный** доступ к Mac mini (M5 Pro) — только под отдельным пользователем без прав администратора, только по ключу, только через вашу приватную сеть Tailscale. В любой момент доступ можно отозвать одной командой.

> Особенности сервера бота: исходящий порт 22 заблокирован, работает 443. Tailscale на сервере работает в userspace-режиме (без TUN-интерфейса), поэтому обычный `ssh 100.x.y.z` напрямую не сработает — SSH идёт **через Tailscale** (`tailscale nc` как ProxyCommand или Tailscale SSH). Трафик Tailscale ходит через DERP-реле по 443 — это нормально.

Ничего из этого бот не делает сам: все шаги выполняете вы на Mac. Доступ не запрашивается, пока вы сами его не выдадите.

---

## 1. Отдельный пользователь `studio` (без прав администратора)

1. **Системные настройки → Пользователи и группы → Добавить пользователя**.
2. Тип: **Стандартный** (НЕ «Администратор»). Имя: `studio`. Задайте длинный случайный пароль (он понадобится только локально, по SSH пароль работать не будет).
3. Проверка в Терминале:
   ```bash
   id studio            # в группах НЕ должно быть admin
   dseditgroup -o checkmember -m studio admin   # ожидается: "no studio is NOT a member of admin"
   ```
4. Дайте `studio` доступ только к нужной папке, например проекту студии:
   ```bash
   sudo mkdir -p /Users/Shared/moonkatty-studio
   sudo chown studio:staff /Users/Shared/moonkatty-studio
   ```
   Ваши личные папки (`/Users/<вы>`) по умолчанию закрыты для других пользователей — не меняйте это.

## 2. Remote Login (SSH) только для `studio`

1. **Системные настройки → Основные → Общий доступ → Удалённый вход** — включить.
2. Нажмите (i) рядом с «Удалённый вход» → «Разрешить доступ: **Только этим пользователям**» → оставьте **только `studio`** (удалите «Администраторы»).
3. **Не** включайте «Полный доступ к диску для удалённых пользователей».

## 3. Только вход по ключу, пароли отключены

1. Ключ: на сервере бота будет создан **отдельный** ключ (ed25519). Вы получите только **публичную** часть (строка `ssh-ed25519 AAAA... moonkatty-bot`). Приватный ключ никогда не передаётся и не нужен вам.
2. Установите публичный ключ для `studio` (выполнять под своим админом):
   ```bash
   sudo mkdir -p /Users/studio/.ssh
   echo 'ssh-ed25519 AAAA...ВСТАВЬТЕ_ПУБЛИЧНЫЙ_КЛЮЧ... moonkatty-bot' | sudo tee /Users/studio/.ssh/authorized_keys
   sudo chown -R studio:staff /Users/studio/.ssh
   sudo chmod 700 /Users/studio/.ssh && sudo chmod 600 /Users/studio/.ssh/authorized_keys
   ```
   Можно дополнительно ограничить ключ: в начало строки добавить
   `from="100.64.0.0/10",no-agent-forwarding,no-X11-forwarding,no-port-forwarding `
   (подключения только из адресов Tailscale, без проброса портов).
3. Отключите пароли в SSH — создайте файл `/etc/ssh/sshd_config.d/100-moonkatty.conf`:
   ```bash
   sudo tee /etc/ssh/sshd_config.d/100-moonkatty.conf >/dev/null <<'CONF'
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   PubkeyAuthentication yes
   AllowUsers studio
   CONF
   sudo sshd -t && echo "конфиг OK"
   ```
   Затем выключите и снова включите «Удалённый вход» (или `sudo launchctl kickstart -k system/com.openssh.sshd`).
   > Убедитесь, что в `/etc/ssh/sshd_config` есть строка `Include /etc/ssh/sshd_config.d/*` (в современных macOS есть по умолчанию).
4. Проверка с самого Mac: `ssh -o PreferredAuthentications=password studio@localhost` → должно быть **Permission denied**.

## 4. Tailscale на Mac

1. Установите Tailscale (Mac App Store или https://tailscale.com/download) и войдите в **свою** учётную запись (tailnet).
2. Включите для Mac тег, чтобы применять к нему правила: в админке https://login.tailscale.com/admin/machines → Mac → **Edit ACL tags** → `tag:mac-studio` (сначала объявите тег в ACL, см. ниже).
3. Сервер бота добавляется в ваш tailnet отдельно (бот присылает ссылку/ключ авторизации только по вашему запросу) и получает тег `tag:studio-bot`. Рекомендуется одноразовый, **pre-approved: off**, **ephemeral** ключ с тегом `tag:studio-bot` — тогда вы подтверждаете устройство вручную.

## 5. ACL: сервер бота видит ТОЛЬКО Mac и ТОЛЬКО порты SSH/студии

В админке → **Access controls** (пример политики; если у вас уже есть правила — добавьте аналогичные, а широкое правило `"*:*"` удалите):

```jsonc
{
  "tagOwners": {
    "tag:mac-studio": ["autogroup:admin"],
    "tag:studio-bot": ["autogroup:admin"]
  },
  "acls": [
    // вы сами — доступ ко всему своему
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] },
    // сервер бота -> только Mac, только SSH (22) и веб-панель студии (8787)
    { "action": "accept", "src": ["tag:studio-bot"], "dst": ["tag:mac-studio:22,8787"] }
  ],
  // вариант с Tailscale SSH (без открытого sshd): только пользователь studio
  "ssh": [
    { "action": "accept", "src": ["tag:studio-bot"], "dst": ["tag:mac-studio"], "users": ["studio"] }
  ]
}
```

Никакого правила «из Mac в сервер бота» и «из бота куда-то ещё» нет — значит бот не видит другие ваши устройства.

## 6. Как бот подключается (для справки)

Вариант A — обычный sshd на Mac через userspace-Tailscale:
```sshconfig
# ~/.ssh/config на сервере бота
Host mac-studio
  HostName mac-mini            # MagicDNS-имя Mac в tailnet
  User studio
  IdentityFile ~/.ssh/moonkatty_mac_ed25519
  IdentitiesOnly yes
  ProxyCommand tailscale nc %h %p
```
Вариант B — Tailscale SSH: на Mac `tailscale set --ssh` (работает в standalone-версии Tailscale, не в App Store-версии), правило `ssh` из ACL выше; подключение `tailscale ssh studio@mac-mini`.

Веб-панель MOONKATTY AI STUDIO на Mac слушает `127.0.0.1:8787`. Для доступа через tailnet используйте `tailscale serve --bg 8787` (публикует только внутри вашего tailnet, НЕ в интернет; **не** используйте `tailscale funnel`).

## 7. Как отозвать доступ (мгновенно)

Любой из шагов полностью отключает бота:
1. Админка Tailscale → Machines → сервер бота → **Remove** (или **Disable key expiry → Expire key**).
2. На Mac: удалить ключ — `sudo rm /Users/studio/.ssh/authorized_keys`.
3. Выключить «Удалённый вход» в Общем доступе.
4. Удалить правило `tag:studio-bot` из ACL.
5. При необходимости удалить пользователя `studio` (Пользователи и группы → «−»).

Проверка после отзыва: в админке Tailscale сервер бота не отображается/offline; `sudo log show --last 1h --predicate 'process == "sshd"'` — новых входов нет.

## 8. Чек-лист безопасности

- [ ] `studio` — стандартный пользователь, не admin
- [ ] Удалённый вход разрешён только `studio`
- [ ] `PasswordAuthentication no`, вход только по ключу
- [ ] ACL: `tag:studio-bot` → только `tag:mac-studio:22,8787`
- [ ] Панель студии слушает только `127.0.0.1`, наружу — только через `tailscale serve`
- [ ] Никаких секретов (seed-фраз, ключей кошельков $MKTY, токенов) в доступных `studio` папках
