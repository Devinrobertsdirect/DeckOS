import { Router } from "express";
import { z } from "zod/v4";
import { getBody, getBodyDetection, getPresence } from "../lib/body.js";

/**
 * /api/body — drive and observe the physical (or virtual) Atlas body through the
 * HAL. Works identically whether Atlas is a desktop sim, a Pi, or a
 * microcontroller over serial/WiFi.
 */
const router = Router();

// GET /api/body/presence — is a physical board plugged in? (for the plug-in
// experience: auto robot mode + the "thanks for the charge" greeting). Cheap;
// safe to poll. Does NOT force the body to start.
router.get("/body/presence", async (_req, res) => {
  res.json(await getPresence());
});

// GET /api/body — current body state + which backend is driving it.
router.get("/body", async (_req, res) => {
  const body = await getBody();
  res.json({
    detection: getBodyDetection(),
    kind: body.kind,
    state: body.getState(),
  });
});

const DriveSchema = z.union([
  z.object({ l: z.number(), r: z.number() }),
  z.object({ linear: z.number(), angular: z.number() }),
]);

// POST /api/body/drive — { l, r } normalized wheels, or { linear, angular } velocity.
router.post("/body/drive", async (req, res) => {
  const parsed = DriveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { l, r } (each -1..1) or { linear, angular }" });
    return;
  }
  const body = await getBody();
  if ("l" in parsed.data) body.drive(parsed.data.l, parsed.data.r);
  else body.driveVelocity(parsed.data.linear, parsed.data.angular);
  res.json({ ok: true, state: body.getState() });
});

// POST /api/body/halt — stop the wheels.
router.post("/body/halt", async (_req, res) => {
  const body = await getBody();
  body.halt();
  res.json({ ok: true });
});

// POST /api/body/estop — { on: boolean } software emergency stop.
router.post("/body/estop", async (req, res) => {
  const on = Boolean((req.body as { on?: unknown })?.on);
  const body = await getBody();
  body.setEstop(on);
  res.json({ ok: true, estop: on });
});

// POST /api/body/face — { state, color? } mirror the face onto the body panel.
router.post("/body/face", async (req, res) => {
  const { state, color } = (req.body ?? {}) as { state?: string; color?: string };
  if (!state) { res.status(400).json({ error: "state required" }); return; }
  const body = await getBody();
  body.setFace(state, color);
  res.json({ ok: true });
});

export default router;
