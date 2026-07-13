# RESEARCH — stack decisions ledger

Why each piece of the stack is what it is, and what is deliberately deferred.
Companion to [ARCHITECTURE.md](ARCHITECTURE.md).

## Model routing — the 4-tier router

Decision: **Claude API for APEX, Ollama for CORTEX + REFLEX, deterministic
rules for AUTOPILOT** (config: [`intelligence/presets.json`](../intelligence/presets.json)).
Rationale: one cloud dependency at the top for quality, everything below it
local so the system degrades to "dumber but alive" instead of "offline".

Claude models & rough pricing (per Mtok in/out — **verify at
platform.claude.com pricing docs before relying on these**):

| Model | Input | Output | Role |
|---|---|---|---|
| Fable 5 | $10 | $50 | frontier reasoning, used sparingly |
| Sonnet 5 | $2 / $10 intro, then $3 / $15 | | APEX default — best cost/quality |
| Haiku 4.5 | $1 | $5 | cheap cloud fallback when local is unavailable |

`CLOUD_PREFERENCE` (`always` / `auto` / `never`) governs escalation —
local-first, cloud optional.

## OpenClaw interop (verified facts, cite docs.openclaw.ai)

- OpenClaw follows the **AgentSkills spec** — `SKILL.md` folders with YAML
  frontmatter (`name`, `description`) + markdown body; interoperable with
  Claude skills and with `marketplace/skills/`.
- Skill install: `openclaw skills install @owner/<slug>`.
- User skills live in `~/.openclaw/workspace/skills/`.
- Community registry: **ClawHub** at clawhub.ai.
- Atlas detects OpenClaw's gateway on `:18789` as an Ollama-compatible
  provider in the failover chain.

## Decisions by area

| Area | Adopt now (v0.1) | Defer (→ v3.0) |
|---|---|---|
| **Agent runtime** | Bespoke inference gateway in `core/server` (simple, debuggable, ours) | MCP client support on the roadmap — plugins as MCP servers is the obvious convergence |
| **Memory** | SQLite/Postgres facts (Drizzle) + markdown **AtlasBrain** vault (human-readable, Obsidian-compatible) | ChromaDB / vector store for semantic recall; knowledge-graph queries |
| **Voice** | faster-whisper STT + Piper TTS, both local; ElevenLabs as optional cloud voice | XTTS voice cloning; on-robot wake-word tuning |
| **Vision** | MediaPipe (already shipping in the desktop for hand tracking) | YOLO for object detection on robot camera; VLM scene description |
| **IoT** | Mosquitto broker + Home Assistant bridge over MQTT `:1883` | HA MQTT Discovery auto-publish; Zigbee/Z-Wave direct |
| **Robotics** | Raspberry Pi 5 + bespoke asyncio HAL (`robotics/atlas-robot`) | ROS 2 LTS + micro-ROS bridge; Jetson Orin when vision gets heavy |
| **Backend / store** | Current Express 5 server + `registry.json` plugin registry | **Atlas Cloud**: accounts, hosted marketplace, cross-device sync |
| **Desktop** | Electron shell (`interfaces/electron`) wrapping the Vite dashboard | Tauri evaluation if bundle size matters |
| **CLI** | `atlas` (Node, runs via `npx`, `installer/atlas-cli`) | plugin/skill scaffolding subcommands |

## Adopt-now vs defer, by release

| Release | Adopt | Explicitly deferred |
|---|---|---|
| **v0.1** | 4-tier router, dashboard + faces, SQLite facts, markdown vault, Express + registry.json, Electron, atlas CLI | vectors, MCP, ROS |
| **v0.5** | autonomy + routines, local voice (faster-whisper/Piper), plugin store polish | cloud accounts |
| **v1.0–2.0** | MQTT fleet + HA bridge, NERVELINK EEG/ECG, vector memory (ChromaDB), MCP client | Jetson |
| **v3.0** | Pi 5 robot brain, ROS 2 LTS + micro-ROS, YOLO vision | — |
| **Beyond** | Atlas Cloud (accounts / marketplace / sync), Mark-series kit | |

## Standing principles

1. **Local-first, cloud optional** — every cloud dependency has a local
   fallback tier; the system must boot and be useful on a laptop with no keys.
2. **An edition is a config, not a fork** — personas, faces, and editions are
   YAML/JSON data (`config/`, `intelligence/`), never branches.
3. **One bus, everywhere** — `domain.action` topics on the desktop
   (`@workspace/event-bus`), the robot (`robot/core/event_bus.py`), and MQTT
   mirror each other so components are location-independent.
4. **Verify pricing/model claims at the provider docs** — numbers in this file
   date quickly; platform.claude.com and docs.openclaw.ai are the sources.
