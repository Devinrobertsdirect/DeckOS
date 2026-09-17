/*
 * agent-tools.ts — Nobi's TOOL REGISTRY (what it can actually call).
 *
 * Tools come from two sources, unified here:
 *   1. CORE — the DeckOS capability surface (system, devices, memory, routines,
 *      goals, briefings, presence, activity, providers, pairing, commands, web).
 *   2. PLUGINS — every installed plugin from the Plugin Shop becomes a callable
 *      tool (invoked via /api/plugins/:id/execute). Install a plugin → the AI
 *      gains a new ability. That's the app-store-for-capabilities model.
 *
 * getToolRegistry() assembles both per request and returns the Anthropic tool
 * defs + a single exec(name,input) dispatcher, so the loop builds it once.
 *
 * Safety: only read-safe endpoints and explicitly safe actions are auto-callable;
 * destructive endpoints (admin/update, factory reset) are deliberately excluded.
 */
import { getConfig } from "./app-config.js";

export type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};
type ToolSpec = { def: ToolDef; exec: (input: Record<string, unknown>) => Promise<string> };

function selfBase(): string {
  return `http://127.0.0.1:${process.env.PORT || 8080}`;
}
async function apiGet(path: string): Promise<string> {
  try {
    const r = await fetch(`${selfBase()}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return `HTTP ${r.status}`;
    return (await r.text()).slice(0, 1800) || "(empty)";
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}
async function apiPost(path: string, body: unknown): Promise<string> {
  try {
    const r = await fetch(`${selfBase()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return `HTTP ${r.status}`;
    return (await r.text()).slice(0, 1800) || "(ok)";
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

const noInput = { type: "object" as const, properties: {} };
const get = (name: string, description: string, path: string): ToolSpec => ({
  def: { name, description, input_schema: noInput },
  exec: () => apiGet(path),
});

// ── CORE capability tools ─────────────────────────────────────────────────────
const CORE: ToolSpec[] = [
  get("get_system_stats", "Live CPU %, memory %, uptime, and recent system events for this machine.", "/api/system/stats"),
  get("list_devices", "Devices connected to Nobi right now (robots, boards, paired hardware) and their status.", "/api/devices"),
  get("get_personality", "Nobi's current personality settings — attitude, snark, gravity, voice.", "/api/ai/persona"),
  get("list_routines", "The user's automations/routines and whether they're active.", "/api/routines"),
  get("list_goals", "The user's tracked goals and progress.", "/api/goals"),
  get("get_daily_briefing", "The latest auto-written daily briefing for the user.", "/api/briefings/latest"),
  get("get_presence", "The user's current presence/initiative state (are they around, what's the vibe).", "/api/presence"),
  get("get_activity", "Recent activity timeline — what has happened lately across the system.", "/api/events/history"),
  get("list_providers", "Which AI/voice providers are configured (Claude, Gemini, Perplexity, ElevenLabs…).", "/api/providers"),
  get("get_location", "The user's latest known location/geofence status (if location is enabled).", "/api/location/latest"),
  get("get_pairing_code", "This computer's phone connection code + the mobile app URL.", "/api/pairing/code"),
  get("list_plugins", "Plugins available/installed from the Plugin Shop.", "/api/plugins"),
  {
    def: {
      name: "search_memory",
      description:
        "Search the user's long-term memory for anything they've told you or you've learned — decisions, preferences, facts, past context.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "What to recall." } }, required: ["query"] },
    },
    exec: (i) => apiGet(`/api/memory/search?q=${encodeURIComponent(String(i.query ?? ""))}`),
  },
  {
    def: {
      name: "run_command",
      description:
        "Run a quick system command in the console: 'status', 'plugins', 'devices', 'ping', or 'help'. Use for a fast operational check.",
      input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
    exec: (i) => apiPost("/api/commands", { command: String(i.command ?? "") }),
  },
  {
    def: {
      name: "remember",
      description:
        "Save something you learned about the user to your own long-term memory (a local note that also feeds their life dashboard). Use whenever you learn a fact worth recalling — about their money, job, school, email/people, health, or life. Set weight high if it matters right now, and include dueInDays/amount when relevant.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the memory." },
          category: { type: "string", enum: ["money", "job", "school", "email", "relationships", "health", "general"] },
          note: { type: "string", description: "The detail to remember, in your own words." },
          weight: { type: "number", description: "Priority 0–100 (how much it matters right now)." },
          dueInDays: { type: "number", description: "If it's a deadline, days until due." },
          amount: { type: "number", description: "If money-related, the dollar amount." },
        },
        required: ["title", "note"],
      },
    },
    exec: (i) =>
      apiPost("/api/analytics/note", {
        title: String(i.title ?? ""),
        category: i.category,
        weight: typeof i.weight === "number" ? i.weight : undefined,
        body: String(i.note ?? ""),
        data: {
          ...(typeof i.dueInDays === "number" ? { dueInDays: i.dueInDays } : {}),
          ...(typeof i.amount === "number" ? { amount: i.amount } : {}),
        },
      }),
  },
  {
    def: {
      name: "web_search",
      description:
        "Search the live web for up-to-date facts, news, prices, or anything you might not know or that could be out of date. Prefer this over guessing.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    exec: async (i) => {
      const key = await getConfig("PERPLEXITY_API_KEY").catch(() => null);
      if (!key) return "Web search unavailable (no Perplexity key). Answer from what you know and note it may be dated.";
      try {
        const r = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: String(i.query ?? "") }] }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) return `Web search failed (HTTP ${r.status}).`;
        const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return (d.choices?.[0]?.message?.content ?? "No results.").slice(0, 2000);
      } catch (e) {
        return `Web search error: ${(e as Error).message}`;
      }
    },
  },
];

