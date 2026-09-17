/**
 * provision.ts — set a robot up from a build profile before it ships.
 *
 * The shop saves each customer's build (name, owner, personality, eye color,
 * accessories) as a `buildProfile` in their Nobi Cloud account. Fulfilment
 * pulls it and POSTs it here; the brain stores it, applies the server-side
 * bits (bot name), and broadcasts `provision.apply` so the face applies the
 * kiosk-side bits (owner name, persona, eye theme) and greets the owner by
 * name on first boot.
 *
 * POST /api/provision  { code, profile: { botName?, ownerName?, personaId?, eyeTheme?, accent?, build? } }
 *   `code` must be the robot's pairing code (LAN-only, so a neighbour can't
 *   rename your robot). GET /api/provision returns what was applied.
 */
import { Router, type Request } from "express";
import { z } from "zod/v4";
import { broadcast } from "../lib/ws-server.js";
import { getConfig, setConfig } from "../lib/app-config.js";
import { getOrCreatePairingCode } from "../lib/pairing.js";

const router = Router();

const ProfileSchema = z.object({
  botName: z.string().trim().max(24).optional(),
  ownerName: z.string().trim().max(40).optional(),
  personaId: z.enum(["rocky", "jarvis", "friday", "alfred", "workshop", "stealth", "forge", "codex"]).optional(),
  eyeTheme: z.string().trim().max(32).optional(),
  accent: z.string().trim().max(32).optional(),
  build: z.record(z.string(), z.unknown()).optional(),
});
const BodySchema = z.object({ code: z.string().min(1), profile: ProfileSchema });

/** Shop personality modules → robot personas (MK-01 Workshop is Rocky's warm-witty default). */
const MIND_TO_PERSONA: Record<string, string> = { workshop: "rocky", stealth: "jarvis", forge: "friday", codex: "alfred" };

function isPrivate(req: Request): boolean {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "").replace("::ffff:", "");
  return ip === "127.0.0.1" || ip === "::1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

router.post("/provision", async (req, res) => {
  if (!isPrivate(req)) { res.status(403).json({ error: "local network only" }); return; }
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Send { code, profile }" }); return; }
  const expected = await getOrCreatePairingCode();
  if (parsed.data.code.trim().toUpperCase() !== expected.toUpperCase()) { res.status(403).json({ error: "bad pairing code" }); return; }

  const p = parsed.data.profile;
  const personaId = p.personaId ? (MIND_TO_PERSONA[p.personaId] ?? p.personaId) : undefined;
  const applied = { botName: p.botName || undefined, ownerName: p.ownerName || undefined, personaId, eyeTheme: p.eyeTheme, accent: p.accent, at: new Date().toISOString() };
  if (applied.botName) await setConfig("ATLAS_BOT_NAME", applied.botName);
  await setConfig("NOBI_BUILD_PROFILE", JSON.stringify({ ...applied, build: p.build ?? null }));
  broadcast({ type: "provision.apply", source: "provision", payload: applied, timestamp: new Date().toISOString() });
  res.json({ ok: true, applied });
});

router.get("/provision", async (req, res) => {
  if (!isPrivate(req)) { res.status(403).json({ error: "local network only" }); return; }
  const raw = await getConfig("NOBI_BUILD_PROFILE").catch(() => null);
  res.json({ profile: raw ? JSON.parse(raw) : null });
});

export default router;
