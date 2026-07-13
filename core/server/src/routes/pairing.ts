import { Router } from "express";
import { getConfig, setConfig } from "../lib/app-config.js";

const router = Router();

const CODE_KEY = "INSTANCE_PAIRING_CODE";

/** Generates a readable 8-char code: 3 uppercase letters + dash + 4 digits */
function generateCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion
  const digits  = "0123456789";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return `${pick(letters)}${pick(letters)}${pick(letters)}-${pick(digits)}${pick(digits)}${pick(digits)}${pick(digits)}`;
}

/** Returns (and lazily creates) the persistent instance code */
async function getOrCreateCode(): Promise<string> {
  const existing = await getConfig(CODE_KEY);
  if (existing) return existing;
  const code = generateCode();
  await setConfig(CODE_KEY, code);
  return code;
}

// GET /api/pairing/code
// Returns the instance pairing code and the mobile URL for this server.
router.get("/pairing/code", async (req, res) => {
  const code = await getOrCreateCode();
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
  const expected = await getOrCreateCode();
  const valid = code.trim().toUpperCase() === expected.toUpperCase();
  res.json({ valid });
});

// POST /api/pairing/reset
// Regenerates the instance pairing code (invalidates all existing pairings)
router.post("/pairing/reset", async (_req, res) => {
  const code = generateCode();
  await setConfig(CODE_KEY, code);
  res.json({ code });
});

export default router;
