/*
 * vault.ts — per-account encrypted API-key store.
 *
 *   GET    /v1/keys          → { keys: [{ name, hasValue, updatedAt }] }  (no values)
 *   PUT    /v1/keys/:name    { value }  → { ok }   (AES-GCM encrypted at rest)
 *   DELETE /v1/keys/:name    → { ok }
 *
 * The plaintext value is only ever held in memory long enough to encrypt it.
 * GET never returns secret values — only whether a slot is filled.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { Store } from "./store.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { encryptSecret } from "./crypto.js";

// The provider keys the cloud brain + bots know how to use. Extra names are
// allowed (uppercase snake) so the app can grow without a server change.
export const KNOWN_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

const nameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/, "key name must be UPPER_SNAKE_CASE");
const valueSchema = z.string().min(1).max(8192);

export function vaultRouter(store: Store): Router {
  const r = Router();
  r.use(requireAuth(store));

  r.get("/", async (req: AuthedRequest, res: Response) => {
    const entries = await store.listKeys(req.account!.id);
    const filled = new Set(entries.map((e) => e.name));
    // Report every known slot (so the UI can show empty ones) plus any extras.
    const names = new Set<string>([...KNOWN_KEYS, ...filled]);
    const keys = [...names].map((name) => {
      const e = entries.find((x) => x.name === name);
      return { name, hasValue: filled.has(name), updatedAt: e?.updatedAt ?? null };
    });
    res.json({ keys });
  });

  r.put("/:name", async (req: AuthedRequest, res: Response) => {
    const name = nameSchema.safeParse(req.params.name);
    const value = valueSchema.safeParse(req.body?.value);
    if (!name.success) {
      res.status(400).json({ error: "invalid key name" });
      return;
    }
    if (!value.success) {
      res.status(400).json({ error: "value required (1–8192 chars)" });
      return;
    }
    const accountId = req.account!.id;
    await store.setKey({
      accountId,
      name: name.data,
      // AAD binds the ciphertext to this exact (account, slot) — a blob moved to
      // another slot/account fails the auth-tag check on decrypt.
      ciphertext: encryptSecret(value.data, `${accountId}:${name.data}`),
      updatedAt: Date.now(),
    });
    res.json({ ok: true });
  });

  r.delete("/:name", async (req: AuthedRequest, res: Response) => {
    const name = nameSchema.safeParse(req.params.name);
    if (!name.success) {
      res.status(400).json({ error: "invalid key name" });
      return;
    }
    await store.deleteKey(req.account!.id, name.data);
    res.json({ ok: true });
  });

  return r;
}
