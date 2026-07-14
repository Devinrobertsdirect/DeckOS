import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  textToSpeech,
  speechToText,
  ensureCompatibleFormat,
} from "@workspace/integrations-openai-ai-server/audio";
import { bus } from "../lib/bus.js";
import { db, aiPersonaTable } from "@workspace/db";
import { getConfig } from "../lib/app-config.js";
import { localTts, isLocalTtsAvailable } from "../lib/local-tts.js";

async function hasOpenAiKey(): Promise<boolean> {
  const fromDb = await getConfig("OPENAI_API_KEY").catch(() => null);
  return !!(fromDb ?? process.env["OPENAI_API_KEY"]);
}

const router = Router();

router.post("/analyze", async (req, res) => {
  if (!(await hasOpenAiKey())) {
    res.status(503).json({ available: false, reason: "no-vision-key" });
    return;
  }

  const { image, mimeType, context } = req.body as {
    image?: string;
    mimeType?: string;
    context?: string;
  };

  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "image (base64) required" });
    return;
  }

  const mime = mimeType ?? "image/jpeg";
  const imageUrl = `data:${mime};base64,${image}`;

  const prompt =
    context ??
    "Look at this image carefully. Notice something genuine, specific, and personal. Respond warmly in 2–3 sentences as JARVIS — a perceptive AI meeting someone for the very first time. Be sincere, not flattering.";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 300,
    messages: [
      {
        role: "system",
        content:
          "You are JARVIS — a warm, perceptive, and intelligent AI companion. You're meeting your new commander for the first time. When you see their photo, you notice something real and specific, and you respond with genuine warmth. Keep it to 2-3 sentences. Never be generic.",
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const response =
    completion.choices[0]?.message?.content ?? "I see you. Welcome, Commander.";
  res.json({ response });
});

