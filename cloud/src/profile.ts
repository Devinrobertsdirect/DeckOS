/*
 * profile.ts — per-account settings/identity blob (NOT secret).
 *
 *   GET   /v1/profile            → { profile }        (the account's blob, {} if none)
 *   PUT   /v1/profile  { profile }  → { ok, profile } (full replace)
 *   PATCH /v1/profile  { patch }    → { ok, profile } (shallow merge)
 *
 * This is where the "AI setup once per account" state lives — the AI's name,
 * eye color, personality, life-priority profile, and an `aiSetupComplete` flag —
 * so it follows the account to every device and stays consistent across views.
 * API keys do NOT go here; those are the encrypted vault (`/v1/keys`).
 */
import { Router, type Response } from "express";
import type { Store } from "./store.js";
import { requireAuth, type AuthedRequest } from "./auth.js";

const MAX_PROFILE_BYTES = 64 * 1024;

function tooBig(data: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(data ?? {}), "utf8") > MAX_PROFILE_BYTES;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function profileRouter(store: Store): Router {
  const r = Router();
  r.use(requireAuth(store));

  r.get("/", async (req: AuthedRequest, res: Response) => {
    const data = (await store.getProfile(req.account!.id)) ?? {};
    res.json({ profile: data });
  });

  r.put("/", async (req: AuthedRequest, res: Response) => {
    const profile = req.body?.profile;
    if (!isPlainObject(profile)) {
      res.status(400).json({ error: "profile must be an object" });
      return;
    }
    if (tooBig(profile)) {
      res.status(413).json({ error: "profile too large" });
      return;
    }
    await store.setProfile(req.account!.id, profile);
    res.json({ ok: true, profile });
  });

  // Shallow-merge patch — handy for one-field updates (eye color, aiSetupComplete)
  // without the client having to read-modify-write the whole blob.
  r.patch("/", async (req: AuthedRequest, res: Response) => {
    const patch = req.body?.patch;
    if (!isPlainObject(patch)) {
      res.status(400).json({ error: "patch must be an object" });
      return;
    }
    const current = (await store.getProfile(req.account!.id)) ?? {};
    const merged = { ...current, ...patch };
    if (tooBig(merged)) {
      res.status(413).json({ error: "profile too large" });
      return;
    }
    await store.setProfile(req.account!.id, merged);
    res.json({ ok: true, profile: merged });
  });

  return r;
}
