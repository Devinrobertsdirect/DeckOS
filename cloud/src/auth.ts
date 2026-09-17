/*
 * auth.ts — accounts, sessions, and the bearer-auth middleware.
 *
 *   POST /v1/auth/signup   { email, password, displayName? }  → { token, user }
 *   POST /v1/auth/login    { email, password }                → { token, user }
 *   POST /v1/auth/google   { idToken }                        → { token, user }
 *   POST /v1/auth/logout   (Bearer)                           → { ok }
 *   GET  /v1/auth/me       (Bearer)                           → { user }
 *
 * Sessions are opaque random tokens; only their SHA-256 is stored, so a leak of
 * the store can't be replayed into live sessions. Passwords are scrypt-hashed
 * (async, non-blocking) and login is timing-equalized against a dummy hash so the
 * response time can't be used to enumerate which emails have accounts.
 */
import { isAdminEmail } from "./sync.js";
import { bindPreassigned, lookupEmail } from "./preassign.js";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Store, Account } from "./store.js";
import {
  hashPassword,
  verifyPassword,
  dummyPasswordHash,
  randomToken,
  sha256,
  randomId,
} from "./crypto.js";

export type PublicUser = { id: string; email: string; displayName: string };
export type AuthedRequest = Request & { account?: Account };

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 days
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const MAX_ID_TOKEN_LEN = 4096;

function publicUser(a: Account): PublicUser {
  return { id: a.id, email: a.email, displayName: a.displayName };
}

/** RFC 6750 bearer scheme is case-insensitive. Returns the token or "". */
export function parseBearer(header: string | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(header || "");
  return m ? m[1]!.trim() : "";
}

async function issueSession(store: Store, accountId: string): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await store.createSession({ tokenHash: sha256(token), accountId, createdAt: now, lastSeen: now });
  return token;
}

/**
 * Shared session validation used by BOTH the REST middleware and the WebSocket
 * relay, so the two surfaces can never drift on expiry/existence checks.
 * Returns the account for a live session, else null (deleting expired rows).
 */
export async function validateSession(store: Store, token: string): Promise<Account | null> {
  if (!token) return null;
  const session = await store.getSession(sha256(token));
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await store.deleteSession(session.tokenHash);
    return null;
  }
  const account = await store.getAccountById(session.accountId);
  if (!account) return null;
  void store.touchSession(session.tokenHash, Date.now());
  return account;
}

/** Express middleware: require a valid Bearer session, attach req.account. */
export function requireAuth(store: Store) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const token = parseBearer(req.header("authorization"));
    if (!token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const account = await validateSession(store, token);
    if (!account) {
      res.status(401).json({ error: "invalid or expired session" });
      return;
    }
    req.account = account;
    next();
  };
}

const credsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80).optional(),
});

/**
 * Verify a Google ID token via Google's tokeninfo endpoint (which itself checks
 * the signature). We additionally enforce audience, issuer, expiry, and — the
 * critical control — that the email is Google-verified. An unverified email must
 * never be trusted for account matching/linking.
 */
async function verifyGoogleIdToken(
  idToken: string,
): Promise<{ sub: string; email: string; name?: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");
  if (idToken.length > MAX_ID_TOKEN_LEN) return null;
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) return null;
  const info = (await res.json()) as Record<string, string>;
  if (info.aud !== clientId) return null;
  if (!info.iss || !GOOGLE_ISSUERS.has(info.iss)) return null;
  if (info.exp && Number(info.exp) * 1000 < Date.now()) return null;
  if (info.email_verified !== "true") return null; // ← reject unverified emails
  if (!info.sub || !info.email) return null;
  return { sub: info.sub, email: info.email, name: info.name };
}

export function authRouter(store: Store): Router {
  const r = Router();

  r.post("/signup", async (req: Request, res: Response) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid email or password (min 8 chars)" });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    if (await store.getAccountByEmail(email)) {
      res.status(409).json({ error: "an account with that email already exists" });
      return;
    }
    const account: Account = {
      id: randomId("acc_"),
      email,
      passwordHash: await hashPassword(parsed.data.password),
      displayName: parsed.data.displayName || email.split("@")[0]!,
      createdAt: Date.now(),
    };
    await store.createAccount(account);
    const pre = await bindPreassigned(store, account);
    const token = await issueSession(store, account.id);
    res.status(201).json({ token, user: publicUser(account), admin: pre.admin, botNumber: pre.botNumber });
  });

  // POST /v1/auth/lookup { email } → do we already know this person (pre-assigned unit / admin)?
  r.post("/lookup", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) { res.status(400).json({ error: "email required" }); return; }
    res.json(await lookupEmail(store, email));
  });

  r.post("/login", async (req: Request, res: Response) => {
    const parsed = credsSchema.pick({ email: true, password: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    const account = await store.getAccountByEmail(parsed.data.email.toLowerCase());
    // Always run exactly one scrypt verify (against a dummy hash when the account
    // is missing or Google-only) so timing can't distinguish the cases.
    const target = account?.passwordHash ?? (await dummyPasswordHash());
    const ok = await verifyPassword(parsed.data.password, target);
    if (!account || !account.passwordHash || !ok) {
      res.status(401).json({ error: "incorrect email or password" });
      return;
    }
    const pre = await bindPreassigned(store, account);
    const token = await issueSession(store, account.id);
    res.json({ token, user: publicUser(account), admin: pre.admin, botNumber: pre.botNumber });
  });

  r.post("/google", async (req: Request, res: Response) => {
    const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
    if (!idToken || idToken.length > MAX_ID_TOKEN_LEN) {
      res.status(400).json({ error: "idToken required" });
      return;
    }
    let info;
    try {
      info = await verifyGoogleIdToken(idToken);
    } catch {
      res.status(502).json({ error: "could not verify Google token" });
      return;
    }
    if (!info) {
      res.status(401).json({ error: "invalid or unverified Google token" });
      return;
    }
    // Match by google sub first. Linking to an existing email account is only
    // safe because we already required email_verified === true above.
    let account =
      (await store.getAccountByGoogleSub(info.sub)) ||
      (await store.getAccountByEmail(info.email.toLowerCase()));
    if (!account) {
      account = {
        id: randomId("acc_"),
        email: info.email.toLowerCase(),
        googleSub: info.sub,
        displayName: info.name || info.email.split("@")[0]!,
        createdAt: Date.now(),
      };
      await store.createAccount(account);
    } else if (!account.googleSub) {
      await store.updateAccount(account.id, { googleSub: info.sub });
    }
    const token = await issueSession(store, account.id);
    res.json({ token, user: publicUser(account) });
  });

  r.post("/logout", requireAuth(store), async (req: Request, res: Response) => {
    const token = parseBearer(req.header("authorization"));
    if (token) await store.deleteSession(sha256(token));
    res.json({ ok: true });
  });

  r.get("/me", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = (await store.getProfile(req.account!.id)) ?? {};
    res.json({ admin: isAdminEmail(req.account!.email), user: publicUser(req.account!), botNumber: (profile["botNumber"] as string | undefined) ?? null });
  });

  return r;
}
