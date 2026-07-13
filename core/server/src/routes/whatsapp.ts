import { Router } from "express";
import express from "express";
import { db, chatMessagesTable, memoryEntriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { runInference } from "../lib/inference.js";
import { bus } from "../lib/bus.js";
import { presenceManager } from "../lib/presence-manager.js";
import { buildPersonalizedPrompt } from "../lib/system-prompt.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.post(
  "/whatsapp/inbound",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const body = req.body as Record<string, string>;
    const from    = (body.From ?? "").trim();
    const message = (body.Body ?? "").trim();

    if (!message || !from) {
      res.sendStatus(204);
      return;
    }

    const sessionId = `whatsapp_${from.replace(/\D/g, "").slice(-12)}`;
    const startMs   = Date.now();

    void presenceManager.record("whatsapp" as any);

    await db.insert(chatMessagesTable).values({
      sessionId,
      role: "user",
      content: message,
      channel: "whatsapp",
    });

    bus.emit({
      source: "channel.whatsapp",
      target: "ai-router",
      type: "ai.chat.request",
      payload: { message: message.substring(0, 200), channel: "whatsapp", sessionId },
    });

    const [recentMemory, recentHistory] = await Promise.all([
      db.select({ content: memoryEntriesTable.content })
        .from(memoryEntriesTable)
        .where(eq(memoryEntriesTable.type, "short_term"))
        .orderBy(desc(memoryEntriesTable.createdAt))
        .limit(5),
      db.select()
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.sessionId, sessionId))
        .orderBy(desc(chatMessagesTable.createdAt))
        .limit(10),
    ]);

    const context = recentHistory.reverse().map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const systemPrompt = await buildPersonalizedPrompt(
      recentMemory.map((m) => m.content),
      "whatsapp",
    );

    let response  = "I'm having trouble processing that right now. Please try again.";
    let modelUsed = "error";

    try {
      const result = await runInference({
        prompt:   message,
        mode:     "deep",
        task:     "chat",
        context:  [{ role: "system", content: systemPrompt }, ...context.slice(-8)],
        useCache: false,
      });
      response  = result.response;
      modelUsed = result.modelUsed;
    } catch (err) {
      logger.error({ err }, "WhatsApp: inference failed");
    }

    const latencyMs = Date.now() - startMs;

    await db.insert(chatMessagesTable).values({
      sessionId,
      role: "assistant",
      content: response,
      channel: "whatsapp",
      modelUsed,
      latencyMs,
    });

    await db.insert(memoryEntriesTable).values({
      type: "short_term",
      content: `[whatsapp] USER: ${message.substring(0, 200)} | AI: ${response.substring(0, 200)}`,
      keywords: ["chat", "whatsapp", sessionId],
      source: "chat.whatsapp",
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    bus.emit({
      source: "ai-router",
      target: "channel.whatsapp",
      type: "ai.chat.response",
      payload: { response: response.substring(0, 300), channel: "whatsapp", sessionId, latencyMs, modelUsed },
    });

    await sendWhatsAppReply(from, response);

    res.sendStatus(204);
  },
);

router.get("/whatsapp/status", (_req, res) => {
  const configured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  res.json({
    configured,
    from: process.env.TWILIO_WHATSAPP_FROM ?? null,
    webhookUrl: "/api/whatsapp/inbound",
    channel: "whatsapp",
    provider: "twilio",
    instructions: configured
      ? "Active — point your Twilio WhatsApp sandbox webhook to this URL"
      : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM to enable",
  });
});

async function sendWhatsAppReply(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

  if (!accountSid || !authToken) {
    logger.warn("WhatsApp: Twilio credentials not set — response stored but not delivered");
    return;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!apiRes.ok) {
      const text = await apiRes.text();
      logger.error({ status: apiRes.status, body: text }, "WhatsApp: Twilio API error");
    }
  } catch (err) {
    logger.error({ err }, "WhatsApp: failed to send reply via Twilio");
  }
}

export default router;
