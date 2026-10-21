# 3D animation cue contract (v1) — contract only, no rig work

Produced by the Voice&Emotion stage per segment; consumed by the future 3D host renderer. Times in seconds from segment start.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "moonkatty/animation-cues/v1",
  "type": "object",
  "required": ["version", "segmentId", "audio", "text", "emotion", "words"],
  "properties": {
    "version": { "const": "1" },
    "segmentId": { "type": "string" },
    "audio": { "type": "object", "required": ["file", "sha256", "durationSec", "sampleRate"],
      "properties": { "file": {"type":"string"}, "sha256": {"type":"string"}, "durationSec": {"type":"number"}, "sampleRate": {"type":"integer"} } },
    "text": { "type": "string" },
    "emotion": { "type": "object", "required": ["mode"],
      "properties": { "mode": { "enum": ["SERIOUS","NEUTRAL","EXCITED","CURIOUS","PLAYFUL","WITTY","EMPATHETIC"] },
        "intensity": { "type": "number", "minimum": 0, "maximum": 1 },
        "changes": { "type": "array", "items": { "type": "object", "required": ["t","mode"], "properties": { "t": {"type":"number"}, "mode": {"type":"string"} } } } } },
    "words": { "type": "array", "items": { "type": "object", "required": ["w","start","end"],
      "properties": { "w": {"type":"string"}, "start": {"type":"number"}, "end": {"type":"number"}, "stress": {"type":"boolean"} } } },
    "visemes": { "type": "array", "items": { "type": "object", "required": ["t","v"], "properties": { "t": {"type":"number"}, "v": {"type":"string"} } } },
    "pauses": { "type": "array", "items": { "type": "object", "required": ["start","end"], "properties": { "start": {"type":"number"}, "end": {"type":"number"}, "kind": { "enum": ["sentence","comma","punchline","story"] } } } },
    "smile": { "type": "array", "items": { "type": "object", "required": ["t","value"], "properties": { "t": {"type":"number"}, "value": {"type":"number","minimum":0,"maximum":1}, "easeSec": {"type":"number"} } } },
    "blinks": { "type": "array", "items": { "type": "object", "required": ["t"], "properties": { "t": {"type":"number"}, "durationSec": {"type":"number","default":0.15} } } },
    "gestures": { "type": "array", "items": { "type": "object", "required": ["start","end","type"],
      "properties": { "start": {"type":"number"}, "end": {"type":"number"}, "type": { "enum": ["rest","paws_open","paw_wave","paws_together","paw_point","paw_tap_desk","none"] }, "side": { "enum": ["left","right","both"] } } } },
    "head": { "type": "array", "items": { "type": "object", "required": ["t","move"], "properties": { "t": {"type":"number"}, "move": { "enum": ["nod","tilt_left","tilt_right","turn_camera","shake_small"] }, "amount": {"type":"number"} } } },
    "ears": { "type": "array", "items": { "type": "object", "required": ["t","move"], "properties": { "t": {"type":"number"}, "move": { "enum": ["perk","flick","flatten_soft","rotate_out"] } } } }
  }
}
```

Rules: word timestamps come from forced alignment of the final audio (Kokoro gives no timestamps; Stage 2 will use per-sentence durations + alignment). SERIOUS/EMPATHETIC: smile ≤ 0.1, no ear flicks, no playful gestures. Blink default from mode `blinkRate`/s with jitter. All times ≤ `audio.durationSec`.
