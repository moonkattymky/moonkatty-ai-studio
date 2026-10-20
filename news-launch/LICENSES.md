# Rights for the corrected MOONKATTY NEWS edition

Checked 20 October 2026. A frame is included only when the right to use it is confirmed. No third-party photograph or footage is in the corrected MP4s.

The extractive draft in `news-launch/artifacts/test-episode/` used the same generated-card method. This file covers the corrected edition in `news-launch/artifacts/corrected-episode/`.

## Frames

Video Factory v0 draws each scene as an ffmpeg `color` source plus DejaVu Sans text. Scene order and colours:

| Scene | On-screen heading | Background | Author | Licence | Commercial use | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| intro | MOONKATTY NEWS | generated solid `0x1a3a5c` | this pipeline | original graphic | yes | none for the card |
| alberta | Alberta | generated solid `0x1a4d3e` | this pipeline | original graphic | yes | none for the card |
| ebola | Abuja | generated solid `0x3a2f6b` | this pipeline | original graphic | yes | none for the card |
| jets | Saudi Arabia | generated solid `0x1a3a5c` | this pipeline | original graphic | yes | none for the card |
| outro | Sources | generated solid `0x1a4d3e` | this pipeline | original graphic | yes | none for the card |

There is no `background` image on any scene. Thumbnails (`horizontal.jpg`, `vertical.jpg`) are a frame of the same generated video with the title drawn on top. Same rights as the frames.

## Font

DejaVu Sans Bold, used for headings, burned-in subtitles, and thumbnails.

- File on the render machine: `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`
- Licence: Bitstream Vera Fonts licence, as kept by the DejaVu project. Commercial use is allowed.
- Attribution required: no.

On a Mac the factory also accepts `/System/Library/Fonts/Supplemental/Arial Bold.ttf` or `/Library/Fonts/Arial Bold.ttf` if DejaVu is absent. Arial is a system font. The VM render used DejaVu.

## Audio

Provisional voice: Kokoro `am_michael`. Not locked. See `news-launch/VOICE_REPORT.md` for the model licence, the dataset statement, and the CC BY audio that the training card names.

- Weights: Apache-2.0, Kokoro-82M v1.0 (hexgrad).
- Commercial use of the weights: allowed by Apache-2.0.
- Attribution for the weights: Apache-2.0 notice if the weights are redistributed. The weights are not committed to this repo. They stay in `news-launch/models/kokoro/`, which is gitignored.
- Training card also names Koniwa `tnc` (under 1 hour, CC BY 3.0) and SIWIS (under 11 hours, CC BY 4.0). Those credits are in `VOICE_REPORT.md`.
- Phonemizer: espeak-ng (GPL-3.0) is used locally and is not vendored. The spoken waveform is the committed audio.

No music bed. `music` is null.

## Comparison sample only

`news-launch/artifacts/voice-samples/piper-en_US-ljspeech-high.wav` is a female Piper voice trained from scratch on public-domain LJ Speech. It is not the episode voice. Licence details are in `news-launch/licenses/tts.json` and `VOICE_REPORT.md`.

## Looked at and not used

| Asset | Where it appeared | Why it is absent |
| --- | --- | --- |
| GOV.UK photo of the Ministry of Defence building | https://assets.publishing.service.gov.uk/media/63495d46d3bf7f618eda94d2/s960_ministry-of-defence-building.jpg | Rights not cleared. Not downloaded into the episode. |
| Elections Alberta page images | elections.ab.ca | Rights not cleared. |
| Guardian photos (Canadian Press / Shutterstock, Reuters) | Alberta article | Rights not cleared. |
| BBC branded still and the "MOD" Typhoon file image | BBC article | Rights not cleared. |

## Subtitles

`horizontal.srt` and `vertical.srt` are text generated from the editor script. Original. No third-party copy.
