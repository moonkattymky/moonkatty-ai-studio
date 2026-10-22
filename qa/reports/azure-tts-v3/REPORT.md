# Azure Speech S0 re-audit

Read-only on `feat/news-launch-integration` @ `cbc9c7030bb9fb64f36010d0d080a97e7f50ab82` (`Close the remaining Azure Speech audit gaps without turning paid calls on.`). Diff against `148ff2b`, the commit in `qa/reports/azure-tts-v2/REPORT.md`: 17 files, +697/−85. The product tree was not modified. Every HTTP call went to a mock. No Azure request was sent. The only speech key used was a fake string, and it is absent from `logs/attack.json`.

Shipped `media-automation/config/master-voice.json` is still Kokoro `am_michael`, status `candidate`. The diff does not touch that file. `news-launch/src/factory-render.js` now loads `state/owner.json` and still refuses any voice other than `am_michael`.

## Verdict

**(a) Store a key and use F0 for internal tests: yes, with conditions.**

**(b) Enable S0 with a $1 ceiling after owner approval: yes, with conditions.** A budget above $1 without an owner-signed grant sends nothing, including a hand-written mode `0600` price file. `setCandidate` cannot set `stateFile` or `keyService`. A signature at the 31-day mark is refused, a serial at or below the watermark sends nothing, `readKey` refuses the owner item and does not spawn, and `store-owner` puts `-T ""` on stdin. `factory-render.js` and `media-automation/bin/master-voice.js` load the public key from `state/owner.json`.

The same OS user can still replace that file. A self-signed `owner.json` became the approval key and the mock was called (`QA-AZR-009`, medium). Deleting both local counter files, rewriting the ledger, or hand-editing `stateFile` resets the local counter (`QA-AZR-010`, low). The Azure portal spending limit of $1 is the invoice cap. This repository cannot set it.

`QA-AZR-007` and `QA-AZR-008` are verified for the fixes that were claimed. `QA-AZR-006` stays open at low and does not block (a) or (b). `QA-AZR-009` is the open condition on the approval file. None are owner-approved.

Real publishing and real social accounts stay forbidden. macOS Keychain ACL, `launchd`, and a live Speech resource were not run.

### Conditions for (a)

- The Speech resource is Free. `MasterVoice.createTTS()` does not pass `skuProbe`. The request has no tier field. A config label of F0 is a label.
- Leave the shipped MasterVoice file on Kokoro.
- Store the speech key with `node news-launch/azure-tts/keychain-cli.js store` or `bin/store-key.sh`. The store argv is `security -i`. The secret is stdin. The provider does not read `AZURE_SPEECH_KEY`.
- F0 calls are real network calls. They are reserved on the USD guard at $15 per million SSML characters, about 66,666 characters per dollar. `synthesize('hello')` reserved 2670 micro-dollars and called the mock once.
- Keep `price.json` absent, or at $1 with no grant. Deleting both `usage.json` and the ledger resets the local counter. On a real F0 resource that reset does not create an invoice.

### What has to be true before (b)

- The Azure subscription or the Speech resource has its own spending limit of $1, set in the portal before any key is stored. This process cannot set it. `QA-AZR-010` is the local reason. With that limit in place, the delete-both reset is low.
- `news-launch/azure-tts/state/owner.json` is the owner's file, mode `0600`, and the episode agent cannot replace it. The signature, the 31-day expiry, and the serial watermark hold against the file that is loaded. A same-user rewrite of that file installs a new public key (`QA-AZR-009`). Deleting the file removes the public key, and S0 then fails closed. Unsigned JSON and mode `0644` throw.
- Treat a signature as standing for that voice and region until it expires or the watermark moves past its serial. A budget grant above $1 is a separate owner signature. It expires 31 days after `at`. It has no serial. A grant 10 days old still verified.
- `price.json`, when present, is mode `0600` and `monthlyBudgetUsd` is 1 unless `budgetGrant` verifies under the public key in `owner.json`.
- `store-owner` sends `-T ""` on stdin. The macOS effect of that flag was not run on this Linux host.
- `factory-render.js` still requires `am_michael`, so that launch path stays on Kokoro. `media-automation/bin/master-voice.js` loads the same owner file and can construct an Azure voice when the voice JSON says so.
- Descriptions stay inside the dry-run slice. That disclosure fix was verified at `148ff2b` and this diff does not touch it.

## What held

Their file `news-launch/test/azure-speech.test.js`: **35 pass, 0 fail**, 2393 ms (`logs/their-tests.log`). The file has 35 tests and 429 `assert` calls. It is not a 154-test run.

