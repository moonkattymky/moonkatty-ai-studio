# Azure Speech S0 re-audit

Read-only on `feat/news-launch-integration` @ `148ff2b203829e2d62afabcac80fa2481f24470f` (`Close the Azure Speech audit gaps without turning paid calls on.`). Diff against `baf8cff`, the commit in `qa/reports/azure-tts/REPORT.md`. The product tree was not modified. Every HTTP call went to a mock. No Azure request was sent. The only speech key used was a fake string.

Shipped `media-automation/config/master-voice.json` is still Kokoro `am_michael`, status `candidate`. `candidate.example.json` still has `enabled: false`, `paidEnabled: false`, and `paidApproval: null`. It is not loaded. `news-launch/src/factory-render.js` still constructs `MasterVoice` with no public key and refuses any voice other than `am_michael`.

## Verdict

**(a) Store a key and use F0 for internal tests: yes, with conditions.**

**(b) Enable S0 and treat the local $1 figure as a hard block after owner approval: no.** The signature and the ledger close the bypasses from `baf8cff`. The same user can still reset or raise the local cap (`QA-AZR-007`). The same user can still sign if they can read the owner Keychain item (`QA-AZR-008`). Turning S0 on is safe for cost after the Azure spending limit in the checklist is in place, and safe as an approval gate after that signing key is unreadable by the episode agent. This repository does not set either control.

Blocking for a local-only hard block: `QA-AZR-007`, `QA-AZR-008`. `QA-AZR-001` through `QA-AZR-005` are verified for the fixes that were claimed. `QA-AZR-006` stays open. None are owner-approved.

Real publishing and real social accounts stay forbidden. macOS Keychain ACL, `launchd`, and a live Speech resource were not run.

### Conditions for (a)

- The Speech resource is Free. `MasterVoice.createTTS()` does not pass `skuProbe`. The request still has no tier field. An injected probe that returns `S0` or `B0` refuses before the key and the mock. A config label of F0 with no probe still called the mock.
- Leave the shipped MasterVoice file on Kokoro. `setCandidate` refuses `enabled`, `paidEnabled`, `paidApproval`, `tier`, and the price fields, and it does not save.
- Store the speech key with `node news-launch/azure-tts/keychain-cli.js store` or `bin/store-key.sh`. The store argv is `security -i`. The secret is stdin. The provider does not read `AZURE_SPEECH_KEY`.
- F0 calls are real network calls. They are reserved on the USD guard at $15 per million SSML characters, about 66,666 characters per dollar. `limitChars: 100` still sent a 178-character SSML document. `synthesize` does not increment `CharacterBudget`.
- Deleting `usage.json` while the ledger remains refuses the call. Deleting both, retargeting `stateFile`, or rewriting the ledger resets the local counter (`QA-AZR-007`). On a real F0 resource that resets a local counter. It does not create an invoice. Keep `price.json` absent, or at $1, so the local guard stays at one dollar.

### What has to be true before (b)

- The Azure subscription or the Speech resource has its own spending limit of $1, set before any key is stored. This process cannot set it. `QA-AZR-007` is the reason.
- The owner signing key is in Keychain service `MOONKATTY AI STUDIO.azure-speech-owner`, account `azure-speech-owner`, and the episode agent cannot read that item. `store-owner` writes it with `add-generic-password` and no access-control flag. `readKey` on that service returned material that produced a verifying signature (`QA-AZR-008`). This host is Linux, so the macOS prompt was not run.
- The public key is passed to `new MasterVoice({ approvalPublicKeyPem })`. A public key written into the voice file is ignored. `factory-render.js` and `media-automation/bin/master-voice.js` pass none, so those paths refuse S0.
- `paidApproval` is the Ed25519 signature from `approve` for that voice and region. Treat it as standing. A signature dated `2020-01-01` still verified, and writing `paidEnabled: true` plus that record reached the mock after `paidEnabled` had been set false.
- `price.json`, when present, is mode `0600` and `monthlyBudgetUsd` is 1. The floor is $15 neural and $22 HD. The file can legally store a budget of $1000.
- Descriptions stay inside the dry-run slice. A 5,000-character summary kept `Voice: AI-generated (Microsoft Azure)` and the payload length was 5,000.

## What held

Their file `news-launch/test/azure-speech.test.js`: **31 pass, 0 fail**, 2360 ms (`logs/their-tests.log`). The file has 31 tests and 362 `assert` calls. It is not a 150-test run.

Independent probes: **67 observations, 0 probe errors** (`logs/attack.json`). Fifteen of those observations are the residuals named below. The rest are the controls that held.

