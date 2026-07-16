/**
 * providers.ts — Cloud provider connector routes
 *
 * Powers the Genesis setup wizard + Settings UI:
 *   GET  /api/providers        → configured-or-not status for every provider
 *   POST /api/providers/test   → test a provider (optionally pre-save with { key })
 *   POST /api/providers/chat   → one-shot chat routed to a specific provider
 */

import { Router } from "express";
import { logger } from "../lib/logger.js";
import {
  providerStatus,
  testProvider,
  callGemini,
  callPerplexity,
  callOpenAIChat,
  type ProviderMessage,
} from "../lib/providers.js";
import { callClaude, getClaudeModel, getClaudeMaxTokens } from "../lib/inference.js";

const router = Router();

// ── GET / ────────────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  res.json({ providers: await providerStatus() });
});

// ── POST /test ───────────────────────────────────────────────────────────────
// { id, key? } — key is optional and used to validate before saving.
router.post("/test", async (req, res) => {
  const { id, key } = req.body as { id?: string; key?: string };
  if (!id) {
    res.status(400).json({ ok: false, detail: "id is required" });
    return;
  }
  const result = await testProvider(id, key);
  res.json(result);
});

// ── POST /chat ───────────────────────────────────────────────────────────────
// { providerId, message, system? } → route to the matching caller.
router.post("/chat", async (req, res) => {
  const { providerId, message, system } = req.body as {
    providerId?: string;
    message?: string;
    system?: string;
  };

  if (!providerId || !message?.trim()) {
    res.status(400).json({ error: "providerId and message are required" });
    return;
  }

  const messages: ProviderMessage[] = [
    { role: "system", content: system || "You are Neura." },
    { role: "user", content: message },
  ];

  try {
    let response: string;
    switch (providerId) {
      case "claude":
        response = await callClaude(messages, await getClaudeModel(), await getClaudeMaxTokens());
        break;
      case "gemini":
        response = await callGemini(messages);
        break;
      case "perplexity":
        response = await callPerplexity(messages);
        break;
      case "openai":
        response = await callOpenAIChat(messages);
        break;
      default:
        res.status(400).json({ error: `Unknown providerId: ${providerId}` });
        return;
    }
    res.json({ response, provider: providerId });
  } catch (err) {
    logger.error({ err }, "provider chat error");
    res.status(502).json({ error: err instanceof Error ? err.message : "Provider error" });
  }
});

export default router;
