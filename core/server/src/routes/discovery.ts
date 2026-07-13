import { Router } from "express";
import { z } from "zod";
import { db, deviceProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { bus } from "../lib/bus.js";

const router = Router();

const ProfileBody = z.object({
  displayName:  z.string().min(1).max(64),
  icon:         z.string().optional().default("cpu"),
  description:  z.string().optional(),
  protocol:     z.string().optional().default("unknown"),
  deviceType:   z.string().optional().default("unknown"),
  category:     z.string().optional().default("sensor"),
  capabilities: z.array(z.string()).optional().default([]),
  eventSchema:  z.record(z.unknown()).optional().default({}),
  controlStubs: z.array(z.record(z.unknown())).optional().default([]),
  tags:         z.array(z.string()).optional().default([]),
  location:     z.string().optional(),
  initialized:  z.boolean().optional().default(true),
});

// GET /api/devices/profiles
router.get("/devices/profiles", async (_req, res) => {
  const profiles = await db.select().from(deviceProfilesTable);
  res.json({ profiles });
});

// GET /api/devices/profile/:deviceId
router.get("/devices/profile/:deviceId", async (req, res) => {
  const [profile] = await db
    .select()
    .from(deviceProfilesTable)
    .where(eq(deviceProfilesTable.deviceId, req.params.deviceId!));
  if (!profile) { res.status(404).json({ error: "Not found" }); return; }
  res.json(profile);
});

// POST /api/devices/profile/:deviceId — create or replace profile (initialize)
router.post("/devices/profile/:deviceId", async (req, res) => {
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { deviceId } = req.params;
  const data = parsed.data;

  const [row] = await db
    .insert(deviceProfilesTable)
    .values({
      deviceId: deviceId!,
      displayName:  data.displayName,
      icon:         data.icon,
      description:  data.description ?? null,
      protocol:     data.protocol,
      deviceType:   data.deviceType,
      category:     data.category,
      capabilities: data.capabilities,
      eventSchema:  data.eventSchema,
      controlStubs: data.controlStubs,
      tags:         data.tags,
      location:     data.location ?? null,
      initialized:  data.initialized,
    })
    .onConflictDoUpdate({
      target: deviceProfilesTable.deviceId,
      set: {
        displayName:  data.displayName,
        icon:         data.icon,
        description:  data.description ?? null,
        capabilities: data.capabilities,
        eventSchema:  data.eventSchema,
        controlStubs: data.controlStubs,
        tags:         data.tags,
        location:     data.location ?? null,
        initialized:  data.initialized,
      },
    })
    .returning();

  bus.emit({
    source: `device.${deviceId}`,
    target: null,
    type:   "device.discovery.initialized",
    payload: { deviceId, profile: row },
  });

  res.status(201).json(row);
});

// DELETE /api/devices/profile/:deviceId — remove profile (reset to uninitialized)
router.delete("/devices/profile/:deviceId", async (req, res) => {
  await db.delete(deviceProfilesTable).where(eq(deviceProfilesTable.deviceId, req.params.deviceId!));
  res.json({ success: true });
});

export default router;
