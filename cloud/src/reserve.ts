/**
 * reserve.ts — reservations, two processors, one shape of record.
 *
 *   PayPal (the easy path, Devin already has it live): the configurator shows
 *   PayPal buttons for a DEPOSIT (NOBI_DEPOSIT_CENTS, default $99, credited to
 *   the build). Buyers pay by PayPal or by card as a guest. When the unit is
 *   built, admin sends a PayPal invoice for the balance from the admin page.
 *   No card data ever touches us.
 *
 *   Stripe (optional): Checkout in SETUP mode saves a card at Stripe; admin
 *   charges the build total off-session at build time. Or, with
 *   STRIPE_PRICE_RESERVE, a deposit is taken AND the card saved.
 *
 * Every completed reservation assigns the next bot # and binds a unit.
 * Both APIs are called over REST with fetch — no SDKs.
 * Env: PAYPAL_CLIENT_ID + PAYPAL_SECRET (+ PAYPAL_ENV, NOBI_DEPOSIT_CENTS,
 *      PAYPAL_INVOICER_EMAIL) · STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
 *      (+ STRIPE_PRICE_RESERVE) · NOBI_PAY_PROVIDER to force one.
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

// ── PayPal (the easy path: deposit now by PayPal or card, balance invoiced at build) ──
// Env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV=live|sandbox, NOBI_DEPOSIT_CENTS (default 9900),
//      optional PAYPAL_INVOICER_EMAIL (a confirmed email on the PayPal business account).
const ppId = () => process.env["PAYPAL_CLIENT_ID"] ?? "";
const ppSecret = () => process.env["PAYPAL_SECRET"] ?? "";
const ppBase = () => (process.env["PAYPAL_ENV"] ?? "live") === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
export const depositCents = () => Math.max(100, Math.round(Number(process.env["NOBI_DEPOSIT_CENTS"] ?? 9900)) || 9900);
/** Which processor is live: PayPal when its keys are set (or NOBI_PAY_PROVIDER forces one), else Stripe, else none. */
export function provider(): "paypal" | "stripe" | null {
  const forced = process.env["NOBI_PAY_PROVIDER"];
  if (forced === "stripe" && key()) return "stripe";
  if (forced === "paypal" && ppId() && ppSecret()) return "paypal";
  if (ppId() && ppSecret()) return "paypal";
  if (key()) return "stripe";
  return null;
}
const usd = (cents: number) => (cents / 100).toFixed(2);
let ppTok: { token: string; exp: number } | null = null;
async function paypalToken(): Promise<string> {
  if (ppTok && ppTok.exp > Date.now() + 30_000) return ppTok.token;
  const res = await fetch(`${ppBase()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${ppId()}:${ppSecret()}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(20_000) });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description ?? `PayPal auth ${res.status}`);
  ppTok = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 300) * 1000 };
  return j.access_token;
}
async function paypal(method: "GET" | "POST", path: string, body?: unknown): Promise<J> {
  const res = await fetch(`${ppBase()}${path}`, { method, headers: { Authorization: `Bearer ${await paypalToken()}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as J;
  if (!res.ok) { const d = (json["details"] as Array<{ description?: string; issue?: string }> | undefined)?.[0]; throw new Error(String(d?.description ?? d?.issue ?? json["message"] ?? json["error_description"] ?? `PayPal ${res.status}`)); }
  return json;
}

/** Bind a bot # + unit to the account and mark the reservation. Shared by every processor. */
async function markReserved(store: Store, accountId: string, patch: J): Promise<string> {
  const current = (await store.getProfile(accountId)) ?? {};
  const prior = (current["reservation"] as J | undefined) ?? {};
  const botNumber = (prior["botNumber"] as string | undefined) ?? (current["botNumber"] as string | undefined) ?? (await store.nextBotNumber());
  if (!(await store.getUnit(botNumber))) await store.createUnit({ botNumber, accountId, createdAt: Date.now(), claimedAt: Date.now(), note: "reserved" });
  await store.setProfile(accountId, { ...current, botNumber, reservation: { ...prior, ...patch, botNumber, at: new Date().toISOString() } });
  return botNumber;
}

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

  // GET /v1/reserve/status → which processor is live + this account's card/reservation
  r.get("/status", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    const profile = (await store.getProfile(req.account!.id)) ?? {};
    const pay = profile["payment"] as { brand?: string; last4?: string } | undefined;
    const prov = provider();
    res.json({
      open: !!prov, provider: prov, deposit: prov === "paypal" ? true : !!depositPrice(), depositCents: prov === "paypal" ? depositCents() : null,
      paypalClientId: prov === "paypal" ? ppId() : null, paypalEnv: prov === "paypal" ? (process.env["PAYPAL_ENV"] ?? "live") : null,
      card: pay ? { brand: pay.brand, last4: pay.last4 } : null, reservation: profile["reservation"] ?? null, botNumber: profile["botNumber"] ?? null,
      invoices: profile["invoices"] ?? [],
    });
  });

  // POST /v1/reserve/paypal/order { code, summary, totalCents } → { id }  (the PayPal button calls this)
  r.post("/paypal/order", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    if (provider() !== "paypal") { res.status(503).json({ error: "reservations not open" }); return; }
    const { code, summary, totalCents } = (req.body ?? {}) as Record<string, unknown>;
    const account = req.account!;
    try {
      const order = await paypal("POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{ custom_id: account.id, description: "Nobi reservation deposit — credited to your build", amount: { currency_code: "USD", value: usd(depositCents()) } }],
        payment_source: { paypal: { experience_context: { brand_name: "Nobi · Development Industries", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } } },
      });
      const current = (await store.getProfile(account.id)) ?? {};
      const prior = (current["reservation"] as J | undefined) ?? {};
      await store.setProfile(account.id, { ...current, reservation: { ...prior, status: prior["status"] === "paid" || prior["status"] === "reserved" ? prior["status"] : "checkout", provider: "paypal", orderId: order["id"], code, summary, totalCents: Math.round(Number(totalCents)) || Number(prior["totalCents"]) || 0, at: new Date().toISOString() } });
      res.json({ id: order["id"] });
    } catch (e) { res.status(502).json({ error: (e as Error).message }); }
  });

  // POST /v1/reserve/paypal/capture { orderId } → { ok, botNumber }  (after the buyer approves)
  r.post("/paypal/capture", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    if (provider() !== "paypal") { res.status(503).json({ error: "reservations not open" }); return; }
    const orderId = String((req.body as { orderId?: string } | undefined)?.orderId ?? "").trim();
    if (!/^[A-Z0-9-]{6,40}$/i.test(orderId)) { res.status(400).json({ error: "orderId required" }); return; }
    const account = req.account!;
    try {
      const cap = await paypal("POST", `/v2/checkout/orders/${orderId}/capture`, {});
      const pu = ((cap["purchase_units"] as J[] | undefined) ?? [])[0] ?? {};
      if (pu["custom_id"] && pu["custom_id"] !== account.id) { res.status(403).json({ error: "that order belongs to another account" }); return; }
      const capture = (((pu["payments"] as J | undefined)?.["captures"] as J[] | undefined) ?? [])[0] ?? {};
      const status = String(cap["status"] ?? capture["status"] ?? "");
      if (status !== "COMPLETED" && status !== "PENDING") { res.status(402).json({ error: `PayPal says ${status || "not completed"}` }); return; }
      const amount = (capture["amount"] as { value?: string } | undefined)?.value;
      const payer = (cap["payer"] as { email_address?: string } | undefined)?.email_address;
      const botNumber = await markReserved(store, account.id, { status: "reserved", provider: "paypal", orderId, captureId: capture["id"] ?? null, captureStatus: status, depositCents: amount ? Math.round(Number(amount) * 100) : depositCents(), currency: "usd", payerEmail: payer ?? null });
      res.json({ ok: true, botNumber, status });
    } catch (e) { res.status(502).json({ error: (e as Error).message }); }
  });

  // POST /v1/reserve/checkout { code, summary, totalCents, successUrl, cancelUrl } → { url, mode }  (Stripe)
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
        const prior = ((await store.getProfile(accountId))?.["reservation"] as J | undefined) ?? {};
        const paidDeposit = obj["mode"] === "payment";
        await markReserved(store, accountId, {
          status: paidDeposit ? "reserved" : "card_on_file", provider: "stripe",
          sessionId: obj["id"], paymentIntent: obj["payment_intent"] ?? null,
          depositCents: paidDeposit ? obj["amount_total"] : 0, currency: obj["currency"] ?? "usd",
          code: meta["code"] || prior["code"], totalCents: Number(meta["totalCents"]) || Number(prior["totalCents"]) || 0,
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
        charges: p.data["charges"] ?? [], invoices: p.data["invoices"] ?? [], updatedAt: p.updatedAt,
      });
    }
    rows.sort((x, y) => Number(y["updatedAt"] ?? 0) - Number(x["updatedAt"] ?? 0));
    res.json({ builds: rows, stripe: !!key(), paypal: !!(ppId() && ppSecret()), provider: provider(), depositCents: depositCents() });
  });

  // POST /v1/admin/invoice { email, amountCents, note? } — PayPal invoice for the balance, emailed to the customer.
  r.post("/invoice", async (req: Request, res: Response) => {
    if (!(await isAdminReq(store, req))) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!(ppId() && ppSecret())) { res.status(503).json({ error: "paypal not configured" }); return; }
    const { email, amountCents, note } = (req.body ?? {}) as { email?: string; amountCents?: number; note?: string };
    const account = email ? await store.getAccountByEmail(String(email).toLowerCase()) : undefined;
    if (!account) { res.status(404).json({ error: "no such account" }); return; }
    const amount = Math.round(Number(amountCents));
    if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "amountCents required (≥ 100)" }); return; }
    const profile = (await store.getProfile(account.id)) ?? {};
    const bot = String(profile["botNumber"] ?? "");
    try {
      const invoicer = process.env["PAYPAL_INVOICER_EMAIL"];
      const created = await paypal("POST", "/v2/invoicing/invoices", {
        detail: { currency_code: "USD", note: String(note ?? "Balance for your Nobi build. Thank you for being an early adopter.").slice(0, 400), payment_term: { term_type: "DUE_ON_RECEIPT" }, reference: bot ? `nobi-${bot}` : undefined },
        ...(invoicer ? { invoicer: { email_address: invoicer, business_name: "Development Industries" } } : {}),
        primary_recipients: [{ billing_info: { email_address: account.email, name: { given_name: account.displayName.slice(0, 140) } } }],
        items: [{ name: bot ? `Nobi · Mark 1 · #${bot} — build balance` : "Nobi · Mark 1 — build balance", quantity: "1", unit_amount: { currency_code: "USD", value: usd(amount) } }],
      });
      const id = String(created["id"] ?? (created["href"] as string | undefined)?.split("/").pop() ?? "");
      if (!id) throw new Error("PayPal returned no invoice id");
      await paypal("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: true });
      const inv = await paypal("GET", `/v2/invoicing/invoices/${id}`);
      const link = ((inv["detail"] as J | undefined)?.["metadata"] as { recipient_view_url?: string } | undefined)?.recipient_view_url ?? `https://www.paypal.com/invoice/p/#${id}`;
      const record = { id, amountCents: amount, status: String(inv["status"] ?? "SENT"), at: new Date().toISOString(), link };
      const invoices = Array.isArray(profile["invoices"]) ? (profile["invoices"] as J[]) : [];
      const reservation = (profile["reservation"] as J | undefined) ?? {};
      await store.setProfile(account.id, { ...profile, invoices: [...invoices, record], reservation: { ...reservation, status: reservation["status"] === "paid" ? "paid" : "invoiced" } });
      res.json({ ok: true, invoice: record });
    } catch (e) { res.status(502).json({ error: (e as Error).message }); }
  });

  // POST /v1/admin/invoice/refresh { email } — pull invoice statuses from PayPal; PAID settles the reservation.
  r.post("/invoice/refresh", async (req: Request, res: Response) => {
    if (!(await isAdminReq(store, req))) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!(ppId() && ppSecret())) { res.status(503).json({ error: "paypal not configured" }); return; }
    const { email } = (req.body ?? {}) as { email?: string };
    const account = email ? await store.getAccountByEmail(String(email).toLowerCase()) : undefined;
    if (!account) { res.status(404).json({ error: "no such account" }); return; }
    const profile = (await store.getProfile(account.id)) ?? {};
    const invoices = Array.isArray(profile["invoices"]) ? (profile["invoices"] as J[]) : [];
    try {
      const next: J[] = [];
      for (const inv of invoices) { const live = await paypal("GET", `/v2/invoicing/invoices/${inv["id"]}`); next.push({ ...inv, status: String(live["status"] ?? inv["status"]) }); }
      const paid = next.some((i) => i["status"] === "PAID" || i["status"] === "MARKED_AS_PAID");
      const reservation = (profile["reservation"] as J | undefined) ?? {};
      await store.setProfile(account.id, { ...profile, invoices: next, reservation: { ...reservation, status: paid ? "paid" : reservation["status"] } });
      res.json({ ok: true, invoices: next, paid });
    } catch (e) { res.status(502).json({ error: (e as Error).message }); }
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
