import { Router, type Request } from "express";
import { z } from "zod/v4";
import { broadcast } from "../lib/ws-server.js";
import { getConfig } from "../lib/app-config.js";
import { setShow } from "../lib/running.js";

/**
 * /api/voice — the Pi's local speech-to-text sidecar hands finished utterances
 * to the brain, which relays them to the face over the WebSocket exactly like a
 * typed message. The robot's Chromium has no Linux speech backend, so a Vosk
 * sidecar captures the USB mic and POSTs each final utterance to
 * /api/voice/heard; we broadcast it as a "voice.heard" event the PetShell feeds
 * into its normal send path. A mute flag (/api/voice/mute) gags the pipeline
 * while Nobi is speaking so the mic never hears its own TTS — the sidecar's
 * POSTs are simply dropped with accepted:false until it clears. Mutations are
 * loopback-only (they come from the robot's own sidecar or not at all); the
 * state GET may serve the LAN.
 */
const router = Router();

// In-memory only: mute is a per-boot "is Nobi speaking" latch and lastHeardAt
// is a liveness breadcrumb — neither is worth persisting.
/** What the ears sidecar last told us about itself (undefined = never reported). */
type EarsReport = { capturing: boolean; mic: string; floor: number; threshold: number; at: number };
const state: { muted: boolean; lastHeardAt: number | null; ears?: EarsReport; armAfterReply: boolean } = {
  muted: false,
  // Should the mic open for a reply when he stops talking? True for an answer
  // to a person; false when he spoke unprompted (an attract line), because
  // nobody asked him anything and nobody is about to answer.
  armAfterReply: true,
  lastHeardAt: null,
};

/** Voice input only ever comes from the robot's own sidecar — loopback or 403. */
function isLoopback(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const HeardSchema = z.object({ text: z.string() });
const MuteSchema = z.object({ on: z.boolean() });
const TranscribeSchema = z.object({ audio: z.string().min(1), format: z.string().optional() });

/**
 * ElevenLabs Scribe (speech-to-text). The Pi's Vosk model mishears "Nobi" and
 * mangles whole sentences; Scribe is far more accurate. The ears sidecar does
 * local voice-activity detection and sends only real speech clips here, so we
 * never spend STT credits on silence. Returns the transcript text ("" if empty).
 */
async function elevenLabsScribe(audio: Buffer, filename: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  // Blob accepts a Buffer (Uint8Array); fetch sets the multipart boundary itself.
  form.append("file", new Blob([audio], { type: "audio/wav" }), filename);
  const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`ElevenLabs STT ${resp.status}: ${msg}`);
  }
  const data = (await resp.json()) as { text?: string };
  return (data.text ?? "").trim();
}

// POST /api/voice/heard — { text }. Loopback only. Dropped while muted (Nobi is
// speaking) so the mic doesn't loop its own voice back in; otherwise stamped and
// broadcast as a "voice.heard" event the face treats like a typed message. The
// wire envelope mirrors atlas.faceInput (index.ts): nest the text under payload
// and include a timestamp — the frontend rebuilds events from whitelisted fields
// and silently drops any message missing timestamp / carrying loose props.
/** True while he is speaking — the same latch the mic uses to ignore its own voice. */
export function isSpeaking(): boolean {
  return state.muted;
}

router.post("/voice/heard", (req, res) => {
  if (!isLoopback(req)) {
    res.status(403).json({ error: "local only" });
    return;
  }
  const parsed = HeardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { text: string }" });
    return;
  }
  const text = parsed.data.text.trim();
  // Nothing to say, or Nobi is mid-utterance — accept the call but relay nothing.
  if (!text || state.muted) {
    res.json({ ok: true, accepted: false });
    return;
  }
  state.lastHeardAt = Date.now();
  broadcast({ type: "voice.heard", source: "voice", payload: { text }, timestamp: new Date().toISOString() });
  res.json({ ok: true, accepted: true });
});

// POST /api/voice/interrupt — the ears heard the user cut in while Nobi was
// talking ("stop", "wait", "hey Nobi"). Loopback only. The face drops whatever
// it is saying or showing the instant this lands.
router.post("/voice/interrupt", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 200) : "";
  state.muted = false;   // whatever he was saying is over; hear the room again now
  broadcast({ type: "voice.interrupt", source: "voice", payload: { text }, timestamp: new Date().toISOString() });
  res.json({ ok: true });
});

