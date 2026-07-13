import { existsSync } from "fs";
import path from "path";
import { bus } from "./bus.js";
import { migrateConfig } from "./app-config.js";
import { PluginRegistry } from "./plugin-registry.js";
import { memoryService } from "./memory-service.js";
import { runInference, runInferenceStreaming, refreshOllamaDetection, getInferenceState, type InferenceMode } from "./inference.js";
import { broadcast } from "./ws-server.js";
import { buildPersonalizedPrompt } from "./system-prompt.js";
import { logger } from "./logger.js";
import { presenceManager } from "./presence-manager.js";
import { initiativeEngine } from "./initiative-engine.js";
import { narrativeManager } from "./narrative-manager.js";
import { createDeviceManager, type DeviceManager } from "./device-manager.js";
import { MqttTransport } from "./mqtt-transport.js";
import { WsDeviceTransport } from "./ws-device-transport.js";
import { startSimulatedDevices } from "./simulated-devices.js";
import type { BusEvent } from "@workspace/event-bus";
import { db, deviceLocationsTable, deviceProfilesTable, autonomyConfigTable, autonomyLogTable, routinesTable, aiPersonaTable } from "@workspace/db";
import { checkEasterEgg } from "./easter-eggs.js";
import { generateDeviceProfile } from "./profile-generator.js";
import { cognitiveLoop } from "./cognitive-loop.js";
import { memoryEnricher } from "./memory-enricher.js";
import { routineRunner } from "./routine-runner.js";
import { notificationService } from "./notification-service.js";
import { eq } from "drizzle-orm";

export let registry: PluginRegistry;

// ── ACERA scene context (updated by client every 500 ms) ─────────────────────
interface AceraScenePayload {
  handCount: number;
  activity: string;
  dominantGesture: string | null;
  summary: string;
  frameCount: number;
  hands: Array<{
    handedness: string;
    gesture: string;
    confidence: number;
    palmX: number;
    palmY: number;
    fingers: boolean[];
  }>;
}

let _aceraScene: AceraScenePayload | null = null;
let _aceraLastMs = 0;
const ACERA_STALE_MS = 5_000; // ignore if not updated for 5 s

export function getAceraContext(): string | null {
  if (!_aceraScene) return null;
  if (Date.now() - _aceraLastMs > ACERA_STALE_MS) return null;
  return _aceraScene.summary;
}

// ── STARK bioelectric context (updated by client every 600 ms) ───────────────
interface StarkScenePayload {
  mode: string;
  amplitude: number;
  contraction: string;
  brainEvent: string;
  heartEvent: string;
  bpm: number | null;
  sampleRate: number;
  portName: string;
  summary: string;
}

let _starkScene: StarkScenePayload | null = null;
let _starkLastMs = 0;
const STARK_STALE_MS = 5_000;

export function getStarkContext(): string | null {
  if (!_starkScene) return null;
  if (Date.now() - _starkLastMs > STARK_STALE_MS) return null;
  return _starkScene.summary;
}

let mqttTransport: MqttTransport | null = null;
let wsDeviceTransport: WsDeviceTransport | null = null;
let stopSimDevices: (() => void) | null = null;
let routerStatusTimer: NodeJS.Timeout | null = null;
let currentAiMode = "DIRECT_EXECUTION";

function emitRouterStatus(): void {
  const state = getInferenceState();
  const totalReqs = state.totalRequests;
  const cacheHitRate = totalReqs > 0 ? state.cacheHits / totalReqs : 0;
  bus.emit({
    source: "ai-router",
    target: null,
    type: "ai.router.status",
    payload: {
      mode: currentAiMode,
      ollamaAvailable: state.ollamaAvailable ?? false,
      cloudAvailable: false,
      totalRequests: totalReqs,
      cacheHitRate: parseFloat(cacheHitRate.toFixed(4)),
      lastDetectedAt: state.lastDetected.toISOString(),
      timestamp: new Date().toISOString(),
    },
  });
}

