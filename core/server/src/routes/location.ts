import { Router } from "express";
import { z } from "zod";
import { db, deviceLocationsTable, geofencesTable, geofenceEventsTable } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { bus } from "../lib/bus.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Zod schemas ────────────────────────────────────────────────────────────

const IngestBody = z.object({
  deviceId:   z.string().min(1),
  deviceType: z.string().optional().default("unknown"),
  lat:        z.number().min(-90).max(90),
  lng:        z.number().min(-180).max(180),
  accuracy:   z.number().optional(),
  altitude:   z.number().optional(),
  speed:      z.number().optional(),
  heading:    z.number().optional(),
  battery:    z.number().optional(),
  signal:     z.string().optional(),
  extra:      z.record(z.unknown()).optional().default({}),
});

const GeofenceBody = z.object({
  name:         z.string().min(1),
  lat:          z.number().min(-90).max(90),
  lng:          z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(100_000).optional().default(100),
  color:        z.string().optional().default("#3f84f3"),
  tags:         z.array(z.string()).optional().default([]),
});

// ── Haversine distance (metres) ────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 6_371_000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lng2 - lng1) * Math.PI) / 180;
  const a    = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Check geofence crossings ───────────────────────────────────────────────

async function checkGeofences(deviceId: string, lat: number, lng: number): Promise<void> {
  try {
    const zones = await db.select().from(geofencesTable).where(eq(geofencesTable.active, true));

    for (const zone of zones) {
      const dist = haversineMeters(lat, lng, zone.lat, zone.lng);
      const inside = dist <= zone.radiusMeters;

      // Check last event for this device + zone to detect transitions
      const [lastEvt] = await db
        .select({ action: geofenceEventsTable.action })
        .from(geofenceEventsTable)
        .where(
          and(
            eq(geofenceEventsTable.geofenceId, zone.id),
            eq(geofenceEventsTable.deviceId, deviceId),
          ),
        )
        .orderBy(desc(geofenceEventsTable.createdAt))
        .limit(1);

      const wasInside = lastEvt?.action === "entered";
      const action    = inside ? "entered" : "exited";

      // Only record/emit on transitions
      if ((inside && !wasInside) || (!inside && wasInside)) {
        await db.insert(geofenceEventsTable).values({
          geofenceId: zone.id,
          deviceId,
          action,
          lat,
          lng,
        });

        bus.emit({
          source: `device.${deviceId}`,
          target: null,
          type:   "device.geofence.triggered",
          payload: {
            deviceId,
            geofenceId:   zone.id,
            geofenceName: zone.name,
            action,
            coordinates:  { lat, lng },
            zone:         zone.name,
          },
        });

        logger.info({ deviceId, zone: zone.name, action }, "Geofence transition");
      }
    }
  } catch (err) {
    logger.error({ err }, "Geofence check failed");
  }
}

// ── POST /api/location/ingest ──────────────────────────────────────────────

router.post("/location/ingest", async (req, res) => {
  const parsed = IngestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const d = parsed.data;

  const [row] = await db.insert(deviceLocationsTable).values({
    deviceId:   d.deviceId,
    deviceType: d.deviceType,
    lat:        d.lat,
    lng:        d.lng,
    accuracy:   d.accuracy ?? null,
    altitude:   d.altitude ?? null,
    speed:      d.speed    ?? null,
    heading:    d.heading  ?? null,
    battery:    d.battery  ?? null,
    signal:     d.signal   ?? null,
    source:     "api",
    extra:      d.extra,
  }).returning();

  bus.emit({
    source: `device.${d.deviceId}`,
    target: null,
    type:   "device.location.updated",
    payload: {
      deviceId:    d.deviceId,
      deviceType:  d.deviceType,
      coordinates: { lat: d.lat, lng: d.lng },
      accuracy:    d.accuracy,
      speed:       d.speed,
      battery:     d.battery,
      timestamp:   row.createdAt.toISOString(),
    },
  });

  void checkGeofences(d.deviceId, d.lat, d.lng);

  res.json({ success: true, id: row.id, timestamp: row.createdAt.toISOString() });
});

// ── GET /api/location/latest ───────────────────────────────────────────────
// Returns the most recent position for every device

router.get("/location/latest", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (device_id)
      id, device_id, device_type, lat, lng, accuracy, altitude, speed, heading,
      battery, signal, source, extra, created_at
    FROM device_locations
    ORDER BY device_id, created_at DESC
  `);

  res.json({ devices: rows.rows });
});

// ── GET /api/location/:deviceId/trail ─────────────────────────────────────

router.get("/location/:deviceId/trail", async (req, res) => {
  const { deviceId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 500);

  const rows = await db
    .select()
    .from(deviceLocationsTable)
    .where(eq(deviceLocationsTable.deviceId, deviceId))
    .orderBy(desc(deviceLocationsTable.createdAt))
    .limit(limit);

  res.json({ deviceId, trail: rows.reverse() });
});

// ── GET /api/geofences ─────────────────────────────────────────────────────

router.get("/geofences", async (_req, res) => {
  const zones = await db.select().from(geofencesTable).orderBy(desc(geofencesTable.createdAt));
  res.json({ geofences: zones });
});

// ── POST /api/geofences ────────────────────────────────────────────────────

router.post("/geofences", async (req, res) => {
  const parsed = GeofenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [row] = await db.insert(geofencesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

// ── PUT /api/geofences/:id ─────────────────────────────────────────────────

router.put("/geofences/:id", async (req, res) => {
  const id     = Number(req.params.id);
  const parsed = GeofenceBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(geofencesTable)
    .set(parsed.data)
    .where(eq(geofencesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── DELETE /api/geofences/:id ─────────────────────────────────────────────

router.delete("/geofences/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(geofencesTable).where(eq(geofencesTable.id, id));
  res.json({ success: true });
});

// ── GET /api/geofences/:id/events ─────────────────────────────────────────

router.get("/geofences/:id/events", async (req, res) => {
  const id    = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const events = await db
    .select()
    .from(geofenceEventsTable)
    .where(eq(geofenceEventsTable.geofenceId, id))
    .orderBy(desc(geofenceEventsTable.createdAt))
    .limit(limit);

  res.json({ geofenceId: id, events });
});

export default router;
