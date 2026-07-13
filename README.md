# DeckOS Atlas

> **The Open Source Personal AI Operating System for Humans, Machines, and Robots.**
>
> *A customizable Jarvis brain that grows from a desktop assistant into the
> operating system for your future robot.* The computer is only the first body.

<!-- badges: build · license MIT · pnpm · TypeScript · Python 3.12 -->

**Local-first · cloud optional.** One brain, many bodies: desktop today,
Raspberry Pi robot tomorrow — same memory, same personality, same face.

---

## The upgrade path

| Stage | Release | You get |
|---|---|---|
| 1. AI desktop command center | v0.1 | Dashboard, the two faces, 4-tier AI gateway |
| 2. Personal agent OS | v0.5 | Autonomy, plugins, voice, memory graph |
| 3. IoT + biometric interface | v1.0–2.0 | MQTT device fleet, NERVELINK EEG/ECG |
| 4. Robotics brain | v3.0 | [`robotics/atlas-robot`](robotics/atlas-robot/README.md) on Pi 5, ROS 2 bridge |
| 5. Build-your-own-JARVIS kit | — | Marketplace + Mark-series personas |

## Quickstart

```bash
git clone https://github.com/Devinrobertsdirect/DeckOS.git -b atlas DeckOS-Atlas
cd DeckOS-Atlas
pnpm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY, MQTT broker, …

# build the dashboard once, then run everything from one process
pnpm --filter @workspace/deck-os build
pnpm --filter @workspace/api-server start
```

Then open **http://localhost:8080** — the API server hosts both the dashboard
and the REST/WebSocket API on a single port.

Or the zero-thought path via the bootstrap CLI in `installer/atlas-cli` (builds
the dashboard and starts Atlas, then opens the browser for you):

```bash
npx atlas start      # → http://localhost:8080
```

For live dashboard editing with hot-reload, run the Vite dev server separately
(`pnpm --filter @workspace/deck-os dev`, proxies `/api` to :8080).

No API keys, no Ollama? Everything still boots — the rule engine keeps the
lights on, and Atlas even runs with no database (persistence just degrades).
Details: [SETUP.md](SETUP.md).

## The face

Atlas has **two face modes** — a companion face (two ice-blue eyes on a navy
disc, nine expression states, blinks every 4–7 s) and a neural face (a
pulsing node cluster that takes over during heavy inference). Same spec runs
on the desktop dashboard and the robot's 3.1" round LCD.

**ONE CURVE · TWO EYES · ONE ACCENT** — full spec in
[docs/FACE-SPEC.md](docs/FACE-SPEC.md), robot renderer in
[`robotics/atlas-robot/robot/display`](robotics/atlas-robot/robot/display).

## The brain — 4-tier AI gateway

Callers declare a task; the gateway routes it and degrades gracefully.
**It never goes silent.** Config: [`intelligence/`](intelligence/README.md).

| Tier | Engine | Used for |
|---|---|---|
| **APEX** | Claude API (Sonnet 5 default; Fable 5 for big-brain mode) | deep reasoning, research, coding |
| **CORTEX** | Ollama local (gemma, llama, …) | chat, planning, briefings |
| **REFLEX** | Ollama small (phi, …) | classification, commands, <200 ms |
| **AUTOPILOT** | rule engine | system checks, safety fallback — always on |

## Repo layout

| Path | What lives there |
|---|---|
| [`core/server`](core/server) | Atlas Core — Express 5 API, agent runtime, inference gateway, plugins (`:8080`) |
| [`core/lib`](core/lib) | Shared libs: db, api-spec, api-zod, api-client-react, event-bus, integrations |
| [`interfaces/desktop`](interfaces/desktop) | Command Center — React 19 + Vite dashboard |
| [`interfaces/electron`](interfaces/electron) | Desktop shell (tray, notifications) |
| [`interfaces/mobile`](interfaces/mobile) | PWA companion (pairs by device code) |
| [`interfaces/cli`](interfaces/cli) | `deck` REPL over WebSocket |
| [`intelligence/`](intelligence) | Model router presets (APEX/CORTEX/REFLEX/AUTOPILOT) |
| [`devices/`](devices/MQTT-TOPICS.md) | MQTT topic contract, Home Assistant bridge, firmware examples |
| [`robotics/atlas-robot`](robotics/atlas-robot) | Python robot brain (asyncio bus, face renderer, HAL) — Pi 5 |
| [`biometrics/nervelink`](biometrics/nervelink) | EEG/ECG/EMG streaming (BrainFlow → WS `:8090`) |
| [`marketplace/`](marketplace/README.md) | Plugin store + AgentSkills-format skills |
| [`installer/atlas-cli`](installer/atlas-cli) | `atlas` bootstrap CLI (install/start/stop/doctor) |
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Face](docs/FACE-SPEC.md) · [Robotics](docs/ROBOTICS.md) · [Biometrics](docs/BIOMETRICS.md) · [Research](docs/RESEARCH.md) |

## The nervous system

- **IoT** — any MQTT device auto-registers on first message; Home Assistant
  bridges via a shared broker on `:1883`. Start with the
  [ESP32 sensor sketch](devices/examples/esp32-sensor.md) and the
  [topic contract](devices/MQTT-TOPICS.md).
- **Robotics** — [`robotics/atlas-robot`](robotics/atlas-robot/README.md) is
  the Pi 5 robot brain: event-driven asyncio, the face on a round LCD, and a
  WebSocket spinal cord back to the desktop. Hardware plan (~$310 BOM, GPIO
  map, power budget): [docs/ROBOTICS.md](docs/ROBOTICS.md).
- **Biometrics** — [`biometrics/nervelink`](biometrics/nervelink/README.md)
  streams EEG/ECG frames over `:8090`; realistic scope (focus trends, blinks,
  HRV — not mind reading): [docs/BIOMETRICS.md](docs/BIOMETRICS.md).

## Mark-series personas

**An edition is a config, not a fork.** A "Mark" is a persona + eye pack +
voice defined entirely in data (`personality.yaml`, `display.yaml`): MK-01
Workshop is the ice-blue reference; MK-02 Stealth and MK-03 Forge are the same
code with different YAML. Tune a persona at your desk, flash it to a robot
body unchanged — *flash a profile, swap a shell*.

## Contributing

PRs welcome. Ground rules: keep TypeScript strict-clean (`pnpm typecheck`),
package names stay `@workspace/*`, and read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before moving walls. Plugins and
skills are the friendliest entry points — see
[marketplace/README.md](marketplace/README.md).

## License

MIT. Build your own Jarvis; it's yours.
