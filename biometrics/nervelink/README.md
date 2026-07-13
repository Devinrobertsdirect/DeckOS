# NERVELINK — biosignal streaming for Atlas

Streams EEG/ECG/EMG frames from consumer biosensors into the Atlas nervous
system: BrainFlow in, JSON-over-WebSocket out on **:8090**. The desktop
dashboard subscribes to render live waveforms and to raise bus events like
`bio.focus_changed`. Plan and integration path: [docs/BIOMETRICS.md](../../docs/BIOMETRICS.md).

## Quickstart (no hardware needed)

```bash
cd biometrics/nervelink
python -m venv .venv && . .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python stream.py                                 # SyntheticBoard → ws://localhost:8090
```

Connect any WebSocket client to `ws://localhost:8090` and you'll receive
`bio.frame` JSON messages ~4x/second.

## Supported hardware

All EEG boards go through [BrainFlow](https://brainflow.org) — one SDK, one
board-id flag:

| Device | `--board-id` | Channels | Link | Notes |
|---|---|---|---|---|
| Synthetic (default) | `-1` | 8 | — | Generated signals; develop with zero hardware |
| OpenBCI Cyton | `0` | 8 | serial dongle (`--serial-port COM3`) | EEG/EMG/ECG capable, the reference board |
| OpenBCI Ganglion | `1` | 4 | BLE or dongle | budget option |
| OpenBCI Cyton+Daisy | `2` | 16 | serial dongle | full montage |
| Muse 2 | `38` | 4 | BLE (`--mac-address`) | consumer headband, EEG only |
| Muse S | `39` | 4 | BLE | sleep-friendly form factor |
| Muse 2016 | `22` | 4 | BLE | legacy |
| Polar H10 (heart rate/ECG) | n/a | 1 | BLE | **not** a BrainFlow board — planned as a separate `bleak`-based reader publishing the same `bio.frame` shape |

`python stream.py --list-boards` prints the table of ids.

## What this can actually do (2026 reality check)

Consumer EEG is **not mind reading**. With dry electrodes and 4–8 channels you
can realistically detect:

- **Focus / relaxation trends** — alpha/beta band-power ratios over tens of
  seconds. Good enough to dim notifications when you're deep in work.
- **Blinks and jaw clenches** — big, reliable artifacts; usable as deliberate
  "switch" inputs.
- **Artifact/quality detection** — knowing when the signal is garbage
  (electrode lift, motion) is half the pipeline.
- **Heart metrics** (ECG boards / Polar H10) — heart rate and HRV are the most
  robust biosignals available and often more informative than consumer EEG.

What you will **not** get: imagined words, images, intentions, emotions with
any specificity, or P300-grade BCI without gel electrodes, careful montage,
and per-user calibration. Atlas treats biosignals as *ambient context*
(focus up/down, stress trend), never as commands with safety consequences.

## Safety & medical disclaimer

NERVELINK is an experimental hobby/research tool. It is **not a medical
device**, is not FDA/CE cleared, and must not be used for diagnosis,
treatment, monitoring of any medical condition, or any safety-critical
control. Signals from consumer hardware are noisy and can be misleading.
If you have a medical concern, talk to a clinician, not a headband.
Never connect mains-powered custom electrodes to your body; use only
battery-powered, commercially certified acquisition hardware.
