# Voice lab v3

Listening set only. `MasterVoice` stays `candidate` (`am_michael`, `lockedBy` null). Nothing here is published, locked, or wired into the episode render.

The owner rejected the Kokoro v2 samples as too robotic. This folder keeps Kokoro `am_michael` as the baseline and adds five other takes of the **same** script. No listener score is assigned. The notes below are measured timings plus tokens from faster-whisper.

## Machine

This VM: Intel Xeon, 4 vCPU, KVM, no GPU. `torch.cuda.is_available()` was false (`torch 2.6.0+cu124`). 15 GiB RAM, 0 swap. No Apple Silicon, so there is no MPS or MLX timing.

Real-time factor (RTF) is generation seconds divided by the finished WAV duration. Lower is faster than the audio. Words per minute use the 133 script words, including tokens the model dropped.

Loudness target is −16 LUFS, true-peak ceiling −1.5 dBTP, 48 kHz mono. WAV is two-pass `loudnorm` then PCM. MP3 is 192 kbps LAME. A makeup gain was applied when integrated loudness was more than 0.4 LU off −16. Chatterbox WAVs needed that makeup (+0.7 dB and +0.9 dB). Their true peak then measured −0.8 and −0.6 dBTP, above the −1.5 ceiling and still below 0 dBFS.

## Script

`script.txt` is 133 words, 727 characters. Every take used that string. It is labeled sample copy, states no claim about a real event, has a surprise line, a two-story transition, a short joke, and ends with `9 Lives. One Moon.`

Chatterbox `punc_norm` rewrites a colon to a comma before synthesis. The words are unchanged. No emotion tags were added, because those would make the text differ by engine.

## Reference audio

Chatterbox was prompted with `reference/osr-us-male-0030-12s.wav`: the first 12 seconds of Open Speech Repository `OSR_us_000_0030_8k.wav` (American English, row marked M, Harvard sentences), resampled to 24 kHz mono. The source bandwidth is still 8 kHz. The repository terms allow use including marketing, with attribution "Open Speech Repository". Source notes are in `reference/SOURCE.md`. No celebrity and no private recording.

## Delivered audio

| id | role | engine | gen s | RTF | duration s | WPM | pauses (n / longest s) | WAV LUFS | WAV dBTP | MP3 LUFS | MP3 dBTP | peak RAM | weights |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| kokoro-am_michael | baseline | kokoro-onnx, `am_michael`, speed 1, en-us | 13.328 | 0.275 | 48.41 | 165 | 10 / 0.52 | −16.4 | −1.5 | −16.0 | −1.1 | 1198 MB | 311 MiB ONNX + 27 MiB voices |
| edge-andrew | variant | edge-tts `en-US-AndrewMultilingualNeural`, rate +0% | 66.779 | 1.371 | 48.72 | 164 | 17 / 0.50 | −16.1 | −1.5 | −16.3 | −1.7 | not sampled | none local |
| edge-brian | variant | edge-tts `en-US-BrianNeural`, rate +0% | 31.580 | 0.642 | 49.22 | 162 | 21 / 0.67 | −16.1 | −1.5 | −16.4 | −1.7 | 39 MB client | none local |
| edge-christopher | variant | edge-tts `en-US-ChristopherNeural`, rate +0% | 17.771 | 0.308 | 57.74 | 138 | 16 / 1.03 | −16.3 | −1.5 | −16.0 | −1.1 | not sampled | none local |
| chatterbox-exag035 | variant | Chatterbox English, exaggeration 0.35, cfg 0.5, temperature 0.8 | 211.187 | 3.621 | 58.32 | 137 | 17 / 2.31 | −16.0 | −0.8 | −16.0 | −0.8 | 7620 MB | 3.19 GB |
| chatterbox-exag085 | variant | Chatterbox English, exaggeration 0.85, cfg 0.5, temperature 0.8 | 174.462 | 3.437 | 50.76 | 157 | 8 / 0.67 | −16.0 | −0.6 | −16.0 | −0.6 | 7620 MB | 3.19 GB |

Files are `audio/<id>.wav` and `audio/<id>.mp3`.

Kokoro generation time is the run that wrote the WAV. Peak RSS is a later run of the same `kokoro_tts.py` bridge: VmHWM 1197.7 MB, duration 48.405 s. That later run shared the CPU with the Chatterbox model load, so its 16.765 s is not the file's generation time. `/usr/bin/time` is not installed; RSS came from `/proc/<pid>/status`.

