import { Router } from "express";
import { z } from "zod/v4";
import { db, chatMessagesTable, voiceIdentityTable, memoryEntriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { runInference } from "../lib/inference.js";
import { bus } from "../lib/bus.js";
import { broadcast } from "../lib/ws-server.js";
import { presenceManager } from "../lib/presence-manager.js";
import { buildPersonalizedPrompt, extractSelfUpdate } from "../lib/system-prompt.js";
import { aiPersonaTable } from "@workspace/db";
import { eq as drEq } from "drizzle-orm";
import { checkEasterEgg } from "../lib/easter-eggs.js";
import { getAceraContext, getStarkContext } from "../lib/bootstrap.js";

const router = Router();

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4096),
  channel: z.enum(["web", "mobile", "whatsapp", "voice", "console"]).default("web"),
  sessionId: z.string().default("default"),
  requestId: z.string().optional(),
});

const VoiceIdentityUpdateSchema = z.object({
  tone: z.string().optional(),
  pacing: z.string().optional(),
  formality: z.number().int().min(0).max(100).optional(),
  verbosity: z.number().int().min(0).max(100).optional(),
  emotionRange: z.string().optional(),
});

// ── POST /api/chat ─────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { message, channel, sessionId, requestId } = parsed.data;
  const startMs = Date.now();

  // record user presence
  void presenceManager.record(channel as any);

  // emit request event
  bus.emit({
    source: `channel.${channel}`,
    target: "ai-router",
    type: "ai.chat.request",
    payload: { message: message.substring(0, 200), channel, sessionId },
  });

  // store user message
  await db.insert(chatMessagesTable).values({
    sessionId, role: "user", content: message, channel,
  });

  // fetch recent memory for context
  const recentMemory = await db
    .select({ content: memoryEntriesTable.content })
    .from(memoryEntriesTable)
    .where(eq(memoryEntriesTable.type, "short_term"))
    .orderBy(desc(memoryEntriesTable.createdAt))
    .limit(5);

  const recentHistory = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, sessionId))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(10);

  const context = recentHistory.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // ── Easter eggs — check before touching the LLM ────────────────────────
  // Fetch persona once so we have the AI name + gender for honourifics.
  const personaRows = await db.select().from(aiPersonaTable).limit(1);
  const personaCtx = personaRows.length > 0
    ? { aiName: personaRows[0]!.aiName, gender: personaRows[0]!.gender }
    : { aiName: "JARVIS", gender: "neutral" };

  const eggResponse = checkEasterEgg(message, personaCtx);

  const baseSystemPrompt = await buildPersonalizedPrompt(recentMemory.map((m) => m.content), channel);
  const aceraCtx = getAceraContext();
  const starkCtx = getStarkContext();
  let systemPrompt = baseSystemPrompt;
  if (aceraCtx) systemPrompt += `\n\n--- ACERA SCENE CONTEXT ---\n${aceraCtx}\n---`;
  if (starkCtx) systemPrompt += `\n\n--- STARK BIOELECTRIC CONTEXT ---\n${starkCtx}\n---`;

  let response: string;
  let modelUsed: string;
  let fromCache: boolean;
  let tier: string | undefined;

  if (eggResponse !== null) {
    response  = eggResponse;
    modelUsed = "easter-egg-v1";
    fromCache = false;
    tier      = "autopilot";
  } else
  try {
    const result = await runInference({
      prompt:   message,
      mode:     "deep",
      task:     "chat",
      context:  [{ role: "system", content: systemPrompt }, ...context.slice(-8)],
      useCache: false, // conversations shouldn't be cached
      onTierResolved: requestId
        ? (resolvedTier, model) => {
            broadcast({
              type: "ai.inference_started",
              payload: { requestId, tier: resolvedTier, model },
            });
          }
        : undefined,
    });
    response = result.response;
    modelUsed = result.modelUsed;
    fromCache = result.fromCache;
    tier = result.tier;
  } catch (err) {
    req.log.error({ err }, "Chat inference failed");
    response = "I'm having trouble processing that right now. Rule engine fallback active.";
    modelUsed = "rule-engine-v1";
    fromCache = false;
  }

  const latencyMs = Date.now() - startMs;

  // ── Self-upgrade: detect and apply persona directives ───────────────────
  let personaUpdated: Record<string, number> | null = null;
  const { clean: cleanResponse, update: personaUpdate } = extractSelfUpdate(response);
  response = cleanResponse;
  if (personaUpdate) {
    try {
      const rows = await db.select().from(aiPersonaTable).limit(1);
      if (rows.length > 0) {
        const current = rows[0]! as Record<string, unknown>;
        const prev: Record<string, number> = {};
        for (const key of Object.keys(personaUpdate)) {
          if (typeof current[key] === "number") prev[key] = current[key] as number;
        }
        await db.update(aiPersonaTable).set(personaUpdate).where(drEq(aiPersonaTable.id, rows[0]!.id));
        personaUpdated = personaUpdate as Record<string, number>;
        bus.emit({
          source: "self-upgrade",
          target: null,
          type:   "system.config_changed",
          payload: { component: "ai_persona", changes: personaUpdate, prev, origin: "self_upgrade" },
        });
      }
    } catch { /* non-fatal */ }
  }

  // store AI response
  await db.insert(chatMessagesTable).values({
    sessionId, role: "assistant", content: response, channel, modelUsed, latencyMs,
  });

  // store in memory
  await db.insert(memoryEntriesTable).values({
    type: "short_term",
    content: `[${channel}] USER: ${message.substring(0, 200)} | AI: ${response.substring(0, 200)}`,
    keywords: ["chat", channel, sessionId],
    source: `chat.${channel}`,
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3h TTL
  });

  bus.emit({
    source: "ai-router",
    target: `channel.${channel}`,
    type: "ai.chat.response",
    payload: { response: response.substring(0, 300), channel, sessionId, latencyMs, modelUsed, fromCache },
  });

  // broadcast raw to WS clients
  broadcast({
    type: "chat.message",
    sessionId,
    channel,
    role: "assistant",
    content: response,
    modelUsed,
    latencyMs,
    fromCache,
    timestamp: new Date().toISOString(),
  });

  const reasonCode = fromCache
    ? "cached"
    : modelUsed.includes("rule-engine")
      ? "rule-engine"
      : "ai-inference";

  res.json({ response, channel, sessionId, latencyMs, modelUsed, fromCache, tier, reasonCode, personaUpdated });
});

