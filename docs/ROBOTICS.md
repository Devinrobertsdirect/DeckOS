# Atlas Robotics — hardware plan

> Source of truth: design sheet **ATL-HW-001**. Software counterpart:
> [`robotics/atlas-robot`](../robotics/atlas-robot/README.md) (ATL-SW-001).
> The face it renders: [FACE-SPEC.md](FACE-SPEC.md).

## Platform

| | |
|---|---|
| Compute | Raspberry Pi 5, 8 GB |
| Form | 282 mm tall × 180 mm cylindrical body |
| Drive | Two-wheel differential (N20 gearmotors + encoders), casters for balance |
| Face | 3.1" round LCD, 480×480, SPI — "the face" |
| Runtime | ~7 h typical, docks itself at 20% battery |

## Bill of materials (~$310)

| Subsystem | Part | ~Cost |
|---|---|---|
| Vision | Raspberry Pi Camera Module 3 Wide | $35 |
| Face | 3.1" round LCD 480×480 SPI | $30 |
| Hearing | 4× I2S MEMS microphone ring | $25 |
| Voice | MAX98357A I2S amp + 3 W speaker | $10 |
| Ranging | 5× VL53L1X ToF + TCA9548A I2C mux | $40 |
| Proprioception | BNO085 IMU + INA219 power monitor | $28 |
| Drive | 2× N20 gearmotors w/ encoders | $24 |
| Motor driver | TB6612FNG dual H-bridge | $18 |
| Power | 4S2P 18650 pack (~100 Wh) + BMS + buck converters | $55 |
| Docking / safety | Dock + pogo pins + e-stop | $28 |

## GPIO map (BCM numbering)

| Function | Pins | Notes |
|---|---|---|
| I2C1 | GPIO2 (SDA) / GPIO3 (SCL) | IMU (BNO085), ToF mux (TCA9548A), INA219, BMS |
| I2S | GPIO18–21 | mic ring in, MAX98357A amp out |
| SPI0 | GPIO8–11 | round LCD data |
| LCD DC / RST | GPIO24 / GPIO25 | display control lines |
| Motor PWM | GPIO12 / GPIO13 @ 20 kHz | left / right speed |
| Motor DIR | GPIO5 / GPIO6 | direction into TB6612FNG |
| Encoders | GPIO16 / GPIO17 / GPIO22 / GPIO23 | quadrature A/B × 2 wheels |
| E-STOP | GPIO26 | hardware kill, input pulled up |
| DOCK sense | GPIO27 | pogo contact detect |
| FAN | GPIO4 | PWM cooling |

## Power budget

| | |
|---|---|
| Typical draw | 11.2 W |
| Peak (both motors + inference + display) | 32 W |
| Pack | 4S2P 18650, ~100 Wh, BMS-protected |
| Runtime | ~7 h mixed use |
| Docking policy | Auto-return to dock at 20% battery; INA219 + BMS report via I2C |

## Network

| | |
|---|---|
| Discovery | mDNS `atlas.local` |
| Robot REST | `:8000` |
| Robot WS (telemetry / face mirror) | `:8001` |
| Desktop Atlas dashboard | `:8080` (robot connects out to `ws://…:8080/api/ws`) |
| IoT | MQTT client → Home Assistant broker `:1883` |
| Offline | Ollama (local models) + Piper (local TTS) take over — the robot never bricks without WiFi |

## Voice stack

| Stage | Component |
|---|---|
| Wake word | openWakeWord or Porcupine |
| STT | faster-whisper (local) |
| TTS | Piper (local) or XTTS; ElevenLabs optional cloud upgrade |
| Targets | < 1.5 s full voice turn; barge-in supported (speech interrupts TTS) |

The voice pipeline publishes on the robot bus (`audio.wake_word`,
`audio.transcript`, `audio.tts_amplitude`) — the face's LISTENING/TALKING
states key off those topics directly.
