# DeckOS Atlas — One Brain, Many Bodies

> Companion to [ARCHITECTURE.md](ARCHITECTURE.md) (the Brain / Nervous System / Body
> split) and [ROBOTICS.md](ROBOTICS.md) (ATL-HW-001, the Pi 5 robot). This document
> covers how the *same* brain reaches every body — desktop, Raspberry Pi, and the
> custom robot PCB — and how a body with no internet of its own **borrows a signal**
> over Bluetooth.

## The hub-brain model

Neura is the **computer–human interaction layer**. It is the one thing that binds
together four otherwise separate worlds:

- **the computer** — files, apps, the OS, the desktop command center
- **the LLMs** — Claude, Gemini, Perplexity, OpenAI, and the local Ollama tiers
- **the physical robot** — the Pi 5 body from ROBOTICS.md, with a face, wheels, and senses
- **the Cyber Deck** — the portable console/dashboard the user carries with them

The important promise: **it is one brain, not four integrations.** The Neura you
talk to on the desktop is *numerically the same agent* — same memory, same
personality, same gateway — that inhabits the robot's head. A body is just a
surface the brain projects itself onto. Swapping bodies never swaps minds.

```
                         ┌─────────────────┐
                         │   ATLAS BRAIN   │   reasoning · memory ·
                         │  (core/server)  │   personality · gateway
                         └────────┬────────┘
                                  │  one agent, many surfaces
         ┌────────────────┬───────┴────────┬──────────────────┐
         ▼                ▼                ▼                  ▼
   ┌───────────┐   ┌────────────┐   ┌────────────┐    ┌────────────┐
   │  Computer │   │    LLMs    │   │   Robot    │    │ Cyber Deck │
   │  desktop  │   │ Claude/…/  │   │  Pi 5 body │    │  portable  │
   │  command  │   │  Ollama    │   │  + face    │    │  console   │
   │  center   │   │            │   │            │    │            │
   └───────────┘   └────────────┘   └────────────┘    └────────────┘
```

## Body tiers

Neura runs across three classes of hardware. Each carries a different amount of the
brain, and each reaches the *full* brain by a different route.

| Tier | Body | What it runs | Reaches the brain via |
|---|---|---|---|
| **1** | **Windows PC** (also macOS/Linux) | **Full server** — `core/server` Atlas Core, the 4-tier gateway, memory, dashboard. This machine *is* a brain host. | Local: it **is** the backend (`:8080`). Or points at the shared Replit backend. |
| **2** | **Raspberry Pi 5** robot | **Edge agent** — `robotics/atlas-robot` (Python 3.12 asyncio, event-bus, HAL). Local Ollama + Piper for offline fallback. Renders the face, drives motors, runs the voice pipeline. | Connects **out** to a brain: `ws://…:8080/api/ws` over Wi-Fi, or **borrows a signal** over BLE from a nearby phone/PC when it has no network of its own. |
| **3** | **Custom robot PCB** | **Firmware** — a microcontroller-class board (sensors, motor driver, power, face bus). No general OS, no LLM. Speaks a compact intent/telemetry protocol. | Never talks to the cloud directly. Pairs over **BLE / Wi-Fi / direct USB** to a Tier-1 or Tier-2 host that acts as its gateway. |

The rule of thumb: **the higher the tier number, the less brain the body carries, and
the more it leans on a host.** A Tier-1 PC is self-sufficient; a Tier-3 PCB is pure
body and always borrows a mind.

## The Bluetooth "brain-borrow"

The robot has **no independent path to the cloud LLMs.** It has no SIM, and out in the
world it often has no trusted Wi-Fi. So it does what a phone-tethered device does: it
**borrows the signal** from something that *does* have a path — the user's phone or PC,
which is already running an Atlas client and already holds the account and keys.

The phone/PC becomes the robot's **network + LLM gateway**. The robot streams *intents*
up (what it heard, what it saw, what it wants to do) and gets *speech and actions* back.

### The flow

```
  ┌────────┐   BLE / Wi-Fi   ┌──────────────────┐   Wi-Fi/LTE   ┌──────────────┐   HTTPS   ┌──────┐
  │ ROBOT  │ ⇄  / USB       ⇄ │  PHONE / PC      │ ⇄            ⇄ │ ATLAS        │ ⇄        ⇄ │ LLMs │
  │ (body) │                  │  (Atlas client = │               │ BACKEND      │           │ APEX │
  │  face  │  intent-out ───▶ │   the gateway)   │  ── request ─▶│ core/server  │  ──────▶  │ tier │
  │  mics  │  ◀─── speech-in  │                  │  ◀─ response  │  gateway     │  ◀──────  │      │
  │  ToF   │  telemetry ───▶  │                  │               │  + memory    │           │      │
  └────────┘  ◀── control     └──────────────────┘               └──────────────┘           └──────┘
```

