/*
 * brain.ts — the cloud brain. Multi-tenant chat that runs on the account's OWN
 * API key (decrypted from the vault just-in-time) so every user pays their own
 * provider costs and no keys are shared.
 *
 *   POST /v1/chat  { message, history?, system? }  → { reply, model }
 *
 * Mirrors core/server/lib/inference.ts: raw fetch (no SDK), 60 s timeout, and
 * every resolved secret is redacted out of any surfaced error string.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { Store } from "./store.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { isOwner } from "./sync.js";
import { decryptSecret } from "./crypto.js";
import { rateLimit } from "./ratelimit.js";

const TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = process.env.NEURA_CLOUD_MODEL || "claude-3-5-sonnet-latest";
const DEFAULT_MAX_TOKENS = Math.min(4096, Number(process.env.NEURA_CLOUD_MAX_TOKENS || 1024));
const CHAT_PER_MIN = Number(process.env.NEURA_CLOUD_CHAT_PER_MIN || 20);
const MAX_TOTAL_INPUT_CHARS = 48_000; // aggregate cap (~12k tokens) to bound spend per call

const chatSchema = z
  .object({
    message: z.string().min(1).max(8000),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
      .max(30)
      .optional(),
    system: z.string().max(4000).optional(),
  })
  .superRefine((v, ctx) => {
    const total =
      v.message.length +
      (v.system?.length ?? 0) +
      (v.history?.reduce((n, m) => n + m.content.length, 0) ?? 0);
    if (total > MAX_TOTAL_INPUT_CHARS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "conversation too large" });
    }
  });

function redact(err: unknown, secret?: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (secret && secret.length >= 4) msg = msg.split(secret).join("***");
  return msg || "Unknown error";
}

/** Resolve the account's Anthropic key from the vault. Returns "" if unset. */
async function accountKey(store: Store, accountId: string, name: string): Promise<string> {
  const entry = await store.getKey(accountId, name);
  if (!entry) return "";
  try {
    return decryptSecret(entry.ciphertext, `${accountId}:${name}`);
  } catch {
    return "";
  }
}

const OPENROUTER_MODEL = process.env.NEURA_CLOUD_OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
async function callOpenRouter(
  key: string,
  system: string | undefined,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ reply: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", "HTTP-Referer": "https://developmentindustries.org", "X-Title": "Nobi" },
      body: JSON.stringify({ model: OPENROUTER_MODEL, max_tokens: DEFAULT_MAX_TOKENS, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages] }),
      signal: controller.signal,
    });
    if (!res.ok) { const body = await res.text(); throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`); }
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const reply = (data.choices?.[0]?.message?.content ?? "").trim();
    return { reply: reply || "(no response)", model: data.model || OPENROUTER_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

async function callClaude(
  key: string,
  system: string | undefined,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ reply: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: DEFAULT_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("")
      .trim();
    return { reply: reply || "(no response)", model: data.model || DEFAULT_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

export function brainRouter(store: Store): Router {
  const r = Router();
  r.use(requireAuth(store));
  // Per-account cap: unbounded chat would drain the user's own provider credits.
  r.use(
    rateLimit({
      windowMs: 60_000,
      max: CHAT_PER_MIN,
      key: (req) => (req as AuthedRequest).account!.id,
      name: "chat",
    }),
  );

  r.post("/", async (req: AuthedRequest, res: Response) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "message required" });
      return;
    }
    // Owners only: the web face is for people who reserved a Nobi (or were entitled).
    if (!isOwner(await store.getProfile(req.account!.id), req.account!.email)) {
      res.status(403).json({ error: "owners_only", message: "The web face is for Nobi owners. Reserve yours to unlock it." });
      return;
    }
    // Bring your own model: OpenRouter first (what the robot runs), else Anthropic.
    const orKey = await accountKey(store, req.account!.id, "OPENROUTER_API_KEY");
    const key = orKey || (await accountKey(store, req.account!.id, "ANTHROPIC_API_KEY"));
    if (!key) {
      res.status(412).json({
        error: "no_key",
        message: "Add your OpenRouter or Anthropic API key to use the web face.",
      });
      return;
    }
    const messages = [
      ...(parsed.data.history || []),
      { role: "user" as const, content: parsed.data.message },
    ];
    try {
      const out = orKey ? await callOpenRouter(orKey, parsed.data.system, messages) : await callClaude(key, parsed.data.system, messages);
      res.json(out);
    } catch (err) {
      res.status(502).json({ error: "brain_error", message: redact(err, key) });
    }
  });

  return r;
}