// POST /api/voice/ears — the sidecar's heartbeat: is a microphone actually
// open, which one, and how loud the room is. Loopback only.
router.post("/voice/ears", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const b = (req.body ?? {}) as Partial<EarsReport>;
  state.ears = {
    capturing: b.capturing !== false,
    mic: typeof b.mic === "string" ? b.mic.slice(0, 120) : "",
    floor: Number(b.floor) || 0,
    threshold: Number(b.threshold) || 0,
    at: Date.now(),
  };
  res.json({ ok: true });
});

// POST /api/voice/listening — { on }. Loopback only. The ears fire this the
// instant a person STARTS talking, so the face can light up while they speak
// instead of after the transcript lands. Pure UI signal; nothing depends on it.
router.post("/voice/listening", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  broadcast({ type: "voice.listening", source: "voice", payload: { on: req.body?.on !== false }, timestamp: new Date().toISOString() });
  res.json({ ok: true });
});

// POST /api/voice/mute — { on }. Loopback only. The PetShell raises this when a
// turn/TTS starts and lowers it when the queue drains, so incoming utterances are
// dropped for as long as Nobi is talking.
router.post("/voice/mute", (req, res) => {
  if (!isLoopback(req)) {
    res.status(403).json({ error: "local only" });
    return;
  }
  if (typeof req.body?.arm === "boolean") state.armAfterReply = req.body.arm;
  const parsed = MuteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { on: boolean }" });
    return;
  }
  state.muted = parsed.data.on;
  res.json({ ok: true, muted: state.muted });
});

// POST /api/voice/transcribe — { audio: base64, format? }. Loopback only. The Pi
// ears sidecar VAD-captures an utterance and sends the raw clip here; we run it
// through ElevenLabs Scribe and return { transcript }. The sidecar keeps the wake
// gate (it re-POSTs the accepted text to /voice/heard), so this stays a pure STT
// proxy and the ElevenLabs key never has to live on the Pi in the sidecar's env.
router.post("/voice/transcribe", async (req, res) => {
  if (!isLoopback(req)) {
    res.status(403).json({ error: "local only" });
    return;
  }
  const parsed = TranscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { audio: base64, format? }" });
    return;
  }
  const apiKey =
    (await getConfig("ELEVENLABS_API_KEY").catch(() => null)) ??
    process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    // No cloud STT — tell the sidecar so it can fall back to local Vosk offline.
    res.status(503).json({ available: false, reason: "no-stt-key" });
    return;
  }
  try {
    const buf = Buffer.from(parsed.data.audio, "base64");
    const fmt = (parsed.data.format ?? "wav").replace(/[^a-z0-9]/gi, "") || "wav";
    const transcript = await elevenLabsScribe(buf, `utterance.${fmt}`, apiKey);
    res.json({ ok: true, transcript });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
});

// GET /api/voice/state — mute latch + last-heard breadcrumb. Read-only; safe to
// serve the LAN (lets any face/dashboard show whether the mic is live).
/**
 * The face telling us what it is playing, so STOP can name it. Shows run in the
 * browser, so this is the only way the robot knows a demo is on.
 */
router.post("/voice/activity", (req, res) => {
  const show = (req.body as { show?: unknown } | undefined)?.show;
  setShow(typeof show === "string" && show ? show : null);
  res.json({ ok: true });
});

router.get("/voice/state", (_req, res) => {
  // `muted` is the ECHO LATCH (true while he speaks), never "the mic is off".
  // `ears` is the real microphone state, straight from the sidecar; anything
  // older than 30s means the sidecar is not running and we simply do not know.
  const e = state.ears;
  const fresh = !!e && Date.now() - e.at < 30_000;
  res.json({
    muted: state.muted,
    lastHeardAt: state.lastHeardAt,
    speaking: state.muted,
    armAfterReply: state.armAfterReply,
    ears: fresh
      ? { capturing: e!.capturing, mic: e!.mic, floor: e!.floor, threshold: e!.threshold, ageMs: Date.now() - e!.at }
      : null,
  });
});

export default router;
