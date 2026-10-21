# Azure Speech S0 audit

Read-only on `feat/news-launch-integration` @ `baf8cff403c96c17923bb6735cf6f832ad81d700`. The product tree was not modified. Every HTTP call in this audit went to a mock. No Azure request was sent. The only key used was a fake string.

Shipped `media-automation/config/master-voice.json` is Kokoro `am_michael`, status `candidate`. `candidate.example.json` has `enabled: false`, `paidEnabled: false`, and `paidApproval: null`. It is not loaded.

## Verdict

**(a) Store a key and use F0 for internal tests: yes, with conditions.**

**(b) Enable S0 and treat the local $1 figure as a hard block: no.**

Blocking for (b): `QA-AZR-001`, `QA-AZR-002`, `QA-AZR-003`. None are owner-approved.

Real publishing and real social accounts stay forbidden. A production launch stays blocked. macOS Keychain, `launchd`, and a live Speech resource were not run.

### Conditions for (a)

- Create a Free (F0) Speech resource. The client never sends a tier. `tier: "F0"` with `paidEnabled: false` still called the mock. The same request against a Standard resource would be a paid call, and the dollar cap would not run (`QA-AZR-003`).
- Leave the shipped MasterVoice file on Kokoro. Leave `enabled` false on any Azure copy the episode agent can edit. `setCandidate` plus `lock('agent')` was enough to turn on S0 and reach the mock (`QA-AZR-002`).
- Store the key with `node news-launch/azure-tts/keychain-cli.js store` or `bin/store-key.sh`. The mock `security` argv was `find-generic-password` without the secret, and the store argv was `-i` with the secret on stdin. The provider does not read `AZURE_SPEECH_KEY`. Linux without an injected key throws `Azure Speech Keychain is macOS-only.`
- Accept that F0 is a real network call, capped locally at 500000 characters, and that deleting `usage.json` resets that counter (`QA-AZR-001`). On a real F0 resource that resets the local counter, not an invoice.

### What would have to be true before (b)

- The Azure subscription or the Speech resource has its own spending limit of $1. This repository cannot set that limit, and a local writer can clear the copy it keeps.
- The voice file and `usage.json` are outside the episode agent's write set. Today `paidApproval` is `{ at, by }` in that JSON. Any non-empty `by` and a string matching `YYYY-MM-DDT` pass.
- `pricePerMillionChars` stays at 15 for this neural voice, or 22 for an HD id. A value of `0.0000004` is accepted and costs 0 micro-dollars, so the cap does not move while the mock is still called.
- `tier` is `S0` and the resource is Standard. HD voice ids on F0 are refused. Tier `S1`, a missing tier, and any other label are refused.
- Descriptions stay short enough that the dry-run slice keeps `Voice: AI-generated (Microsoft Azure)`, or that slice is fixed (`QA-AZR-005`).

## What held

Their file `news-launch/test/azure-speech.test.js`: **25 pass, 0 fail**, 2152 ms (`logs/their-tests.log`). This commit's file is 25 tests. It is not a 144-test run.

Independent probes: **38 observations, 0 probe errors** (`logs/attack.json`). The findings below are the cases that reproduced.

- `paidEnabled: false` on S0 threw `S0 calls are refused` before the key was read and before the mock. A bad timestamp was refused the same way. Zero fetches.
- NaN, Infinity, negative, zero, and a string price are refused.
- Truncated JSON, a negative `spentMicro`, and a fractional `spentMicro` are refused.
- Eight processes reserving about $0.40 each ended at 2 successes and `spentMicro` 800010, under 1000000. Two overlapping `synthesize` calls with room for one charge made one mock call and stopped at exactly 1000000 micro-dollars.
- A timeout-style retry is counted. Three attempts (two HTTP 500s, then audio) reserved three times. The ledger lines had no script and no key. The thrown HTTP error and the state files had no key. ffmpeg was not started for that failure.
- `readKey` / `storeKey` kept the secret out of argv. The store path uses `security -i` and stdin.
- A short dry-run summary kept `Voice: AI-generated (Microsoft Azure)` in `posts[0].payload.description`. The mock publisher made no live fetch.
- With a local engine, Azure failure is stored as `voice: "fallback"` and `review: "owner-review"`. Their suite covers disabled, missing key, budget block, request error, and missing approval. The disclosure line is not copied onto those Kokoro records.
- HD on F0, tier `S1`, and a missing tier throw before HTTP.

## Findings

### High

**`QA-AZR-001`. The usage file fails open when it is removed or incomplete.**

The guard is `usage.json` for the UTC month, mode `0600`, updated under `usage.json.lock` by a temp file and rename. There is no MAC or signature. Measured:

