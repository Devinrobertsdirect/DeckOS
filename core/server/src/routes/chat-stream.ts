import { Router } from "express";
import { z } from "zod/v4";
import { runInferenceStreaming } from "../lib/inference.js";
import { capabilitiesPromptBlock } from "../lib/capabilities.js";
import { neuraIdentityLine } from "../lib/identity.js";

/**
 * Streaming chat — a fast, stateless Server-Sent-Events endpoint.
 *
 * POST /api/chat/stream { message, history?, facts?, sessionId? } →
 *   SSE stream of `{ token }` events, then `{ done: true, model }`, then close.
 *
 * Unlike POST /api/chat this endpoint NEVER touches the database: the client
 * supplies the conversation `history` and remembered `facts`, so Atlas can talk
 * (and reference memory) even when the DB is unavailable. Speed comes from
 * streaming tokens back the moment the model produces them.
 */

const router = Router();

const HistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const StreamRequestSchema = z.object({
  message: z.string().min(1).max(4096),
  history: z.array(HistoryMessageSchema).optional(),
  facts: z.array(z.string()).optional(),
  /** The client-built personality instruction (name + traits) — see personality.ts. */
  persona: z.string().max(600).optional(),
  sessionId: z.string().optional(),
});

// ── POST /api/chat/stream ────────────────────────────────────────────────────
router.post("/stream", async (req, res) => {
  const parsed = StreamRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { message, history, facts, persona } = parsed.data;

  // Personality comes from the client (name + traits). Fall back to the classic
  // warm/witty Atlas if none was sent. Kept concise so spoken replies stay snappy.
  let systemPrompt =
    (persona && persona.trim()
      ? persona.trim()
      : neuraIdentityLine() + " You are a warm, witty personal AI companion running on DeckOS.") +
    " Answer in 1 to 3 short sentences unless the user asks for detail." +
    " Express emotion through words only — never use emoji, emoticons, kaomoji," +
    " or decorative symbols. Your on-screen face shows how you feel; your text is" +
    " just the words you speak." +
    "\n\n" + capabilitiesPromptBlock();
  if (facts && facts.length > 0) {
    systemPrompt +=
      "\n\nHere is what you remember about the user:\n" +
      facts.map((f) => `- ${f}`).join("\n");
  }

  // Match routes/chat.ts: the system message + prior turns go in `context`,
  // while the fresh user turn is passed separately as `prompt`.
  const context = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).slice(-12),
  ];

  // ── Server-Sent Events ──────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // don't let proxies buffer the stream
  res.flushHeaders();

  try {
    const result = await runInferenceStreaming(
      {
        prompt: message,
        mode: "deep",
        task: "chat",
        context,
        useCache: false, // conversations shouldn't be cached
        preferFast: true, // interactive chat → fastest brain (Haiku) when available
      },
      (token) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      },
    );
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ done: true, model: result.modelUsed })}\n\n`);
      res.end();
    }
  } catch (err) {
    req.log.error({ err }, "Chat stream inference failed");
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
      res.end();
    }
  }
});

export default router;
