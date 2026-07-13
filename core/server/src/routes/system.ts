import { Router } from "express";
import os from "os";
import { z } from "zod";
import { db, systemEventsTable, commandHistoryTable, memoryEntriesTable, userCognitiveModelTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  GetSystemStatsResponse,
  GetSystemEventsQueryParams,
  GetSystemEventsResponse,
  GetSystemSummaryResponse,
} from "@workspace/api-zod";

const DEFAULT_CPU_ALERT_PCT = 80;
const DEFAULT_MEM_ALERT_PCT = 90;

async function getThresholdsFromUCM(): Promise<{ cpu: number | null; mem: number | null }> {
  try {
    const rows = await db.select().from(userCognitiveModelTable).limit(1);
    const prefs = (rows[0]?.preferences ?? {}) as Record<string, unknown>;
    const cpu = typeof prefs["cpuAlertThreshold"] === "number" ? prefs["cpuAlertThreshold"] : null;
    const mem = typeof prefs["memAlertThreshold"] === "number" ? prefs["memAlertThreshold"] : null;
    return { cpu, mem };
  } catch {
    return { cpu: null, mem: null };
  }
}

const router = Router();

router.get("/system/stats", (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const cpuUsage = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return acc + ((total - idle) / total) * 100;
  }, 0) / cpus.length;

  const body = GetSystemStatsResponse.parse({
    cpu: {
      usage: Math.round(cpuUsage * 10) / 10,
      cores: cpus.length,
      model: cpus[0]?.model ?? "Unknown",
    },
    memory: {
      used: Math.round(usedMem / 1024 / 1024),
      total: Math.round(totalMem / 1024 / 1024),
      percentage: Math.round((usedMem / totalMem) * 1000) / 10,
    },
    uptime: Math.floor(os.uptime()),
    loadAverage: os.loadavg(),
    platform: os.platform(),
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
  });
  res.json(body);
});

router.get("/system/events", async (req, res) => {
  const params = GetSystemEventsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 50;
  const rawEvents = await db.select().from(systemEventsTable)
    .orderBy(desc(systemEventsTable.createdAt))
    .limit(limit);

  const events = rawEvents.map((e) => ({
    id: String(e.id),
    level: e.level as "info" | "warning" | "error" | "critical",
    message: e.message,
    source: e.source,
    timestamp: e.createdAt.toISOString(),
    data: e.data as Record<string, unknown> | null,
  }));

  const body = GetSystemEventsResponse.parse({ events });
  res.json(body);
});

router.get("/system/summary", async (req, res) => {
  const [commandCount, memCount, alertCount] = await Promise.all([
    db.select().from(commandHistoryTable).then((r) => r.length),
    db.select().from(memoryEntriesTable).then((r) => r.length),
    db.select().from(systemEventsTable).then((r) => r.filter((e) => e.level === "error" || e.level === "critical").length),
  ]);

  const body = GetSystemSummaryResponse.parse({
    status: "optimal",
    activePlugins: 4,
    totalPlugins: 5,
    activeDevices: 4,
    totalDevices: 6,
    memoryEntries: memCount,
    commandsToday: commandCount,
    aiRequests: 0,
    uptimeSeconds: Math.floor(os.uptime()),
    alertCount,
  });
  res.json(body);
});

const PatchThresholdsBody = z.object({
  cpuThreshold: z.number().min(1).max(100).optional(),
  memThreshold: z.number().min(1).max(100).optional(),
});

router.get("/system/thresholds", async (_req, res) => {
  const envCpu = parseFloat(process.env["CPU_ALERT_THRESHOLD"] ?? "");
  const envMem = parseFloat(process.env["MEM_ALERT_THRESHOLD"] ?? "");
  const { cpu, mem } = await getThresholdsFromUCM();

  res.json({
    cpuThreshold: cpu ?? (!isNaN(envCpu) && envCpu > 0 ? envCpu : DEFAULT_CPU_ALERT_PCT),
    memThreshold: mem ?? (!isNaN(envMem) && envMem > 0 ? envMem : DEFAULT_MEM_ALERT_PCT),
    source: {
      cpu: cpu !== null ? "ucm" : (!isNaN(envCpu) && envCpu > 0 ? "env" : "default"),
      mem: mem !== null ? "ucm" : (!isNaN(envMem) && envMem > 0 ? "env" : "default"),
    },
  });
});

router.patch("/system/thresholds", async (req, res) => {
  const parsed = PatchThresholdsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db.select().from(userCognitiveModelTable).limit(1);
  let model;
  if (rows.length > 0) {
    model = rows[0];
  } else {
    const [created] = await db.insert(userCognitiveModelTable).values({}).returning();
    model = created;
  }

  const current = (model.preferences ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = { ...current };
  if (parsed.data.cpuThreshold !== undefined) updates["cpuAlertThreshold"] = parsed.data.cpuThreshold;
  if (parsed.data.memThreshold !== undefined) updates["memAlertThreshold"] = parsed.data.memThreshold;

  await db.update(userCognitiveModelTable)
    .set({ preferences: updates })
    .where(eq(userCognitiveModelTable.id, model.id));

  res.json({
    success: true,
    cpuThreshold: updates["cpuAlertThreshold"] as number,
    memThreshold: updates["memAlertThreshold"] as number,
  });
});

export default router;
