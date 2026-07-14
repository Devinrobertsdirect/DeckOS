# Atlas Runs Anywhere — one brain, any body

Atlas is **takeover software**: install it and it becomes the assistant on a
Linux or Windows desktop, the brain of a Raspberry Pi robot, or the host for a
microcontroller body — **without changing the app**. The trick is a hard line
between the brain and the body.

```
            ┌──────────────────────────── ATLAS BRAIN (Atlas Core) ───────────────────────────┐
            │  face · voice · memory · personality · DeckOS tools · inference gateway          │
            │                                   HAL (AtlasBody)                                 │
            └───────────────┬───────────────────────┬───────────────────────┬──────────────────┘
                            │                        │                       │
                    ┌───────▼───────┐        ┌───────▼───────┐       ┌───────▼────────┐
                    │   SimBody     │        │  PiGpioBody   │       │ SerialBridge   │
                    │ (desktop/dev) │        │ (Pi 5 GPIO)   │       │ (ESP32 / Nano  │
                    │  virtual body │        │  motors/estop │       │  / custom · AWP)│
                    └───────────────┘        └───────────────┘       └───────┬────────┘
                                                                     USB serial / WiFi / BLE
                                                                             │
                                                                     ┌───────▼────────┐
                                                                     │  Body firmware │
                                                                     │ TB6612 · enc · │
                                                                     │ e-stop · sensors│
                                                                     └────────────────┘
```

## The layers

**Brain — Atlas Core** (`core/server`, the TS/Node app). Everything above the
neck: the animated face, voice, memory, personality, the DeckOS capability
surface, and the inference gateway (local-first Ollama/Whisper/Piper, cloud
Claude/OpenAI/ElevenLabs optional). Runs on Linux, Windows, macOS, and the Pi.

**HAL — the Hardware Abstraction Layer** (`core/server/src/hal`). One interface,
`AtlasBody` (`drive`, `driveVelocity`, `halt`, `setFace`, `setEstop`,
`getState`, telemetry events). "Swap any part behind the HAL." Backends:

- **SimBody** — a virtual body (simulated odometry + telemetry). The default on a
  desktop, so every behaviour works before any hardware exists.
- **PiGpioBody** — drives the Pi's own GPIO per the ATL-PCB pin map (motor
  PWM 12/13, DIR 5/6, e-stop 26, dock 27, fan 4). `pigpio`, loaded only on a Pi.
- **SerialBridgeBody** — talks the **Atlas Wire Protocol** to a microcontroller
  over any line transport (USB serial, WiFi TCP, BLE, MQTT — injected, so the HAL
  has zero transport dependencies).

**Atlas Wire Protocol (AWP)** (`core/server/src/hal/protocol.ts` +
`robotics/firmware/AtlasWireProtocol.h`). A newline-delimited ASCII protocol —
`DRIVE l=400 r=400`, `STOP`, `ESTOP on=1`, telemetry `TEL encL=… battmv=…` —
that parses with no JSON library on anything down to an 8-bit Nano.

**Body firmware** (`robotics/firmware`). ESP32 (serial + WiFi) and Arduino Nano
(serial) sketches: TB6612 diff-drive, encoders, e-stop watchdog, battery. Flash,
point the brain at the port, done. See the firmware README.

## Hardware profiles

A profile (`robotics/profiles/*.yaml`) names a backend + geometry so one config
selects the body: `desktop` (sim), `atlas-mk-standard` (Pi), `atlas-esp32`,
`atlas-nano`, or your own custom board.

## Set up, run, go anywhere

```bash
atlas hardware   # detects OS + body → sim / Pi / serial, and the next step
atlas start      # brings up the brain on :8080 with the right body
```

`atlas hardware` auto-selects the backend: a wired board → **serial**, a Pi →
**pi**, otherwise → **sim**. Drive and observe any body through the same API:

```bash
curl localhost:8080/api/body                                  # state + backend
curl -XPOST localhost:8080/api/body/drive -d '{"l":0.4,"r":0.4}'
curl -XPOST localhost:8080/api/body/drive -d '{"linear":0.2,"angular":0.5}'
curl -XPOST localhost:8080/api/body/estop -d '{"on":true}'
```

## Custom boards

Implement `AtlasBody` (a new backend) **or** flash a board that speaks AWP and
use `SerialBridgeBody` with a transport for your link. Either way the brain is
unchanged — that's the whole point.

## Offline & durable

Everything the brain needs runs local-first, and settings/keys persist to a
local file (`~/.atlas/config.json`) with **no database required** — so a fresh
install on a bot keeps its keys across reboots. Cloud is an optional upgrade,
never a dependency.
