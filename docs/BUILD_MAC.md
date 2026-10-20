# Сборка MOONKATTY AI STUDIO на Mac (Apple Silicon)

Самый безопасный способ получить приложение без Developer ID — **собрать его самому из проверенного исходного кода**. Приложения, собранные локально, не получают атрибут карантина, поэтому Gatekeeper их не блокирует; доверие строится на том, что вы видели код и сами его собрали.

## Требования

- Mac с Apple Silicon, macOS 12+.
- Node.js 20 или новее (официальный установщик с https://nodejs.org) и git (`xcode-select --install`).
- Около 2 ГБ свободного места.

## Шаги

```bash
git clone https://github.com/moonkattymky/moonkatty-ai-studio.git
cd moonkatty-ai-studio
git checkout feat/macos-app
git log -1            # сравните хеш коммита с тем, что указан в описании релиза
# по желанию: просмотрите изменения (git diff backup-pre-macos-app..HEAD), особенно desktop/, server.js, runner.js, lib/
./scripts/build-mac.sh
```

Скрипт:
1. ставит зависимости строго по `package-lock.json` (`npm ci --ignore-scripts`, без install-скриптов пакетов);
2. скачивает официальный Node 24.22.0 для darwin-arm64 и сверяет SHA-256 с `SHASUMS256.txt` с nodejs.org;
3. записывает коммит и время сборки (`SOURCE_DATE_EPOCH` = время коммита) в приложение — видно в «О программе»;
4. собирает `.app` (Electron 44.9.1, electron-builder 26.15.3 — точные версии), подписывает ad-hoc (`codesign -s -`), проверяет подпись;
5. создаёт `.zip` и `.dmg`, файлы `.sha256`, `SHA256SUMS.txt`, SBOM `sbom.cdx.json` (CycloneDX) и `BUILD-INFO.txt` со списком fuses.

Результат: `dist/mac-arm64/MOONKATTY AI STUDIO.app` — перетащите в «Программы».

## Воспроизводимость

- Версии зависимостей закреплены в `package-lock.json`; Electron и electron-builder — точные версии в `package.json`.
- Время файлов внутри zip-архива (сборка на Linux) выставляется в `SOURCE_DATE_EPOCH`, порядок файлов отсортирован.
- Полной побитовой воспроизводимости нет: electron-builder и подпись могут добавлять отличия; сравнивайте `MANIFEST.sha256` (хеши каждого файла) и коммит.

## Сборка на Linux (так собран релиз 1.1.1)

`scripts/package-mac-on-linux.sh` — нужен `rcodesign` (ad-hoc подпись). Делает .zip (без .dmg — на Linux его не собрать), `MANIFEST.sha256`, SBOM, `BUILD-INFO.txt`.

## GitHub Actions

`deploy/build-mac.yml.example` — сборка на `macos-14` (arm64), действия закреплены по SHA, права: `contents: read`, у задачи релиза — `contents: write`. Чтобы включить, файл нужно положить в `.github/workflows/`: через веб-интерфейс GitHub или токеном fine-grained только для этого репозитория с правами **Contents: Read and write** и **Workflows: Read and write**.