- Delete the file. The next reserve starts at the new charge.
- Omit `spentMicro`. The next reserve treats it as 0.
- Write `month: "2026-12"` while the clock is January. The current month starts over and the file is replaced.
- Reserve in January, move `now()` to February, move it back to January. The February total is gone and January can spend again.

A local agent that can unlink or rewrite that file can pass the $1 check as often as it wants. The lock does serialize honest processes. It does not authenticate the bytes.

**`QA-AZR-002`. The approval record is forgeable by whoever can write the voice file.**

`resolveCap` checks `paidEnabled === true`, `paidApproval.at` matching `^\d{4}-\d{2}-\d{2}T`, and a non-empty `paidApproval.by`. It does not check a studio session, a password, or a signature. `media-automation/bin/master-voice.js lock --by` passes that string through. On a temp copy, `setCandidate(..., 'agent')` then `lock('agent')` saved `lockedBy: "agent"` and `paidApproval.by: "agent"`. `createTTS().synthesize` then called the mock once.

The shipped file does not contain this switch. The gate holds until something writes it. The episode process and the owner are the same Mac user unless the files are separated.

**`QA-AZR-003`. The config tier and the price are not the bill.**

Request headers were `Content-Type`, `Ocp-Apim-Subscription-Key`, `User-Agent`, `X-Client-Request-Id`, and `X-Microsoft-OutputFormat`. The SSML body did not contain `F0` or `S0`. Billing follows the Speech resource the key belongs to.

`tier: "F0"` with `paidEnabled: false` called the mock. That is the intended free path. It is a paid path if the key is for Standard.

`pricePerMillionChars: 0.0000004` makes `costMicro` return 0. Two reserves of 500000 characters left `spentMicro` at 0, and `synthesize` still called the mock. The owner-editable price has no floor at the $15 or $22 retail meters.

### Medium

**`QA-AZR-004`. Cache bytes are trusted.**

The cache path is the sha256 of voice, rate, SSML, and text. A file planted at that path came back `cached: true` with zero mock calls. `VoiceSession.render(..., { final: true })` stored the Azure voice id, `final: true`, and `review: null`. A same-process re-render of audio Azure already returned is $0, which is the right cost behavior. A file the agent wrote first is not that audio.

**`QA-AZR-005`. The disclosure can be sliced off the dry-run payload.**

`withDisclosure` appends `Voice: AI-generated (Microsoft Azure)`. `dryRunAzureEpisode` then uses `description.slice(0, 5000)`. A summary of 5000 `M` characters produced a payload description of 5000 characters and the sentence was gone. `showCaption: false` also leaves `caption` unset, so the description is the only copy. A one-line summary kept the sentence, and `globalThis.fetch` was not used.

### Low

**`QA-AZR-006`.**

- A disabled provider with no local engine, called with `final: false`, stored `voice: "fallback"`, `review: "owner-review"`, and `final: true`. The fallback label is present. The preview is also marked final.
- `reconcile({ note })` writes the note into `usage.json` with no redaction. A note that contained the fake key kept it. The ledger path does refuse a line that contains the key.
- `withFileLock` deletes a lock whose mtime is older than 30 seconds. A holder sleeping inside the lock for 32 seconds lost it to a second process at 31 seconds. `begin` itself does not sleep. The eight-process reserve still stayed under $1.
- Microsoft Learn's text-to-speech pricing note (fetched 21 October 2026) counts every Unicode code point in the SSML body, excludes the `speak` and `voice` tags, and counts each Han character as two. `ssml.length` is UTF-16 units of the whole document. For `Привет MOONKATTY` the document is 220 units and 220 code points. For `你好` the two Han characters are 2 units inside a 175-unit document, so the note's Han rule is 2 billable characters above this counter. Emoji `😀` is 2 UTF-16 units and 1 code point, so the guard counts it high. English text is not under-counted relative to code points. The guard also counts failed attempts. The pricing note bills a successfully processed request, so failed attempts move the local total up, which keeps the cap on the safe side of that sentence.

## Their tests

`node --test news-launch/test/azure-speech.test.js` from a detached tree at `baf8cff`: 25 pass, 0 fail. The suite already checks the free-tier cap, the dollar warnings, retries, the ledger, the cache hit, the in-flight hash, the dry-run disclosure on a short summary, the local fallback, and the refusal when `paidEnabled` is false. It does not delete the state file, forge `paidApproval` through `setCandidate`, or set a price that rounds to zero.

## NOT VERIFIED

A real F0 or S0 resource, the macOS Keychain ACL, whether `security` prompts on read, `launchd`, and the portal spending limit. `defaultWhois` is unrelated. No sample key is in the repo, and none was stored here.