Edge generation times are wall clock for the call that wrote each file, including the network. A later Brian call on the same script returned in 1.005 s, so those RTF figures are not a stable server rate. The 39 MB figure is that later client process (VmHWM 39.0 MB). There is no local voice model.

Chatterbox load was 20.864 s and is not inside `gen s`. Both renders ran in one process. VmHWM 7620.2 MB is the high-water mark for that process. Weights on disk: `t3_cfg.safetensors` 2.130 GB, `s3gen.safetensors` 1.056 GB, `ve.safetensors` 5.7 MB, `conds.pt` 105 KB, `tokenizer.json` 25 KB. `max_new_tokens` was raised from the library default of 1000 to 2500. Neither take hit that cap (1459 and 1270 raw tokens). Outputs are Perth-watermarked. Device string was `cpu`.

The 2.31 s Chatterbox 0.35 gap starts at 56.01 s. The last agreed speech token in that take is near 55 s, so that gap is trailing silence. Interior gaps still include 1.50 s at 11.03 s and 1.41 s at 32.29 s.

## Pitch

`librosa.pyin`, 16 kHz, fmin 70 Hz, fmax 400 Hz. These are analysis frames, not a performance score.

| id | voiced frames | median Hz | p10 Hz | p90 Hz |
| --- | ---: | ---: | ---: | ---: |
| kokoro-am_michael | 1085 | 113.7 | 92.4 | 150.9 |
| edge-andrew | 997 | 115.7 | 86.2 | 158.1 |
| edge-brian | 1227 | 122.6 | 99.0 | 151.8 |
| edge-christopher | 1265 | 106.1 | 75.5 | 140.8 |
| chatterbox-exag035 | 1209 | 122.6 | 70.0 | 150.9 |
| chatterbox-exag085 | 1144 | 129.9 | 103.1 | 160.8 |

The 0.35 p10 sits on the 70 Hz analysis floor, so that low end is the floor of the measurement. Raising exaggeration from 0.35 to 0.85 shortened the file from 58.32 s to 50.76 s, cut interior pauses from 17 to 8, and moved the median from 122.6 Hz to 129.9 Hz.

## Pronunciation

Decoder: faster-whisper `base.en`, int8, CPU. Three passes. Passes 1 and 2 used library defaults and did not match each other token for token. Pass 3 used temperature 0 and beam size 1; that transcript is `asr.json` under `pass3`. A substitution is listed here only when at least two passes wrote it. Number words often come back as digits (`ten` → `10`). That is orthography from the decoder.

`MOONKATTY` was not recovered as one correct token in any pass:

| id | agreed hearing | time |
| --- | --- | --- |
| kokoro-am_michael | `moon kettie` (passes 1 and 2); pass 3 wrote `Moonkety` | 0.26 s |
| edge-andrew | `MUNCADI` / `muncaddy` | 0.38 s |
| edge-brian | three spellings: `mooncatty`, `Mooncaddy`, `Munkadi` | 0.34 s |
| edge-christopher | `Munkatti` / `munkadi` | 0.48 s |
| chatterbox-exag035 | `Munkatty` / `Munkaddy` | 0.92 s |
| chatterbox-exag085 | `Monkety` / `Munkety` | 0.56 s |

Other agreements:

- **edge-andrew.** `atlas` heard as `alice` at 24.72 s, in all three passes. `holds` heard as `hold` at 31.82 s. On the clock line, `the` heard as `a` near 33.6 s, and `four` heard as `for` at 34.64 s, in all three passes. The joke and `Nine lives. One moon.` are present (sign-off at 46.70 s in pass 2).
- **edge-brian.** `Atlas` is intact. The joke and `Nine lives. One moon.` are present (46.46 s in pass 2). On `strikes four`, two passes wrote `for` and one wrote `four`, so that word is not counted as a stable miss.
- **edge-christopher.** Joke and sign-off are present (`9 lives` at 53.98 s in pass 2). Pace is the outlier: 57.74 s, 138 WPM, longest interior pause 1.03 s. Pass 3 alone wrote `forfolio` in place of `a voice`; the other passes kept `voice test`.
- **kokoro-am_michael.** Joke and `Nine lives. One moon.` are present (46.44 s in pass 2). Pass 3 alone inserted `ItemLevel`, `This]).`, and `Story 3`. Passes 1 and 2 kept `Second story` and `atlas`.
- **chatterbox-exag035.** All three passes turned `Second story` into `Story 2` (33.62 s in pass 2). All three dropped the second half of the joke. Passes 2 and 3 end `but the lives one moon` (`lives` at 54.71 s in pass 2), so `library will not wait for the ferry` and a separate `9` are absent. Pass 3 alone inserted `Belichick`.
- **chatterbox-exag085.** Joke and `Nine lives. One moon.` are present (`Nine` at 47.22 s in pass 2). Pass 3 alone inserted `Cheong` before the close. Single-pass tokens (`testimonials`, `seiz`) are not listed as misses.