Independent probes: **46 observations, 0 probe errors** (`logs/attack.json`). Eight of those observations are the residuals named below. The rest are the controls that held.

- `writeOwnerPrice` and `UsdBudget` with `monthlyBudgetUsd: 1000` and no grant throw `ceiling of 1.00`. A mode `0600` price file written by hand with that budget made `readOwnerPrice` and `synthesize` throw the same way, with zero mock calls.
- An owner-signed grant for $1000 wrote the price file and a reserve of 100,000 characters finished at 1,500,000 micro-dollars. A grant from another Ed25519 key was refused. A grant dated 32 days earlier does not verify. A budget of $1 needs no grant.
- Deleting `usage.json` while the ledger remains refuses, and the message is `missing but the ledger exists`.
- `setCandidate({ stateFile })` and `setCandidate({ keyService })` throw `owner-only` and leave the voice file byte-for-byte unchanged. Both names are in `OWNER_ONLY_FIELDS`.
- Eight processes each reserving 26,667 characters ($0.400005) ended at 2 successes and `spentMicro` 800010.
- A serial above the watermark verifies. A serial equal to the watermark does not. Replaying that equal serial with `paidEnabled: true` threw `S0 calls are refused` with zero key reads and zero mock calls. A signature dated exactly 31 days earlier is refused, and one millisecond inside that window verifies. A signature more than five minutes ahead is refused. Swapping the voice or the region returns false.
- `writeOwnerConfig` refuses a lower serial with `cannot move backwards`. An unsigned `owner.json` throws `does not verify`. Mode `0644` throws `owner-only`. A missing file returns a null public key and serial 0.
- `readKey` on service `MOONKATTY AI STUDIO.azure-speech-owner` and account `azure-speech-owner` rejects with `Azure Speech owner key is not readable by this process.` and the spawn function was not called. A provider constructed with that service and account does the same, with zero mock calls. `provider.js` does not contain that service name.
- `store-owner` argv is `-i`. Stdin contains ` -T ""`, the owner service, and the owner account. The PKCS#8 material was not an argument and was not in the success line.
- `factory-render.js` and `media-automation/bin/master-voice.js` both call `loadOwnerConfig` and pass `approvalPublicKeyPem: owner.publicKeyPem`.
- A cache file sealed with the speech key, plus a ledger `ok` mac under that same key, is a miss and then one mock call. `cacheMac` under the cache key differs from `cacheMac` under the speech key. The cache key file path ends in `state/cache-mac.key`. A file sealed with the cache key and a ledger `ok` mac under that key is a hit: zero mock calls, the audio bytes were `RIFF-FAKE`, `ledgerRequestId` equals the request id, and `VoiceSession` stored `final: true` with the Azure voice id. A valid cache MAC with no ledger mac is a miss. A stub hit whose `ledgerRequestId` is null stores `final: false` even when the caller passed `final: true`. A cache key file at mode `0644` throws `owner-only` before the mock.
- `reconcile` with the fake key in `note` throws `note was refused` and the usage file bytes are unchanged. A one-dot split that still contains a 12-character run of the refused class is refused the same way. The note `invoice checked` is stored.
- A preview with no local engine, called with `final: false`, throws and stores `voice: "fallback"`, `review: "owner-review"`, and `final: false`.
- `paidEnabled: false` on S0 threw `S0 calls are refused` with zero key reads and zero mock calls.

## Findings

### Medium

**`QA-AZR-009`. A same-user `owner.json` replaces the approval public key.**

`loadOwnerConfig` verifies the signature with `publicKeyPem` from the same file. There is no external pin. `writeOwnerConfig` refuses a lower serial and signs whatever public key it is given.

- An agent generated an Ed25519 key and wrote a mode `0600` file, serial 0, signed by that key. `loadOwnerConfig` accepted it. An approval at serial 1 from that key does not verify against the owner public key. `MasterVoice` constructed with the loaded public key and `approvalMinSerial: 0`, on an S0 voice file carrying that approval, called the mock once.
- `writeOwnerConfig` at serial 2, then serial 5, left the watermark at 5, and a later call at serial 4 threw. Overwriting the file with the serial 2 bytes and `chmod 0600` made `loadOwnerConfig` return serial 2 and the owner public key. An approval at serial 3 then verified.

`readKey` cannot mint that signature. The writer of `state/owner.json` can. The portal spending limit still caps the invoice after that rewrite, because a grant verifies under the public key in the same file.

### Low

**`QA-AZR-010`. Deleting both counter files resets the local dollar guard.** Rated low because an Azure portal spending limit of $1 is the invoice cap, and this repository cannot set it. On a real F0 resource the reset does not create an invoice. The local file is a second guard.

