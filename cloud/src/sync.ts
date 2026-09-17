/**
 * sync.ts — owner entitlement + "sync my Nobi".
 *
 * The web face (site /talk) is for owners only: an account counts as an owner
 * when its build profile is RESERVED (Stripe webhook, reserve.ts) or an admin
 * entitled it. Owners bring their own model key (vault.ts); the web brain and
 * the robot both use it.
 *
 * Sync: the owner asks the site for a sync code — three words, so it survives
 * being SAID to the robot ("hey Nobi, sync apple river stone"). The robot
 * redeems it (no login on the robot, ever), receives a session of its own, and
 * pulls the profile + decrypted keys with GET /v1/sync. Codes live 10 minutes,
 * single use, in memory (one instance — Reserved VM).
 */
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Store } from "./store.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { decryptSecret, randomToken, sha256 } from "./crypto.js";

const WORDS = ["apple", "river", "stone", "maple", "cloud", "tiger", "ocean", "piano", "lemon", "cedar", "comet", "delta", "ember", "falcon", "garden", "harbor", "island", "jasper", "kettle", "lantern", "meadow", "nectar", "orbit", "pepper", "quartz", "raven", "saddle", "timber", "velvet", "willow", "yonder", "zephyr"];
const CODE_TTL_MS = 10 * 60_000;
const codes = new Map<string, { accountId: string; exp: number }>();

export function isOwner(profile: Record<string, unknown> | undefined): boolean {
  if (!profile) return false;
  if (profile["entitled"] === true) return true;
  const r = profile["reservation"] as { status?: string } | undefined;
  return r?.status === "reserved";
}

/** Everything a robot needs to become this account's Nobi. */
export async function syncPayload(store: Store, accountId: string) {
  const profile = (await store.getProfile(accountId)) ?? {};
  const keys: Record<string, string> = {};
  for (const e of await store.listKeys(accountId)) {
    try { keys[e.name] = decryptSecret(e.ciphertext, `${accountId}:${e.name}`); } catch { /* skip a blob that won't open */ }
  }
  const account = await store.getAccountById(accountId);
  return { email: account?.email, displayName: account?.displayName, profile, keys };
}

export function syncRouter(store: Store): Router {
  const r = Router();

  // GET /v1/entitlement (auth) → { owner, reserved, entitled, keys: [names with values] }
  r.get("/entitlement", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = (await store.getProfile(req.account!.id)) ?? {};
    const keys = (await store.listKeys(req.account!.id)).map((k) => k.name);
    const reservation = profile["reservation"] as { status?: string } | undefined;
    res.json({ owner: isOwner(profile), reserved: reservation?.status === "reserved", entitled: profile["entitled"] === true, keys });
  });

  // POST /v1/sync/code (auth) → { code: "apple river stone", expiresAt }
  r.post("/sync/code", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = await store.getProfile(req.account!.id);
    if (!isOwner(profile)) { res.status(403).json({ error: "owners_only" }); return; }
    for (const [k, v] of codes) if (v.exp < Date.now() || v.accountId === req.account!.id) codes.delete(k);
    let code = "";
    do { code = [0, 1, 2].map(() => WORDS[Math.floor(Math.random() * WORDS.length)]!).join(" "); } while (codes.has(code));
    const exp = Date.now() + CODE_TTL_MS;
    codes.set(code, { accountId: req.account!.id, exp });
    res.json({ code, expiresAt: new Date(exp).toISOString() });
  });

  // POST /v1/sync/redeem { code } — the ROBOT calls this (no login). Single use.
  r.post("/sync/redeem", async (req: Request, res: Response) => {
    const raw = String((req.body as { code?: string })?.code ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
    const hit = codes.get(raw);
    if (!hit || hit.exp < Date.now()) { res.status(404).json({ error: "bad_or_expired_code" }); return; }
    codes.delete(raw);
    const token = randomToken(32);
    const now = Date.now();
    await store.createSession({ tokenHash: sha256(token), accountId: hit.accountId, createdAt: now, lastSeen: now });
    const account = await store.getAccountById(hit.accountId);
    res.json({ token, email: account?.email, displayName: account?.displayName });
  });

  // GET /v1/sync (auth) → profile + decrypted keys (the account's own; robot import)
  r.get("/sync", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    res.json(await syncPayload(store, req.account!.id));
  });

  return r;
}

/** POST /v1/admin/entitle { email, entitled } — grant/revoke owner access by hand. */
export function adminEntitleRouter(store: Store): Router {
  const r = Router();
  r.post("/entitle", async (req: Request, res: Response) => {
    const want = process.env["NOBI_ADMIN_KEY"] ?? "";
    const got = req.header("x-admin-key") ?? "";
    if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) { res.status(401).json({ error: "unauthorized" }); return; }
    const { email, entitled } = (req.body ?? {}) as { email?: string; entitled?: boolean };
    const account = email ? await store.getAccountByEmail(email.toLowerCase()) : undefined;
    if (!account) { res.status(404).json({ error: "no such account" }); return; }
    const current = (await store.getProfile(account.id)) ?? {};
    await store.setProfile(account.id, { ...current, entitled: entitled !== false });
    res.json({ ok: true, email: account.email, entitled: entitled !== false });
  });
  return r;
}
