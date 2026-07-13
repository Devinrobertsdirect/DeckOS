import { Router } from "express";
import {
  ListPluginsResponse,
  GetPluginParams,
  GetPluginResponse,
  TogglePluginParams,
  TogglePluginBody,
  TogglePluginResponse,
  ExecutePluginCommandParams,
  ExecutePluginCommandBody,
  ExecutePluginCommandResponse,
} from "@workspace/api-zod";
import { db, pluginStateTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

type PluginStatus = "active" | "inactive" | "error" | "loading";

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  status: PluginStatus;
  commands: string[];
  category: string;
  lastActivity: string | null;
  errorMessage: string | null;
}

const plugins: Plugin[] = [
  {
    id: "system_monitor",
    name: "System Monitor",
    description: "Real-time CPU, memory, network, and process monitoring",
    version: "1.2.0",
    enabled: true,
    status: "active",
    commands: ["stats", "processes", "network", "disk", "alert-threshold"],
    category: "monitoring",
    lastActivity: null,
    errorMessage: null,
  },
  {
    id: "file_manager",
    name: "File Manager",
    description: "Browse, search, read, and manage local filesystem operations",
    version: "1.0.3",
    enabled: true,
    status: "active",
    commands: ["ls", "read", "write", "search", "delete", "move"],
    category: "system",
    lastActivity: null,
    errorMessage: null,
  },
  {
    id: "ai_chat",
    name: "AI Chat",
    description: "Conversational AI interface routed through the AI Router",
    version: "2.1.0",
    enabled: true,
    status: "active",
    commands: ["chat", "summarize", "explain", "analyze", "generate"],
    category: "ai",
    lastActivity: null,
    errorMessage: null,
  },
  {
    id: "device_control",
    name: "Device Control",
    description: "MQTT/WebSocket IoT device interface with simulated device support",
    version: "1.1.2",
    enabled: true,
    status: "active",
    commands: ["list", "read", "control", "simulate", "discover"],
    category: "iot",
    lastActivity: null,
    errorMessage: null,
  },
  {
    id: "automation_scheduler",
    name: "Automation Scheduler",
    description: "Schedule and manage automated tasks, cron jobs, and event triggers",
    version: "1.0.8",
    enabled: false,
    status: "inactive",
    commands: ["schedule", "list", "run", "cancel", "history"],
    category: "automation",
    lastActivity: null,
    errorMessage: null,
  },
];

const pluginHandlers: Record<string, Record<string, (args: Record<string, unknown>) => Promise<{ output: string; data?: Record<string, unknown> }>>> = {
  system_monitor: {
    stats: async () => ({ output: "System stats retrieved successfully", data: { cpu: 23.4, memory: 67.2, uptime: 98234 } }),
    processes: async () => ({ output: "Top 5 processes listed", data: { count: 5 } }),
    network: async () => ({ output: "Network interfaces scanned", data: { interfaces: ["eth0", "lo"] } }),
    disk: async () => ({ output: "Disk usage analyzed", data: { usage: 45.6 } }),
    "alert-threshold": async (args) => ({ output: `Alert threshold set to ${args.threshold ?? "80"}%`, data: args }),
  },
  file_manager: {
    ls: async (args) => ({ output: `Directory listing for ${args.path ?? "/"}`, data: { files: ["README.md", "config.json"] } }),
    read: async (args) => ({ output: `File read: ${args.path ?? "unknown"}`, data: { size: 1024 } }),
    search: async (args) => ({ output: `Search results for: ${args.query ?? ""}`, data: { results: [] } }),
  },
  ai_chat: {
    chat: async (args) => ({ output: `AI response: I am JARVIS, your Deck OS assistant. Query: "${String(args.message ?? "").substring(0, 50)}"`, data: {} }),
    summarize: async (args) => ({ output: `Summary: Content analyzed and condensed.`, data: {} }),
    explain: async (args) => ({ output: `Explanation: ${args.topic ?? "topic"} — processing via AI router.`, data: {} }),
  },
  device_control: {
    list: async () => ({ output: "5 simulated devices found", data: { count: 5 } }),
    discover: async () => ({ output: "Device discovery scan complete", data: { found: 2 } }),
    read: async (args) => ({ output: `Sensor read from device ${args.deviceId ?? "unknown"}`, data: {} }),
    control: async (args) => ({ output: `Control signal sent to ${args.deviceId ?? "device"}`, data: { success: true } }),
  },
  automation_scheduler: {
    list: async () => ({ output: "No scheduled tasks — plugin is inactive", data: { tasks: [] } }),
  },
};

const HEALTH_CHECK_COMMANDS: Record<string, string> = {
  system_monitor: "stats",
  file_manager: "ls",
  ai_chat: "chat",
  device_control: "list",
  automation_scheduler: "list",
};

