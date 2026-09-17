import { Router } from "express";
import { getOrCreatePairingCode, resetPairingCode } from "../lib/pairing.js";

const router = Router();

// GET /api/pairing/code
// Returns the instance pairing code and the mobile URL for this server.
router.get("/pairing/code", async (req, res) => {
  const code = await getOrCreatePairingCode();
  const host = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
  const mobileUrl = `${host}/mobile/`;
  res.json({ code, mobileUrl });
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
// Regenerates the instance pairing code (invalidates all existing pairings)
router.post("/pairing/reset", async (_req, res) => {
  const code = await resetPairingCode();
  res.json({ code });
});

export default router;
