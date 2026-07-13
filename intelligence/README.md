# intelligence/ — the 4-tier model router

Configuration for the Atlas inference gateway (implemented in
`core/server/src/lib/inference.ts`; robot-side mirror in
`robotics/atlas-robot/robot/ai/llm.py`). Callers never pick a model — they
declare a **task type**, and the router picks the cheapest tier that can do
the job. **It never goes silent.**

## The four tiers (`presets.json`)

| Tier | Provider | Typical models | Used for |
|---|---|---|---|
| **APEX** | Anthropic Claude API | Fable 5 · Opus 4.8 · Sonnet 5 (default) · Haiku 4.5 | deep reasoning, architecture, research, coding — "big-brain mode" |
| **CORTEX** | Ollama (local) | first available of: gemma, llama, mistral, deepseek, qwen | chat, planning, summarisation, briefings |
| **REFLEX** | Ollama (local, small) | first available of: phi, qwen-small, smollm, tinyllama | classification, intent routing, command parsing (<200 ms budget) |
| **AUTOPILOT** | deterministic rules | — | system checks, device polling, safety fallback |

`cortex.prefer` / `reflex.prefer` are ordered *name prefixes*: the router
scans the local Ollama model list (`ollama list`) and takes the first
installed model whose name starts with a preferred prefix — so `gemma3:9b`
satisfies `gemma`, `phi3` satisfies `phi`.

Failover chain: **APEX → CORTEX → REFLEX → AUTOPILOT** (with OpenClaw on
`:18789` detected as an extra Ollama-compatible provider). No API key and no
Ollama? You still get the rule engine — local-first, cloud optional.

## `CLOUD_PREFERENCE`

Env var controlling how eagerly the router escalates to APEX (cloud):

| Value | Behaviour |
|---|---|
| `always` | Route every eligible task to APEX when a key is present (max quality, max cost) |
| `auto` (default) | APEX only for tasks tagged deep-reasoning/coding; everything else stays local |
| `never` | Hard offline mode — cloud is never called, even with a key configured |

Related env: `ANTHROPIC_API_KEY` (enables APEX), `OLLAMA_HOST`
(default `http://localhost:11434`).

## Editing presets

- Model ids in `apex.models` are the allowed list shown in
  Settings → AI Config; `apex.default` must be one of them.
- Verify current model names and pricing at
  [platform.claude.com](https://platform.claude.com) before shipping changes.
- Adding a local model family: append its prefix to `prefer` — no code change.
