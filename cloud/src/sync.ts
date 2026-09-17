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
 * single use. Spoken codes are matched loosely (speech-to-text mangles words),
 * but only ever against the handful of codes that are live right now.
 *
 * Saying words is still too much work when the robot is already on the owner's
 * network, so there is a second road with nothing to type or say: the owner
 * presses "Push to my Nobi" (POST /v1/units/push) and the robot, which knows
 * its own bot number, collects it (POST /v1/units/pull). The first robot to
 * collect enrols its device id against the unit; after that the device id alone
 * re-authorises, so "Sync now" on the robot works forever without the site.
 */
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Store } from "./store.js";
import { requireAuth, validateSession, type AuthedRequest } from "./auth.js";
import { decryptSecret, randomToken, sha256 } from "./crypto.js";

const WORDS = ["apple", "river", "stone", "maple", "cloud", "tiger", "ocean", "piano", "lemon", "cedar", "comet", "delta", "ember", "falcon", "garden", "harbor", "island", "jasper", "kettle", "lantern", "meadow", "nectar", "orbit", "pepper", "quartz", "raven", "saddle", "timber", "velvet", "willow", "yonder", "zephyr"];
const CODE_TTL_MS = 10 * 60_000;
const PUSH_TTL_MS = 30 * 60_000;

/** Edit distance, capped — we only care whether two words are within a letter or two. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!; prev[0] = i; let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = prev[j]!; prev[j] = cur; if (cur < best) best = cur;
    }
    if (best > max) return false;
  }
  return prev[b.length]! <= max;
}

/** The live code closest to what the robot heard — same word count, ≤1 letter off per word. */
async function nearestLiveCode(store: Store, heard: string): Promise<string | null> {
  const said = heard.split(" ").filter(Boolean);
  if (said.length !== 3) return null;
  const now = Date.now();
  for (const key of await store.kvKeys("synccode/")) {
    const code = key.slice("synccode/".length);
    const words = code.split(" ");
    if (words.length !== said.length) continue;
    if (!words.every((w, i) => within(w, said[i]!, 1))) continue;
    const row = await store.kvGet<{ exp: number }>(key);
    if (row && row.exp > now) return code;
  }
  return null;
}

