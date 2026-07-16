# DeckOS Atlas — Genesis (the first-run sequence)

> A developer's guide to what happens the *very first* time someone opens Neura, before
> they ever see a dashboard. Genesis is three acts: **Setup wizard → Genesis intro →
> the app (Pet or Developer mode).** Related: [ARCHITECTURE.md](ARCHITECTURE.md),
> [FACE-SPEC.md](FACE-SPEC.md) (the expressions), [DEVICES-AND-BLE.md](DEVICES-AND-BLE.md)
> (the "lives in your robot" promise the intro makes).

## The shared contracts

Genesis is assembled from a few files that are **contracts** — read and import them, do
not fork them:

| File | Exports | Role |
|---|---|---|
| `interfaces/desktop/src/lib/uiMode.ts` | `useUiMode`, `getUiMode`/`setUiMode`, `isSetupDone`/`markSetupDone`, `isIntroDone`/`markIntroDone`, `getUserName`/`setUserName`, `resetGenesis` | The gates and the Pet/Developer mode switch. |
| `interfaces/desktop/src/genesis/providers.ts` | `PROVIDERS`, `ProviderDef`, `providersByCategory` | The manifest of minds the wizard offers. |
| `interfaces/desktop/src/genesis/useAtlasVoice.ts` | `useAtlasVoice()`, `getVoiceEngine`/`setVoiceEngine` | One voice API over two engines (browser / server). |
| `interfaces/desktop/src/genesis/genesisScript.ts` | `buildGenesisScript(ctx)`, `scriptToText`, `GenesisBeat`, `GenesisContext` | The narration, one expression-tagged beat at a time. |
| `interfaces/desktop/src/components/faces/AtlasFace.tsx` | `<AtlasFace state=… activity=… />` | The fullscreen face that speaks the intro. |

## The flow

```
  first open
      │
      ▼
  ┌──────────────┐   isSetupDone()? ── true ──┐
  │ SETUP WIZARD │                            │
  │ name · keys  │   markSetupDone()          │
  │ voice engine │────────────┐               │
  └──────────────┘            ▼               ▼
                        ┌──────────────┐   isIntroDone()? ── true ──┐
                        │ GENESIS INTRO│                            │
                        │ talking face │   markIntroDone()          │
                        │ buildGenesis…│────────────┐               │
                        └──────────────┘            ▼               ▼
                                              ┌────────────────────────┐
                                              │  THE APP                │
                                              │  Pet mode (default)     │
                                              │  or Developer mode      │
                                              └────────────────────────┘
```

Both gates are checked on load. If both are already satisfied, Neura boots straight into
the app in the last-used `atlas_ui_mode`.

## Act 1 — Setup wizard

Runs while `isSetupDone()` is `false`. It collects three things and nothing else — the
goal is "talking to Neura in under a minute," not a settings marathon.

1. **Name.** "What should I call you?" → `setUserName(name)`. Stored in
   `atlas_user_name`; later spoken by the intro (`{name}`) and used throughout the app.
2. **Provider keys.** Renders the `PROVIDERS` manifest (group with `providersByCategory`
   — `chat`, `voice`, `image`, `video`). For each provider the user pastes a key; save it
   with **`PUT /api/config { [keyName]: value }`** (e.g. `{ "ANTHROPIC_API_KEY": "sk-…" }`).
   The backend persists it **and mirrors it into `process.env`** so the gateway and
   connectors pick it up live — no restart. `keysUrl` links out to where to get each key;
   `testable` providers can be live-checked; `status` (`"wired"` vs `"stub"`) tells the
   user which are real integrations vs. connector stubs awaiting an official API. **Keys
   are write-only from the UI** — never read them back or print them.
3. **Voice engine.** `setVoiceEngine("browser" | "server")`. `"browser"` is the
   zero-config default (`window.speechSynthesis`). `"server"` unlocks once an ElevenLabs
   key is saved and gives Neura a real, waveform-driven voice. Stored in
   `atlas_voice_engine`.

On finish, call `markSetupDone()` and advance to the intro.

## Act 2 — Genesis intro

Runs while `isIntroDone()` is `false`. A **single fullscreen `<AtlasFace>`** wakes up and
speaks — this is the emotional first impression, the "partner not appliance" beat.

