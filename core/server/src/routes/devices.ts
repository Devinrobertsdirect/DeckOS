import { Router } from "express";
import { z } from "zod";
import {
  ListDevicesResponse,
  GetDeviceParams,
  GetDeviceResponse,
  ControlDeviceParams,
  ControlDeviceBody,
  ControlDeviceResponse,
  GetDeviceStatsResponse,
} from "@workspace/api-zod";
import { getDeviceManager } from "../lib/device-manager.js";
import { db, deviceReadingsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";

const DeviceHistoryQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const router = Router();

function parseStoredValue(raw: string): number | boolean | string {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (!Number.isNaN(n)) return n;
  return raw;
}

type ApiDevice = {
  id: string;
  name: string;
  type: "sensor" | "actuator" | "display" | "network" | "simulated";
  status: "online" | "offline" | "error" | "standby";
  protocol: "mqtt" | "websocket" | "http" | "simulated";
  readings: { sensor: string; value: number | string | boolean; unit: string | null; timestamp: string }[];
  capabilities: string[];
  lastSeen: string | null;
  location: string | null;
};

function toApiDevice(d: ReturnType<ReturnType<typeof getDeviceManager>["getDevice"]>): ApiDevice | null {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    status: d.state.status,
    protocol: d.protocol === "websocket" ? "websocket" : d.protocol === "mqtt" ? "mqtt" : "simulated",
    readings: d.state.readings,
    capabilities: d.capabilities,
    lastSeen: d.state.lastSeen,
    location: d.location,
  };
}

router.get("/devices", (_req, res) => {
  const dm = getDeviceManager();
  const devices = dm.listDevices().map((d) => toApiDevice(d)!);
  const body = ListDevicesResponse.parse({ devices });
  res.json(body);
});

router.get("/devices/stats", (_req, res) => {
  const dm = getDeviceManager();
  const devices = dm.listDevices();
  const stats = {
    total: devices.length,
    online: devices.filter((d) => d.state.status === "online").length,
    offline: devices.filter((d) => d.state.status === "offline").length,
    error: devices.filter((d) => d.state.status === "error").length,
    byType: devices.reduce(
      (acc, d) => {
        acc[d.type] = (acc[d.type] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };
  const body = GetDeviceStatsResponse.parse(stats);
  res.json(body);
});

router.get("/devices/:deviceId", (req, res) => {
  const params = GetDeviceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const dm = getDeviceManager();
  const device = dm.getDevice(params.data.deviceId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const body = GetDeviceResponse.parse(toApiDevice(device));
  res.json(body);
});

router.get("/devices/:deviceId/history", async (req, res) => {
  const deviceId = req.params["deviceId"];
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }

  const query = DeviceHistoryQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { limit, offset } = query.data;

  const dm = getDeviceManager();
  const device = dm.getDevice(deviceId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const memoryHistory = dm.getHistory(deviceId);

  if (memoryHistory.length > 0) {
    const total = memoryHistory.length;
    const page  = memoryHistory.slice(offset, offset + limit);
    res.json({ deviceId, history: page, total, limit, offset, source: "memory" });
    return;
  }

  try {
    const [countRow] = await db
      .select({ total: count() })
      .from(deviceReadingsTable)
      .where(eq(deviceReadingsTable.deviceId, deviceId));

    const total = countRow?.total ?? 0;

    const rows = await db
      .select()
      .from(deviceReadingsTable)
      .where(eq(deviceReadingsTable.deviceId, deviceId))
      .orderBy(desc(deviceReadingsTable.recordedAt))
      .limit(limit)
      .offset(offset);

    const history = rows
      .reverse()
      .map((row) => ([{
        sensor:    row.sensor,
        value:     parseStoredValue(row.value),
        unit:      row.unit ?? null,
        timestamp: row.recordedAt.toISOString(),
      }]));

    res.json({ deviceId, history, total, limit, offset, source: "db" });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve device history" });
  }
});

router.post("/devices/:deviceId/control", (req, res) => {
  const params = ControlDeviceParams.safeParse(req.params);
  const bodyParsed = ControlDeviceBody.safeParse(req.body);
  if (!params.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { action, parameters } = bodyParsed.data;
  const deviceId = params.data.deviceId;

  const dm = getDeviceManager();
  const device = dm.getDevice(deviceId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const dispatched = dm.sendCommand(deviceId, {
    action,
    parameters: parameters ?? undefined,
  });

  const response = ControlDeviceResponse.parse({
    success: dispatched,
    message: dispatched
      ? `Action "${action}" dispatched to device ${deviceId}`
      : `Failed to dispatch action "${action}" to device ${deviceId}`,
    newState: null,
  });
  res.json(response);
});

router.post("/devices/:deviceId/command", (req, res) => {
  const deviceId = req.params["deviceId"];
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }

  const { action, parameters } = req.body as { action?: string; parameters?: Record<string, unknown> };
  if (!action) {
    res.status(400).json({ error: "action is required" });
    return;
  }

  const dm = getDeviceManager();
  const device = dm.getDevice(deviceId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const dispatched = dm.sendCommand(deviceId, { action, parameters });

  res.json({
    success: dispatched,
    deviceId,
    action,
    message: dispatched
      ? `Command "${action}" dispatched to ${deviceId} via event bus`
      : `Failed to dispatch command "${action}" to ${deviceId}`,
  });
});

export default router;