function registerQueryHandlers(deviceManager: DeviceManager): void {
  bus.subscribe("device.list.request", async (event: BusEvent) => {
    if (event.type !== "device.list.request") return;
    const devices = deviceManager.listDevices().map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      category: d.category,
      protocol: d.protocol,
      status: d.state.status,
      readings: d.state.readings,
      lastSeen: d.state.lastSeen,
      location: d.location,
      capabilities: d.capabilities,
    }));
    bus.emit({
      source: "device-manager",
      target: event.source,
      type: "device.registry.snapshot",
      payload: { devices, count: devices.length },
    });
  });

  bus.subscribe("plugin.list.request", (event: BusEvent) => {
    if (event.type !== "plugin.list.request") return;
    const plugins = registry
      ? registry.listPlugins().map((p) => ({
          id: p.plugin.id,
          name: p.plugin.name,
          version: p.plugin.version,
          enabled: p.enabled,
          status: p.status,
        }))
      : [];
    bus.emit({
      source: "plugin-registry",
      target: event.source,
      type: "plugin.list.response",
      payload: { plugins, count: plugins.length },
    });
  });

  bus.subscribe("memory.search.request", async (event: BusEvent) => {
    if (event.type !== "memory.search.request") return;
    const p = event.payload as Record<string, unknown>;
    const query = String(p?.["query"] ?? "");
    if (!query) return;
    const results = await memoryService.search(query, 10);
    bus.emit({
      source: "memory-service",
      target: event.source,
      type: "memory.search.response",
      payload: { query, results, count: results.length },
    });
  });

  bus.subscribe("memory.recent.request", async (event: BusEvent) => {
    if (event.type !== "memory.recent.request") return;
    const p = event.payload as Record<string, unknown>;
    const limit = typeof p?.["limit"] === "number" ? p["limit"] : 20;
    const entries = await memoryService.getRecent(limit);
    bus.emit({
      source: "memory-service",
      target: event.source,
      type: "memory.recent.response",
      payload: { entries, count: entries.length },
    });
  });

  bus.subscribe("ai.mode.set", (event: BusEvent) => {
    if (event.type !== "ai.mode.set") return;
    const p = event.payload as Record<string, unknown>;
    const mode = String(p?.["mode"] ?? currentAiMode);
    currentAiMode = mode;
    emitRouterStatus();
  });

  bus.subscribe("plugin.toggle.request", (event: BusEvent) => {
    if (event.type !== "plugin.toggle.request") return;
    const p = event.payload as Record<string, unknown>;
    const pluginId = String(p?.["pluginId"] ?? "");
    const enabled = Boolean(p?.["enabled"] ?? false);
    if (!pluginId) return;
    registry.setEnabled(pluginId, enabled);
  });

  // ── Community Plugin Hot-Reload ───────────────────────────────────────────
  // WS or bus clients emit plugin.reload to trigger unload + reload from disk.
  // Useful when a plugin's entrypoint file has been updated without reinstalling.
  bus.subscribe("plugin.reload", async (event: BusEvent) => {
    if (event.type !== "plugin.reload") return;
    const p = event.payload as Record<string, unknown>;
    const pluginId = String(p?.["pluginId"] ?? "");
    if (!pluginId) return;

    logger.info({ pluginId }, "Bootstrap: plugin.reload received — hot-reloading community plugin");

    const existing = registry.getPlugin(pluginId);
    if (existing) {
      await registry.unloadPlugin(pluginId).catch((err) =>
        logger.warn({ err, pluginId }, "Bootstrap: hot-reload unload failed"),
      );
    }

    // Re-load from disk if the local file exists
    const { COMMUNITY_PLUGINS_DIR } = await import("../routes/store.js");
    const localPath = path.join(COMMUNITY_PLUGINS_DIR, `${pluginId}.mjs`);

    if (existsSync(localPath)) {
      const loaded = await registry.loadCommunityPlugin(localPath, pluginId).catch(() => false);
      bus.emit({
        source: "plugin-registry",
        target: null,
        type: "plugin.status_changed",
        payload: { pluginId, reloaded: true, loaded },
      });
      logger.info({ pluginId, loaded }, "Bootstrap: community plugin hot-reload complete");
    } else {
      logger.warn({ pluginId, localPath }, "Bootstrap: plugin.reload — local file not found, cannot reload");
      bus.emit({
        source: "plugin-registry",
        target: null,
        type: "plugin.error",
        payload: { pluginId, error: "hot-reload failed — plugin file not found on disk" },
      });
    }
  });

  // ── WS Chat Handler: ai.chat.request → streaming inference ────────────────
  // The Command Console sends ai.chat.request via WebSocket. This handler picks
  // it up on the bus, runs real streaming inference, and broadcasts tokens back.
  bus.subscribe("ai.chat.request", async (event: BusEvent) => {
    if (event.type !== "ai.chat.request") return;
    const p = event.payload as Record<string, unknown>;
    const prompt    = typeof p["prompt"]    === "string" ? p["prompt"]    : "";
    const requestId = typeof p["requestId"] === "string" ? p["requestId"] : null;
    const modeStr   = typeof p["mode"]      === "string" ? p["mode"]      : "DEEP_REASONING";
    if (!prompt || !requestId) return;

    // Map UI mode label → inference mode
    const inferenceMode: InferenceMode =
      modeStr === "DIRECT_EXECUTION"  ? "none" :
      modeStr === "LIGHT_REASONING"   ? "fast" : "deep";

    // Tell the UI we received the request and are routing
    broadcast({
      type: "ai.inference_started",
      source: "ai-router",
      payload: { requestId, mode: modeStr },
      timestamp: new Date().toISOString(),
    });

    const basePrompt = await buildPersonalizedPrompt([], "console").catch(
      () => "You are JARVIS, a precise and capable AI command center assistant.",
    );
    const aceraCtx = getAceraContext();
    const systemPrompt = aceraCtx
      ? `${basePrompt}\n\n--- ACERA SCENE CONTEXT ---\n${aceraCtx}\n---`
      : basePrompt;

    // ── Easter egg check ──────────────────────────────────────────────────
    const personaRows = await db.select().from(aiPersonaTable).limit(1).catch(() => []);
    const personaCtx = personaRows.length > 0
      ? { aiName: personaRows[0]!.aiName, gender: personaRows[0]!.gender }
      : { aiName: "JARVIS", gender: "neutral" };
    const eggReply = checkEasterEgg(prompt, personaCtx);

    if (eggReply !== null) {
      // Emit a brief fake token so the streaming cursor shows
      broadcast({
        type: "ai.chat.token",
        source: "ai-router",
        payload: { requestId, token: eggReply },
        timestamp: new Date().toISOString(),
      });
      broadcast({
        type: "ai.chat.response",
        source: "ai-router",
        payload: {
          requestId,
          response:  eggReply,
          modelUsed: "easter-egg-v1",
          latencyMs: 1,
          fromCache:  false,
          mode:       modeStr,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    try {
      const result = await runInferenceStreaming(
        {
          prompt,
          mode: inferenceMode,
          task: "chat",
          context: [{ role: "system", content: systemPrompt }],
          onTierResolved: (tier, model) => {
            broadcast({
              type: "ai.inference_started",
              source: "ai-router",
              payload: { requestId, tier, model },
              timestamp: new Date().toISOString(),
            });
          },
        },
        (token) => {
          broadcast({
            type: "ai.chat.token",
            source: "ai-router",
            payload: { requestId, token },
            timestamp: new Date().toISOString(),
          });
        },
      );

      broadcast({
        type: "ai.chat.response",
        source: "ai-router",
        payload: {
          requestId,
          response:   result.response,
          modelUsed:  result.modelUsed,
          latencyMs:  result.latencyMs,
          fromCache:  result.fromCache,
          mode:       modeStr,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err, requestId }, "WS chat handler: inference failed");
      broadcast({
        type: "ai.chat.response",
        source: "ai-router",
        payload: {
          requestId,
          response: "Inference error — rule engine fallback active.",
          modelUsed: "rule-engine-v1",
          latencyMs: 0,
          fromCache: false,
          mode: modeStr,
        },
        timestamp: new Date().toISOString(),
      });
    }
  });
}

async function seedBriefingRoutine(): Promise<void> {
  try {
    const existing = await db
      .select({ id: routinesTable.id })
      .from(routinesTable)
      .where(eq(routinesTable.actionType, "generate_briefing"))
      .limit(1);
    if (existing.length > 0) return;

    await db.insert(routinesTable).values({
      name:         "Daily AI Briefing at 06:00",
      enabled:      true,
      triggerType:  "cron",
      triggerValue: "0 6 * * *",
      actionType:   "generate_briefing",
      actionParams: {},
    });
    logger.info("Bootstrap: daily briefing routine seeded");
  } catch (err) {
    logger.warn({ err }, "Bootstrap: briefing routine seed failed");
  }
}

async function seedStarterRoutines(): Promise<void> {
  try {
    const existing = await db.select({ id: routinesTable.id }).from(routinesTable).limit(1);
    if (existing.length > 0) return;

    const starters: (typeof routinesTable.$inferInsert)[] = [
      {
        name:         "Daily health check at 07:00",
        enabled:      false,
        triggerType:  "cron",
        triggerValue: "0 7 * * *",
        actionType:   "run_health_check",
        actionParams: {},
      },
      {
        name:         "Alert on device disconnect",
        enabled:      false,
        triggerType:  "event",
        triggerValue: "device.disconnected",
        actionType:   "send_notification",
        actionParams: { title: "Device Disconnected", message: "A device left the network." },
      },
    ];

    await db.insert(routinesTable).values(starters);
    logger.info({ count: starters.length }, "RoutineRunner: starter routines seeded");
  } catch (err) {
    logger.warn({ err }, "RoutineRunner: starter routine seed failed");
  }
}

export async function bootstrap(): Promise<void> {
  await migrateConfig();

  memoryService.start(60_000);
  presenceManager.start(30_000);
  initiativeEngine.start(60_000);

  setTimeout(() => void narrativeManager.syncFromGoals(), 10_000);

  registry = new PluginRegistry(bus, {
    memory: memoryService,
    infer: async (opts) => {
      const result = await runInference(opts);
      return result;
    },
  });

  bus.emit({
    source: "system",
    target: null,
    type: "system.boot",
    payload: { startedAt: new Date().toISOString() },
  });

  await refreshOllamaDetection().catch(() => {});

  // Re-probe Ollama every 30 s so it is discovered automatically when started
  // after the server (e.g. user launches Ollama while Deck OS is already running).
  setInterval(() => { void refreshOllamaDetection().catch(() => {}); }, 30_000);

  await registry.loadPluginsDir();

  const { loadEnabledCommunityPlugins } = await import("../routes/store.js");
  await loadEnabledCommunityPlugins().catch((err) =>
    logger.warn({ err }, "Bootstrap: community plugin restore failed"),
  );

  const deviceManager = createDeviceManager(bus);

  registerQueryHandlers(deviceManager);

  // ── ACERA scene update subscription ──────────────────────────────────────
  bus.subscribe("acera.scene.update", (event: BusEvent) => {
    if (event.type !== "acera.scene.update") return;
    const p = event.payload as AceraScenePayload;
    if (p && typeof p.summary === "string") {
      _aceraScene  = p;
      _aceraLastMs = Date.now();
    }
  });

  // ── STARK bioelectric scene update subscription ───────────────────────────
  bus.subscribe("stark.scene.update", (event: BusEvent) => {
    if (event.type !== "stark.scene.update") return;
    const p = event.payload as StarkScenePayload;
    if (p && typeof p.summary === "string") {
      _starkScene  = p;
      _starkLastMs = Date.now();
    }
  });

  stopSimDevices = startSimulatedDevices(deviceManager);

  routerStatusTimer = setInterval(emitRouterStatus, 10_000);
  setTimeout(emitRouterStatus, 2_000);

  mqttTransport = new MqttTransport(bus, deviceManager);
  await mqttTransport.start();

  const wsDevicePort = Number(process.env["WS_DEVICE_PORT"] ?? 0);
  if (wsDevicePort > 0) {
    try {
      wsDeviceTransport = new WsDeviceTransport(wsDevicePort, bus, deviceManager);
    } catch (err) {
      logger.warn({ err }, "WsDeviceTransport: failed to start — continuing without WS device transport");
    }
  } else {
    logger.info("WsDeviceTransport: WS_DEVICE_PORT not set — WS device transport disabled");
  }

  // ── GPS location persistence ──────────────────────────────────────────────
  // Intercept device.reading events from mobile/WebSocket devices that carry
  // GPS data and persist them into device_locations for the map layer.
  bus.subscribe("device.reading", async (event: BusEvent) => {
    if (event.type !== "device.reading") return;

    const p = event.payload as Record<string, unknown>;
    const values = p["values"] as Record<string, unknown> | undefined;
    if (!values) return;

    const gps = values["gps"] as Record<string, unknown> | undefined;
    if (!gps || typeof gps["lat"] !== "number" || typeof gps["lon"] !== "number") return;

    const deviceId   = typeof p["deviceId"]   === "string" ? p["deviceId"]   : String(event.source ?? "unknown");
    const deviceType = typeof p["deviceType"] === "string" ? p["deviceType"] : "unknown";
    const bat        = (values["battery"] as Record<string, unknown> | undefined);
    const battery    = typeof bat?.["level"] === "number" ? (bat["level"] as number) : undefined;
    const netInfo    = (values["network"] as Record<string, unknown> | undefined);
    const signal     = typeof netInfo?.["type"] === "string" ? (netInfo["type"] as string) : undefined;

    try {
      await db.insert(deviceLocationsTable).values({
        deviceId,
        deviceType,
        lat:      gps["lat"] as number,
        lng:      gps["lon"] as number,
        accuracy: typeof gps["accuracy"] === "number" ? gps["accuracy"] as number : undefined,
        altitude: typeof gps["altitude"] === "number" ? gps["altitude"] as number : undefined,
        speed:    typeof gps["speed"]    === "number" ? gps["speed"]    as number : undefined,
        battery:  battery ?? undefined,
        signal:   signal  ?? undefined,
        source:   "websocket",
        extra:    {},
      });

      bus.emit({
        source: `device.${deviceId}`,
        target: null,
        type:   "device.location.updated",
        payload: {
          deviceId,
          deviceType,
          coordinates: { lat: gps["lat"], lng: gps["lon"] },
          accuracy:    gps["accuracy"],
          battery,
          signal,
          timestamp:   typeof p["timestamp"] === "string" ? p["timestamp"] : new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.debug({ err, deviceId }, "GPS persistence skipped");
    }
  });

  // ── Device Discovery ──────────────────────────────────────────────────────
  // When any non-simulated device connects for the first time (no existing profile
  // in device_profiles), emit device.discovery.new with a generated suggestion.
  bus.subscribe("device.connected", async (event: BusEvent) => {
    if (event.type !== "device.connected") return;

    const p = event.payload as Record<string, unknown>;
    const deviceId = typeof p["deviceId"] === "string" ? p["deviceId"] : null;
    if (!deviceId) return;

    // Skip simulated devices — they're always present and don't need onboarding
    const protocol = typeof p["protocol"] === "string" ? p["protocol"] : "";
    if (protocol === "simulated") return;

    try {
      const [existing] = await db
        .select({ deviceId: deviceProfilesTable.deviceId })
        .from(deviceProfilesTable)
        .where(eq(deviceProfilesTable.deviceId, deviceId))
        .limit(1);

      if (existing) return; // Already profiled — silent reconnect

      // Build suggestion from event payload
      const suggestion = generateDeviceProfile({
        id:           deviceId,
        name:         typeof p["name"]     === "string" ? p["name"]     : deviceId,
        type:         typeof p["type"]     === "string" ? p["type"]     : "unknown",
        category:     typeof p["category"] === "string" ? p["category"] : "sensor",
        protocol,
        capabilities: Array.isArray(p["capabilities"]) ? p["capabilities"] as string[] : [],
      });

      bus.emit({
        source: `device.${deviceId}`,
        target: null,
        type:   "device.discovery.new",
        payload: {
          deviceId,
          protocol,
          deviceType:  typeof p["type"]     === "string" ? p["type"]     : "unknown",
          deviceName:  typeof p["name"]      === "string" ? p["name"]     : deviceId,
          capabilities: Array.isArray(p["capabilities"]) ? p["capabilities"] : [],
          suggestion,
          timestamp: new Date().toISOString(),
        },
      });

      logger.info({ deviceId, protocol }, "Device Discovery: new device detected");
    } catch (err) {
      logger.debug({ err, deviceId }, "Device discovery check failed");
    }
  });

  // ── Autonomy Pipeline: bus-driven action execution ────────────────────────
  // Listens for autonomy.action.request events (emitted by cognitive-loop or
  // other sources) and processes them through the autonomy controller logic.
  bus.subscribe("autonomy.action.request", async (event: BusEvent) => {
    if (event.type !== "autonomy.action.request") return;
    const p = event.payload as Record<string, unknown>;
    const action      = typeof p["action"]      === "string" ? p["action"]      : "";
    const parameters  = typeof p["parameters"]  === "object" ? (p["parameters"] as Record<string, unknown>) : {};
    const requestedBy = typeof p["requestedBy"] === "string" ? p["requestedBy"] : "system";
    const reason      = typeof p["reason"]      === "string" ? p["reason"]      : "";
    if (!action) return;

    try {
      const configRows = await db.select().from(autonomyConfigTable).limit(1);
      const config = configRows[0];
      if (!config || !config.enabled) {
        bus.emit({ source: "autonomy-controller", target: null, type: "autonomy.action.skipped",
          payload: { action, reason: "autonomy disabled", requestedBy } });
        return;
      }

      const allowed  = (config.allowedActions as string[]) ?? [];
      const blocked  = (config.blockedActions as string[]) ?? [];
      const isBlocked   = blocked.includes(action);
      const isAllowed   = allowed.includes(action);
      const safetyLevel = config.safetyLevel;

      if (isBlocked) {
        bus.emit({ source: "autonomy-controller", target: null, type: "autonomy.action.blocked",
          payload: { action, requestedBy, reason: "action blocked by config" } });
        return;
      }

      // Permissive mode with allowed action: auto-execute
      if (safetyLevel === "permissive" || (safetyLevel !== "strict" && isAllowed && !config.confirmationRequired)) {
        const outcome = "success";
        const result  = `Auto-executed: ${action}${reason ? ` — ${reason}` : ""}`;

        await db.insert(autonomyLogTable).values({
          action,
          actionType: isAllowed ? "allowed" : "unlisted",
          parameters,
          outcome,
          reason: reason || "cognitive-loop initiated",
        });

        bus.emit({ source: "autonomy-controller", target: null, type: "autonomy.action.executed",
          payload: { action, requestedBy, outcome, result, automated: true } });
        logger.info({ action, requestedBy }, "Autonomy: auto-executed action");
      } else {
        // Needs user confirmation
        bus.emit({ source: "autonomy-controller", target: null, type: "autonomy.confirmation.required",
          payload: { action, parameters, requestedBy, reason, safetyLevel } });
        logger.info({ action, safetyLevel }, "Autonomy: confirmation required");
      }
    } catch (err) {
      logger.warn({ err, action }, "Autonomy pipeline error");
    }
  });

  // ── Cognitive Loop (persistent background thinking) ───────────────────────
  cognitiveLoop.start();

  // ── Memory Enricher (background UCM auto-enrichment) ─────────────────────
  memoryEnricher.start();

  // ── Notification Service (persistent alert inbox) ─────────────────────────
  notificationService.start();

  // ── Routine Runner (scheduled & event-based automations) ─────────────────
  await seedStarterRoutines();
  await seedBriefingRoutine();
  routineRunner.start();

  logger.info("EventBus, PluginRegistry, DeviceManager, and transports bootstrapped");
}

export async function teardown(): Promise<void> {
  if (routerStatusTimer) {
    clearInterval(routerStatusTimer);
    routerStatusTimer = null;
  }
  if (registry) {
    await registry.shutdownAll();
  }
  memoryService.stop();
  presenceManager.stop();
  initiativeEngine.stop();
  cognitiveLoop.stop();
  memoryEnricher.stop();
  notificationService.stop();
  routineRunner.stop();

  if (stopSimDevices) {
    stopSimDevices();
  }

  if (mqttTransport) {
    await mqttTransport.stop();
  }

  if (wsDeviceTransport) {
    wsDeviceTransport.stop();
  }

  bus.emit({
    source: "system",
    target: null,
    type: "system.shutdown",
    payload: { stoppedAt: new Date().toISOString() },
  });
}
