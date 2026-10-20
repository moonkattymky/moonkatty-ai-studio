# Voice report — male US anchor

Checked 20 October 2026. The owner asked for one consistent adult male American English anchor: confident, professional, natural, clear. The current episode voice in the first draft, Piper `en_US-ljspeech-high`, is a female speaker. It does not fit. A default is chosen below only as a provisional render voice. It is **not locked**. This machine cannot score naturalness by ear. The owner has to listen.

Samples of one shared script, with the lexicon applied to every file including the Piper comparison, are in `news-launch/artifacts/voice-samples/`.

Written text (`sample.txt`):

> This is MOONKATTY NEWS. Nigeria's health ministry confirmed one Ebola case in Abuja on October twentieth. A woman who flew in from Uganda is in isolation. Officials list forty-four close contacts. Minister Muhammad Ali Pate issued the statement.

Spoken text is `sample-spoken.txt`. Measured durations of that same text:

| File | Duration |
| --- | --- |
| `kokoro-am_michael.wav` | 19.37 s |
| `kokoro-am_adam.wav` | 16.32 s |
| `kokoro-am_fenrir.wav` | 17.60 s |
| `piper-en_US-ljspeech-high.wav` | 18.62 s (comparison only) |

All three male samples are between 15 and 20 seconds. The corrected bulletin uses `am_michael` and runs 53.2 seconds in both aspect ratios.

## Provisional candidates — Kokoro-82M v1.0

All three ids are in the installed voice pack (`Kokoro.get_voices()` listed `am_adam`, `am_michael`, and `am_fenrir` among 54 voices).

| Voice | Role | Locked | Model licence | Dataset |
| --- | --- | --- | --- | --- |
| `am_michael` | provisional default for this render | no | Apache-2.0 | see training card below |
| `am_adam` | candidate | no | Apache-2.0 | same checkpoint |
| `am_fenrir` | candidate | no | Apache-2.0 | same checkpoint |

### Model licence

- Hugging Face card `hexgrad/Kokoro-82M`: `license: apache-2.0`. https://huggingface.co/hexgrad/Kokoro-82M
- Card text: "With Apache-licensed weights, Kokoro can be deployed anywhere from production environments to personal projects."
- Base model named on the card: `yl4579/StyleTTS2-LJSpeech`. LJ Speech is public domain (texts 1884–1964, LibriVox recordings 2016–17). https://keithito.com/LJ-Speech-Dataset/
- v1.0 released 27 January 2025. Model SHA256 on the card: `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4`.
- Offline files used here: `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx v1.0 model-files release. They are gitignored under `news-launch/models/kokoro/`. Runtime: `kokoro-onnx` 0.4.9, `lang="en-us"`, speed 1.

### Dataset licence, in the author's words

The card says Kokoro "was trained exclusively on permissive/non-copyrighted audio data and IPA phoneme labels", including public-domain audio, audio under Apache/MIT, and synthetic audio from closed TTS providers. It says no synthetic audio from open TTS models or custom voice clones was used.

The same card lists CC BY audio that was part of the v1.0 training set:

| Audio | Duration used | Licence |
| --- | --- | --- |
| Koniwa `tnc` https://github.com/koniwa/koniwa | under 1 hour | CC BY 3.0 |
| SIWIS https://datashare.ed.ac.uk/handle/10283/2353 | under 11 hours | CC BY 4.0 |

Those credits are required reading before a commercial lock. This report is not a legal opinion. The author describes generated audio as usable in commercial deployments of an Apache-licensed model. A lock still waits on the owner's ear and on whatever attribution practice the owner wants for the CC BY training audio.

### Phonemizer

Synthesis uses espeak-ng (GPL-3.0) on the machine. The binary is not committed. GPL applies to that program if it is redistributed. The wav files are the synthesized waveform, not a copy of espeak-ng. The Mac needs `brew install espeak-ng`.

## Rejected

| Id | Engine | Model card | Why it is not a candidate |
| --- | --- | --- | --- |
| `en_US-ryan-high` | Piper | https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ryan/high/MODEL_CARD | Dataset URL is Ryan Speech on Kaggle. **Licence on the card: CC BY-NC-SA 4.0.** Trained from scratch. Non-commercial. Not rendered. |
| `en_US-joe-medium` | Piper | https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/joe/medium/MODEL_CARD | Dataset URL OHF-Voice/voice-datasets, licence **CC0**. Training line: **"Finetuned from U.S. English lessac voice (medium quality)."** The Lessac checkpoint is research-only (Blizzard 2013 licence, no commercial voice-synthesis use). A CC0 fine-tune corpus does not clear that base. Not rendered. |
| `en_US-lessac-medium` | Piper | research licence | Already rejected for the first episode. Not a male commercial voice. |
| `en_US-ljspeech-high` | Piper | public domain LJ Speech, trained from scratch | **Commercial use is allowed.** Speaker is female. Kept only as `piper-en_US-ljspeech-high.wav` so the gender mismatch can be heard. Piper engine itself is MIT, release 2023.11.14-2. The Piper tarball also bundles espeak-ng. |

`news-launch/src/voices.js` marks ryan, joe, and lessac `commercialUse: false`. The bulletin path will not select them. `en_US-ljspeech-high` stays available for the old RSS command when `--tts` is omitted, and the Mac instructions say not to lock it.

## Lexicon

Applied only to the string sent to TTS. The script file and both SRT files keep normal spelling.

| Written | Spoken hint |
| --- | --- |
| Muhammad Ali Pate | Moo-hah-mud Ah-lee Pah-tay |
| Wes Streeting | Wes Street-ing |
| Houthis / Houthi | Hoo-theez / Hoo-thee |
| Typhoon | Ty-foon |
| Alberta | Al-ber-tuh |
| Abuja | Ah-boo-jah |
| Ebola | Ee-boh-lah |
| Uganda | Yoo-gan-duh |
| Saudi | Saw-dee |
| Riyadh | Ree-yahd |
| King Khalid | King Kuh-leed |
| NCDC | N C D C |
| FCT | F C T |
| A400M | A four hundred M |

These are editorial hints, not IPA from a pronunciation dictionary. **Pate** in particular may be PAH-tay or PAT-eh. The hint is PAH-tay and should be corrected if the owner knows the minister's pronunciation. The brand word MOONKATTY is left to the model.

## Verdict

Provisional default: **Kokoro `am_michael`**, `locked: false`.

`am_adam` and `am_fenrir` are the other legal male US options rendered from the same checkpoint. Piper LJ Speech is the rejected gender. Piper Ryan and Joe are rejected on licence.

The corrected MP4s use `am_michael` so there is one audible bulletin to review. Change the voice with `node news-launch/bin/render-corrected.js --voice am_adam` (or `am_fenrir`) after listening. Do not treat this choice as final.
