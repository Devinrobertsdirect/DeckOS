# Atlas Face Specification

> Source of truth: design sheets ATL-ID-001 (Concept & Character), ATL-SW-001 (System Map §06),
> ATL-PA-001 (Product Atlas §P3 "Eye packs"). "No mouth, no eyebrows — two shapes on a dark
> round glass do all the acting."

Atlas has **two face modes** plus legacy audio-reactive styles:

| Mode | Component | When |
|---|---|---|
| **Companion face** (default) | `AtlasFace` | Idle, chat, low CPU — the "cute" mode |
| **Neural face** | `NeuralFace` | Heavy inference / high CPU — the node-cluster brain becomes the face |
| Legacy packs | `AIFace` (vocoder, oscilloscope, iris, spectrum) | User-selectable extras |

Auto-switch: the face controller morphs Companion → Neural when the THINKING state
persists > 1.5 s or system CPU > 65%, and morphs back when activity subsides.
Users can pin either mode in Settings (`atlas_face_mode`).

## Canvas

- Round dark disc, colour `#1E2A38` (smoked-glass navy), subtle 1px lighter ring at the rim.
- Reference resolution 480×480 (the robot's 3.1" round LCD); render at any size, keep circular.
- 60 fps target; all state changes **tween 250–400 ms — the face never "teleports"**.
- Default eye colour: ice-blue `#C9DCF0`. Eye colour always equals the accent ("the eyes always
  match the seam").

## Expression states (event-bus `EMOTION_CHANGED`)

| State | Eyes | Extras | Trigger |
|---|---|---|---|
| IDLE | Two vertical rounded pills (~1:2.2 w:h), gap ≈ one eye-width, slightly above midline | Blink every 4–7 s (randomised), gaze micro-drift | default |
| LISTENING | Pills widen/rounden, lean toward sound | Dashed attention arc above | mic recording / wake word |
| THINKING | Eyes shrink, drift up-left | Trail of 3 dots to lower-right, slow pulse glow | inference in flight |
| TALKING | Idle pills, subtle cadence bounce | Motion synced to TTS amplitude | audio playback |
| HAPPY | Upward arcs ("∩∩", closed happy eyes) | Quick bounce | task success |
| CONFUSED | Asymmetric squint: left pill, right short dash set higher | Slight tilt | error / low confidence |
| EXCITED | Lightning-bolt zigzag eyes | Spark flicker | notable events |
| CHARGING | Half-closed shallow arcs | Dashed % ring below, breathing glow | battery charging |
| SLEEPING | Two horizontal dashes | "z z" drifting up-right, screen dim to 5% | idle timeout / night |

## Neural face (node-cluster mode)

- 50–80 nodes in a 2D force/spring simulation, clustered loosely into the same silhouette as the
  companion face (two denser "eye" clusters so it still reads as a face across the room).
- Nodes pulse with real activity: WebSocket events, inference tier (cortex/reflex/apex), CPU %.
- Edges light up along "thought paths" during streaming tokens; whole cluster gently drifts
  ("slight moving and pulsating").
- Colour: eye/accent colour on the navy disc; brightness maps to activity.

## Eye packs (theme system, `atlas_face_theme`)

An edition is a config, not a fork — themes change colour/shape/blink-rate only:

| Pack | Eye colour | Notes |
|---|---|---|
| `workshop` (default, MK-01) | `#C9DCF0` ice-blue | Reference build |
| `stealth` (MK-02) | `#9FB4C8` on graphite | Dimmer idle glow |
| `forge` (MK-03) | `#E3B54F` gold | `sarcasm: 0.6, energy: high` persona pairing |
| `codex` (MK-04) | `#E8C98A` candlelight | Slower blink, softer pulse |
| `cat` | any | Vertical-slit pupils inside the pills |
| `pixel` | any | Eyes drawn as 8×12 pixel grids |

Blink rate, idle glow, and colours are data (`display` config), matching the robot's
`display.yaml` / `personality.yaml` so a desktop persona can be flashed to a physical robot
unchanged.
