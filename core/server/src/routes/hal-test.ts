import { Router } from "express";
import { z } from "zod/v4";
import { AdeeptMotorHatBody, adeeptProfile } from "../hal/index.js";
import { peekBody, getBodyDetection } from "../lib/body.js";

/**
 * /api/hal/test — SAFE bench tests for the physical HAT, used to verify wiring
 * before any motion flows from the AI. Every action is bounded and clamped: a
 * motor pulse can't exceed 500 ms or 40% duty and always ends in a stop
 * (finally-block), servo pulses are pinned to the mechanically-safe
 * 1200..1800 µs band, and "stop" kills everything. GET reports what's
 * available without touching the hardware at all.
 */
const router = Router();

const MAX_PULSE_MS = 500;
const MAX_PULSE_DUTY = 0.4;

// The body under test: the live one when the brain is already driving the HAT
// (ATLAS_PROFILE=adeept-motorhat-v2), else a lazily-started bench instance.
let bench: AdeeptMotorHatBody | null = null;
let benchStarting: Promise<AdeeptMotorHatBody> | null = null;

async function testBody(): Promise<AdeeptMotorHatBody> {
  const active = peekBody();
  if (active instanceof AdeeptMotorHatBody) return active;
  if (bench) return bench;
  if (!benchStarting) {
    benchStarting = (async () => {
      const b = new AdeeptMotorHatBody(adeeptProfile());
      await b.start();
      bench = b;
      return b;
    })();
  }
  try { return await benchStarting; } finally { benchStarting = null; }
}

// GET /api/hal/test — driver/module availability + which profile/body is
// active. Never starts hardware; safe to poll from anywhere.
router.get("/hal/test", async (_req, res) => {
  const active = peekBody();
  const adeept = active instanceof AdeeptMotorHatBody ? active : bench;
  res.json({
    profile: adeeptProfile().id,
    body: active ? { kind: active.kind, board: active.getState().board } : null,
    detection: getBodyDetection(),
    benchStarted: !!bench,
    driver: adeept?.driverStatus() ?? null,
    modules: {
      pigpio: await moduleAvailable("pigpio"),
      i2cBus: await moduleAvailable("i2c-bus"),
    },
  });
});

const TestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("pulse"),
    motor: z.enum(["A", "B"]),
    ms: z.number().positive().optional(),
    duty: z.number().positive().optional(),
  }),
  z.object({ action: z.literal("servo"), ch: z.number().int().min(0).max(15), us: z.number() }),
  z.object({ action: z.literal("stop") }),
]);

// POST /api/hal/test — one clamped bench action:
//   { action: "pulse", motor: "A"|"B", ms?, duty? }   ≤ 500 ms, ≤ 0.4 duty, guaranteed stop
//   { action: "servo", ch, us }                       us clamped to 1200..1800
//   { action: "stop" }                                everything off
router.post("/hal/test", async (req, res) => {
  const parsed = TestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { action: pulse|servo|stop, ... }" });
    return;
  }
  const cmd = parsed.data;
  try {
    const body = await testBody();
    if (cmd.action === "pulse") {
      const ms = clamp(cmd.ms ?? 250, 20, MAX_PULSE_MS);
      const duty = clamp(cmd.duty ?? 0.25, 0, MAX_PULSE_DUTY);
      try {
        await body.pulseMotor(cmd.motor, ms, duty);
      } finally {
        body.halt();  // belt-and-braces: never leave a wheel driven
      }
      res.json({ ok: true, action: "pulse", motor: cmd.motor, ms, duty });
    } else if (cmd.action === "servo") {
      const us = clamp(cmd.us, 1200, 1800);
      await body.setServoPulseUs(cmd.ch, us);
      res.json({ ok: true, action: "servo", ch: cmd.ch, us });
    } else {
      await body.allOff();
      res.json({ ok: true, action: "stop" });
    }
  } catch (e) {
    // Whatever failed, report it with the hardware left stopped (the body's
    // failsafe already fired on any GPIO/I²C error).
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Can this optional native module load here? (Non-literal import, same trick as the HAL.) */
async function moduleAvailable(name: string): Promise<boolean> {
  try { await import(name); return true; } catch { return false; }
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }

export default router;