Read it as: **Robot ⇄ BLE ⇄ Phone/PC (Atlas client) ⇄ Wi-Fi ⇄ Atlas backend ⇄ LLMs.**
The robot never sees an API key and never opens a socket to Anthropic or Google. It
only ever talks to whatever friendly gateway it paired with; the gateway does the rest.

Transport preference, best to worst latency/bandwidth:

1. **Direct USB** (bench / charging / setup) — a wired serial link, highest bandwidth.
2. **Wi-Fi** — when the robot and a host share a LAN, it uses the normal
   `ws://…:8080/api/ws` path (see ROBOTICS.md → Network). No borrowing needed.
3. **BLE** — the "out in the world" case: low bandwidth, but enough for JSON intents and
   compressed/streamed speech. This is the brain-borrow proper.

### Offline fallback

If **no** phone/PC is in range and there is **no** Wi-Fi, the robot does not brick — it
falls back to the **local models on the Pi** (Ollama for reasoning, Piper for TTS, per
ROBOTICS.md → Voice stack). It degrades to a smaller, local personality (the gateway's
`CORTEX → REFLEX → AUTOPILOT` tiers, minus the cloud APEX tier) until a signal — or a
phone — comes back. **It never goes silent.**

### BLE GATT service sketch (proposed)

A single custom GATT service exposes the borrow protocol. UUIDs below are **placeholder
128-bit UUIDs for the roadmap** — treat them as a proposal to be finalized, not an
allocated block.

| Role | Type | UUID (proposed) | Direction | Payload |
|---|---|---|---|---|
| **Atlas Borrow Service** | Service | `A71A5000-0000-1000-8000-00805F9B34FB` | — | container for the four characteristics |
| **intent-out** | Characteristic (Notify) | `A71A5001-…` | robot → host | what the robot wants: transcript, detected intent, vision summary |
| **speech-in** | Characteristic (Write / Write-No-Response, chunked) | `A71A5002-…` | host → robot | the reply to speak/act: text, TTS audio frames, or an action |
| **telemetry** | Characteristic (Notify) | `A71A5003-…` | robot → host | battery %, IMU/pose, ToF ranges, face state, health |
| **control** | Characteristic (Write) | `A71A5004-…` | host → robot | commands: drive, stop, dock, set-expression, e-stop |

Notes: BLE MTU is small (~180–512 B after negotiation), so anything large — a full TTS
clip or a camera still — is **chunked and reassembled** with the framing below. `speech-in`
audio streams as sequential frames so the face's TALKING state can key off amplitude as
it arrives, rather than waiting for the whole clip.

### JSON framing example

Every logical message is a small JSON envelope. When it exceeds the MTU it is split into
`seq`/`total` frames on the same characteristic and reassembled by `id`.

```jsonc
// intent-out : the robot heard something and wants a response
{
  "v": 1,                       // protocol version
  "id": "3f9c",                 // message id (frames of one message share it)
  "seq": 0, "total": 1,         // framing: this is frame 0 of 1
  "t": "intent",
  "body": {
    "kind": "utterance",
    "transcript": "atlas, what's my next meeting?",
    "confidence": 0.94,
    "vision": null              // optional scene summary
  }
}
```

```jsonc
// speech-in : the gateway's reply, streamed back to be spoken
{
  "v": 1, "id": "3f9c",
  "seq": 1, "total": 3,         // audio split across 3 frames
  "t": "speech",
  "body": {
    "text": "Your next meeting is the Atlas sync at 3 PM.",
    "expression": "talking",    // face state to hold (see FACE-SPEC.md)
    "audio": "…base64 opus frame…",
    "format": "opus"
  }
}
```

```jsonc
// telemetry : periodic, fire-and-forget
{ "v": 1, "id": "b210", "seq": 0, "total": 1, "t": "telemetry",
  "body": { "battery": 0.62, "docked": false, "face": "idle", "tof_mm": [820,910,1200,760,540] } }
```

