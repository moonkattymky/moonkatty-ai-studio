# Roadmap: 3D Character (MOONKATTY), block "3D CHARACTER"
Status in 1.2.0: **not implemented**. The repo has no rig, shape keys, lip-sync, blinking, voice profiles or master asset.
The only related piece is the stylized primitive cat in `blender/templates/scene_basic.py`. It is a placeholder, not the character.

## Goals
1. Make the facial animation system permanent: part of the master rig, not per-episode hacks.
2. Lip-sync to the approved male voice. Studio 2 owns the voice; Studio 5 stores the profile.
3. Natural blinking plus idle head, ear and paw motion.
4. Identical look in every episode: a locked, versioned master asset with a SHA-256 hash.
5. Free and local only. No paid services.

## Contract
- **Input:** `audio.wav` (mono, 16-bit PCM, 16–48 kHz) + `voiceProfileId` (must be an approved profile in Studio 5's store) + optional `transcript.txt` (improves Rhubarb accuracy) + `masterAssetVersion`.
- **Output:** a Blender **Action** `MK_Talk_<episode>_<hash8>` on the master rig, in a new episode `.blend` that *links* (not appends) the master. It contains:
  - viseme shape-key curves
  - blink curves
  - head/ear/paw bone curves
- **Side outputs:** `visemes.json` (Rhubarb output), `report.json` with:
  - master asset sha256
  - voiceProfileId
  - audio sha256
  - duration
  - frame rate
- **Job type:** `character_animate` (to be added to `docs/JOBS_API.md`), `resourceClass: gpu_heavy`, `requiresNode: mac-mini`, `safeToRetry: true` (always writes a new version).
- The job is refused if:
  - `voiceProfileId` is not approved
  - the WAV is invalid
  - the master hash does not match

## Rig and shape keys (Blender)
- **Master asset** `assets/character/moonkatty_master_vNNN.blend`:
  - a mesh modeled from the original reference images (Stage D)
  - an armature (root, spine, neck, head, ear.L/R with 2 bones each, paw.L/R FK, tail chain)
  - face shape keys
- **Mouth shape keys** follow Rhubarb's 9 mouth shapes:
  - `A` (M/B/P closed)
  - `B` (K/S/T, slightly open)
  - `C` (EH/AE)
  - `D` (AA, wide)
  - `E` (AO/ER)
  - `F` (UW/OW/W, puckered)
  - `G` (F/V)
  - `H` (L)
  - `X` (rest)
- **Other shape keys:** `Blink.L/R`, `BrowUp`, `Smile`.
- **Drivers:** a bone `face_ctrl` with custom properties `viseme_*` (0..1) drives the shape keys. Animation keys the properties, never the mesh directly. This lets the rig change without breaking old actions.
- The rig is built and validated by a vetted template `blender/templates/character_rig_check.py`. It checks that the required bones, shape keys and drivers exist, and fails fast.

## Lip-sync from audio: Rhubarb Lip Sync (MIT)
- **Source:** github.com/DanielSWolf/rhubarb-lip-sync, v1.14.0 (latest).
  - Rhubarb itself is MIT; the bundled third-party components have their own licenses, see `LICENSE.md` in the release.
  - **Checked 2026-10-21:**
    - The official macOS zip contains an **x86_64** Mach-O (cputype 0x01000007). On Apple Silicon it runs only under **Rosetta 2**.
    - The Linux x64 build runs on the CI box (`rhubarb --version` → 1.14.0).
  - **Plan:** build arm64 natively from source on the Mac (CMake + Boost; to be verified). Rosetta is the fallback.
  - The binary path is pinned by SHA-256 in settings.
- **Run:**
  ```
  rhubarb -f json -r pocketSphinx|phonetic --extendedShapes GHX [-d transcript.txt] audio.wav -o visemes.json
  ```
  It is run with `spawn` and argv only, no shell, with a timeout.
  - Use `-r phonetic` for non-English audio.
- **Mapping** (`lib/lipsync.js`):
  - Each cue `{start, end, value}` → keyframes on `face_ctrl["viseme_<value>"]`: 1 at start, 0 at the next cue.
  - Ease: 2-frame in/out overlap, with a small amount of co-articulation so a viseme is ≥ 2 frames.
  - Frame rate comes from the episode (25 fps default).
- **Voice profile** (from Studio 5): `{id, approved, sampleRate, recognizer, gain, mouthScale}`.
  - `mouthScale` multiplies the viseme amplitude, so the male voice gets a fuller opening.
  - The approval flag is checked before the job starts.

## Procedural blink and idle (vetted script `character_idle.py`, deterministic seed per episode)
- **Blink:**
  - Interval is log-normal, mean 4 s, min 1.5 s, with a 12% chance of a double blink.
  - Close takes 3 frames, hold 1, open 4.
  - No blink starts during the `D`/`E` visemes at peak volume.
- **Head:**
  - Low-frequency noise (≤0.3 Hz, ±3° yaw/±2° pitch).
  - A nod accent on audio RMS peaks above a threshold.
- **Ears:**
  - Spring secondary motion follows the head (damped; F-curve noise modifier as a fallback).
  - A random twitch every 6–12 s.
- **Paws/tail:**
  - Breathing cycle 0.25 Hz.
  - Occasional gestures from a small library of authored actions, layered in NLA.
- All motion goes on separate NLA tracks: `Lipsync`, `Blink`, `Idle`, `Gesture`. The result is baked into one action on request.

## Master-asset lock
- `assets/character/manifest.json`: `{version, file, sha256, createdAt, approvedBy, sourceRefs[]}`. It is append-only; the approved version is marked `locked: true`.
- Episodes **link** the master `.blend` (library override for the rig only). Mesh, materials and textures are never edited in episode files.
- **Before every render** (preflight stage):
  1. Compute the SHA-256 of the master file and compare it with the manifest. On mismatch the job is `blocked`.
  2. In Blender, verify that the linked library path equals the locked file and that no local overrides touch mesh or material data blocks.
- **New master version:** only through a `character_master_update` job with human approval. The previous version stays (versioned, never overwritten).
- The hash and version are written into every render's `report.json` and job artifacts (`{path, sha256, kind}`).

## Order of work (after A/B, needs Stage D model)
1. Master asset and manifest lock check, with tests on a sample rig: 1.5 d
2. Shape keys/drivers spec and the rig-check template: 1 d
3. Rhubarb integration (Linux CI binary; Mac arm64 build or Rosetta), WAV validation, voice-profile check, mapping to keyframes, tests with a sample WAV: 1.5 d
4. Procedural blink/idle/ears/paws, NLA layering, deterministic seed: 1.5 d
5. `character_animate` job type, UI preview (playblast PNG frames/MP4 via ffmpeg) and approval: 1 d

The total is about 6–7 days plus Mac checks. Risks:
- Rhubarb accuracy on non-English speech: use the phonetic recognizer, and transcripts help.
- Rosetta availability.
- Quality depends on the Stage D mesh and topology.
- Linking and library overrides behave differently across Blender versions (pin 5.2 LTS).
