# Azure Speech candidate (not enabled)

`en-US-AndrewMultilingualNeural` is the main candidate. It is not the locked master voice. `media-automation/config/master-voice.json` stays on Kokoro `am_michael` with status `candidate`. Nothing in this folder creates an Azure account, stores a key, or calls Azure.

Standard (S0) is prepared with a **$1.00** monthly budget. Every synthesize, including a config that says `tier: "F0"`, draws that dollar guard. The Speech subscription key cannot read the resource sku, so a config label of F0 is not proof the resource is free. Paid S0 calls stay off until `paidEnabled` is true and an owner approval signature is present. A Keychain speech key, and a JSON object with only `at` and `by`, are not enough. The owner must also set an Azure spending limit or budget alert on the subscription. Deleting both the local state file and the ledger on the same machine still resets the local counter.

Read `RESEARCH.md` before turning this on. The Product Terms grant for commercial use of prebuilt neural output is written for **paid-tier** TTS customers. The Free (F0) 0.5 million characters are an allowance, not that grant. Microsoft also requires a disclosure that the voice is synthetic. YouTube and TikTok are not named in the Product Terms.

## What is already wired

`AzureSpeechProvider` implements the same `synthesize(text, outWav)` shape as the other engines. `MasterVoice.createTTS()` builds it only when a config file says `engine: "azure"` and `enabled: true`. The shipped master-voice file does not. `detectTTS()` does not select it.

`candidate.example.json` is an example. It is not loaded.

SSML:

- `<sub alias="moon-KAT-ee">` around `MOONKATTY` and around the lexicon form `Moon Katty`
- `<phoneme alphabet="…" ph="…">` when a pronunciation entry sets `alphabet` and `ph`
- `[pause 250]` or `[pause 250ms]` becomes `<break time="250ms"/>` when this provider sees the markup. `SpeechComposer` still turns those pauses into silence files before the engine, so either path is valid
- a numeric `rate` of `0.95` becomes `<prosody rate="95%">`

The key is read from the macOS Keychain. It is not read from the environment. Linux tests inject a mock. On Linux, a real call throws `Azure Speech Keychain is macOS-only.`

## Budget

