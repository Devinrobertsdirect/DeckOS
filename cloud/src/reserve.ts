/**
 * reserve.ts — build-profile reservations, paid through Stripe Checkout.
 *
 * The configurator on the site saves a `buildProfile` into the account profile
 * (see profile.ts). Reserving a unit opens a hosted Stripe Checkout for the
 * deposit price in STRIPE_PRICE_RESERVE; Stripe calls the webhook when it is
 * paid and the profile gets a `reservation` record. Fulfilment reads the
 * reserved builds through the admin list and provisions each robot from them.
 *
 * Talks to Stripe's REST API directly (form-encoded + Basic auth) so the cloud
 * takes no new dependency; the webhook signature is verified with node:crypto.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_PRICE_RESERVE (a Price id), STRIPE_WEBHOOK_SECRET,
 *      NOBI_ADMIN_KEY (for GET /v1/admin/builds). Without the Stripe keys the
 *      checkout route answers 503 "reservations not open" and the site says so.
 */
import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "./store.js";
import { requireAuth, type AuthedRequest } from "./auth.js";

const STRIPE = "https://api.stripe.com/v1";
const key = () => process.env["STRIPE_SECRET_KEY"] ?? "";
const price = () => process.env["STRIPE_PRICE_RESERVE"] ?? "";

async function stripe(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE}${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(key() + ":").toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String((json["error"] as { message?: string } | undefined)?.message ?? `Stripe ${res.status}`));
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

export function reserveRouter(store: Store): Router {
  const r = Router();

  // POST /v1/reserve/checkout { code, summary, successUrl, cancelUrl } → { url }
  r.post("/checkout", requireAuth(store), async (req: AuthedRequest, res: Response) => {
    if (!key() || !price()) { res.status(503).json({ error: "reservations not open" }); return; }
    const { code, summary, successUrl, cancelUrl } = (req.body ?? {}) as Record<string, unknown>;
    if (!isHttpUrl(successUrl) || !isHttpUrl(cancelUrl)) { res.status(400).json({ error: "successUrl and cancelUrl required" }); return; }
    const account = req.account!;
    try {
      const session = await stripe("/checkout/sessions", {
        mode: "payment",
        "line_items[0][price]": price(),
        "line_items[0][quantity]": "1",
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: account.email,
        client_reference_id: account.id,
        "metadata[accountId]": account.id,
        "metadata[code]": String(code ?? "").slice(0, 400),
        "metadata[summary]": String(summary ?? "").slice(0, 400),
      });
      const current = (await store.getProfile(account.id)) ?? {};
      await store.setProfile(account.id, { ...current, reservation: { status: "checkout", sessionId: session["id"], at: new Date().toISOString(), code } });
      res.json({ url: session["url"], sessionId: session["id"] });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  // POST /v1/reserve/webhook — Stripe → us. Needs the RAW body (app.ts keeps it on req.rawBody).
  r.post("/webhook", async (req: Request, res: Response) => {
    const secret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyStripeSignature(raw, req.header("stripe-signature"), secret)) { res.status(400).json({ error: "bad signature" }); return; }
    const event = req.body as { type?: string; data?: { object?: Record<string, unknown> } };
    const obj = event.data?.object ?? {};
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const meta = (obj["metadata"] ?? {}) as Record<string, string>;
      const accountId = meta["accountId"] ?? (obj["client_reference_id"] as string | undefined);
      if (accountId) {
        const current = (await store.getProfile(accountId)) ?? {};
        await store.setProfile(accountId, {
          ...current,
          reservation: {
            status: "reserved",
            sessionId: obj["id"],
            paymentIntent: obj["payment_intent"],
            amountTotal: obj["amount_total"],
            currency: obj["currency"],
            code: meta["code"],
            at: new Date().toISOString(),
          },
        });
      }
    }
    res.json({ received: true });
  });

  return r;
}

/** GET /v1/admin/builds — every account with a saved build profile (fulfilment view). Header x-admin-key. */
export function adminRouter(store: Store): Router {
  const r = Router();
  r.get("/builds", async (req: Request, res: Response) => {
    const want = process.env["NOBI_ADMIN_KEY"] ?? "";
    const got = req.header("x-admin-key") ?? String(req.query["key"] ?? "");
    if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) { res.status(401).json({ error: "unauthorized" }); return; }
    const rows: Array<Record<string, unknown>> = [];
    for (const p of await store.listProfiles()) {
      const bp = p.data["buildProfile"] as Record<string, unknown> | undefined;
      if (!bp) continue;
      const a = await store.getAccountById(p.accountId);
      rows.push({
        accountId: p.accountId, email: a?.email, displayName: a?.displayName,
        ownerName: p.data["ownerName"], botName: p.data["botName"], emailUpdates: p.data["emailUpdates"],
        code: bp["code"], summary: bp["summary"], savedAt: bp["savedAt"],
        build: bp, reservation: p.data["reservation"] ?? null, updatedAt: p.updatedAt,
      });
    }
    rows.sort((x, y) => Number(y["updatedAt"] ?? 0) - Number(x["updatedAt"] ?? 0));
    res.json({ builds: rows });
  });
  return r;
}
