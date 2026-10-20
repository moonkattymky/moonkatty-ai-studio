# Подпись и нотаризация (Apple) — что даёт и как сделать

## Почему сейчас macOS блокирует приложение

Релизы `*-mac-preview` подписаны только **ad-hoc** (без сертификата) и **не нотаризованы**. Gatekeeper блокирует такие загруженные из интернета приложения — это правильное поведение. Ad-hoc подпись лишь фиксирует содержимое, но не подтверждает автора.

## Подписанная и нотаризованная сборка

Нужно:
1. **Apple Developer Program** — 99 USD в год (в местной валюте может отличаться; источник: https://developer.apple.com/programs/enroll/ и https://developer.apple.com/help/account/membership/program-enrollment/, проверено 20.10.2026). Ничего не куплено.
2. Сертификат **Developer ID Application** (Certificates, Identifiers & Profiles → «+» → Developer ID Application), экспорт в `.p12`.
3. **Hardened Runtime** + entitlements. Для Electron обычно нужны:
   - `com.apple.security.cs.allow-jit`
   - `com.apple.security.cs.allow-unsigned-executable-memory` (если требуется версией Electron)
   Для встроенного Node (`Resources/node/node`) — те же JIT-права. Ничего лишнего (без `disable-library-validation`, если не требуется).
4. **Нотаризация** через `notarytool` (Xcode 13+): App Store Connect API key (рекомендуется) или Apple ID + app-specific password.
5. **Stapling**: `xcrun stapler staple "MOONKATTY AI STUDIO.app"` (и .dmg) — чтобы проверка работала офлайн.

Пример локально:
```bash
export CSC_LINK=/path/DeveloperID.p12 CSC_KEY_PASSWORD=…
# в package.json → build.mac: "hardenedRuntime": true, "entitlements": "build/entitlements.mac.plist", "notarize": true
export APPLE_API_KEY=/path/AuthKey_XXXX.p8 APPLE_API_KEY_ID=XXXX APPLE_API_ISSUER=…
npx electron-builder --mac zip dmg --arm64
spctl --assess --type execute --verbose "dist/mac-arm64/MOONKATTY AI STUDIO.app"   # должно быть: accepted, source=Notarized Developer ID
```

В GitHub Actions: те же значения как **секреты репозитория** (`CSC_LINK` в base64, `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (содержимое .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) — только в задаче сборки, только на защищённых тегах; не печатать в журнал.

После этого: приложение открывается без «Всё равно открыть», и становится возможным безопасное автообновление (проверка подписи обновления).

## Как безопасно проверить приложение без Developer ID

От наиболее к наименее безопасному:

1. **Собрать самостоятельно на Mac** после просмотра кода (`docs/BUILD_MAC.md`). Локально собранное приложение не помещается в карантин. Это рекомендуемый путь.
2. **Запустить в виртуальной машине macOS** на Apple Silicon (UTM — https://mac.getutm.app, или Tart — https://tart.run) — изолированно от ваших данных и Keychain.
3. **Отдельная стандартная (не администратор) учётная запись macOS** для теста.
4. Только для загруженного релиза и только после сверки контрольной суммы:
   ```bash
   shasum -a 256 ~/Downloads/MOONKATTY-AI-STUDIO-1.1.1-arm64-mac.zip   # сравнить с .sha256 и BUILD-INFO.txt в релизе
   ```
   затем разрешить **именно это приложение**: Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть» (штатный механизм Apple для одного приложения).

Не рекомендуется: отключать Gatekeeper глобально (`spctl --master-disable`) и снимать атрибут карантина (`xattr -d com.apple.quarantine`/`xattr -cr`) — это отключает проверки, а не решает проблему доверия.