// ── GET /api/chat/history ──────────────────────────────────────────────────
router.get("/chat/history", async (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, sessionId))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit);

  res.json({ messages: messages.reverse(), sessionId });
});

// ── GET /api/voice-identity ────────────────────────────────────────────────
router.get("/voice-identity", async (req, res) => {
  const rows = await db.select().from(voiceIdentityTable).limit(1);
  if (rows.length === 0) {
    const defaults = await db
      .insert(voiceIdentityTable)
      .values({})
      .returning();
    res.json(defaults[0]);
    return;
  }
  res.json(rows[0]);
});

// ── PUT /api/voice-identity ────────────────────────────────────────────────
router.put("/voice-identity", async (req, res) => {
  const parsed = VoiceIdentityUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db.select().from(voiceIdentityTable).limit(1);
  if (rows.length === 0) {
    const created = await db
      .insert(voiceIdentityTable)
      .values({ ...parsed.data })
      .returning();
    res.json(created[0]);
    return;
  }

  const updated = await db
    .update(voiceIdentityTable)
    .set({ ...parsed.data })
    .where(eq(voiceIdentityTable.id, rows[0].id))
    .returning();

  bus.emit({
    source: "system",
    target: null,
    type: "system.config_changed",
    payload: { config: "voice_identity", changes: parsed.data },
  });

  res.json(updated[0]);
});

export default router;
