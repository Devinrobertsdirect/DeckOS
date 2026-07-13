# DeckOS Atlas — Architecture

> **The Open Source Personal AI Operating System for Humans, Machines, and Robots.**
> A customizable Jarvis brain that grows from a desktop assistant into the operating
> system for your future robot. The computer is only the first body.

Atlas separates three concerns:

- **The Brain** — reasoning, memory, planning, personality, learning (`core/`)
- **The Nervous System** — sensors, APIs, IoT, robotics communication (`devices/`, `robotics/`, `biometrics/`)
- **The Body** — desktop, phone, Raspberry Pi, robot (`interfaces/`, device profiles)

```
                        DECKOS ATLAS
                             |
                        ATLAS CORE
                             |
            ------------------------------------
            |                |                 |
        CORTEX AI        MEMORY CORE      ACTION ENGINE
        Claude API       SQLite facts     Tool calling
        Ollama           Vector recall    Plugins & routines
        OpenClaw         Knowledge graph  IoT / MQTT
        Rule engine      Markdown vault   Robotics bridge
                             |
                     DEVICE ABSTRACTION
                             |
           -------------------------------------
           |               |                   |
        Windows          Linux             Robot OS
        Desktop PC       Raspberry Pi      ROS 2 / HAL
```

## Repository layout

| Path | Role |
|---|---|
| `core/server` | Atlas Core — Express 5 API, agent runtime, inference gateway, memory, autonomy, plugins (REST `:8080`, WS `/api/ws`) |
| `core/lib` | Shared libraries: db (Drizzle), api-spec (OpenAPI), api-zod, api-client-react, event-bus, integrations |
| `interfaces/desktop` | Atlas Command Center — React 19 + Vite dashboard (the remodelled deck-os) |
| `interfaces/electron` | Windows/Linux desktop shell (tray, notifications) |
| `interfaces/mobile` | Mobile PWA — connects **through** Atlas Cloud/server API |
| `interfaces/cli` | `deck` REPL client over WebSocket |
| `intelligence/` | Model & perception configs: model router presets, vision, voice profiles |
| `robotics/atlas-robot` | Robot brain scaffold (Python 3.12 asyncio, event-bus, HAL) per ATL-SW-001 — targets Raspberry Pi 5 |
| `biometrics/nervelink` | EEG/ECG/EMG streaming service scaffold (BrainFlow) |
| `devices/` | IoT: MQTT topic contract, Home Assistant bridge notes, firmware examples |
| `marketplace/` | Plugin store registry + community plugins |
| `installer/atlas-cli` | `atlas` bootstrap CLI: install / start / stop / status / doctor / update |
| `docs/` | Architecture, face spec, hardware, roadmap |
| `examples/` | Sandboxes and demos |

## The inference gateway (4 tiers)

Callers declare a task type; the gateway routes and degrades gracefully. **It never goes silent.**

| Tier | Engine | Tasks |
|---|---|---|
| **APEX** | Claude API (Fable 5 / Opus / Sonnet 5 / Haiku — configurable, "big-brain mode") | deep reasoning, architecture, research, coding |
| **CORTEX** | Ollama local reasoning model (auto-detected, e.g. gemma) | chat, planning, summarization, briefings |
| **REFLEX** | Ollama small model (e.g. phi3) | classification, routing, commands, <200 ms budget |
| **AUTOPILOT** | Deterministic rule engine | system checks, device polling, safety fallback |

Failover chain: `APEX → CORTEX → REFLEX → OpenWebUI → AUTOPILOT`.
OpenClaw is detected on `:18789` as an Ollama-compatible local provider.
Offline, Ollama + local TTS take over — local-first, cloud optional.

## Memory

- **Facts** — SQLite/Postgres via Drizzle (names, preferences, routines)
- **Context** — semantic recall over conversation memory (top-K)
- **Knowledge graph** — relationships between people, projects, devices (Memory screen)
- **Vault** — markdown-first `AtlasBrain/` folder (Identity / Projects / Knowledge / Skills /
  Memories / Goals): human-readable, AI-searchable, Obsidian-compatible

## Ports & network contract (matches ATL-HW-001)

| Port | Service |
|---|---|
| `:8080` | Atlas server (REST + dashboard + WS `/api/ws`) |
| `:1883` | MQTT broker (Home Assistant bridge) |
| `:11434` | Ollama |
| `:18789` | OpenClaw (optional) |
| mDNS | `atlas.local` (robot bodies) |

## Upgrade path

| Stage | Release | Adds |
|---|---|---|
| 1. AI desktop command center | v0.1 | This repo: remodelled dashboard, faces, 4-tier gateway |
| 2. Personal agent OS | v0.5 | Autonomy, plugins, voice, memory graph |
| 3. IoT + biometric interface | v1.0–2.0 | MQTT fleet, NERVELINK EEG/ECG |
| 4. Robotics brain | v3.0 | `robotics/atlas-robot` on Pi 5, ROS 2 bridge |
| 5. Build-your-own-JARVIS kit | — | Marketplace, Mark-series personas ("an edition is a config, not a fork") |
