import { Router } from "express";
import { z } from "zod";
import { runInference } from "../lib/inference.js";

/**
 * Genesis — the AI-powered first-run introduction.
 *
 * POST /api/genesis/intro { name, providers?[] } →
 *   { beats: [{ expression, text }], source: "ai" | "fallback" }
 *
 * Atlas writes its OWN welcome the first time it meets you, using whatever
 * brain is available (the gateway routes to the connected cloud model if there
 * is one, otherwise local Ollama). If generation or parsing fails, we return a
 * hand-written fallback so the intro never breaks.
 */

const router = Router();

// Expressions the face can hold while speaking a line (must match FaceState).
const EXPRESSIONS = ["idle", "happy", "listening", "thinking", "excited", "confused"] as const;
type Expression = (typeof EXPRESSIONS)[number];

const BeatSchema = z.object({
  expression: z.enum(EXPRESSIONS),
  text: z.string().min(1).max(320),
});
type Beat = z.infer<typeof BeatSchema>;

const IntroRequest = z.object({
  name: z.string().max(60).optional().default(""),
  botName: z.string().max(60).optional().default("Neura"),
  providers: z.array(z.string().max(40)).max(12).optional().default([]),
});

function timeGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function spokenList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Hand-written fallback — tighter and more varied than a single tone. */
function fallbackBeats(name: string, providers: string[], hour: number, bot = "Neura"): Beat[] {
  const who = name.trim() || "friend";
  const greet = timeGreeting(hour);
  const mind = providers.length
    ? `And you already use ${spokenList(providers)}. Good — I'll talk to them for you, so it feels like one assistant, not ten tabs.`
    : `Connect Claude, Gemini, or the tools you love, and I'll talk to them for you — one assistant, not ten tabs.`;
  return [
    { expression: "happy", text: `${greet}, ${who}. I'm ${bot}.` },
    { expression: "idle", text: `Think of me less like an app and more like a partner who lives in your machines.` },
    { expression: "listening", text: `Your computer, your phone, your devices — I pull your day into one place and keep it organized.` },
    { expression: "excited", text: mind },
    { expression: "thinking", text: `Everything runs on your terms, with your keys. Local first — I only reach out when you ask.` },
    { expression: "idle", text: `The same brain you're talking to now is the one that will live in your robot's head.` },
    { expression: "happy", text: `That's enough about me, ${who}. Ask me anything — I'm ready.` },
  ];
}

/** Pull the first JSON array out of a model response and validate it. */
function parseBeats(raw: string): Beat[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const beats: Beat[] = [];
  for (const item of parsed) {
    const r = BeatSchema.safeParse(item);
    if (r.success) beats.push(r.data);
    if (beats.length >= 9) break;
  }
  return beats.length >= 3 ? beats : null;
}

router.post("/intro", async (req, res) => {
  const parsed = IntroRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Body must be { name?, providers?[] }" });
    return;
  }
  const { name, botName, providers } = parsed.data;
  const bot = (botName || "Neura").trim() || "Neura";
  const hour = new Date().getHours();

  const system =
    `You are ${bot}, a warm, witty personal AI operating system meeting a new user for the first time. ` +
    `You are speaking out loud, so write natural spoken sentences — no markdown, no lists, no stage directions. ` +
    `You organize the user's day across their computer, phone, devices, and (one day) their robot. ` +
    `You talk to their other AI tools for them so it feels like one seamless assistant. ` +
    `Everything is local-first and private; the user holds their own keys.`;

  const user =
    `Write my spoken introduction to ${name || "the user"}.` +
    (providers.length ? ` They have connected: ${providers.join(", ")}. Mention this warmly.` : ` They have not connected other AIs yet; invite them to.`) +
    ` Greet them with "${timeGreeting(hour)}" and use their name once or twice.` +
    ` Return ONLY a JSON array of 6 to 8 objects, each {"expression": one of ${JSON.stringify(EXPRESSIONS)}, "text": "one spoken sentence"}.` +
    ` Vary the expression across beats. Keep each sentence short and clear. End by inviting them to ask me anything.`;

  try {
    const result = await runInference({
      prompt: user,
      mode: "deep",
      task: "chat",
      context: [{ role: "system", content: system }],
      useCache: false,
      preferFast: true, // the intro should generate fast — Haiku when available
    });
    const beats = parseBeats(result.response);
    if (beats) {
      res.json({ beats, source: "ai", model: result.modelUsed });
      return;
    }
  } catch {
    /* fall through to the hand-written intro */
  }

  res.json({ beats: fallbackBeats(name, providers, hour, bot), source: "fallback" });
});

export default router;
