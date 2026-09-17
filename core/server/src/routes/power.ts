import { Router, type IRouter, type Request } from "express";
import { execFile } from "node:child_process";
import { z } from "zod/v4";

/**
 * power.ts — safe shutdown / reboot for the robot body.
 *
 * POST /api/power { action: "shutdown" | "reboot" }
 *
 * Guardrails, in order:
 *  - loopback only (same rule as the bluetooth/wifi mutations): only the
 *    robot's own voice pipeline or local console can power it off — never the
 *    paired phone or anything else on the LAN.
 *  - Linux only: on a dev Windows/Mac box it reports { available: false }
 *    instead of touching the machine.
 *  - the actual command is delayed a few seconds so the confirmation line can
 *    finish speaking before the OS goes down.
 *
 * The voice skill layered on top adds its own arm→confirm two-step, so a stray
 * phrase can never power the robot down in one shot.
 */
const router: IRouter = Router();

function isLoopback(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const Body = z.object({ action: z.enum(["shutdown", "reboot"]) });

/** Seconds of grace so the spoken confirmation isn't cut off mid-word. */
const GRACE_S = 6;

router.post("/power", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Send { action: "shutdown" | "reboot" }' }); return; }
  if (process.platform !== "linux") { res.json({ ok: false, available: false }); return; }

  const { action } = parsed.data;
  const argv = action === "reboot" ? ["reboot"] : ["shutdown", "-h", "now"];
  setTimeout(() => {
    execFile("sudo", ["-n", ...argv], { timeout: 10_000 }, (err) => {
      // Nothing useful to answer by now — the response went out long ago.
      if (err) console.error(`[power] ${action} failed:`, err.message);
    });
  }, GRACE_S * 1000);
  res.json({ ok: true, action, inSeconds: GRACE_S });
});

export default router;