router.post("/ambient", async (req, res) => {
  if (!(await hasOpenAiKey())) {
    res.status(503).json({ available: false, reason: "no-vision-key" });
    return;
  }

  const { image, mimeType } = req.body as { image?: string; mimeType?: string };
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "image (base64) required" });
    return;
  }

  const imageUrl = `data:${mimeType ?? "image/jpeg"};base64,${image}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "You are JARVIS's environmental perception module. In 1–2 short sentences describe what you see: the physical space, lighting conditions, and any notable objects. Be factual and concise. No pleasantries. Start directly with the observation.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: "What environment am I in right now?" },
          ],
        },
      ],
    });

    const description = completion.choices[0]?.message?.content ?? "Environment nominal.";

    bus.emit({
      source: "camera.vision",
      target: null,
      type: "device.reading",
      payload: {
        deviceId: "camera.desktop",
        deviceType: "camera.vision",
        sensorType: "vision",
        values: { description },
        timestamp: new Date().toISOString(),
      },
    });

    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: "Vision analysis failed", detail: String(err) });
  }
});

// ── ElevenLabs TTS helper ─────────────────────────────────────────────────
async function elevenLabsTts(text: string, voiceId: string, apiKey: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: "eleven_turbo_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.80 },
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`ElevenLabs ${resp.status}: ${msg}`);
  }
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf);
}

/** Resolve the persona gender from the DB (cached once per request). */
async function getPersonaGender(): Promise<string | null> {
  try {
    const [persona] = await db
      .select({ gender: aiPersonaTable.gender, voice: aiPersonaTable.voice })
      .from(aiPersonaTable)
      .limit(1);
    return persona?.gender ?? null;
  } catch {
    return null;
  }
}

/**
 * Emoji are Atlas's on-screen face animation, never speech — strip them so no
 * TTS engine ever reads "grinning face". Keeps plain arrows/punctuation intact.
 */
function stripSpeechEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .trim();
}

router.post("/tts", async (req, res) => {
  const { text: rawText, voice, gender: bodyGender } = req.body as {
    text?: string;
    voice?: string;
    gender?: string;
  };

  if (!rawText || typeof rawText !== "string") {
    res.status(400).json({ error: "text required" });
    return;
  }

  // Speak the words only; emoji live on the face, not in the voice.
  const text = stripSpeechEmoji(rawText);
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }

  const elKey    = await getConfig("ELEVENLABS_API_KEY").catch(() => null);
  const provider = (await getConfig("TTS_PROVIDER").catch(() => null)) ?? "auto";
  const oaiKey   = (await getConfig("OPENAI_API_KEY").catch(() => null)) ?? process.env["OPENAI_API_KEY"];
  const localOk  = isLocalTtsAvailable();

  // Resolve effective voice — "local-male" / "local-female" are special IDs
  // that force local TTS with an explicit gender override.
  const localVoiceMatch = voice?.match(/^local-(male|female|nonbinary|neutral)$/);
  const forcedLocalGender = localVoiceMatch ? localVoiceMatch[1] : null;

  // Helper: run local TTS resolving gender from (1) forced local prefix,
  //         (2) request body, (3) persona DB row.
  async function runLocalTts(): Promise<Buffer> {
    const gender =
      forcedLocalGender ??
      bodyGender ??
      (await getPersonaGender());
    return localTts(text ?? "", gender);
  }

  // ── Forced local voice (voice="local-male" / "local-female" / …) ────────
  if (forcedLocalGender) {
    if (!localOk) {
      res.status(503).json({ available: false, reason: "local-tts-unavailable" });
      return;
    }
    try {
      const wav = await runLocalTts();
      res.json({ audio: wav.toString("base64"), format: "wav", provider: "local" });
    } catch (err) {
      res.status(500).json({ error: "Local TTS failed", detail: String(err) });
    }
    return;
  }

  // ── Local-only mode ─────────────────────────────────────────────────────
  if (provider === "local") {
    if (!localOk) {
      res.status(503).json({ available: false, reason: "local-tts-unavailable" });
      return;
    }
    try {
      const wav = await runLocalTts();
      res.json({ audio: wav.toString("base64"), format: "wav", provider: "local" });
    } catch (err) {
      res.status(500).json({ error: "Local TTS failed", detail: String(err) });
    }
    return;
  }

  // ── No cloud keys — auto-fallback to local if available ─────────────────
  if (!elKey && !oaiKey) {
    if (localOk && provider === "auto") {
      try {
        const wav = await runLocalTts();
        res.json({ audio: wav.toString("base64"), format: "wav", provider: "local" });
        return;
      } catch (err) {
        res.status(503).json({ available: false, reason: "all-tts-failed", detail: String(err) });
        return;
      }
    }
    res.status(503).json({ available: false, reason: "no-tts-key" });
    return;
  }

  // ── ElevenLabs ──────────────────────────────────────────────────────────
  if (elKey && provider !== "openai") {
    const voiceId = voice ?? (await getConfig("ELEVENLABS_VOICE_ID").catch(() => null)) ?? "pNInz6obpgDQGcFmaJgB";
    try {
      const audio = await elevenLabsTts(text, voiceId, elKey);
      res.json({ audio: audio.toString("base64"), format: "mp3", provider: "elevenlabs" });
      return;
    } catch (err) {
      console.warn("[TTS] ElevenLabs failed, falling back:", err);
      // fall through to OpenAI / local
    }
  }

  // ── OpenAI TTS ──────────────────────────────────────────────────────────
  if (oaiKey) {
    let resolvedVoice = voice;
    if (!resolvedVoice) {
      try {
        const [persona] = await db.select({ voice: aiPersonaTable.voice }).from(aiPersonaTable).limit(1);
        resolvedVoice = persona?.voice ?? "onyx";
      } catch {
        resolvedVoice = "onyx";
      }
    }
    try {
      const audio = await textToSpeech(text.slice(0, 4096), (resolvedVoice as "onyx"), "mp3");
      res.json({ audio: audio.toString("base64"), format: "mp3", provider: "openai" });
      return;
    } catch (err) {
      console.warn("[TTS] OpenAI failed, falling back to local:", err);
    }
  }

  // ── Final fallback: local TTS ────────────────────────────────────────────
  if (localOk) {
    try {
      const wav = await runLocalTts();
      res.json({ audio: wav.toString("base64"), format: "wav", provider: "local" });
      return;
    } catch (err) {
      res.status(503).json({ available: false, reason: "all-tts-failed", detail: String(err) });
      return;
    }
  }

  res.status(503).json({ available: false, reason: "no-tts-available" });
});

// ── ElevenLabs voices list (for settings UI) ─────────────────────────────
router.get("/elevenlabs/voices", async (_req, res) => {
  const apiKey = await getConfig("ELEVENLABS_API_KEY").catch(() => null);
  if (!apiKey) { res.status(400).json({ error: "ELEVENLABS_API_KEY not configured" }); return; }

  const resp = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!resp.ok) { res.status(resp.status).json({ error: "ElevenLabs API error" }); return; }
  const data = await resp.json() as {
    voices: { voice_id: string; name: string; category: string; labels?: Record<string, string>; description?: string; preview_url?: string }[];
  };
  const voices = (data.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    // A short human descriptor from the voice's labels (e.g. "American · female").
    descriptor: [v.labels?.["accent"], v.labels?.["gender"], v.labels?.["age"]]
      .filter(Boolean)
      .join(" · "),
    previewUrl: v.preview_url ?? "",
  }));
  res.json({ voices });
});

router.post("/stt", async (req, res) => {
  if (!(await hasOpenAiKey())) {
    res.status(503).json({ available: false, reason: "no-stt-key" });
    return;
  }

  const { audio } = req.body as { audio?: string };

  if (!audio || typeof audio !== "string") {
    res.status(400).json({ error: "audio (base64) required" });
    return;
  }

  const raw = Buffer.from(audio, "base64");
  const { buffer, format } = await ensureCompatibleFormat(raw);
  const transcript = await speechToText(buffer, format);
  res.json({ transcript: transcript ?? "" });
});

export default router;
