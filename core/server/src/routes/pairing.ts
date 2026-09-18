import { Router, type Request } from "express";
import { getOrCreatePairingCode, resetPairingCode } from "../lib/pairing.js";

const router = Router();

/**
 * Is this request coming from the robot itself?
 *
 * The pairing code is the ONLY thing standing in front of the remote, the games
 * and /remote/setup — and /remote/setup writes API keys. It was being handed to
 * anyone who asked, with no auth, which made all of that effectively open to
 * every device on the network. At a convention that is every stranger on the
 * guest Wi-Fi.
 *
 * The rule now matches how the code is meant to travel: you learn it by LOOKING
 * AT THE ROBOT — its screen, or by asking it out loud. Both of those run on the
 * robot itself, so they come from loopback. Anything off-box is told the code
 * exists and where to find it, which is all a stranger has any business knowing.
 */
function fromRobotItself(req: Request): boolean {
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

// GET /api/pairing/code
// Returns the instance pairing code and the mobile URL for this server.
router.get("/pairing/code", async (req, res) => {
  const host = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
  const mobileUrl = `${host}/mobile/`;
  if (!fromRobotItself(req)) {
    // Not a secret that it EXISTS — just not handed out to the whole network.
    res.status(403).json({ error: "ask the robot for its code, or read it off its screen", mobileUrl });
    return;
  }
  res.json({ code: await getOrCreatePairingCode(), mobileUrl });
});

// POST /api/pairing/validate
// Body: { code: string }
// Returns { valid: boolean }
router.post("/pairing/validate", async (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code required" });
    return;
  }
  const expected = await getOrCreatePairingCode();
  const valid = code.trim().toUpperCase() === expected.toUpperCase();
  res.json({ valid });
});

// POST /api/pairing/reset
// Regenerates the instance pairing code (invalidates all existing pairings).
// Needs the CURRENT code, or to come from the robot itself: this used to be open
// to the network, so any device could rotate the code and cut every paired phone
// off — including, at the worst possible moment, mid-demo.
router.post("/pairing/reset", async (req, res) => {
  const given = String((req.body as { code?: string } | undefined)?.code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const expected = (await getOrCreatePairingCode()).toUpperCase().replace(/\s+/g, "");
  if (!fromRobotItself(req) && given !== expected) {
    res.status(403).json({ error: "send the current pairing code to change it" });
    return;
  }
  const code = await resetPairingCode();
  res.json({ code });
});

export default router;