async function persistPluginState(plugin: Plugin): Promise<void> {
  try {
    await db
      .insert(pluginStateTable)
      .values({
        pluginId: plugin.id,
        enabled: plugin.enabled,
        lastActivity: plugin.lastActivity ? new Date(plugin.lastActivity) : null,
      })
      .onConflictDoUpdate({
        target: pluginStateTable.pluginId,
        set: {
          enabled: plugin.enabled,
          lastActivity: plugin.lastActivity ? new Date(plugin.lastActivity) : null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err, pluginId: plugin.id }, "plugins: failed to persist plugin state to DB");
  }
}

async function loadPluginState(): Promise<void> {
  try {
    const rows = await db.select().from(pluginStateTable);
    const stateMap = new Map(rows.map((r) => [r.pluginId, r]));

    for (const plugin of plugins) {
      const saved = stateMap.get(plugin.id);
      if (saved) {
        plugin.enabled = saved.enabled;
        plugin.status = saved.enabled ? "active" : "inactive";
        plugin.lastActivity = saved.lastActivity ? saved.lastActivity.toISOString() : null;
      } else {
        // First run — seed the DB with the default state
        await persistPluginState(plugin);
      }
    }
  } catch (err) {
    logger.warn({ err }, "plugins: failed to load plugin state from DB — using in-memory defaults");
  }
}

async function pingPlugin(plugin: Plugin): Promise<void> {
  const command = HEALTH_CHECK_COMMANDS[plugin.id];
  const handlers = pluginHandlers[plugin.id] ?? {};
  const handler = command ? handlers[command] : undefined;
  if (!handler) return;
  try {
    await handler({});
    plugin.lastActivity = new Date().toISOString();
    plugin.status = "active";
    plugin.errorMessage = null;
    await persistPluginState(plugin);
  } catch {
    plugin.status = "error";
    plugin.errorMessage = "Health check failed";
  }
}

async function runHealthChecks(): Promise<void> {
  for (const plugin of plugins) {
    if (plugin.enabled) {
      await pingPlugin(plugin);
    }
  }
}

loadPluginState().then(() => runHealthChecks()).catch(() => runHealthChecks());

const HEALTH_INTERVAL_MS = 60_000;
setInterval(runHealthChecks, HEALTH_INTERVAL_MS);

router.get("/plugins", (req, res) => {
  const body = ListPluginsResponse.parse({ plugins });
  res.json(body);
});

router.get("/plugins/:pluginId", (req, res) => {
  const params = GetPluginParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const plugin = plugins.find((p) => p.id === params.data.pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  const body = GetPluginResponse.parse(plugin);
  res.json(body);
});

router.post("/plugins/:pluginId/toggle", async (req, res) => {
  const params = TogglePluginParams.safeParse(req.params);
  const body = TogglePluginBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const plugin = plugins.find((p) => p.id === params.data.pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }

  plugin.enabled = body.data.enabled;
  plugin.status = body.data.enabled ? "active" : "inactive";
  if (body.data.enabled) {
    pingPlugin(plugin).catch(() => {});
  }

  await persistPluginState(plugin);

  const response = TogglePluginResponse.parse(plugin);
  res.json(response);
});

router.post("/plugins/:pluginId/execute", async (req, res) => {
  const params = ExecutePluginCommandParams.safeParse(req.params);
  const bodyParsed = ExecutePluginCommandBody.safeParse(req.body);
  if (!params.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const plugin = plugins.find((p) => p.id === params.data.pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }

  if (!plugin.enabled) {
    const response = ExecutePluginCommandResponse.parse({
      success: false,
      output: `Plugin ${plugin.name} is disabled`,
      data: null,
      executionTimeMs: 0,
      modelUsed: null,
    });
    res.json(response);
    return;
  }

  const start = Date.now();
  const { command, args = {} } = bodyParsed.data;
  const handlers = pluginHandlers[plugin.id] ?? {};
  const handler = handlers[command];

  let output = "";
  let data: Record<string, unknown> | null = null;
  let success = true;

  try {
    if (handler) {
      const result = await handler(args as Record<string, unknown>);
      output = result.output;
      data = result.data ?? null;
    } else {
      output = `Command "${command}" not found in plugin ${plugin.name}`;
      success = false;
    }
  } catch (err) {
    output = `Execution error: ${err instanceof Error ? err.message : "unknown error"}`;
    success = false;
  }

  if (success) {
    plugin.lastActivity = new Date().toISOString();
    await persistPluginState(plugin);
  }

  const response = ExecutePluginCommandResponse.parse({
    success,
    output,
    data,
    executionTimeMs: Date.now() - start,
    modelUsed: null,
  });
  res.json(response);
});

export default router;