- Delete `usage.json` and the ledger. The next `begin` of 1,000 characters starts at `spentMicro` 15000. A second `synthesize` after both files were removed called the mock again, and the new file showed one charge, 2670 micro-dollars.
- A file at 800010, rewritten to one valid reserved ledger line of $0.015 and `spentMicro` 15000, accepted another 1,000-character reserve and finished at 30000.
- `setCandidate` cannot point `stateFile` elsewhere. Writing `stateFile` into the voice JSON by hand, and also writing `keyService` to the owner service, left `createTTS().keyService` on `MOONKATTY AI STUDIO.azure-speech`. The filled file stayed at 999990. The new file showed 2670. The mock was called once. The filled total plus that hello SSML is over $1.
- Eight honest processes stayed at 800010.

**`QA-AZR-006` remains, narrowed.** A raw key in a reconciliation note is refused and the file is unchanged. A preview with no local engine is stored `final: false`. Two leftovers from the same bug:

- `VoiceSession` with a local engine whose `synthesize` throws stores `voice: "fallback"` and `final: true`, then rethrows. The caller had passed `final: false`.
- A note broken into runs shorter than 12 characters of `[A-Za-z0-9+/_=-]`, with a dot between the runs, is stored. The check refuses any single run of 12 or more. The note is sliced to 200 characters.

The 30-second lock takeover and the Han-character count from the first audit were not re-measured. The lock and the SSML length path are outside this diff's claimed fixes.

A holder of `state/cache-mac.key` can seal a cache hit. The speech key cannot. That file is mode `0600`. The same user who can read it can produce the hit that `VoiceSession` stores as final. That is the cache key doing what the HMAC is for.

## Their tests

`node --test news-launch/test/azure-speech.test.js` from a detached tree at `cbc9c70`: 35 pass, 0 fail. The suite covers the $1 ceiling, the separate cache HMAC, the ledger request-id match, and a reconciliation note that looks like a key. It does not delete both the state file and the ledger and then speak again, restore an older `owner.json`, write a self-signed `owner.json` and synthesize, hand-edit `stateFile`, or store a reconciliation note whose runs are shorter than 12.

## Owner setup checklist

1. Set an Azure spending limit of $1 on the subscription or the Speech resource before any key is stored. Do this in the portal. This repository cannot do it. The local counter is a second guard. Deleting both `usage.json` and the ledger starts it over (`QA-AZR-010`, low).
2. For internal tests, create a Free (F0) Speech resource and confirm `sku.name` in the portal. For S0, create a Standard resource and confirm the same field. `createTTS()` does not pass a `skuProbe`.
3. Store the speech key on stdin: `node news-launch/azure-tts/keychain-cli.js store` or `news-launch/azure-tts/bin/store-key.sh`. Service `MOONKATTY AI STUDIO.azure-speech`, account `azure-speech`. Do not put it in git, in a `.env` file, or on a command line.
4. Generate an Ed25519 key and store the PKCS#8 DER, base64, on stdin: `node news-launch/azure-tts/keychain-cli.js store-owner`. Service `MOONKATTY AI STUDIO.azure-speech-owner`, account `azure-speech-owner`. The command includes `-T ""`. On the Mac, confirm that item prompts or refuses `security find-generic-password -w` for the episode agent. This host did not run `security`.
5. Let the owner write `news-launch/azure-tts/state/owner.json` (mode `0600`). `factory-render.js` and `media-automation/bin/master-voice.js` already load it. Keep that file off the episode agent's write path. A self-signed replacement becomes the approval key (`QA-AZR-009`). A byte copy of an older signed file lowers the watermark. Deleting the file makes S0 fail closed. Unsigned contents and mode `0644` throw, including for a Kokoro caller that loads the file.
6. `approve <at> <by> <voice> <region> <serial>` prints the record and does not print the key. Use a serial greater than the watermark. `revoke` writes `owner.json` and will not lower the serial. A signature stands for that voice and region until expiry or until the watermark moves past it. A budget grant above $1 is a separate signature, expires in 31 days, and is not cleared by raising the approval serial.
7. Leave `media-automation/config/master-voice.json` on Kokoro. If `news-launch/azure-tts/state/price.json` exists, keep it mode `0600` and keep `monthlyBudgetUsd` at 1 unless the grant is one you just signed. The same user can overwrite a `0600` file.
8. Real publishing and real social accounts stay off.

## NOT VERIFIED

A real F0 or S0 resource, the Azure portal spending limit, the macOS effect of `-T ""`, whether `security` prompts on read, and `launchd`. No sample key was stored here.