**Build the script:**

```ts
import { buildGenesisScript } from "@/genesis/genesisScript";
import { getUserName } from "@/lib/uiMode";
import { getVoiceEngine } from "@/genesis/useAtlasVoice";

const beats = buildGenesisScript({
  name: getUserName(),
  providers: connectedProviderNames,   // e.g. ["Claude","Gemini"] — drives the "you already use…" beat
  premiumVoice: getVoiceEngine() === "server",
  hour: new Date().getHours(),         // picks Good morning/afternoon/evening
});
```

Each `GenesisBeat` is `{ expression, text, hold? }`. The arc: **wake → meet → what I am →
I already talk to your other minds → I live in your devices and your robot → let's
begin.** The narration is personalized (name, the actual providers connected, a premium-
voice thank-you if `server` voice is on) and it explicitly makes the
[brain-borrow](DEVICES-AND-BLE.md) promise: *"the same brain you're talking to now is the
one that will live inside your robot's head."*

**Speak it, one beat at a time, expression synced to the words:**

```ts
const { speak } = useAtlasVoice();

for (const beat of beats) {
  setFaceState(beat.expression);          // hold this FaceState while the line is spoken
  await speak(beat.text);                 // resolves when the utterance finishes
  if (beat.hold) await delay(beat.hold);  // a beat of silence after the line
}
markIntroDone();
```

Because `speak()` resolves when the utterance ends, the face's expression changes **per
beat** and stays in step with the audio. With the `server` voice, `useAtlasVoice`
attaches an amplitude analyser so the TALKING mouth tracks the real waveform; with the
`browser` voice it falls back to a cadence bounce. Empty-text beats (`text: ""`) are pure
pauses used for the wake — asleep on the dock, eyes closed, then open. Use `scriptToText`
to render captions for accessibility.

Offer a **skip** (still call `markIntroDone()`), and see `resetGenesis()` below for a
"replay intro" control.

## Act 3 — Pet mode vs Developer mode

After the intro, Neura lands in the app in one of two UI modes (`useUiMode()` /
`getUiMode()` / `setUiMode()`, persisted in `atlas_ui_mode`, **default `"pet"`**):

| Mode | Who it's for | What it is |
|---|---|---|
| **`pet`** (default) | A kid, a grandparent, anyone who just wants to talk to it | One big face, one input, almost no chrome — a super-computer R2-D2 you talk to. |
| **`developer`** | Builders | The full command center: every panel, plugin, route, and knob. |

`setUiMode()` also dispatches an `atlas:uiModeChanged` window event, so `useUiMode()`
subscribers re-render live when the mode is toggled anywhere in the app.

## localStorage gates (the whole state of first-run)

| Key | Set by | Meaning |
|---|---|---|
| `atlas_genesis_setup_done` | `markSetupDone()` | Setup wizard finished — skip Act 1. |
| `atlas_genesis_intro_done` | `markIntroDone()` | Intro watched (or skipped) — skip Act 2. |
| `atlas_ui_mode` | `setUiMode()` | `"pet"` or `"developer"` (default `"pet"`). |
| `atlas_user_name` | `setUserName()` | What Neura calls the user; spoken in the intro. |
| `atlas_voice_engine` | `setVoiceEngine()` | `"browser"` (default) or `"server"` (ElevenLabs). |

> Note: `atlas_user_name`, `atlas_ui_mode`, and `atlas_voice_engine` are *preferences*
> that persist for the life of the app. `resetGenesis()` only clears the two **gate**
> keys, so replaying the intro keeps the user's name, mode, and voice choice.

### Resetting

```ts
import { resetGenesis } from "@/lib/uiMode";

resetGenesis();     // clears atlas_genesis_setup_done + atlas_genesis_intro_done
// then reload — Atlas runs the wizard and intro again from the top.
```

Wire this behind a "replay intro / re-run setup" control in Developer mode. To reset a
single preference instead, remove its key directly (e.g.
`localStorage.removeItem("atlas_voice_engine")`). Provider keys are **not** in
localStorage — they live server-side via the config API and are cleared there.

## How to add a provider

Two edits keep the manifest and the backend in agreement:

1. **Frontend manifest** — add a `ProviderDef` to `PROVIDERS` in
   `interfaces/desktop/src/genesis/providers.ts`:

   ```ts
   {
     id: "myprovider",
     name: "My Provider",
     category: "chat",                 // "chat" | "voice" | "image" | "video"
     keyName: "MYPROVIDER_API_KEY",    // the config key the key is stored under
     blurb: "One line the wizard shows.",
     keysUrl: "https://…/api-keys",    // where the user gets a key
     testable: true,                   // can Atlas live-test it in setup?
     status: "wired",                  // "wired" (real API) vs "stub" (connector pending)
   }
   ```

   That alone makes it appear in the setup wizard, and `PUT /api/config` will persist its
   `keyName` and mirror it to `process.env`.

2. **Backend connector** — register the actual integration server-side (the provider/
   connector layer in `core/server`, e.g. the backend `providers.ts` / the gateway's
   connector registry) so the saved key is used to make real calls, and so `testable`
   providers have something to test against. Ship it as `status: "stub"` until the real
   connector lands, then flip it to `"wired"`.

Keep the two in sync: a `ProviderDef` with no backend connector should stay
`status: "stub"` so the wizard is honest about what actually works.

## AI-powered intro (v2)

The intro narration is generated live the first time Neura meets a user, so the
"banter" is written by the model, not hard-coded:

- `POST /api/genesis/intro { name, providers?[] }` → `{ beats:[{expression,text}], source:"ai"|"fallback" }`.
  Server (`core/server/src/routes/genesis.ts`) prompts the gateway for a JSON
  array of expression+text beats, validates them (expressions must be one of
  idle/happy/listening/thinking/excited/confused), and returns a hand-written
  fallback if generation or JSON parsing fails.
- The client (`GenesisIntro.tsx`) pre-fetches on mount (cached in sessionStorage
  as `atlas_intro_beats`) so it's ready by the time the user taps to wake Neura.
  If the model is slow (local Ollama can take ~40–100s), it falls back to the
  static `buildGenesisScript` after ~2.5s — the user never waits. A fast cloud
  model (Claude Haiku, Gemini Flash) returns in a couple of seconds and the
  spoken intro is fully personalized (it names the providers you connected).

## Setup wizard (4 steps)

Name → **How Neura gets smart** (a plain-language API/keys explainer, added so a
non-technical user understands *before* the connect screen) → Connect your minds
→ Give me a voice. All before the intro.

## Voice

`useAtlasVoice` picks the clearest installed English voice and speaks a touch
faster (rate 1.08) for clarity; `warmUpVoices()` is called on the setup and
intro screens so the first utterance isn't delayed by async voice loading.
ElevenLabs remains the premium upgrade (amplitude-driven mouth motion).

## Voice loop & flow (v3)

Reordered so the **API-keys screen is the first thing after the home screen**:

1. Home (StartScreen)
2. **Do you have any AI keys to plug in?** — provider cards with a plain-language
   primer, save or skip. The voice engine is auto-set here: if an ElevenLabs key
   is present, Neura uses it; otherwise the browser voice.
3. **What should I call you?** — name.
4. **Genesis intro** — AI-written, uses the connected providers.
5. **Talk or type?** (`InputChoice.tsx`) — Neura asks out loud; choosing *Talk*
   triggers `acquireMic()` (silent on a robot with no permission gate, a prompt on
   desktop). On denial it falls back to text gracefully.
6. **Pet mode** — in the chosen modality.

### Hands-free listening with semantic endpointing

`useAtlasListening.ts` runs Web Speech continuous recognition and decides when a
person is *actually* done vs. just thinking mid-sentence:

- Finalized chunks accumulate in a buffer; on each pause `looksIncomplete()`
  checks whether the text trails off on a conjunction / filler / preposition /
  modal ("I want **to**…", "**and then**…", "we **could**…").
- Complete-looking thoughts send after a short grace (~450 ms); trailing-off ones
  wait up to ~2.2 s for more speech before sending anyway.
- While Neura speaks it goes deaf (`paused`) so it never hears itself.
- No SpeechRecognition (or the robot build) → falls back to text / the robot's
  own Whisper+VAD stack.

`micAccess.ts` probes for a mic without prompting (`hasMicDevice()`) and acquires
it (`acquireMic()`) — robot-aware. Input mode is stored as `atlas_input_mode`.
