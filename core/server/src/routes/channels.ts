import { Router } from "express";
import { db, chatMessagesTable, memoryEntriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { runInference } from "../lib/inference.js";
import { bus } from "../lib/bus.js";
import { presenceManager } from "../lib/presence-manager.js";
import { buildPersonalizedPrompt } from "../lib/system-prompt.js";
import { logger } from "../lib/logger.js";

const router = Router();

const SUPPORTED_CHANNELS = [
  "discord",
  "telegram",
  "imessage",
  "whatsapp",
  "slack",
  "signal",
  "line",
  "matrix",
  "irc",
  "sms",
] as const;

type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

function isSupported(c: string): c is SupportedChannel {
  return (SUPPORTED_CHANNELS as readonly string[]).includes(c);
}

/**
 * Generic inbound message webhook — designed for OpenClaw and similar
 * local AI-bridge tools.
 *
 * POST /api/channels/inbound
 * Body (JSON):
 *   channel   — one of: discord, telegram, imessage, whatsapp, slack, signal, line, matrix, irc, sms
 *   from      — sender identifier (username, phone number, user ID, etc.)
 *   message   — the text message content
 *   sessionId — optional; if omitted one is derived from channel+from
 *   replyTo   — optional message ID/thread ID for context (stored in memory, not used for routing)
 *
 * Returns (JSON):
 *   response    — AI-generated reply
 *   sessionId   — session identifier used
 *   channel     — echoed channel name
 *   modelUsed   — which model generated the response
 *   latencyMs   — total inference time in milliseconds
 */
router.post("/channels/inbound", async (req, res) => {
  const body = req.body as Record<string, string>;
  const channel = (body.channel ?? "").trim().toLowerCase();
  const from    = (body.from    ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!message || !from || !isSupported(channel)) {
    res.status(400).json({
      error: "Missing required fields: channel (must be one of the supported channels), from, message",
      supported: SUPPORTED_CHANNELS,
    });
    return;
  }

  const sessionId = body.sessionId?.trim() || `${channel}_${from.replace(/\W/g, "_").slice(0, 24)}`;
  const startMs   = Date.now();

  void presenceManager.record(channel as Parameters<typeof presenceManager.record>[0]);

  await db.insert(chatMessagesTable).values({
    sessionId,
    role: "user",
    content: message,
    channel,
  });

  bus.emit({
    source: `channel.${channel}`,
    target: "ai-router",
    type: "ai.chat.request",
    payload: { message: message.substring(0, 200), channel, sessionId, from },
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
    channel,
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
    logger.error({ err, channel }, "channels/inbound: inference failed");
  }

  const latencyMs = Date.now() - startMs;

  await db.insert(chatMessagesTable).values({
    sessionId,
    role: "assistant",
    content: response,
    channel,
    modelUsed,
    latencyMs,
  });

  await db.insert(memoryEntriesTable).values({
    type: "short_term",
    content: `[${channel}] USER: ${message.substring(0, 200)} | AI: ${response.substring(0, 200)}`,
    keywords: ["chat", channel, sessionId],
    source: `chat.${channel}`,
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
  });

  bus.emit({
    source: "ai-router",
    target: `channel.${channel}`,
    type: "ai.chat.response",
    payload: { response: response.substring(0, 1000), channel, sessionId, latencyMs, modelUsed, from },
  });

  logger.info({ channel, from, sessionId, latencyMs, modelUsed }, "channels/inbound: response sent");

  res.json({ response, sessionId, channel, modelUsed, latencyMs });
});

/**
 * Channel status — shows configuration state of all supported channels.
 * GET /api/channels/status
 */
router.get("/channels/status", (_req, res) => {
  const whatsappConfigured = !!(process.env["TWILIO_ACCOUNT_SID"] && process.env["TWILIO_AUTH_TOKEN"]);
  const discordConfigured  = !!process.env["DISCORD_BOT_TOKEN"];
  const telegramConfigured = !!process.env["TELEGRAM_BOT_TOKEN"];
  const slackConfigured    = !!process.env["SLACK_BOT_TOKEN"];
  const signalConfigured   = !!process.env["SIGNAL_CLI_NUMBER"];

  res.json({
    inboundWebhook: "/api/channels/inbound",
    note: "POST { channel, from, message } to the inbound webhook from OpenClaw or any bridge tool",
    channels: {
      discord: {
        configured: discordConfigured,
        instructions: discordConfigured
          ? "Active — set OpenClaw Discord token to route messages here"
          : "Set DISCORD_BOT_TOKEN env var, then configure OpenClaw to POST to /api/channels/inbound",
        envVars: ["DISCORD_BOT_TOKEN"],
      },
      telegram: {
        configured: telegramConfigured,
        instructions: telegramConfigured
          ? "Active — set OpenClaw Telegram token to route messages here"
          : "Set TELEGRAM_BOT_TOKEN env var, then configure OpenClaw to POST to /api/channels/inbound",
        envVars: ["TELEGRAM_BOT_TOKEN"],
      },
      whatsapp: {
        configured: whatsappConfigured,
        instructions: whatsappConfigured
          ? "Active via Twilio — webhook at /api/whatsapp/inbound, OR use OpenClaw → /api/channels/inbound"
          : "Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN for Twilio, or use OpenClaw bridge",
        envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
      },
      imessage: {
        configured: false,
        instructions: "Use OpenClaw with imsg configured locally, then POST to /api/channels/inbound with channel=imessage",
        envVars: [],
        note: "iMessage requires macOS + imsg CLI (no cloud token needed — OpenClaw handles it locally)",
      },
      slack: {
        configured: slackConfigured,
        instructions: slackConfigured
          ? "Active — set OpenClaw Slack token to route messages here"
          : "Set SLACK_BOT_TOKEN env var, then configure OpenClaw to POST to /api/channels/inbound",
        envVars: ["SLACK_BOT_TOKEN"],
      },
      signal: {
        configured: signalConfigured,
        instructions: signalConfigured
          ? "Active — set OpenClaw Signal number to route messages here"
          : "Set SIGNAL_CLI_NUMBER env var, then configure OpenClaw to POST to /api/channels/inbound",
        envVars: ["SIGNAL_CLI_NUMBER"],
      },
      line:    { configured: false, instructions: "Use OpenClaw LINE token + POST to /api/channels/inbound", envVars: ["LINE_CHANNEL_TOKEN"] },
      matrix:  { configured: false, instructions: "Use OpenClaw Matrix access token + POST to /api/channels/inbound", envVars: [] },
      irc:     { configured: false, instructions: "Use OpenClaw IRC config + POST to /api/channels/inbound", envVars: [] },
      sms:     { configured: false, instructions: "Use OpenClaw SMS config or Twilio + POST to /api/channels/inbound", envVars: [] },
    },
    supported: SUPPORTED_CHANNELS,
  });
});

export default router;
