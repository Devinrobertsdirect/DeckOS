# marketplace/ — plugins & skills

Two ways to extend Atlas:

| Kind | Format | Runs where | Registry |
|---|---|---|---|
| **Plugins** | sandboxed `.mjs` (Worker thread) | inside the Atlas server | `core/server/registry.json` |
| **Skills** | `SKILL.md` folders (AgentSkills spec) | injected into agent context | `marketplace/skills/` (+ external hubs) |

## Plugins

The plugin store is served by the Atlas server. The registry of installable
plugins lives at **`core/server/registry.json`** (override with the
`PLUGIN_REGISTRY_URL` env var), and downloaded community plugin files land in
**`core/server/community-plugins/`**. Those stay where they are — this folder
documents and curates; the server owns the runtime.

Authoring, sandbox API, permissions, and publishing flow:
`core/server/REGISTRY_FORMAT.md` and the root README's plugin section.

## Skills (AgentSkills format)

A skill is a folder containing a `SKILL.md` with YAML frontmatter
(`name` + `description` required) and a markdown body of instructions the
agent loads when the skill is relevant:

```
skills/
└── example-weather/
    └── SKILL.md      # frontmatter + instructions (+ optional scripts/, references/)
```

```markdown
---
name: example-weather
description: Fetch and summarise current weather. Use when the user asks about weather or forecasts.
---

# Instructions the agent follows when the skill triggers...
```

This is the [AgentSkills](https://agentskills.io) spec — the same format used
by Claude skills, so a skill written here works in Claude Code and vice versa.

### OpenClaw interop (verified)

[OpenClaw](https://docs.openclaw.ai) follows the AgentSkills spec, so Atlas
skills are portable to it directly:

- Install: `openclaw skills install @owner/<slug>`
- User skills live in `~/.openclaw/workspace/skills/`
- Community registry: **ClawHub** at [clawhub.ai](https://clawhub.ai)

Drop any folder from `marketplace/skills/` into the OpenClaw workspace skills
directory and it just works; publish to ClawHub to share it.

### Included examples

| Skill | What it does |
|---|---|
| [`skills/example-weather`](skills/example-weather/SKILL.md) | Fetches current weather from Open-Meteo (no API key) and reports it in persona |

### Writing your own

1. `mkdir marketplace/skills/<your-skill>` and add a `SKILL.md`.
2. Frontmatter: `name` (lowercase, hyphens) and `description` — the
   description is the trigger, so say *when* to use it, not just what it is.
3. Keep the body focused and procedural; link out to `references/` files for
   bulky material so the context stays lean.
4. Optional extras per the spec: bundled `scripts/`, `references/`, `assets/`.
