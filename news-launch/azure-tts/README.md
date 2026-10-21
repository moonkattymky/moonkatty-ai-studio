# Azure Speech candidate (not enabled)

`en-US-AndrewMultilingualNeural` is the main candidate. It is not the locked master voice. `media-automation/config/master-voice.json` stays on Kokoro `am_michael` with status `candidate`. Nothing in this folder creates an Azure account, stores a key, or calls Azure.

Standard (S0) is prepared with a **$1.00** monthly budget. Paid calls stay off until `paidEnabled` is true and an owner approval record (`at` and `by`) is present. A key in the Keychain is not enough.

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

F0 counts characters. S0 counts US dollars. Both are local guards, keyed by the UTC calendar month (`YYYY-MM`). The state file defaults to `news-launch/azure-tts/state/usage.json` (gitignored). A new month starts at zero. The write is a temp file plus rename, mode `0600`. A sibling `.lock` file is created with `O_EXCL` so two processes cannot reserve the same month together. A lock older than 30 seconds is treated as stale. A fresh lock held by another process fails the call (`Azure Speech budget lock is held`). A corrupt state file fails with a fixed message and does not echo the file.

Billable length is the JavaScript length of the **SSML payload** (UTF-16 code units), computed **before** each HTTP attempt. The pricing FAQ points at a character definition that was not on the pricing page fetched for `RESEARCH.md`. The Audio Content Creation tool's "tags excluded" figure is a limit of that tool, not a statement of the REST meter. The quotas page says lexicon elements inside SSML count as billable characters. Until a definition says tags are free, the guard counts the whole payload.

| Config | Behavior |
| --- | --- |
| `tier: "F0"` (required; there is no silent default) | Cap is `limitChars`, or 500000 when `limitChars` is omitted. A value above 500000 is refused. |
| Use reaches 70% or 90% of the F0 cap, or of `monthlyBudgetUsd` on S0 | The result's `warnings` lists each threshold that call crossed. |
| The next attempt would pass 100% | Hard block. Nothing is sent. Landing on exactly 100% is allowed. |
| `tier: "S0"` without both `paidEnabled: true` and `paidApproval` (`at` ISO timestamp, `by` non-empty) | Refused. Nothing is sent, and the key is not read. |
| `monthlyBudgetUsd` omitted on an approved S0 config | **1.00**. |
| `pricePerMillionChars` omitted | **15.00** for a standard neural voice, **22.00** when the voice id contains `DragonHD`, `MAI-Voice`, or `:Dragon`. Both numbers are owner-editable. |
| `tier` missing, `S1`, or anything else | Refused. The retail neural meter is labeled S1; the quotas page calls the paid tier S0. An unrecognized label does not run. |
| Voice id contains `DragonHD`, `MAI-Voice`, or `:Dragon` on F0 | Refused. F0's published allowance is labeled Neural, not Neural HD. |

`allowPaid: true` on F0 is refused. It is not the S0 switch. S0 uses `paidEnabled` and `paidApproval`.

The dollar defaults are Retail Prices API list prices queried **21 October 2026** (`https://prices.azure.com/api/retail/prices`): meter "S1 Neural Text To Speech Characters" at $15 per 1M, and "Neural HD Text to Speech Characters" at $22 per 1M. The quotas page calls the paid tier Standard (S0). Whether a portal S0 resource bills the retail meter named S1 is not stated. See `RESEARCH.md`. The example pins `pricePerMillionChars` at 15 for this non-HD candidate. If the voice id changes to HD, change that number or remove it so the $22 default applies.

Cost is integer micro-dollars, rounded up, from `characters * price / 1,000,000`. The attempt is blocked when spent plus this attempt would go **over** the budget. Every HTTP attempt counts, including retries and failed or timed-out attempts that may still have been billed. Nothing is refunded. The default retry limit is 2 (`maxAttempts`). The client sends `X-Client-Request-Id` from a hash of the text, voice, rate, and SSML. A successful response is cached under that hash. The same text, voice, and SSML parameters are served from the cache at **$0**, with no HTTP call and no key read. A second live process that already holds the same hash does not send another request and is not charged.

Each month has `ledger-YYYY-MM.jsonl`: timestamp, characters, estimated cost, status (`reserved`, `ok`, `failed`, `timeout`, `blocked`, `cache`), request id, and attempt. The line has no script and no key. A line that would contain the key is not written.

`UsdBudget.reconcile({ actualUsd, by, at, note })` records an owner-entered Azure usage figure. If that figure is higher than the local total, the guard rises to it. A lower figure does not lower the guard. Put the usage number in `actualUsd`. Do not paste the script or the key into `note`.

## Fallback and disclosure

`VoiceSession` is the episode path. If Azure is disabled, has no key, is over budget, is not approved, or the request errors, it calls the configured local engine. The default is Kokoro `am_michael`. Chatterbox is optional: pass a local engine whose `name` is the Chatterbox id. Chatterbox is not bundled here. The episode record stores `engine`. A render that did not use Azure is stored as `voice: "fallback"` and `review: "owner-review"`. The raw Azure error is not copied into that file. `MasterVoice.createTTS()` still throws when Azure is disabled, so the Kokoro candidate is not swapped underneath the news renderer.

When Azure does speak the episode, the description is the summary plus this line:

`Voice: AI-generated (Microsoft Azure)`

`showCaption: true` repeats that line for an on-screen caption. `dryRunAzureEpisode` puts the description on the YouTube dry-run payload. Kokoro hold-for-approval files are not stamped with this line.

## Owner setup, later

Do not do this until you have decided to create the resource. This repository does not do it, and it does not turn paid calls on.

1. Do not create a Speech resource until you have decided to pay. The code is prepared for Standard (S0) with a $1.00 monthly budget and still refuses every call until you set `paidEnabled` and `paidApproval` yourself.
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

5. Leave `enabled` false and leave `paidEnabled` false. A later experiment would use a **copy** of the voice config. Do not lock MasterVoice. Even with `enabled: true`, tier `S0`, a region, a voice, and a Keychain key, calls stay refused until `paidEnabled` is true and `paidApproval` is `{ "at": "<ISO timestamp>", "by": "<name>" }`.

`candidate.example.json` shows that shape with the switches off. It is not loaded. No sample key is stored in this repo.
