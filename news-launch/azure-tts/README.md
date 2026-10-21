# Azure Speech candidate (not enabled)

`en-US-AndrewMultilingualNeural` is the main candidate. It is not the locked master voice. `media-automation/config/master-voice.json` stays on Kokoro `am_michael` with status `candidate`. Nothing in this folder creates an Azure account, stores a key, or calls Azure.

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

The counter is a JSON file, by default `news-launch/azure-tts/state/usage.json` (gitignored). The month is the UTC calendar month (`YYYY-MM`). Characters are the JavaScript string length of the text passed to `synthesize`, counted **before** the HTTP call. A failed call is not refunded. This is a local guard. Microsoft's billable-character definition was not on the pricing page fetched for `RESEARCH.md`, so the guard can differ from the invoice.

| Config | Behavior |
| --- | --- |
| `tier: "F0"` (required; there is no silent default) | Cap is `limitChars`, or 500000 when `limitChars` is omitted. A value above 500000 is refused. |
| Use reaches 70% or 90% of the cap on that call | The result's `warnings` lists each threshold that call crossed. |
| The next call would pass 100% | Hard block. Nothing is sent. Landing on exactly 100% is allowed. |
| `tier: "S0"` and `allowPaid` is not `true` | Refused with the paid-tier error. Nothing is sent. |
| `tier: "S0"`, `allowPaid: true`, and a positive integer `paidCapChars` | The hard cap is `paidCapChars`. This is the only way past the free quota, and only after the Azure resource itself is Standard (S0). |
| `tier` missing, `S1`, or anything else | Refused. The retail neural meter is labeled S1; the quotas page calls the paid tier S0. An unrecognized label does not run. |
| Voice id contains `DragonHD`, `MAI-Voice`, or `:Dragon` on F0 | Refused. F0's published allowance is labeled Neural, not Neural HD. HD is a separate $22/1M retail meter. See `RESEARCH.md`. |

`allowPaid: true` on F0 is refused. Paying means setting the tier to `S0` and setting a cap. The cap counts characters. It does not convert HD characters into the $15 neural meter.

## Owner setup, later

Do not do this until you have decided to create the resource. This repository does not do it.

1. In the Azure portal, create a **Speech** resource on the **Free F0** tier. Do not select Standard (S0) unless you have accepted paid use and set `allowPaid` plus `paidCapChars`.
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

   The Keychain service is `MOONKATTY AI STUDIO.azure-speech`, account `azure-speech`. The test service is `MOONKATTY AI STUDIO.azure-speech-test` (`node news-launch/azure-tts/keychain-cli.js store-test`). Do not put the production key in the test service. Keys that contain a newline, a quote, or a backslash are rejected so they cannot break the Keychain command.

5. Leave `enabled` false until a separate owner decision switches a **copy** of the voice config. Do not lock MasterVoice as part of that experiment. The news-launch renderer still expects the Kokoro `am_michael` candidate.

A later enablement config would set `engine` to `azure`, `enabled` to `true`, `tier` to `F0`, `region` to `uaenorth`, `voice` to `en-US-AndrewMultilingualNeural`, `gender` to `male`, and `allowPaid` to `false`. It still needs the Keychain item from step 4. No sample key is stored in this repo.