The Speech key cannot tell Free (F0) from Standard (S0). Accounts - Get can. Fetched 21 October 2026 from [Accounts - Get](https://learn.microsoft.com/en-us/rest/api/cognitiveservices/accountmanagement/accounts/get):

`GET https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.CognitiveServices/accounts/{accountName}?api-version=2024-10-01`

The response field is `sku.name` (`F0`, `B0`, `S0`, or `P0` on that page). The call needs a Microsoft Entra token for Azure Resource Manager. This client does not make it. `skuReadRequest` only builds that URL. An injected `skuProbe` may return `F0` or `S0`. A mismatch with `tier`, or any other value, refuses the call before the TTS request. A probe that returns `F0` does not skip the dollar guard.

Every `synthesize` uses `UsdBudget`. `CharacterBudget` remains for the published F0 quota checks: `limitChars` above 500000 is refused, and an HD voice id on F0 is refused. It is not what `synthesize` increments. Config `tier: "F0"` with `paidEnabled: false` can still speak, and that call is reserved against the **$1.00** guard at the neural retail price. About 66,666 SSML characters at $15 per million is one dollar, which sits inside the 0.5 million F0 allowance and is tighter than it.

The guard is keyed by the UTC calendar month (`YYYY-MM`). The state file defaults to `news-launch/azure-tts/state/usage.json` (gitignored). The write is a temp file plus rename, mode `0600`. A sibling `.lock` file is created with `O_EXCL` so two processes cannot reserve the same month together. A lock older than 30 seconds is treated as stale. A fresh lock held by another process fails the call (`Azure Speech budget lock is held`). A corrupt state file fails with a fixed message and does not echo the file.

If `usage.json` is missing and `ledger-YYYY-MM.jsonl` has any line, the call is refused. A state file that omits `spentMicro` is refused and is not rewritten to zero. Each ledger line stores `prev`, the SHA-256 of the previous raw line (`genesis` on the first). A broken link is refused. If `spentMicro` is below the sum of `reserved` lines for that month, the call is refused. Spend above the ledger is kept, because reconciliation may raise it. A month change stashes the old month in `history` and restores it if the clock returns. A brand-new month with an empty ledger starts at zero. Deleting **both** the state file and the ledger still resets the counter. The same macOS user can also read the Keychain. Those gaps are why the Azure portal spending limit or budget alert is required. This process cannot enforce it.

Billable length is the JavaScript length of the **SSML payload** (UTF-16 code units), computed **before** each HTTP attempt. The pricing FAQ points at a character definition that was not on the pricing page fetched for `RESEARCH.md`. The Audio Content Creation tool's "tags excluded" figure is a limit of that tool, not a statement of the REST meter. The quotas page says lexicon elements inside SSML count as billable characters. Until a definition says tags are free, the guard counts the whole payload.

| Config | Behavior |
| --- | --- |
| `tier: "F0"` (required; there is no silent default) | Still reserved on the USD guard. `limitChars` above 500000 is refused. `synthesize` does not spend the 500000 character counter. |
| Use reaches 70% or 90% of `monthlyBudgetUsd` | The result's `warnings` lists each threshold that call crossed. The default budget is $1.00, including when the config says F0. |
| The next attempt would pass 100% | Hard block. Nothing is sent. Landing on exactly 100% is allowed. |
| `tier: "S0"` without `paidEnabled: true` and a signature over `at`, `by`, the voice, the region, and a serial | Refused. The signature expires 31 days after `at`. A serial at or below the owner-signed watermark is refused. Nothing is sent, and the key is not read. |
| `monthlyBudgetUsd` omitted or at most **1.00** | The ceiling is **1.00**. A price file, the voice JSON, or a provider option cannot raise it. Only an owner-signed budget grant can. |
| `pricePerMillionChars` omitted | **15.00** for a standard neural voice, **22.00** when the voice id contains `DragonHD`, `MAI-Voice`, or `:Dragon`. A number below that floor is refused. A higher number is allowed. |
| Price file mode is not `0600` | Refused. The file is `news-launch/azure-tts/state/price.json`. |
| `tier` missing, `S1`, or anything else | Refused. The retail neural meter is labeled S1; the quotas page calls the paid tier S0. An unrecognized label does not run. |
| Voice id contains `DragonHD`, `MAI-Voice`, or `:Dragon` on F0 | Refused. F0's published allowance is labeled Neural, not Neural HD. |

`allowPaid: true` on F0 is refused. It is not the S0 switch. S0 uses `paidEnabled` and a signed `paidApproval`.

`MasterVoice.setCandidate` refuses `enabled`, `paidEnabled`, `paidApproval`, `tier`, `pricePerMillionChars`, `monthlyBudgetUsd`, `priceFile`, `approvalPublicKey`, `approvalPublicKeyPem`, `skuProbe`, `stateFile`, and `keyService`. The file is not saved. `MasterVoice.createTTS()` does not copy `pricePerMillionChars`, `monthlyBudgetUsd`, or `keyService` out of the voice JSON. The speech key service stays `MOONKATTY AI STUDIO.azure-speech`. When `news-launch/azure-tts/state/price.json` exists it is the only price source, and it must be mode `0600`. A missing file uses the retail floor and $1.00. A `monthlyBudgetUsd` above 1.00 in that file is refused unless `budgetGrant` is an Ed25519 signature over the micro-dollar amount, the timestamp, and the name. That grant expires 31 days after `at`. The same user can still overwrite a `0600` file. That is another reason for the Azure budget alert.

The dollar floor is the Retail Prices API list price queried **21 October 2026** (`https://prices.azure.com/api/retail/prices`): meter "S1 Neural Text To Speech Characters" at $15 per 1M, and "Neural HD Text to Speech Characters" at $22 per 1M. The quotas page calls the paid tier Standard (S0). Whether a portal S0 resource bills the retail meter named S1 is not stated. See `RESEARCH.md`. The example pins `pricePerMillionChars` at 15 for this non-HD candidate. The provider ignores that field. If the voice id changes to HD, the floor becomes $22 unless the owner price file sets a higher number.

The approval record is an Ed25519 signature over `{"v":1,"paid":true,"at","by","voice","region","serial"}`. It is valid for 31 days from `at`. The private key is PKCS#8 DER, base64, on stdin:

```sh
node news-launch/azure-tts/keychain-cli.js store-owner
node news-launch/azure-tts/keychain-cli.js approve <at> <by> <voice> <region> <serial>
node news-launch/azure-tts/keychain-cli.js revoke <at> <by> <serial> <owner.json>
```

`store-owner` writes Keychain service `MOONKATTY AI STUDIO.azure-speech-owner`, account `azure-speech-owner`, with `-T ""` so no application is on the access list. `readKey` refuses that service and does not spawn `security`. `approve` prints the JSON record and does not print the key. `revoke` writes `news-launch/azure-tts/state/owner.json` (mode `0600`) and will not lower the serial. That file holds the public key and the watermark. A signature whose serial is less than or equal to the watermark does not verify, so turning paid off and then pasting the old record does not call Azure. Deleting the file removes the public key and S0 fails closed. `factory-render.js` and `media-automation/bin/master-voice.js` load that file and pass `approvalPublicKeyPem`. It is not a field in the voice file. `lock()` calls `createTTS()` first, so a forged approval cannot flip the voice to locked. No owner key was stored for this change, and `paidEnabled` stays false in the example.

Cost is integer micro-dollars, rounded up, from `characters * price / 1,000,000`. The attempt is blocked when spent plus this attempt would go **over** the budget. Every HTTP attempt counts, including retries and failed or timed-out attempts that may still have been billed. Nothing is refunded. The default retry limit is 2 (`maxAttempts`). The client sends `X-Client-Request-Id` from a hash of the text, voice, rate, and SSML. A successful response is cached under that hash as `{"v":1,"hash","mac","audio"}`. `mac` is HMAC-SHA256 of the hash and the audio bytes under a cache key stored in `news-launch/azure-tts/state/cache-mac.key` (mode `0600`). The speech subscription key is not that HMAC key. A hit also needs a ledger line with status `ok` whose `mac` matches the cache key and the request id. A planted file, a MAC under the speech key, or an `ok` line without that mac, is a miss and is not returned as the render. The hit costs **$0** and does not call HTTP. A cache hit is stored as `final: true` only when `ledgerRequestId` equals that request id. A second live process that already holds the same hash does not send another request and is not charged.

Each month has `ledger-YYYY-MM.jsonl`: `prev`, timestamp, characters, estimated cost, status (`reserved`, `ok`, `failed`, `timeout`, `blocked`, `cache`), request id, and attempt. The line has no script and no key. A line that would contain the key is not written. `blocked` lines are not added to the ledger spend.

`UsdBudget.reconcile({ actualUsd, by, at, note })` records an owner-entered Azure usage figure. If that figure is higher than the local total, the guard rises to it. A lower figure does not lower the guard. Put the usage number in `actualUsd`. A note that contains a key-like token is refused and the state file is left unchanged.

## Fallback and disclosure

`VoiceSession` is the episode path. If Azure is disabled, has no key, is over budget, is not approved, or the request errors, it calls the configured local engine. The default is Kokoro `am_michael`. Chatterbox is optional: pass a local engine whose `name` is the Chatterbox id. Chatterbox is not bundled here. The episode record stores `engine`. A render that did not use Azure is stored as `voice: "fallback"` and `review: "owner-review"`. A preview with no local engine is stored with `final: false`. The raw Azure error is not copied into that file. `MasterVoice.createTTS()` still throws when Azure is disabled, so the Kokoro candidate is not swapped underneath the news renderer.

When Azure does speak the episode, the description is the summary plus this line:

`Voice: AI-generated (Microsoft Azure)`

`fitDescription` appends that line after the summary is cut to the platform limit (5000 characters for the YouTube dry-run). The disclosure is not the part that gets dropped. `showCaption: true` repeats that line for an on-screen caption. `dryRunAzureEpisode` puts the description on the YouTube dry-run payload. Kokoro hold-for-approval files are not stamped with this line.

## Owner setup, later

Do not do this until you have decided to create the resource. This repository does not do it, and it does not turn paid calls on.

1. Do not create a Speech resource until you have decided to pay. Before any key is stored, set an Azure spending limit or budget alert on the subscription. The local $1.00 figure is a second guard. It cannot see the portal sku, and it cannot stop someone who deletes both `usage.json` and the ledger. The code still refuses S0 until `paidEnabled` is true and `approve` has produced a signature the public key accepts. Owner setup was not performed here.
2. Region. Israel Central is an Azure region and is not a Speech region in the Speech regions table. For this non-HD voice, UAE North (`uaenorth`) is on the neural text-to-speech table and on the REST host list. Qatar Central is also on the neural table. Neither shows HD voices checked. If you later switch the voice id to a Dragon HD Andrew voice, use a region whose HD column is checked, such as West Europe (`westeurope`). No latency number is claimed. Details are in `RESEARCH.md`.
3. Copy the resource key once from the portal. Do not put it in git, in a `.env` file, in chat, or on a command line.
4. On the Mac, store it through stdin. The script runs `security -i` and sends `add-generic-password` on standard input, so the key is not an argument:

   ```sh
   node news-launch/azure-tts/keychain-cli.js store
   ```

   Paste the key and end the input (Ctrl-D). Or:

   ```sh
   news-launch/azure-tts/bin/store-key.sh
   ```

   The Keychain service is `MOONKATTY AI STUDIO.azure-speech`, account `azure-speech`. The test service is `MOONKATTY AI STUDIO.azure-speech-test` (`node news-launch/azure-tts/keychain-cli.js store-test`). Do not put the production key in the test service. Keys that contain a newline, a quote, or a backslash are rejected so they cannot break the Keychain command. The provider never reads `AZURE_SPEECH_KEY` from the environment.

5. Leave `enabled` false and leave `paidEnabled` false. A later experiment would use a **copy** of the voice config. Do not lock MasterVoice. `setCandidate` cannot turn those switches on. Even with `enabled: true`, tier `S0`, a region, a voice, and a Keychain speech key, calls stay refused until `paidEnabled` is true and `paidApproval` is the signed record from `approve`. Pass the matching public key into `MasterVoice` from outside the voice file. A hand-written `{ "at", "by" }` does not unlock S0. A config that says F0 still draws the $1.00 guard.

`candidate.example.json` shows that shape with the switches off. It is not loaded. No sample key is stored in this repo.