/** Admin accounts (NOBI_ADMIN_EMAILS, comma-separated) — admins are owners too. */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const list = (process.env["NOBI_ADMIN_EMAILS"] ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** A reservation counts once the card is on file, a deposit is paid, or the build is paid. */
export const RESERVED_STATUSES = new Set(["reserved", "card_on_file", "invoiced", "paid"]);
export function isReserved(profile: Record<string, unknown> | undefined): boolean {
  const r = profile?.["reservation"] as { status?: string } | undefined;
  return RESERVED_STATUSES.has(r?.status ?? "");
}

export function isOwner(profile: Record<string, unknown> | undefined, email?: string): boolean {
  if (isAdminEmail(email)) return true;
  if (!profile) return false;
  if (profile["entitled"] === true) return true;
  return isReserved(profile);
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
    res.json({ owner: isOwner(profile, req.account!.email), admin: isAdminEmail(req.account!.email), reserved: isReserved(profile), entitled: profile["entitled"] === true, botNumber: profile["botNumber"] ?? null, keys });
  });

  // POST /v1/sync/code (auth) → { code: "apple river stone", expiresAt }
  r.post("/sync/code", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = await store.getProfile(req.account!.id);
    if (!isOwner(profile, req.account!.email)) { res.status(403).json({ error: "owners_only" }); return; }
    let code = "";
    do { code = [0, 1, 2].map(() => WORDS[Math.floor(Math.random() * WORDS.length)]!).join(" "); } while (await store.kvGet(`synccode/${code}`));
    const exp = Date.now() + CODE_TTL_MS;
    await store.kvSet(`synccode/${code}`, { accountId: req.account!.id, exp });
    res.json({ code, expiresAt: new Date(exp).toISOString() });
  });

  // POST /v1/sync/redeem { code } — the ROBOT calls this (no login). Single use.
  r.post("/sync/redeem", async (req: Request, res: Response) => {
    const raw = String((req.body as { code?: string })?.code ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
    let key = raw;
    let hit = await store.kvGet<{ accountId: string; exp: number }>(`synccode/${raw}`);
    // Heard, not typed: let a near-miss through, but only against codes that are
    // live this minute (a handful), and only within one letter per word.
    if (!hit && raw) { const near = await nearestLiveCode(store, raw); if (near) { key = near; hit = await store.kvGet(`synccode/${near}`); } }
    if (!hit || hit.exp < Date.now()) { res.status(404).json({ error: "bad_or_expired_code" }); return; }
    await store.kvDel(`synccode/${key}`);
    const token = randomToken(32);
    const now = Date.now();
    await store.createSession({ tokenHash: sha256(token), accountId: hit.accountId, createdAt: now, lastSeen: now });
    const account = await store.getAccountById(hit.accountId);
    res.json({ token, email: account?.email, displayName: account?.displayName });
  });

  // POST /v1/units/claim { botNumber, claimCode? } (auth) — "already have one": bind a
  // registered unit to this account. A unit with a claim code needs it; one without
  // is claimable by number alone (the admin decides per unit). Owned units can't move.
  r.post("/units/claim", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const raw = String((req.body as { botNumber?: string })?.botNumber ?? "").replace(/\D+/g, "");
    if (!raw) { res.status(400).json({ error: "botNumber required" }); return; }
    const botNumber = raw.padStart(7, "0");
    const unit = await store.getUnit(botNumber);
    if (!unit) { res.status(404).json({ error: "unknown_unit", message: "We don't know that bot number. Check the card that came with your Nobi." }); return; }
    if (unit.accountId && unit.accountId !== req.account!.id) { res.status(409).json({ error: "claimed", message: "That Nobi already belongs to another account." }); return; }
    if (unit.claimCodeHash) {
      const code = String((req.body as { claimCode?: string })?.claimCode ?? "").trim().toUpperCase();
      const a = Buffer.from(sha256(code)), b = Buffer.from(unit.claimCodeHash);
      if (!code || a.length !== b.length || !timingSafeEqual(a, b)) { res.status(403).json({ error: "bad_claim_code", message: "The claim code doesn't match that bot number." }); return; }
    }
    await store.updateUnit(botNumber, { accountId: req.account!.id, claimedAt: unit.claimedAt ?? Date.now() });
    const current = (await store.getProfile(req.account!.id)) ?? {};
    await store.setProfile(req.account!.id, { ...current, entitled: true, botNumber });
    res.json({ ok: true, botNumber });
  });

  // POST /v1/units/push (auth, owner) — "send my keys to my Nobi". Opens a short
  // window for THIS account's bot number; the robot collects it with /units/pull.
  r.post("/units/push", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = (await store.getProfile(req.account!.id)) ?? {};
    if (!isOwner(profile, req.account!.email)) { res.status(403).json({ error: "owners_only" }); return; }
    const botNumber = String(profile["botNumber"] ?? "");
    if (!botNumber) { res.status(412).json({ error: "no_unit", message: "No Nobi on this account yet." }); return; }
    const unit = await store.getUnit(botNumber);
    if (!unit || unit.accountId !== req.account!.id) { res.status(412).json({ error: "no_unit", message: "That Nobi isn't bound to this account." }); return; }
    const exp = Date.now() + PUSH_TTL_MS;
    await store.kvSet(`push/${botNumber}`, { accountId: req.account!.id, exp });
    res.json({ ok: true, botNumber, expiresAt: new Date(exp).toISOString(), enrolled: !!unit.deviceHash });
  });

  // POST /v1/units/pull { botNumber, deviceId } — the ROBOT collects (no login).
  // Allowed when the owner just pressed Push, or when this device already enrolled.
  r.post("/units/pull", async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as { botNumber?: string; deviceId?: string };
    const botNumber = String(b.botNumber ?? "").replace(/\D+/g, "").padStart(7, "0");
    const deviceId = String(b.deviceId ?? "").trim();
    if (!/^\d{7}$/.test(botNumber) || !/^[A-Za-z0-9_-]{20,128}$/.test(deviceId)) { res.status(400).json({ error: "botNumber and deviceId required" }); return; }
    const unit = await store.getUnit(botNumber);
    if (!unit?.accountId) { res.status(404).json({ error: "unknown_unit" }); return; }
    const deviceHash = sha256(deviceId);
    const known = !!unit.deviceHash && timingSafeEqual(Buffer.from(unit.deviceHash), Buffer.from(deviceHash));
    const pending = await store.kvGet<{ accountId: string; exp: number }>(`push/${botNumber}`);
    const pushed = !!pending && pending.exp > Date.now() && pending.accountId === unit.accountId;
    if (!known && !pushed) { res.status(403).json({ error: "not_authorized", message: "Ask the owner to press Push on their account page." }); return; }
    // A different robot can only take over a unit through a fresh push from the owner.
    if (!known) await store.updateUnit(botNumber, { deviceHash, deviceAt: Date.now() });
    else await store.updateUnit(botNumber, { deviceAt: Date.now() });
    if (pushed) await store.kvDel(`push/${botNumber}`);
    const token = randomToken(32);
    const now = Date.now();
    await store.createSession({ tokenHash: sha256(token), accountId: unit.accountId, createdAt: now, lastSeen: now });
    const account = await store.getAccountById(unit.accountId);
    res.json({ token, email: account?.email, displayName: account?.displayName, botNumber, enrolled: !known });
  });

  // GET /v1/sync (auth) → profile + decrypted keys (the account's own; robot import)
  r.get("/sync", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    res.json(await syncPayload(store, req.account!.id));
  });

  return r;
}

/** POST /v1/admin/entitle { email, entitled } — grant/revoke owner access by hand.
 *  POST /v1/admin/units { botNumber?, claimCode?, email?, note? } — register a unit
 *  (next serial if omitted); with an email it's bound + entitled at once.
 *  GET  /v1/admin/units — the registry. */
