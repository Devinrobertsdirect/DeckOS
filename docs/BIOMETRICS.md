# NERVELINK — biometrics plan

> Scaffold: [`biometrics/nervelink`](../biometrics/nervelink/README.md).
> Stage 3 of the upgrade path (v1.0–2.0): the nervous system learns to feel.

## Approach

One SDK, many boards: **BrainFlow** abstracts acquisition across OpenBCI,
Muse, and a synthetic board, so the whole pipeline develops and CI-tests with
zero hardware. `stream.py` reads windows from the board ring buffer and
broadcasts JSON `bio.frame` messages over WebSocket **:8090**.

## Hardware options

| Tier | Device | Why |
|---|---|---|
| Develop | SyntheticBoard (`--board-id -1`) | free, always available |
| Entry | Muse 2 / Muse S (BLE) | comfortable 4-ch EEG headband |
| Serious | OpenBCI Cyton (8ch) / Cyton+Daisy (16ch) | EEG + EMG + ECG capable, proper montages |
| Heart | Polar H10 chest strap | best consumer ECG/HRV signal; separate BLE reader (planned), same frame shape |

## What consumer EEG can realistically do in 2026

Set expectations before soldering: dry-electrode consumer EEG delivers
**band-power trends and big artifacts, not thoughts.**

Realistic and useful:
- Focus/relaxation index from alpha/beta ratios (tens-of-seconds resolution)
- Deliberate blink / jaw-clench "switch" inputs
- Sleep-adjacent drowsiness trends
- Signal-quality detection (electrode lift, motion artifacts)
- From ECG/PPG: heart rate and HRV — honestly the highest signal-to-usefulness
  ratio of anything in this file

Not realistic (with this class of hardware): decoding words, images, or
intentions; reliable emotion classification; medical-grade anything. If a
vendor claims otherwise, they are selling artifacts.

## Integration path

```
BrainFlow board ──► stream.py ──► WS :8090 ──► dashboard panel (waveforms)
                                     │
                                     └──► feature extraction (band power, blink,
                                          HR/HRV) ──► Atlas bus events
```

1. **Now (scaffold)** — raw `bio.frame` streaming on :8090; dashboard can
   render live waveforms.
2. **Next** — server-side feature extraction that debounces raw frames into
   sparse bus events, e.g.:
   - `bio.focus_changed` `{ level: 0..1, trend: "rising" | "falling" }`
   - `bio.blink_detected` `{ strength }`
   - `bio.heart_rate` `{ bpm, hrv_rmssd }`
   - `bio.signal_quality` `{ ok: boolean, channels: [...] }`
3. **Then** — autonomy hooks: routines subscribe to `bio.*` (dim
   notifications when focus is high, suggest a break when HRV tanks). Ambient
   context only — bio signals never gate safety-relevant actions.

Summarised `bio.*` events may also be mirrored to MQTT under the proposed
`atlas/bio/*` topics ([devices/MQTT-TOPICS.md](../devices/MQTT-TOPICS.md));
raw frames stay on the WebSocket — they are too chatty for the broker.

## Safety

NERVELINK is not a medical device and must never be used for diagnosis or
safety-critical control. Full disclaimer in
[biometrics/nervelink/README.md](../biometrics/nervelink/README.md).