## Licenses and commercial use

| engine | what was read | commercial use |
| --- | --- | --- |
| Kokoro-82M | Hugging Face `hexgrad/Kokoro-82M` card: Apache-2.0. Local ONNX is the file already in `news-launch/models/kokoro/`. | Allowed under Apache-2.0. Local cost $0. |
| Chatterbox | GitHub `resemble-ai/chatterbox` LICENSE is MIT (Copyright 2025 Resemble AI). Hugging Face `ResembleAI/chatterbox` card: `license: mit`. English model is the 0.5B checkpoint with exaggeration. | Allowed under MIT. Local cost $0. Perth watermark is embedded. The OSR prompt's own terms ask for attribution "Open Speech Repository". |
| edge-tts | `edge-tts` Python package, no API key. Voices: Andrew Multilingual, Brian, Christopher, rate +0%. | Microsoft Q&A [6007729](https://learn.microsoft.com/en-us/answers/questions/6007729/commercial-use-of-microsoft-edge-text-to-speech-vi) says Microsoft does not publish a commercial-redistribution grant for Edge Read Aloud or `edge-tts`. On 10 Oct 2026 a Microsoft moderator on [6032190](https://learn.microsoft.com/en-us/answers/questions/6032190/commercial-use-rights-for-microsoft-edge-read-alou) wrote that they could not find an article. Azure AI Speech paid-tier product terms do grant commercial use of prebuilt neural TTS output ("paid tier TTS Service only", cited from the Microsoft Customer Agreement product terms in Q&A 5805156). These WAVs are a free listening reference. They are not a cleared production voice. |

## Engines that were not rendered

| engine | license check | why there is no WAV |
| --- | --- | --- |
| F5-TTS | Code README: MIT. Pretrained weights: CC-BY-NC because of Emilia. Hugging Face `SWivid/F5-TTS` is the NC checkpoint. | Non-commercial weights fail the commercial-use requirement. A from-scratch commercial checkpoint was not trained. The README also links an MLX port; the license is the blocker. |
| Orpheus TTS | Code repo describes an Apache-style release. Hugging Face `canopylabs/orpheus-3b-0.1-ft` card says `license: apache-2.0` and `base_model` includes `meta-llama/Llama-3.2-3B-Instruct`. The repo is gated. Safetensors parameter count is 3.78B fp32. `usedStorage` is about 57 GB because training artifacts are in the repo. README checklist still has 1B, 400M, and 150M unchecked. Inference path shown is vLLM. A llama.cpp note exists for machines without a GPU. Built-in male names in the README include leo, dan, zac. | Not downloaded. Gated, no GPU, and a 3.78B fp32 weight set does not fit this 15 GiB box. No unofficial GGUF was used. The Llama 3.2 Community License is a separate document from the card's Apache-2.0 tag; this lab did not accept the gate. |
| Dia | `nari-labs/dia` README: Apache-2.0. `nari-labs/Dia-1.6B-0626`: 1.61B fp32 parameters. README speed table: fp32 about 7.9 GB VRAM on an RTX 4090, and "CPU support is to be added soon." Inputs that correspond to more than about 20 s of audio "will make the speech unnaturally fast." | Not started. This script is about 48–58 s, the published path is CUDA, and this VM has no GPU. |
| Zonos | `Zyphra/Zonos` and `Zyphra/Zonos-v0.1-transformer`: Apache-2.0. Transformer card: 1.62B bf16 parameters, about 3.65 GB on disk. README: 6 GB+ VRAM; hybrid also needs an NVIDIA 3000-series or newer; CPU is possible with enough RAM but "a lot slower" and "likely won't be sufficient for interactive use." macOS is listed as an OS. | Not started. Chatterbox, at 0.5B, already took 174–211 s on this CPU. A timed 1.6B CPU run was not opened after that. |
| StyleTTS2 | Code README: MIT. The same README binds the pretrained checkpoints to a disclosure rule: tell listeners the speech is synthesized unless the speaker licensed the clone. Issue #37 is the author's note that those rules apply to the pretrained weights. The LJSpeech checkpoint is the single female LJ speaker. LibriTTS is the multi-speaker checkpoint. | Not started. The shipped single-speaker checkpoint is female, so it cannot be one of the male variants. A LibriTTS clone stack was not installed on this CPU box. |

## Cost

Local Kokoro and local Chatterbox: $0.

edge-tts: $0 in cash, no key, and no commercial grant found (see above).

Paid cloud was not called. Public list prices, fetched 21 Oct 2026 from [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api), taxes excluded:

| ElevenLabs model | public price | this 727-character script |
| --- | ---: | ---: |
| v4, v3, v2 Multilingual | $0.08 / 1,000 characters | $0.058 |
| v4 Turbo, v3 Conversational, Flash / Turbo | $0.04 / 1,000 characters | $0.029 |

The FAQ on that page still says "$0.08 per 1,000 characters (multilingual) or $0.04 (Flash/Turbo)."

## Mac mini M5 Pro, 24 GB

No RTF was measured on Apple Silicon. Estimates use the weight sizes above and the vendor notes.

- Kokoro-82M ONNX peaked at 1.2 GB RSS here. The media-automation Kokoro bridge comments that it runs on Apple Silicon CPU. 24 GB is enough for that working set. No MLX timing was taken.
- Chatterbox weights are 3.19 GB and the Linux CPU process peaked at 7.6 GB. 24 GB unified memory can hold that. `from_pretrained` accepts `mps` and falls back to CPU when MPS is missing. This VM has no MPS, so there is no MPS number.
- Dia's README still lists CPU support and macOS Docker as future work. The published fp32 footprint is about 7.9 GB. The weights would fit; the official path does not offer this machine's CPU or MPS.
- Zonos lists macOS and a 6 GB VRAM floor. The transformer weights are about 3.2 GB in bf16. MPS is not named. The hybrid checkpoint asks for NVIDIA.
- Orpheus at fp32 is about 15 GB of weights before a KV cache. A bf16 copy is about 7.6 GB and might fit in 24 GB. The published path is vLLM, the repo is gated, and it was not loaded.
- F5's README includes an Apple Silicon install and an MLX port. The pretrained weights are CC-BY-NC, so memory is not the reason to skip them.
- StyleTTS2 LJSpeech is a female speaker. It was not sized as the anchor.

## Recommendation

1. **chatterbox-exag085.** This is the local, MIT-licensed take that kept the joke and `9 Lives. One Moon.` in every ASR pass, and the exaggeration control did measurable work: 50.76 s and median 129.9 Hz versus 58.32 s and 122.6 Hz at exaggeration 0.35. Cost $0. Limits to hear before any lock: the name comes back as `Monkety` / `Munkety`, the prompt is 8 kHz, RTF is 3.4 on this 4-vCPU CPU, peak RAM is 7.6 GB, and the watermark is present. Exaggeration 0.35 is the wrong daily read: every pass lost the second half of the joke.
2. **edge-brian, as the listening reference only.** Among the three Edge voices it is the one whose agreed transcript keeps `Atlas`, the joke, and the sign-off, at 49.22 s and 162 WPM. The name is still wrong (`Mooncaddy` / `Munkadi` / `mooncatty`). It cannot be the on-air voice while Microsoft's public answers leave `edge-tts` without a commercial grant. Andrew adds a stable `atlas` → `alice` miss at 24.72 s. Christopher's read is complete and slower (57.74 s, pauses near 1 s).

Kokoro `am_michael` stays the baseline already in the pipeline: Apache-2.0, RTF 0.275, 48.41 s, sign-off present, peak about 1.2 GB, name split as `moon kettie`. The owner already called that family too robotic. This lab does not replace that judgment with a score, and it does not change `MasterVoice`.
