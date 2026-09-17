# Nobi Pi Ops — die-often resilience kit

The robot gets power-yanked in the field; these files make sure the face always comes back.

| File | What it does |
|---|---|
| `neura-kiosk.sh` | v3 kiosk supervisor: waits for the brain + a calm loadavg, then relaunches Chromium forever (deaths logged to `~/kiosk-boot.log`). |
| `setup-hardening.sh` | One-time, with sudo: hardware watchdog, journald-to-RAM (SD-card protection), fsck.repair verify. |
| `cdp-eval.mjs` | Zero-dep CDP poke: `node cdp-eval.mjs 'document.title'`, or `--key Enter` for remote keyboard wake. |
| `chaos-test.sh` | Kill -9 Chromium N times (default 3) and prove the supervisor resurrects the face — PASS/FAIL per cycle. |

Install: `scp -r robotics/pi-ops devindungeon@<pi>:~/pi-ops && ssh devindungeon@<pi> 'chmod +x ~/pi-ops/*.sh'`
Harden once: `ssh devindungeon@<pi> 'sudo bash ~/pi-ops/setup-hardening.sh'` (then reboot to arm the watchdog)
Autostart the supervisor (labwc): add `~/pi-ops/neura-kiosk.sh &` to `~/.config/labwc/autostart`, then reboot.
Chaos-check any time: `bash ~/pi-ops/chaos-test.sh 5`

## BT speaker audio auto-routes on connect

When a Bluetooth speaker is paired from the face UI (`POST /api/bt/pair`), the
server now best-effort makes it the DEFAULT audio sink, so the very next spoken
response — and Chromium's live TTS stream — comes out of the speaker instead of
the built-in jack. It uses WirePlumber (`wpctl set-default`) if present, else
PulseAudio/pipewire-pulse (`pactl set-default-sink` + `move-sink-input`). The
pair response carries an `audioRouted` boolean; `false` just means no bluez sink
was found yet (not an error). Check what's live with `wpctl status` — the `*`
under `Sinks:` marks the default; it should read `bluez_output.<MAC>` after connect.

## Nobi ears (local STT)

The robot's Chromium Web Speech doesn't transcribe on Linux (no speech backend),
so the face never hears anything. These three files add on-device STT: capture
the USB mic with `arecord`, run Vosk locally, and POST each final utterance to
the brain's loopback `/api/voice/heard` — which broadcasts it to the face as a
`voice.heard` event, the SAME path a typed message takes. No cloud, no second
response pipe. The brain mutes the intake while Nobi is speaking so she doesn't
hear her own TTS.

| File | What it does |
|---|---|
| `install-ears.sh` | One-time, idempotent: venv at `~/.atlas/ears-venv` (vosk + requests) and the small English model flattened into `~/.atlas/vosk-model`. ~120MB total — re-running detects both and skips. |
| `neura-ears.py` | The STT loop: `arecord` (raw S16LE 16k mono) → Vosk → POST `{text}` to `127.0.0.1:8080/api/voice/heard`. Respawns arecord if it dies; swallows POST errors; clean SIGTERM. Env: `NEURA_MIC_DEV` (default `plughw:3,0`), `NEURA_VOSK_MODEL`, optional `NEURA_WAKE_WORD` (gate + strip). |
| `neura-ears.service` | systemd unit (`User=devindungeon`, `After=neura-brain.service`, `Restart=always`). |

Install:
```
bash ~/pi-ops/install-ears.sh
sudo cp ~/pi-ops/neura-ears.service /etc/systemd/system/
sudo systemctl enable --now neura-ears
```

Test: speak near the mic and watch it forward — `journalctl -u neura-ears -f`
(you'll see a `heard: '…'` line per utterance). Confirm the brain saw it with
`curl -s localhost:8080/api/voice/state` (`lastHeardAt` updates; `muted` is
`true` only while Nobi is talking). Wake-word mode: uncomment
`Environment=NEURA_WAKE_WORD=nobi` in the unit, then `sudo systemctl daemon-reload
&& sudo systemctl restart neura-ears` — now only "nobi, …" utterances forward.