- `paidEnabled: false` on S0 threw `S0 calls are refused` before the sku probe, before the key, and before the mock.
- Tier F0 with `paidEnabled: false` reserved `spentMicro` for the SSML length at $15 per million and called the mock once. The URL was `https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1`. The body did not contain `F0` or `S0`.
- An injected sku probe of `S0` against tier F0, and a probe of `B0`, refused with zero mock calls. A matching `F0` probe is what their suite already charges.
- NaN, Infinity, negative, zero, `0.0000004`, and `14.99` are refused. HD at $15 is refused. A price file at mode `0644` sends nothing. `writeOwnerPrice` creates mode `0600`.
- A voice JSON `pricePerMillionChars` of `0.0000004` and `monthlyBudgetUsd` of 1000 are ignored by `createTTS`. The resolved price was 15 and the budget was 1 while `state/price.json` was absent.
- Deleting `usage.json` while `ledger-2026-10.jsonl` remains refuses, and the file is not recreated. `spentMicro` below the reserved sum refuses. Truncated JSON, a negative `spentMicro`, and a ledger line whose `prev` is not the prior hash refuse.
- A January reserve, a February reserve, and a return to January restored the January total from `history`.
- Eight processes each reserving 26,667 characters ($0.400005) ended at 2 successes and `spentMicro` 800010.
- `setCandidate` of `enabled`, `paidEnabled`, `paidApproval`, `tier`, and `pricePerMillionChars` throws `owner-only` and leaves the file unchanged. Flags sitting on the prototype are not copied. An unsigned `{ at, by }` does not verify. A signature from another Ed25519 key sends nothing. `setCandidate({ region: 'westeurope' })` against a signature for `uaenorth` fails closed.
- `provider.js` does not contain `MOONKATTY AI STUDIO.azure-speech-owner`.
- A planted cache file is a miss. A file sealed with the speech key and no ledger `ok` line is a miss. A MAC under a different key is a miss. The sealed file does not contain the speech key. The MAC matches `cacheMac(speechKey, hash, audio)`.
- A 5,000-character dry-run description ends with `Voice: AI-generated (Microsoft Azure)`, length 5,000, status `dry_run`. `globalThis.fetch` was not called. A one-line summary keeps the sentence.
- An HTTP 401 body that contained the fake key was redacted in the thrown error. The ledger and `usage.json` from that call did not contain it. `store-owner` argv was `-i`.

## Findings

### Medium

**`QA-AZR-007`. The local dollar cap still moves when the same user rewrites the state.**

The ledger hash chain is real. Each line stores `prev`, the SHA-256 of the previous raw line, and `UsdBudget` refuses when `usage.json` is missing while any ledger line exists, when `spentMicro` is below the sum of `reserved` lines, or when a link does not match. `usage.json` itself has no hash. Measured:

- Delete `usage.json` and the ledger. The next `begin` starts at the new charge (`spentMicro` 15000 for 1,000 characters). A second `synthesize` after both files were removed called the mock again and the new file showed one charge, 2670 micro-dollars, which is the cost of that one SSML document.
- Replace the ledger with one valid line (`prev: "genesis"`, `estCostUsd: "0.015000"`) and set `spentMicro` to 15000. A file that had been at 800010 then accepted another reserve and finished at 30000.
- `setCandidate({ stateFile })` is allowed. `stateFile` and `keyService` are not in `OWNER_ONLY_FIELDS`. After a state file sat at 999990 micro-dollars, pointing `stateFile` at a new directory called the mock once and the new file showed 2670. The filled file stayed at 999990.
- `writeOwnerPrice` accepts `monthlyBudgetUsd: 1000` and writes mode `0600`. A reserve of 100,000 characters then succeeded at 1,500,000 micro-dollars.

Honest processes stay inside the budget they were given. The Azure portal spending limit is the control that still applies after these writes. This process cannot create that limit.

**`QA-AZR-008`. The owner signature does not expire, and the signing key is a same-user Keychain item.**

`verifyApproval` checks an Ed25519 signature over `{"v":1,"paid":true,"at","by","voice","region"}`. The provider verifies with `approvalPublicKeyPem` from the `MasterVoice` constructor. It does not read service `MOONKATTY AI STUDIO.azure-speech-owner` on the default path.

