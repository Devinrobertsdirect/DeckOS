import { Router } from "express";
import { db, commandHistoryTable, systemEventsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  ListCommandsResponse,
  DispatchCommandBody,
  DispatchCommandResponse,
  GetCommandHistoryQueryParams,
  GetCommandHistoryResponse,
} from "@workspace/api-zod";

const router = Router();

const COMMAND_REGISTRY = [
  { id: "status", name: "status", description: "Get system status", plugin: "system_monitor", syntax: "status", examples: ["status", "status --verbose"] },
  { id: "plugins-list", name: "plugins list", description: "List all plugins", plugin: "system_monitor", syntax: "plugins list", examples: ["plugins list"] },
  { id: "devices-list", name: "devices list", description: "List IoT devices", plugin: "device_control", syntax: "devices list", examples: ["devices list"] },
  { id: "memory-search", name: "memory search", description: "Search memory entries", plugin: "ai_chat", syntax: "memory search <query>", examples: ["memory search network", "memory search error"] },
  { id: "infer", name: "infer", description: "Send prompt to AI router", plugin: "ai_chat", syntax: "infer <prompt>", examples: ["infer explain quantum computing", "infer summarize logs"] },
  { id: "ls", name: "ls", description: "List files in directory", plugin: "file_manager", syntax: "ls [path]", examples: ["ls /", "ls /home"] },
  { id: "ping", name: "ping", description: "Ping the system", plugin: "system_monitor", syntax: "ping", examples: ["ping"] },
  { id: "help", name: "help", description: "List all available commands", plugin: "system_monitor", syntax: "help", examples: ["help"] },
];

type IntelligenceMode = "DIRECT_EXECUTION" | "LIGHT_REASONING" | "DEEP_REASONING" | "HYBRID_MODE";

function parseCommand(input: string): { command: string; args: string[]; plugin: string | null } {
  const parts = input.trim().split(/\s+/);
  const cmdDef = COMMAND_REGISTRY.find((c) => input.toLowerCase().startsWith(c.name));
  return {
    command: parts[0] ?? input,
    args: parts.slice(1),
    plugin: cmdDef?.plugin ?? null,
  };
}

function executeRuleBasedCommand(input: string): { output: string; plugin: string | null } {
  const lower = input.toLowerCase().trim();

  if (lower === "ping") return { output: "PONG — System responsive. Latency: <1ms", plugin: "system_monitor" };
  if (lower === "help") return { output: `Available commands:\n${COMMAND_REGISTRY.map((c) => `  ${c.syntax.padEnd(30)} ${c.description}`).join("\n")}`, plugin: "system_monitor" };
  if (lower.startsWith("status")) return { output: "DECK OS STATUS: NOMINAL\nAll 4 plugins active | 5 devices online | Memory: 127 entries | AI Router: rule-engine-v1", plugin: "system_monitor" };
  if (lower.startsWith("plugins")) return { output: "Plugins: system_monitor [ACTIVE] | file_manager [ACTIVE] | ai_chat [ACTIVE] | device_control [ACTIVE] | automation_scheduler [INACTIVE]", plugin: "system_monitor" };
  if (lower.startsWith("devices")) return { output: "Devices: 5 simulated | temp-sensor-01 [ONLINE] | humidity-01 [ONLINE] | relay-01 [ONLINE] | display-01 [STANDBY]", plugin: "device_control" };
  if (lower.startsWith("ls")) {
    const path = lower.replace("ls", "").trim() || "/";
    return { output: `[FILE MANAGER] ${path}:\n  config.json\n  logs/\n  plugins/\n  memory.db\n  README.md`, plugin: "file_manager" };
  }
  if (lower.startsWith("memory search")) {
    const q = input.replace(/memory search/i, "").trim();
    return { output: `[MEMORY] Searching for: "${q}" — no persistent results in rule mode. Use AI mode for semantic search.`, plugin: "ai_chat" };
  }
  if (lower.startsWith("infer")) {
    return { output: `[AI ROUTER] Rule-engine fallback active. Switch to LIGHT_REASONING or DEEP_REASONING mode to use LLM inference.`, plugin: "ai_chat" };
  }

  return { output: `Command not recognized: "${input.substring(0, 60)}". Type "help" for available commands.`, plugin: null };
}

router.get("/commands", (req, res) => {
  const body = ListCommandsResponse.parse({ commands: COMMAND_REGISTRY });
  res.json(body);
});

router.post("/commands", async (req, res) => {
  const parsed = DispatchCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { input, mode = "auto" } = parsed.data;
  const start = Date.now();
  const parsed2 = parseCommand(input);

  const { output, plugin } = executeRuleBasedCommand(input);
  const executionTimeMs = Date.now() - start;
  const aiAssisted = false;
  const modeUsed = mode === "auto" ? "DIRECT_EXECUTION" : mode;

  await db.insert(commandHistoryTable).values({
    input,
    output,
    success: true,
    plugin: plugin ?? parsed2.plugin,
    command: parsed2.command,
    modeUsed,
    aiAssisted,
    executionTimeMs,
  });

  await db.insert(systemEventsTable).values({
    level: "info",
    message: `Command dispatched: ${input.substring(0, 50)}`,
    source: "command_router",
    data: { plugin, executionTimeMs },
  });

  const body = DispatchCommandResponse.parse({
    success: true,
    output,
    plugin: plugin ?? parsed2.plugin,
    command: parsed2.command,
    executionTimeMs,
    modeUsed,
    aiAssisted,
    timestamp: new Date().toISOString(),
  });
  res.json(body);
});

router.get("/commands/history", async (req, res) => {
  const params = GetCommandHistoryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 50;
  const history = await db.select().from(commandHistoryTable)
    .orderBy(desc(commandHistoryTable.createdAt))
    .limit(limit);

  const body = GetCommandHistoryResponse.parse({
    history: history.map((h) => ({
      id: String(h.id),
      input: h.input,
      output: h.output,
      success: h.success ?? true,
      plugin: h.plugin,
      executionTimeMs: h.executionTimeMs ?? 0,
      timestamp: h.createdAt.toISOString(),
    })),
    total: history.length,
  });
  res.json(body);
});

export default router;