export function adminEntitleRouter(store: Store): Router {
  const r = Router();
  const admin = async (req: Request, res: Response): Promise<boolean> => {
    const want = process.env["NOBI_ADMIN_KEY"] ?? "";
    const got = req.header("x-admin-key") ?? "";
    if (want && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))) return true;
    // …or a signed-in admin (NOBI_ADMIN_EMAILS)
    const bearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (bearer) { const acct = await validateSession(store, bearer); if (acct && isAdminEmail(acct.email)) return true; }
    res.status(401).json({ error: "unauthorized" }); return false;
  };
  r.post("/units", async (req: Request, res: Response) => {
    if (!(await admin(req, res))) return;
    const b = (req.body ?? {}) as { botNumber?: string; claimCode?: string; email?: string; note?: string };
    const botNumber = b.botNumber ? String(b.botNumber).replace(/\D+/g, "").padStart(7, "0") : await store.nextBotNumber();
    if (await store.getUnit(botNumber)) { res.status(409).json({ error: "unit exists", botNumber }); return; }
    const email = b.email ? String(b.email).trim().toLowerCase() : "";
    const account = email ? await store.getAccountByEmail(email) : undefined;
    const claimCode = b.claimCode ? String(b.claimCode).trim().toUpperCase() : undefined;
    // no account yet → the unit waits for that email (binds on their first sign-in)
    await store.createUnit({ botNumber, claimCodeHash: claimCode ? sha256(claimCode) : undefined, accountId: account?.id, reservedFor: email && !account ? email : undefined, createdAt: Date.now(), claimedAt: account ? Date.now() : undefined, note: b.note });
    if (account) { const current = (await store.getProfile(account.id)) ?? {}; await store.setProfile(account.id, { ...current, entitled: true, botNumber }); }
    res.json({ ok: true, botNumber, claimCode: claimCode ?? null, boundTo: account?.email ?? null, reservedFor: email && !account ? email : null });
  });
  // POST /v1/admin/units/assign { botNumber, email | null } — (re)bind or release a unit.
  r.post("/units/assign", async (req: Request, res: Response) => {
    if (!(await admin(req, res))) return;
    const b = (req.body ?? {}) as { botNumber?: string; email?: string | null };
    const botNumber = String(b.botNumber ?? "").replace(/\D+/g, "").padStart(7, "0");
    const unit = await store.getUnit(botNumber);
    if (!unit) { res.status(404).json({ error: "unknown_unit" }); return; }
    // release from the current owner
    if (unit.accountId) {
      const prev = (await store.getProfile(unit.accountId)) ?? {};
      if (prev["botNumber"] === botNumber) { const { botNumber: _b, ...rest } = prev; await store.setProfile(unit.accountId, { ...rest, entitled: isReserved(rest) ? rest["entitled"] : false }); }
    }
    const email = b.email ? String(b.email).trim().toLowerCase() : "";
    const account = email ? await store.getAccountByEmail(email) : undefined;
    await store.updateUnit(botNumber, { accountId: account?.id, reservedFor: email && !account ? email : undefined, claimedAt: account ? Date.now() : undefined });
    if (account) { const cur = (await store.getProfile(account.id)) ?? {}; await store.setProfile(account.id, { ...cur, entitled: true, botNumber }); }
    res.json({ ok: true, botNumber, owner: account?.email ?? null, reservedFor: email && !account ? email : null });
  });
  // GET /v1/admin/accounts — who has signed up (no secrets).
  r.get("/accounts", async (req: Request, res: Response) => {
    if (!(await admin(req, res))) return;
    const rows = [];
    for (const p of await store.listProfiles()) { const a = await store.getAccountById(p.accountId); rows.push({ email: a?.email, displayName: a?.displayName, createdAt: a?.createdAt, botNumber: p.data["botNumber"] ?? null, entitled: p.data["entitled"] === true, reserved: isReserved(p.data), status: (p.data["reservation"] as { status?: string } | undefined)?.status ?? null, emailUpdates: p.data["emailUpdates"] === true }); }
    res.json({ accounts: rows });
  });

  r.get("/units", async (req: Request, res: Response) => {
    if (!(await admin(req, res))) return;
    const units = await store.listUnits();
    const rows = [];
    for (const u of units) { const a = u.accountId ? await store.getAccountById(u.accountId) : undefined; rows.push({ botNumber: u.botNumber, owner: a?.email ?? null, reservedFor: u.reservedFor ?? null, hasClaimCode: !!u.claimCodeHash, createdAt: u.createdAt, claimedAt: u.claimedAt ?? null, note: u.note ?? null }); }
    res.json({ units: rows });
  });
  r.post("/entitle", async (req: Request, res: Response) => {
    if (!(await admin(req, res))) return;
    const { email, entitled } = (req.body ?? {}) as { email?: string; entitled?: boolean };
    const account = email ? await store.getAccountByEmail(email.toLowerCase()) : undefined;
    if (!account) { res.status(404).json({ error: "no such account" }); return; }
    const current = (await store.getProfile(account.id)) ?? {};
    await store.setProfile(account.id, { ...current, entitled: entitled !== false });
    res.json({ ok: true, email: account.email, entitled: entitled !== false });
  });
  return r;
}
