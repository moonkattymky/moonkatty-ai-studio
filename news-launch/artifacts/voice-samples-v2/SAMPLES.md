# Voice samples v2

Listening set only. No voice is approved. `MasterVoice` is not locked. These files are not a bulletin and they are not published.

Engine: local Kokoro-82M through `media-automation/tools/kokoro_tts.py` (`kokoro-onnx`). No paid speech service.

The three files speak the same English text. The only per-voice control is Kokoro `speed` (higher is a faster read). This bridge does not expose pitch.

## Exact text

```
This is MOONKATTY NEWS. What you are hearing is a voice sample, not a live bulletin.

Here is the sample item, and it is example copy only. A public library lists Saturday hours on its own website. The doors open at ten. The doors close at four. That is the whole story. This recording states no claim about a real event.

And now a light sign-off, in the house style. 9 Lives. One Moon. We spent one life reading the hours, so eight are still on the table. MOONKATTY NEWS.
```

The news paragraph is example copy. It names no real incident. The sign-off is one light joke on the house line, 9 Lives. One Moon.

## Parameters

| Voice | Lang | Speed | WAV | MP3 |
| --- | --- | --- | --- | --- |
| `am_michael` | en-us | 1.03 | `kokoro-am_michael.wav` | `kokoro-am_michael.mp3` |
| `am_adam` | en-us | 1.00 | `kokoro-am_adam.wav` | `kokoro-am_adam.mp3` |
| `am_fenrir` | en-us | 0.82 | `kokoro-am_fenrir.wav` | `kokoro-am_fenrir.mp3` |

Shared settings: `lang=en-us`. Two-pass ffmpeg `loudnorm=I=-16:TP=-1.5:LRA=11:linear=true`. Output is 48 kHz mono PCM WAV, then 192 kbps mono MP3 (`libmp3lame`) from that WAV. An MP3 that measured more than 0.4 LU away from -16 was encoded again with a makeup gain. That second encode is what `am_adam` and `am_fenrir` use. `am_michael` is the direct encode.

`am_michael` is lifted to 1.03 so the read sits near 29 seconds. `am_adam` at speed 1.00 is already 25.41 seconds, so a faster setting would drop him under 25. `am_fenrir` at speed 1.00 finishes under 25 seconds, so 0.82 is the slowdown that just clears the window. The words do not change.

Rebuild with `node news-launch/bin/voice-samples-v2.js`. That command does not lock a voice.

## Measurements

Duration is `ffprobe -show_entries format=duration`. Loudness is `ffprobe` lavfi `ebur128=peak=true` (`lavfi.r128.I`, true peak from `lavfi.r128.true_peaks_ch0`).

| File | Duration | Integrated loudness | True peak |
| --- | --- | --- | --- |
| `kokoro-am_michael.wav` | 29.29 s | -16.2 LUFS | -1.5 dBFS |
| `kokoro-am_michael.mp3` | 29.33 s | -16.4 LUFS | -1.6 dBFS |
| `kokoro-am_adam.wav` | 25.41 s | -16.4 LUFS | -1.5 dBFS |
| `kokoro-am_adam.mp3` | 25.44 s | -16.0 LUFS | -1.0 dBFS |
| `kokoro-am_fenrir.wav` | 25.11 s | -16.4 LUFS | -1.5 dBFS |
| `kokoro-am_fenrir.mp3` | 25.15 s | -16.0 LUFS | -1.0 dBFS |

Target loudness is -16 LUFS. WAV true peak is held at or under −1.5 dBTP by the loudnorm limiter.

## Licenses

- Model weights: Kokoro-82M v1.0, Apache-2.0. https://huggingface.co/hexgrad/Kokoro-82M
- Local file `news-launch/models/kokoro/kokoro-v1.0.onnx` sha256 `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5`. Gitignored. Not a paid download.
- Voice pack `voices-v1.0.bin` sha256 `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d`. Ids used: `am_michael`, `am_adam`, `am_fenrir`.
- Phonemizer: espeak-ng (GPL-3.0) on this machine. The binary is not committed. The WAV and MP3 are synthesized audio, not a copy of espeak-ng.
- Training-card notes for the CC BY audio inside Kokoro v1.0 (Koniwa `tnc`, SIWIS) are in `news-launch/VOICE_REPORT.md`. This sample set does not lock a commercial voice.

## Wordmark

A temporary text logo, not final and with no character, is in `news-launch/branding/temp/`.