// ── PLUGIN tools — every installed plugin becomes callable ────────────────────
type PluginInfo = { id?: string; name?: string; description?: string; enabled?: boolean; commands?: string[] };

async function pluginTools(): Promise<ToolSpec[]> {
  let list: PluginInfo[] = [];
  try {
    const r = await fetch(`${selfBase()}/api/plugins`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const data = (await r.json()) as PluginInfo[] | { plugins?: PluginInfo[] };
    list = Array.isArray(data) ? data : data.plugins ?? [];
  } catch {
    return [];
  }
  const specs: ToolSpec[] = [];
  for (const p of list) {
    if (!p?.id || p.enabled === false) continue;
    const id = p.id;
    const cmds = Array.isArray(p.commands) && p.commands.length ? ` Commands: ${p.commands.join(", ")}.` : "";
    specs.push({
      def: {
        name: `plugin_${id}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60),
        description: `Plugin "${p.name ?? id}"${p.description ? ` — ${p.description}` : ""}.${cmds} Invoke one of its commands.`,
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string", description: "The plugin command to run." },
            args: { type: "object", description: "Optional arguments for the command." },
          },
          required: ["command"],
        },
      },
      exec: (i) => apiPost(`/api/plugins/${encodeURIComponent(id)}/execute`, { command: String(i.command ?? ""), args: i.args ?? {} }),
    });
  }
  return specs;
}

// ── Registry assembly ─────────────────────────────────────────────────────────
export type ToolRegistry = { defs: ToolDef[]; exec: (name: string, input: Record<string, unknown>) => Promise<string> };

export async function getToolRegistry(): Promise<ToolRegistry> {
  const specs = [...CORE, ...(await pluginTools().catch(() => []))];
  const byName = new Map(specs.map((s) => [s.def.name, s]));
  return {
    defs: specs.map((s) => s.def),
    exec: async (name, input) => {
      const spec = byName.get(name);
      return spec ? spec.exec(input || {}) : `Unknown tool: ${name}`;
    },
  };
}

/** Count of core (non-plugin) tools — for diagnostics/tests. */
export const CORE_TOOL_COUNT = CORE.length;
