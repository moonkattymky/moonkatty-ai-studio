# QA contracts

These documents are how QA talks to the other studios. QA does not import their code, does not write `server/jobs*` or `server/blender*` (those belong to `feat/v1.2.0`), and does not post or publish.

| Role | Owns | Hands to QA |
| --- | --- | --- |
| Studio 2 | News scripts, stored sources, rendered video | Script package below |
| QA (this branch) | Pre-publication check and correction re-check | Verdict, or a correction verification |
| Studio 5 | Corrections log for items already published | Correction record; they append the verification themselves |

Game-test bug and task shapes stay in `qa/interfaces/`. This file is only the content QC contract.

## 1. Script package (input)

`contract` may be omitted on input. Required: `id`, `sources[]` with each `id`, and `body` or `claims`.

```json
{
  "id": "script-landing",
  "title": "Crew lands",
  "language": "en",
  "body": "On 12 March 2026 the mission cost $2.4 billion. NASA said: \"the crew is safe on the surface\".",
  "claims": [
    { "id": "c1", "text": "The lander reached the south pole of the Moon." }
  ],
  "images": [
    {
      "id": "img1",
      "file": "optional/path.png",
      "caption": "Moon lander on 12 March 2026",
      "sourceId": "nasa",
      "credit": "NASA",
      "takenAt": "2026-03-12"
    }
  ],
  "video": {
    "file": "optional/render.mp4",
    "expected": {
      "width": 1920,
      "height": 1080,
      "aspect": "16:9",
      "minDurationSec": 1,
      "maxDurationSec": 180,
      "requireAudio": true,
      "loudnessLUFS": { "min": -16, "max": -13 },
      "maxBlackFramePct": 0.02
    }
  },
  "citations": ["nasa"],
  "sources": [
    {
      "id": "nasa",
      "name": "NASA",
      "url": "https://www.nasa.gov/example-landing",
      "kind": "official",
      "status": 200,
      "publishedAt": "2026-03-12",
      "retrievedAt": "2026-03-12T18:00:00.000Z",
      "title": "Lander on the Moon",
      "text": "Stored body of the source. Quotes, figures and dates are checked against this text."
    }
  ]
}
```

`status` is the HTTP status Studio 2 stored when they retrieved the source. `text` is that stored body. QA does not fetch URLs unless the CLI is run with `--probe`. A source is dead when `status` is outside 200–399, `alive` is false, `error` is set, or there is no status and no stored text.

Studio 2 can build this from their news story without QA importing that code:

- `id` ← story id
- `body` ← `headline` + `summary`, or the video script `scenes[].text` joined
- `claims[]` ← sentences they want checked as facts
- `sources[]` ← each story item: `sourceId`, `sourceName`, `link` as `url`, `title`, `summary` as `text`, `published`
- `images[]` ← `mediaUrl` plus the caption and credit they intend to publish
- `video.file` ← the rendered file from the video factory; `expected` is the preset they rendered for (1920×1080 16:9, or 1080×1920 9:16)

## 2. QC verdict (output)

`moonkatty.qa.content.verdict/1`

```json
{
  "contract": "moonkatty.qa.content.verdict/1",
  "scriptId": "script-landing",
  "checkedAt": "2026-10-20T22:00:00.000Z",
  "decision": "clear",
  "publish": true,
  "findings": [],
  "counts": { "blocker": 0, "major": 0, "minor": 0 },
  "video": null,
  "note": "decision is a publish gate from the findings above. It is not a quality score."
}
```

`decision` is `clear` (no findings), `clear_with_notes` (minor only), or `hold` (any major or blocker). `publish` is true only when the decision is not `hold`. There is no numeric score.

Finding `kind` values:

| kind | When |
| --- | --- |
| `unsupported_claim` | A claim with no quote, number, or date shares fewer than 60% of its content words with every stored source |
| `quote_mismatch` | A quotation of at least 12 characters is not in any stored source |
| `number_mismatch` | A number disagrees with a related source sentence |
| `unsupported_number` | A number appears in no stored source and no related sentence contradicts it |
| `date_mismatch` | A date disagrees with a related source sentence |
| `date_unsupported` | A date appears in no stored source (minor) |
| `dead_source` | Stored status, error, or empty body says the source is not usable |
| `mismatched_source` | A citation or image `sourceId` is not in `sources` |
| `image_mismatch` | Caption date, number, proper noun, `takenAt`, or embedded creation day disagrees with the linked source |
| `image_credit` | Credit text does not match the source name (minor) |
| `image_file_missing` / `image_unreadable` | `file` was set and is missing or ffprobe cannot read it |
| `video_file_missing` / `video_missing` | Render path missing, or no video stream |
| `video_resolution` / `video_aspect` / `video_duration` | ffprobe disagrees with `expected` |
| `audio_missing` | `requireAudio` and no audio stream |
| `loudness` | ffmpeg `ebur128` integrated LUFS is outside `loudnessLUFS` or could not be measured |
| `black_frames` | ffmpeg `blackdetect` black time exceeds `maxBlackFramePct` |

`video` on the verdict, when a file was inspected, is the measured object: width, height, aspect, durationSec, audio codec/channels/sampleRate, integratedLUFS, blackPct. Those are measurements.

Commands:

```bash
node qa/content/cli.mjs qa/content/fixtures/good-script.json
node qa/content/cli.mjs --probe package.json
npm run qa:content
```

`--probe` replaces each source status with a live HTTP GET. Tests inject their own fetch. The default checker never opens a network connection.

## 3. Correction record (input)

Studio 5 sends this. `log.keeper` must be `studio-5`.

```json
{
  "id": "corr-1",
  "itemId": "script-landing",
  "publishedAt": "2026-03-12T20:00:00.000Z",
  "correctedAt": "2026-03-13T09:00:00.000Z",
  "correctedBy": "studio-5",
  "reason": "The published cost did not match the NASA text.",
  "addresses": ["QC-number_mismatch-xxxxxxxx"],
  "waivers": [],
  "log": { "keeper": "studio-5", "entryId": "log-1" },
  "sources": [],
  "before": { "id": "script-landing", "body": "published text", "claims": [], "images": [] },
  "after": { "id": "script-landing", "body": "replacement text", "claims": [], "images": [] }
}
```

`addresses` are finding ids from the verdict on the published item. `sources` is the stored source list (the same array as in the script package). A waiver is `{ "id", "note" }` and the note must be at least 10 characters or it is ignored.

## 4. Correction verification (output)

`moonkatty.qa.content.correction-verification/1`

```json
{
  "contract": "moonkatty.qa.content.correction-verification/1",
  "correctionId": "corr-1",
  "itemId": "script-landing",
  "verified": true,
  "decision": "verified",
  "beforeDecision": "hold",
  "afterDecision": "clear",
  "addressed": [],
  "missingFromBefore": [],
  "remaining": [],
  "introduced": [],
  "errors": [],
  "afterVerdict": {},
  "procedure": [],
  "note": "QA does not write the Studio 5 corrections log and does not publish."
}
```

`verified` is true only when every addressed id was present before, none of them remain (unless waived), no new major or blocker was introduced, the package changed, the keeper is studio-5, and the after decision is not `hold`. Otherwise `decision` is `not_verified` and `verified` is false.

The human procedure is `qa/content/CORRECTIONS.md`.