```jsonc
// control : host tells the body to do something
{ "v": 1, "id": "c001", "seq": 0, "total": 1, "t": "control",
  "body": { "cmd": "dock" } }        // or {"cmd":"drive","v":0.3,"w":0.0}, {"cmd":"estop"}
```

### Implemented vs. roadmap

| Piece | Status |
|---|---|
| Wi-Fi path: robot ⇄ `ws://…:8080/api/ws` ⇄ backend ⇄ LLMs | **Implemented** (the normal desktop/Pi topology per ARCHITECTURE.md & ROBOTICS.md). |
| Local offline fallback (Ollama + Piper on the Pi) | **Implemented** in the robot scaffold's voice/gateway design. |
| The pairing surface (`core/server/src/routes/pairing.ts`) | **Partial** — a pairing route exists; the BLE profile below binds to it. |
| BLE GATT service, characteristics, and JSON framing above | **Roadmap** — proposed here; not yet an allocated UUID block or shipped firmware. |
| Direct-USB serial transport | **Roadmap**. |

## The Replit-hosted backend

The **intended production topology** is that **every body talks through ONE backend
server, deployed on Replit**, wired to the GitHub repo so that **push → Replit
redeploy**. There is exactly one brain host in the cloud; Windows, Pi, and PCB clients
all point their REST/WS base URL at it.

> **Local dev uses `localhost:8080`.** Replit is the shared/hosted target. The two are
> the same server (`core/server`) behind different base URLs — nothing about a body
> changes except the URL it dials.

### Device registration & sync

- On first contact a body registers with the backend (via the pairing/discovery
  routes) and gets a **device record** and a **short-lived session** (see Security).
- Thereafter every body — desktop, Pi, PCB-via-gateway — points at the **same base URL**
  and shares **one** memory, one gateway, one config. State written on the desktop is
  visible to the robot because there is only one brain behind the URL.
- Discovery on a LAN still uses mDNS `atlas.local`; over the internet, bodies use the
  configured Replit base URL directly.

### Deploy to Replit from GitHub — checklist

1. **Import the repo** into Replit ("Create Repl" → "Import from GitHub" → the DeckOS
   Atlas repo). Connect the GitHub account so Replit can pull.
2. **Set the run/build** to start `core/server` (the `@workspace/api-server` package) and
   bind it to Replit's provided `$PORT` (map it to the app's `:8080` contract).
3. **Add the env vars / Secrets** (next section) in Replit's Secrets pane — never commit
   them.
4. **Enable auto-deploy on push**: connect the GitHub repo so a push to the tracked
   branch triggers a redeploy. (Replit Deployments → connect repo → deploy on push.)
5. **Grab the public base URL** Replit assigns (e.g. `https://atlas-<you>.replit.app`).
6. **Point the bodies at it**: set each client's REST/WS base URL to that host
   (`https://…` for REST, `wss://…/api/ws` for the socket).
7. **Push to redeploy**: from then on, `git push` → Replit rebuilds and redeploys. No
   manual step.

### Env vars set on Replit (Secrets)

Set the LLM/provider keys (mirrored into `process.env` via the config API — see
[GENESIS.md](GENESIS.md)) plus the server basics. Set only what you use:

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude — APEX tier |
| `GEMINI_API_KEY` | Gemini |
| `PERPLEXITY_API_KEY` | Perplexity (web-grounded) |
| `OPENAI_API_KEY` | OpenAI / GPT |
| `ELEVENLABS_API_KEY` | Server (premium) voice |
| `DATABASE_URL` | Postgres for memory/facts (optional; SQLite works for local) |
| `PORT` | Provided by Replit; the server binds to it (maps to the `:8080` contract) |
| *(others per provider)* | e.g. media provider tokens as you connect them |

> Keys set here live **on the backend/account**, exactly like keys saved through the
> desktop setup wizard's `PUT /api/config`. They are the brain's keys, not any body's.

## Security note

- **Keys live on the user's account and backend — never on the robot.** The Pi and the
  PCB do not store `ANTHROPIC_API_KEY` or any provider secret. They physically cannot
  leak what they never hold.
- The robot (and any borrowed gateway on its behalf) authenticates to the backend and
  receives a **short-lived session token** scoped to that device. That is the *only*
  credential a body ever holds, and it expires.
- A stolen or lost robot therefore exposes no long-lived secrets — revoke its device
  session and it is inert. The brain, the keys, and the memory stay behind the backend.
