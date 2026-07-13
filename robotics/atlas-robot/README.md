# atlas-robot — the robot brain

Python 3.12 scaffold of the Atlas robot runtime per design sheet **ATL-SW-001**:
event-driven asyncio, hardware abstraction layer, Raspberry Pi 5 target.
This is stage 4 of the DeckOS Atlas upgrade path — see
[docs/ROBOTICS.md](../../docs/ROBOTICS.md) for the full hardware plan
(BOM, GPIO map, power budget) and [docs/FACE-SPEC.md](../../docs/FACE-SPEC.md)
for the face it renders.

```
robot/
├── core/       event_bus.py (async pub/sub, "domain.action" topics)
│               config.py (YAML loader over config/*.yaml)
│               robot.py (lifecycle: wires services, runs until SIGINT)
├── display/    face.py + eyes.py (480x480 round-face state machine,
│               9 states, 250–400 ms tweens, 4–7 s blinks)
│               face_sim.py (pygame window; pure-python fallback)
├── ai/         llm.py (Claude → Ollama → rule-engine failover,
│               mirror of the desktop 4-tier gateway)
└── web/        bridge.py (WebSocket link to the desktop Atlas server)
config/         personality.yaml · display.yaml · network.yaml
```

## Run the face simulator

```bash
cd robotics/atlas-robot
python -m venv .venv && . .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt pygame
python -m robot.display.face_sim
```

Keys **1–9** cycle IDLE → LISTENING → THINKING → TALKING → HAPPY → CONFUSED →
EXCITED → CHARGING → SLEEPING. Without pygame the sim falls back to a headless
run that prints each state transition — same state machine, no window.

Run the whole brain (face service + desktop bridge):

```bash
python -m robot.core.robot
```

## How this maps to the Mark series

**Flash a profile, swap a shell.** Everything that makes a Mark a Mark lives in
`config/`: `personality.yaml` (traits, voice, energy) and `display.yaml`
(eye pack, blink rate, brightness). MK-01 "Workshop" is this reference config;
MK-02 "Stealth" or MK-03 "Forge" are the same code with a different YAML —
*an edition is a config, not a fork*. The same files drive the desktop face,
so the persona you tuned at your desk boots unchanged on the robot.

## Segmentation: desktop brain vs robot body

The robot runs standalone (local Ollama + rules keep it alive offline), but
when the desktop Atlas server is reachable, `robot/web/bridge.py` connects to
`ws://atlas.local:8080/api/ws` and the roles split:

| Desktop (brain) | Robot (body) |
|---|---|
| Deep reasoning (APEX/CORTEX), memory, planning, dashboard | Sensors, motors, mics, the physical face |
| Sees the robot as a live device (heartbeat → device registry) | Republishes bus events upstream; mirrors face state |

Ports: robot REST `:8000`, robot WS `:8001`, desktop `:8080`, MQTT `:1883`,
mDNS `atlas.local` (see `config/network.yaml`).
