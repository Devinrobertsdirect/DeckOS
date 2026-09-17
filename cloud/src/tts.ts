/**
 * tts.ts — voice for the web face, on the OWNER's ElevenLabs key.
 *
 * The fixed lines on the site (intro, gates, "ready") are static clips
 * rendered once in the Rocky voice — no credits per play. Live replies are
 * voiced here only when the owner has put their own ELEVENLABS_API_KEY in the
 * vault (their credits); otherwise the site falls back to the browser voice.
 * Nothing here ever spends Development Industries' credits.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { Store } from "./store.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { decryptSecret } from "./crypto.js";
import { rateLimit } from "./ratelimit.js";
import { isOwner } from "./sync.js";

const DEFAULT_VOICE = process.env["NEURA_CLOUD_TTS_VOICE"] || "pNInz6obpgDQGcFmaJgB";
const schema = z.object({ text: z.string().min(1).max(1200), voice: z.string().regex(/^[A-Za-z0-9]{8,40}$/).optional() });

export function ttsRouter(store: Store): Router {
  const r = Router();
  r.use(requireAuth(store));
  r.use(rateLimit({ windowMs: 60_000, max: 30, key: (req) => (req as AuthedRequest).account!.id, name: "tts" }));
  r.post("/", async (req: AuthedRequest, res: Response) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "text required" }); return; }
    const accountId = req.account!.id;
    if (!isOwner(await store.getProfile(accountId))) { res.status(403).json({ error: "owners_only" }); return; }
    const entry = await store.getKey(accountId, "ELEVENLABS_API_KEY");
    if (!entry) { res.status(412).json({ error: "no_key" }); return; }
    let key = "";
    try { key = decryptSecret(entry.ciphertext, `${accountId}:ELEVENLABS_API_KEY`); } catch { res.status(412).json({ error: "no_key" }); return; }
    const profile = (await store.getProfile(accountId)) ?? {};
    const voice = parsed.data.voice || (typeof profile["voiceId"] === "string" ? (profile["voiceId"] as string) : DEFAULT_VOICE);
    try {
      const up = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: parsed.data.text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.38, similarity_boost: 0.85, style: 0.35, speed: 1.04, use_speaker_boost: true } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!up.ok) { res.status(502).json({ error: "tts_error", status: up.status }); return; }
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(Buffer.from(await up.arrayBuffer()));
    } catch (e) {
      res.status(502).json({ error: "tts_error", message: (e as Error).message });
    }
  });
  return r;
}