- A signature with `at: "2020-01-01T00:00:00Z"` verifies. Pasting it into the voice file with `paidEnabled: true` called the mock. Setting `paidEnabled` false refused. Writing `paidEnabled: true` and the same record again called the mock again. There is no expiry and no generation counter.
- Swapping voice or region in the verified message returns false.
- `readKey({ service: OWNER_SERVICE, account: OWNER_ACCOUNT })` with a mock `security` returned the PKCS#8 material, and `signApproval` of that material verified against the owner public key. The argv was `find-generic-password -s <owner service> -a <owner account> -w`. The secret was not an argument.
- `store-owner` writes that item on stdin. The command has no `-T` access list.
- `setCandidate({ keyService: OWNER_SERVICE })` made `createTTS()` call `security` on the owner service with account `azure-speech` (the speech account). That lookup does not ask for account `azure-speech-owner`. A provider constructed with both the owner service and the owner account does ask for that item. `MasterVoice.createTTS()` does not pass `account`.

An agent that cannot read the owner item cannot mint a signature. An agent that can read it can. The voice-file write path can replay a signature it has already seen without reading the key.

### Low

**`QA-AZR-006` remains.** `UsdBudget.reconcile({ note })` still copies the note into `usage.json` with no redaction. A note that contained the fake key stayed there until the temp file was removed. `VoiceSession` with no local engine, called with `final: false`, stored `voice: "fallback"`, `review: "owner-review"`, and `final: true`.

**Cache authenticity is the speech key.** The HMAC key is the speech subscription key, the same secret `getKey` reads from Keychain service `MOONKATTY AI STUDIO.azure-speech`, account `azure-speech`. A planted file and a valid MAC with no ledger `ok` line are misses (`QA-AZR-004`). Sealing `RIFF-FAKE` with that key and appending an unsigned ledger line `status: "ok"` for the request id returned `cached: true`, made zero mock calls, and `VoiceSession` stored the Azure voice id with `final: true` and `review: null`. The ledger `ok` line is not signed. A process that does not have the speech key cannot produce that hit.

`withFileLock` still deletes a lock whose mtime is older than 30 seconds. That race was not re-timed. The eight-process reserve stayed at 800010 micro-dollars.

## Their tests

`node --test news-launch/test/azure-speech.test.js` from a detached tree at `148ff2b`: 31 pass, 0 fail. The suite covers the USD charge on F0, the sku mismatch refusal, the unsigned approval, `setCandidate`, the price floor, mode `0600`, the planted cache, the long dry-run disclosure, and the ledger chain. It does not delete both the state file and the ledger and then speak again, retarget `stateFile`, raise `monthlyBudgetUsd` above 1, replay a 2020 signature, or call `readKey` on the owner service and sign with the result.

## Owner setup checklist

1. Set an Azure spending limit or budget alert of $1 on the subscription before any key is stored. Do this in the portal. This repository cannot do it.
2. For internal tests, create a Free (F0) Speech resource and confirm `sku.name` in the portal. For S0, create a Standard resource and confirm the same field. Pass a `skuProbe` only if that portal read is wired by the owner. `skuReadRequest` builds the Accounts - Get URL and does not fetch it. `createTTS()` does not pass a probe.
3. Store the speech key on stdin: `node news-launch/azure-tts/keychain-cli.js store` or `news-launch/azure-tts/bin/store-key.sh`. Service `MOONKATTY AI STUDIO.azure-speech`, account `azure-speech`. Do not put it in git, in a `.env` file, or on a command line.
4. Generate an Ed25519 key and store the PKCS#8 DER, base64, on stdin: `node news-launch/azure-tts/keychain-cli.js store-owner`. Service `MOONKATTY AI STUDIO.azure-speech-owner`, account `azure-speech-owner`. On the Mac, restrict that item so the episode agent cannot run `security find-generic-password -w` against it. This code does not set that restriction.
5. Pass the matching public key to `MasterVoice` from outside the voice file. `approve <at> <by> <voice> <region>` prints the record and does not print the key. Put that record in `paidApproval` only when S0 should run, and set `paidEnabled: true` in the same edit. Leave both off until then. A later revocation needs a new public key in the process, or a voice file the agent cannot write. `paidEnabled: false` alone does not stick against a writer who still has the old signature.
6. Leave `media-automation/config/master-voice.json` on Kokoro. Do not lock MasterVoice for these tests. If `news-launch/azure-tts/state/price.json` exists, keep it mode `0600` and keep `monthlyBudgetUsd` at 1. The same user can overwrite a `0600` file.
7. Real publishing and real social accounts stay off.

## NOT VERIFIED

A real F0 or S0 resource, the Azure portal spending limit, the macOS Keychain ACL, whether `security` prompts on read, and `launchd`. No sample key was stored here.
