/**
 * reserve.ts — reservations with a CARD ON FILE, through Stripe.
 *
 * The configurator saves a `buildProfile` (profile.ts). Reserving opens a
 * hosted Stripe Checkout in SETUP mode: the customer saves a card, nothing is
 * charged yet. Stripe holds the card (PCI stays with them); we keep only the
 * customer id, payment-method id, brand and last4. The team then charges the
 * build total off-session from the admin page when the unit is built — or an
 * automated step can do the same call. If STRIPE_PRICE_RESERVE is set, Checkout
 * instead takes that deposit now AND saves the card for the balance.
 *
 * Every completed reservation assigns the next bot # and binds a unit.
 * Stripe is called through its REST API (form-encoded, Basic auth) — no SDK.
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, optional STRIPE_PRICE_RESERVE.
 */
import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "./store.js";
import { requireAuth, validateSession, type AuthedRequest } from "./auth.js";
import { isAdminEmail } from "./sync.js";

const STRIPE = "https://api.stripe.com/v1";
const key = () => process.env["STRIPE_SECRET_KEY"] ?? "";
const depositPrice = () => process.env["STRIPE_PRICE_RESERVE"] ?? "";

type J = Record<string, unknown>;
async function stripe(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<J> {
  const res = await fetch(`${STRIPE}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(key() + ":").toString("base64")}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as J;
  if (!res.ok) {
    const err = json["error"] as { message?: string; code?: string } | undefined;
    const e = new Error(String(err?.message ?? `Stripe ${res.status}`)) as Error & { code?: string };
    e.code = String(err?.code ?? "");
    throw e;
  }
  return json;
}

/** Verify a Stripe-Signature header against the raw body (t=…,v1=…; 5-minute tolerance). */
export function verifyStripeSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts["t"], v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u) && u.length < 2000;

/** Reuse or create the Stripe customer for an account (id kept on the profile). */
async function customerFor(store: Store, accountId: string, email: string): Promise<string> {
  const profile = (await store.getProfile(accountId)) ?? {};
  const existing = (profile["stripe"] as { customerId?: string } | undefined)?.customerId;
  if (existing) return existing;
  const c = await stripe("POST", "/customers", { email, "metadata[accountId]": accountId });
  await store.setProfile(accountId, { ...profile, stripe: { customerId: c["id"] } });
  return String(c["id"]);
}

/** After Checkout completes: remember the saved card (brand/last4 only — Stripe keeps the number). */
async function recordCard(store: Store, accountId: string, session: J): Promise<void> {
  let pm: string | undefined;
  if (session["mode"] === "setup" && session["setup_intent"]) {
    const si = await stripe("GET", `/setup_intents/${session["setup_intent"]}`);
    pm = typeof si["payment_method"] === "string" ? (si["payment_method"] as string) : undefined;
  } else if (session["payment_intent"]) {
    const pi = await stripe("GET", `/payment_intents/${session["payment_intent"]}`);
    pm = typeof pi["payment_method"] === "string" ? (pi["payment_method"] as string) : undefined;
  }
  if (!pm) return;
  const m = await stripe("GET", `/payment_methods/${pm}`);
  const card = (m["card"] ?? {}) as { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
  const current = (await store.getProfile(accountId)) ?? {};
  await store.setProfile(accountId, {
    ...current,
    payment: { customerId: session["customer"], paymentMethodId: pm, brand: card.brand, last4: card.last4, exp: card.exp_month && card.exp_year ? `${card.exp_month}/${card.exp_year}` : undefined, savedAt: new Date().toISOString() },
  });
}

export function reserveRouter(store: Store): Router {
  const r = Router();

  // GET /v1/reserve/status → is Checkout live, and does this account already have a card + reservation
  r.get("/status", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = (await store.getProfile(req.account!.id)) ?? {};
    const pay = profile["payment"] as { brand?: string; last4?: string } | undefined;
    res.json({ open: !!key(), deposit: !!depositPrice(), card: pay ? { brand: pay.brand, last4: pay.last4 } : null, reservation: profile["reservation"] ?? null, botNumber: profile["botNumber"] ?? null });
  });

  // POST /v1/reserve/checkout { code, summary, totalCents, successUrl, cancelUrl } → { url, mode }
  r.post("/checkout", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    if (!key()) { res.status(503).json({ error: "reservations not open" }); return; }
    const { code, summary, totalCents, successUrl, cancelUrl } = (req.body ?? {}) as Record<string, unknown>;
    if (!isHttpUrl(successUrl) || !isHttpUrl(cancelUrl)) { res.status(400).json({ error: "successUrl and cancelUrl required" }); return; }
    const account = req.account!;
    try {
      const customer = await customerFor(store, account.id, account.email);
      const common = {
        customer, success_url: successUrl, cancel_url: cancelUrl, client_reference_id: account.id,
        "metadata[accountId]": account.id, "metadata[code]": String(code ?? "").slice(0, 400), "metadata[summary]": String(summary ?? "").slice(0, 400), "metadata[totalCents]": String(Math.round(Number(totalCents)) || 0),
      };
      const session = depositPrice()
        ? await stripe("POST", "/checkout/sessions", { ...common, mode: "payment", "line_items[0][price]": depositPrice(), "line_items[0][quantity]": "1", "payment_intent_data[setup_future_usage]": "off_session", "payment_intent_data[metadata][accountId]": account.id })
        : await stripe("POST", "/checkout/sessions", { ...common, mode: "setup", "payment_method_types[0]": "card" });
      const current = (await store.getProfile(account.id)) ?? {};
      const prior = (current["reservation"] as J | undefined) ?? {};
      await store.setProfile(account.id, { ...current, reservation: { ...prior, status: prior["status"] === "paid" ? "paid" : "checkout", sessionId: session["id"], at: new Date().toISOString(), code, totalCents: Math.round(Number(totalCents)) || 0, summary } });
      res.json({ url: session["url"], sessionId: session["id"], mode: session["mode"] });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  // POST /v1/reserve/webhook — Stripe → us. Needs the RAW body (app.ts keeps it on req.rawBody).
  r.post("/webhook", async (req: Request, res: Response) => {
    const secret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyStripeSignature(raw, req.header("stripe-signature"), secret)) { res.status(400).json({ error: "bad signature" }); return; }
    const event = req.body as { type?: string; data?: { object?: J } };
    const obj = event.data?.object ?? {};
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const meta = (obj["metadata"] ?? {}) as Record<string, string>;
      const accountId = meta["accountId"] ?? (obj["client_reference_id"] as string | undefined);
      if (accountId) {
        try { await recordCard(store, accountId, obj); } catch { /* card summary is a nicety; the reservation still records */ }
        const current = (await store.getProfile(accountId)) ?? {};
        // Every reservation is a unit: assign the next bot # and bind it to the account.
        const prior = (current["reservation"] as J | undefined) ?? {};
        const botNumber = (prior["botNumber"] as string | undefined) ?? (current["botNumber"] as string | undefined) ?? (await store.nextBotNumber());
        if (!(await store.getUnit(botNumber))) await store.createUnit({ botNumber, accountId, createdAt: Date.now(), claimedAt: Date.now(), note: "reserved" });
        const paidDeposit = obj["mode"] === "payment";
        await store.setProfile(accountId, {
          ...current,
          botNumber,
          reservation: {
            ...prior,
            status: paidDeposit ? "reserved" : "card_on_file",
            botNumber, sessionId: obj["id"], paymentIntent: obj["payment_intent"] ?? null,
            depositCents: paidDeposit ? obj["amount_total"] : 0, currency: obj["currency"] ?? "usd",
            code: meta["code"] || prior["code"], totalCents: Number(meta["totalCents"]) || Number(prior["totalCents"]) || 0,
            at: new Date().toISOString(),
          },
        });
      }
    }
    res.json({ received: true });
  });

  return r;
}

async function isAdminReq(store: Store, req: Request): Promise<boolean> {
  const want = process.env["NOBI_ADMIN_KEY"] ?? "";
  const got = req.header("x-admin-key") ?? String(req.query["key"] ?? "");
  if (want && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))) return true;
  const bearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const acct = bearer ? await validateSession(store, bearer) : null;
  return !!acct && isAdminEmail(acct.email);
}

/** GET /v1/admin/builds — fulfilment view. POST /v1/admin/charge — charge a saved card off-session. */
export function adminRouter(store: Store): Router {
  const r = Router();
  r.get("/builds", async (req: Request, res: Response) => {
    if (!(await isAdminReq(store, req))) { res.status(401).json({ error: "unauthorized" }); return; }
    const rows: Array<J> = [];
    for (const p of await store.listProfiles()) {
      const bp = p.data["buildProfile"] as J | undefined;
      if (!bp) continue;
      const a = await store.getAccountById(p.accountId);
      const pay = p.data["payment"] as J | undefined;
      rows.push({
        accountId: p.accountId, email: a?.email, displayName: a?.displayName,
        botNumber: p.data["botNumber"] ?? null, ownerName: p.data["ownerName"], botName: p.data["botName"], emailUpdates: p.data["emailUpdates"],
        code: bp["code"], summary: bp["summary"], savedAt: bp["savedAt"], pricing: bp["pricing"] ?? null,
        build: bp, reservation: p.data["reservation"] ?? null,
        card: pay ? { brand: pay["brand"], last4: pay["last4"], exp: pay["exp"] } : null,
        charges: p.data["charges"] ?? [], updatedAt: p.updatedAt,
      });
    }
    rows.sort((x, y) => Number(y["updatedAt"] ?? 0) - Number(x["updatedAt"] ?? 0));
    res.json({ builds: rows, stripe: !!key() });
  });

  // POST /v1/admin/charge { email, amountCents, description? } — the team charges the card on file at build time.
  r.post("/charge", async (req: Request, res: Response) => {
    if (!(await isAdminReq(store, req))) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!key()) { res.status(503).json({ error: "stripe not configured" }); return; }
    const { email, amountCents, description } = (req.body ?? {}) as { email?: string; amountCents?: number; description?: string };
    const account = email ? await store.getAccountByEmail(String(email).toLowerCase()) : undefined;
    if (!account) { res.status(404).json({ error: "no such account" }); return; }
    const profile = (await store.getProfile(account.id)) ?? {};
    const pay = profile["payment"] as { customerId?: string; paymentMethodId?: string } | undefined;
    if (!pay?.customerId || !pay.paymentMethodId) { res.status(412).json({ error: "no card on file" }); return; }
    const amount = Math.round(Number(amountCents));
    if (!Number.isFinite(amount) || amount < 50) { res.status(400).json({ error: "amountCents required (≥ 50)" }); return; }
    try {
      const pi = await stripe("POST", "/payment_intents", {
        amount: String(amount), currency: "usd", customer: String(pay.customerId), payment_method: pay.paymentMethodId,
        off_session: "true", confirm: "true", description: String(description ?? "Nobi build").slice(0, 200),
        "metadata[accountId]": account.id, "metadata[botNumber]": String(profile["botNumber"] ?? ""),
      });
      const charge = { id: pi["id"], amountCents: amount, status: pi["status"], at: new Date().toISOString(), description: description ?? "Nobi build" };
      const charges = Array.isArray(profile["charges"]) ? (profile["charges"] as J[]) : [];
      const reservation = (profile["reservation"] as J | undefined) ?? {};
      await store.setProfile(account.id, { ...profile, charges: [...charges, charge], reservation: { ...reservation, status: pi["status"] === "succeeded" ? "paid" : reservation["status"] } });
      res.json({ ok: pi["status"] === "succeeded", charge });
    } catch (e) {
      const err = e as Error & { code?: string };
      res.status(402).json({ error: err.message, code: err.code ?? null, hint: err.code === "authentication_required" ? "The bank wants the customer to confirm — ask them to re-save the card from the site." : undefined });
    }
  });
  return r;
}
