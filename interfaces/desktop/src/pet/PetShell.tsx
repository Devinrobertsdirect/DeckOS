import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Mic, MicOff, Settings, MessageSquare, X, Brain, Trash2, Sparkles, LayoutGrid } from "lucide-react";
import { FacesGallery } from "@/collection/FacesGallery";
import { CapabilitiesPanel } from "@/pet/CapabilitiesPanel";
import { BuddySettings } from "@/pet/BuddySettings";
import { FaceCaption } from "@/pet/FaceCaption";
import { useAttract } from "@/pet/useAttract";
import { MOTION } from "@/pet/motion";
import { YouTubeOverlay, type VideoHandle } from "@/components/YouTubeOverlay";
import { ContentOverlay } from "@/components/ContentOverlay";
import SurvivorOverlay from "@/components/SurvivorOverlay";
import { AtlasFace, saveFaceTheme, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice, nudgeVoiceRate, setVoiceEngine, speechProgress, speechHasProgress } from "@/genesis/useAtlasVoice";
import { readAmplitude } from "@/lib/audioAnalyser";
import { useLatestEvent } from "@/contexts/WebSocketContext";
import { useAtlasListening } from "@/genesis/useAtlasListening";
import { useWake } from "@/hooks/useWake";
import { getInputMode, setInputMode, acquireMic } from "@/genesis/micAccess";
import { getUserName, getBotName, setUserName, setBotName, setExperienceMode } from "@/lib/uiMode";
import { applyClientAction, type UiAction } from "@/pet/agentActions";
import { mirrorFace } from "@/lib/hardwareFace";
import { segmentReply, emojiGlyph, type EmotionSegment } from "@/genesis/emotionDirector";
import { personaPrompt, getPersona, setPersona } from "@/genesis/personality";
import ShowcaseOverlay, { SHOP_URL, type ShowcaseScene } from "@/pet/ShowcaseOverlay";
import { sfx, sfxForScene } from "@/pet/showSfx";
import {
  buildDemoScript, buildPitchScript, buildOrderScript, meetDirectorNote, meetDetectBeats, guessName, line, asPersona,
  TRICK_MOODS, TRICK_TADA, TRICK_INTRO, pickTrick, pickJoke, interruptedLine, setShowOverrides, withOverrides, SAID_TRICK, SAID_JOKE, type TrickKind, type AskSpec, type MeetCtx, type Persona,
} from "@/pet/showScripts";
import { stripEmoji } from "@/lib/stripText";
import { dockLines } from "@/genesis/dockGreetings";
import MeteorCanvas, { type MeteorCanvasData } from "@/pet/MeteorCanvas";
import {
  appendTurn, ingestUserMessage, buildContext,
  useAtlasMemory, addFact, removeFact, memorySummary,
} from "@/lib/atlasMemory";

/**
 * PetShell — the DEFAULT Atlas experience: one big face you just talk to.
 *
 * Atlas *acts* while it speaks (emotion-driven eyes, colour, and emoji), it
 * REMEMBERS you (persistent chat history + a user-memory log it references in
 * every reply), and it answers FAST — replies stream in and Atlas starts
 * speaking each sentence the moment it completes.
 */

const SERVER_DOWN_MSG = "I can't reach my brain right now — is the server running?";

/** The face engine paints eyes with `rgb(${triplet})` — accept "#rrggbb" or "r,g,b" and normalize. */
function toEyeRgb(color: string): string | null {
  const c = color.trim();
  const hex = c.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(c) ? c : null;
}

/** Per-persona ElevenLabs voice (localStorage `atlas_persona_voices` = {rocky: id, …}); undefined → the default voice. */
/**
 * The voice set on the robot itself (ELEVENLABS_VOICE_ID — what the remote's
 * picker and the website write). Learned at boot and updated the moment it
 * changes, so picking a voice takes effect without a restart.
 */
let configuredVoiceId: string | undefined;
export function setConfiguredVoiceId(id: string | undefined): void {
  configuredVoiceId = id && id.trim() ? id.trim() : undefined;
}

/**
 * Which voice to speak in.
 *
 * The SET voice wins — everywhere, including shows. It used to lose to a
 * per-persona map held in the browser, so conversation came out in the voice
 * you had chosen and then the demo switched to whatever the map remembered.
 * Choosing a voice has to mean he uses it, or the picker is a lie. The persona
 * map is only a fallback for a desktop install that has no configured voice.
 */
function personaVoiceId(): string | undefined {
  if (configuredVoiceId) return configuredVoiceId;
  try {
    const map = JSON.parse(localStorage.getItem("atlas_persona_voices") || "{}") as Record<string, string>;
    const id = map[getPersona().id];
    return id && id.trim() ? id.trim() : undefined;
  } catch { return undefined; }
}

function activityFor(state: FaceState): number {
  switch (state) {
    case "thinking": return 0.9;
    case "talking": return 0.65;
    case "excited": case "angry": return 0.7;
    case "listening": case "happy": case "suspicious": return 0.5;
    case "confused": case "sad": return 0.3;
    default: return 0.15;
  }
}

export function PetShell({
  onOpenDeveloper,
  robotMode = false,
}: {
  onOpenDeveloper: () => void;
  /** Face-locked kiosk/robot mode: no dev/settings escape chrome. */
  robotMode?: boolean;
}) {
  const bot = getBotName();
  const { speak, speaking, stop } = useAtlasVoice();
  const mem = useAtlasMemory();

  const [faceState, setFaceState] = useState<FaceState>("idle");
  const [caption, setCaption] = useState("");
  const [eyeColor, setEyeColor] = useState<string | null>(null);
  /** A visible clock on something irreversible, so it can be seen and stopped. */
  const [countdown, setCountdown] = useState<{ n: number; label: string } | null>(null);
  const [discTint, setDiscTint] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveHeard, setLiveHeard] = useState("");
  // Computer mode: honour the chosen input mode. Robot mode does NOT use the
  // browser's Web Speech (it has no backend on the Pi and would flicker the face
  // with a false "Listening…") — the robot's real ears are the server-side Vosk
  // STT, which streams transcripts in over the WS. So keep the browser mic OFF
  // on the robot; it's genuinely listening, just not through this path.
  const [micOn, setMicOn] = useState(() => !robotMode && getInputMode() === "voice");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"chat" | "memory">("chat");
  // Robot full-face fills the whole display — track the smaller viewport edge so
  // the bare eyes scale to the round screen (recomputed on resize).
  const [faceFill, setFaceFill] = useState(() =>
    typeof window !== "undefined" ? Math.min(window.innerWidth, window.innerHeight) : 480);
  useEffect(() => {
    if (!robotMode) return;
    const onResize = () => setFaceFill(Math.min(window.innerWidth, window.innerHeight));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [robotMode]);

  // On the robot, Chromium's speechSynthesis has no Linux backend — the browser
  // voice is silent. Force the server (ElevenLabs) engine so replies actually
  // speak out of the Bluetooth headset. /api/vision/tts falls back to local TTS
  // and then the browser voice on its own, so this is safe even with no key.
  useEffect(() => {
    if (robotMode) setVoiceEngine("server");
  }, [robotMode]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [brain, setBrain] = useState<{ label: string; model: string; online: boolean } | null>(null);
  // Voice-summoned YouTube layer over the face ("robot play …" / "… close video").
  const [videoQuery, setVideoQuery] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<{ kind: "image" | "tutorial" | "link"; src: string; caption?: string; code?: string; hint?: string } | null>(null);
  const videoRef = useRef<VideoHandle | null>(null);
  // Survivor billboard ("have you seen survivor" / "the tribe has spoken") —
  // visual-only: no speech, the overlay mounts immediately and the eyes shuffle
  // fire colors right after. The banner rides in a ref for the deferred mount.
  const [survivorAnim, setSurvivorAnim] = useState<"torches" | "snuff" | null>(null);
  const survivorBannerRef = useRef<string | null>(null);
  const fireCelebRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (fireCelebRef.current !== null) cancelAnimationFrame(fireCelebRef.current);
  }, []);

  // Mirror every expression change onto a physical face panel, if one is
  // attached (no-op cost otherwise — the server face link runs in sim mode).
  useEffect(() => { mirrorFace(faceState, eyeColor); }, [faceState, eyeColor]);

  const busyRef = useRef(false);
  busyRef.current = busy;
  const cancelRef = useRef(false);

  // Robot mode is face-locked; a long-press on the face is the discreet way out
  // back to computer mode (no visible chrome to clutter the kiosk).
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHold = useCallback(() => {
    if (!robotMode) return;
    holdRef.current = setTimeout(() => {
      setExperienceMode("computer");
      setCaption("Computer mode — tap my face any time to come home.");
    }, 1200);
  }, [robotMode]);
  const endHold = useCallback(() => {
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
  }, []);

  const clearMood = () => { setEyeColor(null); setDiscTint(null); setEmoji(null); };
  const applyMood = (s: EmotionSegment["style"]) => {
    setFaceState(s.expression);
    setEyeColor(s.eyeColor);
    setDiscTint(s.discTint);
    setEmoji(emojiGlyph(s));
  };

  // ── Sequential speak queue — sentences are spoken in order as they arrive ────
  const queueRef = useRef<EmotionSegment[]>([]);
  // handleSend is declared much further down, but the remote pre-empt effect
  // needs to call it. A ref refreshed each render bridges that without
  // reordering the component.
  const handleSendRef = useRef<((t: string) => Promise<void>) | null>(null);
  const drainingRef = useRef(false);
  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    while (queueRef.current.length && !cancelRef.current) {
      const seg = queueRef.current.shift()!;
      applyMood(seg.style);
      await speak(seg.text, { voiceId: personaVoiceId() });
    }
    drainingRef.current = false;
  }, [speak]);
  const waitForQueue = useCallback(async () => {
    while ((queueRef.current.length || drainingRef.current) && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }, []);

  // ── Survivor celebration ────────────────────────────────────────────────────
  // Right after the billboard: he SMILES for 3 seconds, with a fast fire-color
  // shuffle on the eyes (yellow→orange→red, eased blends) for the first ~1.7s
  // of it. Color steps are throttled — smooth on a glowing eye, and it keeps
  // the mirrorFace effect from spamming the hardware face panel.
  const runFireCelebration = useCallback(() => {
    if (fireCelebRef.current !== null) cancelAnimationFrame(fireCelebRef.current);
    setFaceState("happy");
    const FIRE: [number, number, number][] = [[255, 204, 32], [255, 138, 0], [240, 58, 34]];
    const LOOP = 0.85, LOOPS = 2, SMILE_S = 3.0;
    const start = performance.now();
    let lastPush = 0;
    let colorDone = false;
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      if (t >= SMILE_S) {
        setEyeColor(null);
        setFaceState("idle");
        fireCelebRef.current = null;
        return;
      }
      if (t >= LOOP * LOOPS) {
        if (!colorDone) { colorDone = true; setEyeColor(null); } // smile rides out in his own color
      } else if (now - lastPush >= 60) {
        lastPush = now;
        const ph = ((t % LOOP) / LOOP) * FIRE.length;
        const i = Math.floor(ph) % FIRE.length;
        const j = (i + 1) % FIRE.length;
        const f = ph - Math.floor(ph);
        const e = f * f * (3 - 2 * f);
        const a = FIRE[i]!, b = FIRE[j]!;
        setEyeColor(`${Math.round(a[0] + (b[0] - a[0]) * e)},${Math.round(a[1] + (b[1] - a[1]) * e)},${Math.round(a[2] + (b[2] - a[2]) * e)}`);
      }
      fireCelebRef.current = requestAnimationFrame(tick);
    };
    fireCelebRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Built-in shows ──────────────────────────────────────────────────────────
  // "quick demo" (~2 min, three live questions) and the "tell them about you"
  // pitch (~90s, uninterrupted) — see showScripts.ts. A show holds `busy` for
  // its whole run (mic sidecar muted, normal turns paused) and narrates through
  // the same voice pipeline as replies; `direct` beats hold a chosen expression.
  // ASK beats speak a question, open the ears, catch the answer (voice or typed)
  // and hand it to the brain with a director note, so the reply is live and in
  // character. Tap the screen to skip; a hard 3-minute cap guarantees it ends.
  const [showcaseScene, setShowcaseScene] = useState<ShowcaseScene | null>(null);
  /** A guest's (or the demo answerer's) name, for the stage's `name` scene. */
  const [meetName, setMeetName] = useState("");
  const showRef = useRef(false);
  /** While a show is waiting on an answer, the next utterance resolves this instead of starting a turn. */
  const pendingAnswerRef = useRef<((text: string) => void) | null>(null);
  // "Meet someone": a live conversation steered a turn at a time (showScripts.ts).
  const meetRef = useRef<(MeetCtx & { startedAt: number }) | null>(null);
  const demoMood = useCallback((state: string, color?: string) => {
    setFaceState(state as FaceState);
    setEyeColor(color ? toEyeRgb(color) : null);
  }, []);
  const demoSleep = useCallback(async (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end && !cancelRef.current) await new Promise((r) => setTimeout(r, 80));
  }, []);
  // The moment a show ends; voice transcripts that land in the next couple of
  // seconds are the tail of his own narration, not the user — drop them.
  const showEndedAtRef = useRef(0);
  /**
   * Mute the ears while he speaks. `arm` says whether the mic should open for
   * a reply afterwards: true when he answered someone, false when he spoke
   * unprompted — an attract line is not a question, so leaving the mic open
   * after one just invites the room into the conversation.
   */
  const setEarsMuted = (on: boolean, arm = true) =>
    fetch("/api/voice/mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on, arm }) }).catch(() => { /* no sidecar here */ });
  // Dev/test hook: drive the stage directly (window.__nobiScene("bowl")).
  useEffect(() => {
    (window as unknown as { __nobiScene?: (s: ShowcaseScene | null) => void }).__nobiScene = (s) => setShowcaseScene(s);
    (window as unknown as { __nobiName?: (n: string) => void }).__nobiName = (n) => setMeetName(n);
  }, []);
  // Sound design: every scene change plays its cue (showSfx.ts); looping cues
  // (the gears' ticking) stop when the scene moves on.
  useEffect(() => {
    const stop = sfxForScene(showcaseScene);
    return () => { stop?.(); };
  }, [showcaseScene]);
  /** Stage backdrop for a "meet someone" turn: their name in gold when he greets them (or first learns it), hearts for goodbye, the orb ring in between. */
  const meetStage = (m: MeetCtx, nameNow: boolean): ShowcaseScene => (m.wrap ? "hearts" : nameNow ? "name" : m.step === 0 ? "sparkle" : "faces");
  /** The face trick: rapid moods under a spinning rainbow ring, then confetti. */
  const runTrick = useCallback(async (kind: TrickKind = "rainbow") => {
    if (kind === "spin") {           // the little Mark 1 drives a lap and skids, eyes dizzy
      setShowcaseScene("drive"); demoMood("dizzy", "#C9DCF0"); await demoSleep(2600);
      demoMood("laughing", "#FFC820"); await demoSleep(900);
    } else if (kind === "hearts") {  // hearts float up, he melts
      setShowcaseScene("hearts"); demoMood("love", "#FF6FA5"); await demoSleep(2200);
      demoMood("starstruck", "#FF6FA5"); await demoSleep(900);
    } else if (kind === "warp") {    // star streaks, then a sparkle burst
      setShowcaseScene("warp"); demoMood("shocked", "#C9DCF0"); await demoSleep(1600);
      demoMood("mindblown", "#F5B83D"); await demoSleep(900);
      setShowcaseScene("sparkle"); await demoSleep(900);
    } else {                          // rainbow ring + rapid moods
      setShowcaseScene("trick");
      for (const [m, col] of TRICK_MOODS) { if (cancelRef.current) break; demoMood(m, col); await demoSleep(650); }
    }
    setShowcaseScene("confetti");
    demoMood("starstruck", "#F5B83D");
  }, [demoMood, demoSleep]);
  /** An ASK beat: question → ears open → answer → live in-character reply. */
  const askAndRespond = useCallback(async (
    ask: AskSpec, p: Persona, stage: ShowcaseScene,
    sayDirect: (t: string) => Promise<void>, sayQueued: (t: string) => Promise<void>,
  ) => {
    await sayDirect(line(ask.say, p));
    setFaceState("listening");
    await setEarsMuted(false);
    const answer = await new Promise<string | null>((resolve) => {
      const done = (v: string | null) => { window.clearTimeout(timer); window.clearInterval(poll); pendingAnswerRef.current = null; resolve(v); };
      const timer = window.setTimeout(() => done(null), ask.listenMs ?? 14000);
      const poll = window.setInterval(() => { if (cancelRef.current) done(null); }, 120);
      pendingAnswerRef.current = (t) => done(t);
    });
    await setEarsMuted(true);
    if (cancelRef.current) return;
    const tada = line(TRICK_TADA, p);
    if (!answer) {
      await sayDirect(line(ask.fallback, p));
      if (ask.branch === "joke-or-trick") { await runTrick(); await sayDirect(tada); }
      return;
    }
    setLiveHeard("");
    setCaption(`“${stripEmoji(answer)}”`);
    appendTurn("user", answer);
    ingestUserMessage(answer);
    // Joke or trick is decided HERE, from set material — never the brain. A
    // trick they named (spin, hearts, warp) or the next one; a joke from the
    // bank. Anything else they said still gets a joke, so the beat never stalls.
    // A trick is decided here from set material. A joke is IMPROVISED by the
    // brain (Devin prefers it) — with the bank as the safety net when the brain
    // is slow, offline, or comes back empty, so the beat never stalls.
    let wantJoke = false;
    if (ask.branch === "joke-or-trick") {
      if (SAID_TRICK.test(answer) && !SAID_JOKE.test(answer)) {
        const kind = pickTrick(answer);
        await sayDirect(line(TRICK_INTRO[kind], p));
        await runTrick(kind); await sayDirect(tada); appendTurn("atlas", tada);
        return;
      }
      wantJoke = true;
    }
    setFaceState("thinking");
    setShowcaseScene("gears");   // visible "thinking" while the brain works
    // The brain sees ONLY this exchange: the question Nobi just asked and the
    // answer, in a session of its own. With the normal history the last user
    // turn is "give us a quick demo" and the model dutifully starts a tour
    // ("Hey Devin. Quick tour, coming up…") instead of reacting to the answer.
    const ctx = buildContext();   // only .facts is used — no chat history goes out
    const director = `You are in the middle of a live stage show and just asked: "${line(ask.say, p)}". ${ask.director} Hard rules: at most 35 words; end on a STATEMENT — the show moves on the instant you finish and nobody can answer, so no questions at all (not even "Question."); never offer a tour, a demo, or a list of what you can do.`;
    let reply = "";
    // A slow brain must not stall a live show: 15s and he falls back to the
    // scripted line for this beat.
    const abort = new AbortController();
    const abortTimer = window.setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({
          message: answer, sessionId: `show-${Date.now()}`,
          history: [{ role: "assistant", content: line(ask.say, p) }], facts: ctx.facts,
          persona: `${personaPrompt()}\n\n${director}`,
        }),
      });
      const data = (await res.json()) as { response?: string };
      reply = stripEmoji((data.response ?? "").trim());
    } catch { reply = ""; }
    finally { window.clearTimeout(abortTimer); }
    if (!reply) reply = wantJoke ? pickJoke(p) : line(ask.fallback, p);
    // The model won't always honour "no questions / 35 words": keep whole
    // sentences up to ~40 words and drop trailing questions (nobody can answer).
    const sentences = reply.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [reply];
    while (sentences.length > 1 && (/\?$/.test(sentences[sentences.length - 1]!) || /^question[.!]?$/i.test(sentences[sentences.length - 1]!))) sentences.pop();
    const kept: string[] = []; let words = 0;
    for (const s of sentences) { const n = s.split(/\s+/).length; if (kept.length && words + n > 40) break; kept.push(s); words += n; }
    reply = kept.join(" ") || reply;
    if (wantJoke) { setShowcaseScene("faces"); demoMood("mischievous", "#C9DCF0"); }
    // Their name, in gold above the eyes, while he replies.
    let next: ShowcaseScene = stage;
    if (ask.branch === "name") {
      const one = answer.trim().match(/^([A-Za-z][a-z]{1,20})[.!]?$/);
      const g = guessName(answer) ?? (one ? one[1]![0]!.toUpperCase() + one[1]!.slice(1) : undefined);
      if (g) { setMeetName(g); next = "name"; }
    }
    setShowcaseScene(next);
    appendTurn("atlas", reply);
    await sayQueued(reply);
    if (next === "name") setShowcaseScene(stage);
  }, [runTrick]);
  const runShow = useCallback(async (kind: "demo" | "pitch" | "order") => {
    if (showRef.current) return;
    showRef.current = true;
    cancelRef.current = false;
    queueRef.current = [];
    setBusy(true);
    setCaption("");
    setInput("");
    // Explicit, AWAITED mute before the first word: the busy/speaking effect also
    // mutes, but its fire-and-forget POSTs can land out of order around the
    // deferred hand-off, and an unmuted mic would hear the narration itself.
    await setEarsMuted(true);
    const p = asPersona(getPersona().id);
    const built = kind === "demo" ? buildDemoScript(getBotName(), p) : kind === "order" ? buildOrderScript(getBotName(), p) : buildPitchScript(getBotName(), p);
    const script = withOverrides(kind === "demo" ? "demo" : kind === "order" ? "order" : "pitch", built);
    if (kind === "order") setMeetName(getUserName().trim() || "YOURS");   // the studio engraves the owner's name
    const started = performance.now();
    sfx.prime();
    setShowcaseScene(script[0]!.scene);
    const voiceId = personaVoiceId();
    const sayDirect = async (text: string) => { if (!text) return; setCaption(stripEmoji(text)); await speak(text, { voiceId }); };
    const sayQueued = async (text: string) => {
      if (!text) return;
      setCaption(stripEmoji(text));
      for (const seg of segmentReply(text)) queueRef.current.push(seg);
      void drainQueue();
      await waitForQueue();
    };
    try {
      for (const beat of script) {
        if (cancelRef.current || performance.now() - started > 180_000) break;
        setShowcaseScene(beat.scene);
        const beatStart = performance.now();
        if (beat.mood) { demoMood(beat.mood, beat.color); if (beat.mood === "wink" || beat.mood === "love") sfx.boop(); }
        if (beat.trick) await runTrick();
        const text = line(beat.say, p);
        if (text) { if (beat.direct) await sayDirect(text); else await sayQueued(text); }
        for (const step of beat.steps ?? []) {
          if (cancelRef.current) break;
          demoMood(step.mood, step.color);
          const st = line(step.say, p);
          if (st) await sayDirect(st);
          await demoSleep(step.holdMs);
        }
        if (beat.ask) await askAndRespond(beat.ask, p, beat.scene, sayDirect, sayQueued);
        // holdMs is a FLOOR for beats with no speech, never a mandate. Once a
        // line has actually been spoken the scene moves on after a breath: the
        // audio is what the audience is following, and a cached line that plays
        // in half the scripted time used to leave him staring in silence for
        // the remainder. Silent beats still hold for their full duration.
        const elapsed = performance.now() - beatStart;
        const remaining = beat.holdMs - elapsed;
        const cap = text ? Math.min(remaining, MOTION.maxDeadAir) : remaining;
        if (cap > 0) await demoSleep(text ? Math.max(MOTION.afterSpeech, cap) : cap);
      }
    } finally {
      setShowcaseScene(null);
      queueRef.current = [];
      pendingAnswerRef.current = null;
      clearMood();
      setCaption("");
      setFaceState("happy");
      window.setTimeout(() => setFaceState((s) => (s === "happy" ? "idle" : s)), 2500);
      // Let the speaker's tail die out before the ears re-open.
      await demoSleep(1500);
      showEndedAtRef.current = Date.now();
      setBusy(false);
      showRef.current = false;
      void setEarsMuted(false);
      if (kind === "order") {
        setOverlay({ kind: "link", src: SHOP_URL, caption: "Design your Nobi", hint: "developmentindustries.org/build" });
        window.setTimeout(() => setOverlay((o) => (o && o.kind === "link" && o.src === SHOP_URL ? null : o)), 60_000);
      }
    }
  }, [speak, drainQueue, waitForQueue, demoMood, demoSleep, runTrick, askAndRespond]);
  const skipShow = useCallback(() => {
    if (!showRef.current) return;
    cancelRef.current = true;
    pendingAnswerRef.current = null;
    stop();
  }, [stop]);

  // ── Talk to the brain (streaming) ───────────────────────────────────────────
  const handleSend = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      // A show is waiting on an answer (typed here, or spoken) — hand it over.
      if (message && pendingAnswerRef.current) { pendingAnswerRef.current(message); return; }
      if (!message || busyRef.current) return;

      touched();
      cancelRef.current = false;
      queueRef.current = [];
      setInput("");
      setLiveHeard("");
      setBusy(true);
      setCaption("");
      setFaceState("thinking");

      // Memory: build context from prior history + facts BEFORE recording this turn.
      const ctx = buildContext({ maxTurns: 12 });
      const persona = personaPrompt(); // in-character system instruction (name + traits)
      appendTurn("user", message);

      let full = "";
      let ok = false;

      // ── Agentic pre-flight: is this a DeckOS ACTION rather than chat? ────────
      // (drive/turn/stop, remember X, open a tool, status). Deterministic + fast,
      // so plain conversation isn't slowed. Falls through to chat on no match.
      // While the "meet someone" director is mid-conversation, the person's
      // replies go straight to the brain — "yes, remember that" is a reply to
      // Nobi, not a command for the deterministic skills. "stop" still exits.
      if (meetRef.current && meetRef.current.step > 0 && /\b(stop|cancel|never ?mind|quit|enough)\b/i.test(message)) {
        meetRef.current = null;
        setShowcaseScene(null);
      }
      const skipAgent = !!meetRef.current && meetRef.current.step > 0;
      if (!skipAgent) {
      try {
        const ar = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, facts: ctx.facts }),
        });
        if (ar.ok) {
          const decision = (await ar.json()) as { mode: "action" | "chat"; speak?: string; ui?: UiAction };
          if (decision.mode === "action") {
            const ui: UiAction = decision.ui ?? { type: "none" };
            if (ui.type === "meet") {
              // Arm the "meet someone" director and fall through to the chat path
              // below: the brain runs the conversation, we steer it turn by turn.
              meetRef.current = {
                step: 0, answers: [], beatsDone: [], wrap: false, startedAt: Date.now(),
                ownerName: getUserName().trim(), personName: ui.name, relation: ui.relation,
              };
            } else {
            // "say that again" re-speaks the previous reply.
            let sayText = decision.speak ?? "";
            if (ui.type === "replayLast") {
              const lastAtlas = [...mem.history].reverse().find((t) => t.role === "atlas");
              sayText = lastAtlas?.text ?? "I don't have anything to repeat yet.";
            }
            // Run the client effect now; get back any deferred (navigate / mode /
            // mood) to run AFTER Atlas finishes speaking.
            const deferred = applyClientAction(ui, {
              showMood: (state, ms, color) => {
                setFaceState(state as FaceState);
                if (color) setEyeColor(toEyeRgb(color));
                window.setTimeout(() => {
                  setFaceState("idle");
                  if (color) setEyeColor(null);
                }, ms);
              },
              openVideo: (query) => setVideoQuery(query),
              controlVideo: (action) => {
                if (action === "close") setVideoQuery(null);
                else if (action === "pause") videoRef.current?.pause();
                else videoRef.current?.resume();
              },
              playSurvivor: (variant, banner) => {
                survivorBannerRef.current = banner ?? null;
                setSurvivorAnim(variant);
              },
              showImage: (url, prompt) => setOverlay({ kind: "image", src: url, caption: prompt }),
              openTutorial: () => setOverlay({ kind: "tutorial", src: "/tutorial.html" }),
              showLink: (title, url, code, hint) => setOverlay({ kind: "link", src: url, caption: title, code, hint }),
              closeOverlay: () => setOverlay(null),
              playShow: (kind) => { void runShow(kind); },
            });
            if (sayText.trim()) {
              ok = true;
              full = sayText;
              setCaption(stripEmoji(full));
              setFaceState("happy");
              for (const seg of segmentReply(full)) queueRef.current.push(seg);
              void drainQueue();
              await waitForQueue();
              appendTurn("atlas", stripEmoji(full));
            }
            setFaceState("idle");
            clearMood();
            setBusy(false);
            if (deferred) deferred();
            return;
            }
          }
        }
      } catch { /* agent unavailable — just talk */ }
      }

      // Memory ingestion happens only for CONVERSATION — after the pre-flight, so
      // commands and show triggers ("tell us about you") never become facts —
      // and never during a meet: the person talking is the GUEST, and their
      // "I'm a nurse" must not become a fact about the owner. The meet wrap-up
      // stores a single "Met <name> …" fact instead.
      if (!meetRef.current) ingestUserMessage(message);

      // The "meet someone" director expires quietly if the conversation stalls;
      // a goodbye (or six turns) makes THIS reply the warm wrap-up.
      if (meetRef.current && Date.now() - meetRef.current.startedAt > 6 * 60_000) { meetRef.current = null; setShowcaseScene(null); }
      let nameNow = false;   // show their name this turn: the greeting, or the turn he first learns it
      if (meetRef.current && meetRef.current.step > 0) {
        const m = meetRef.current;
        if (m.step >= 6 || /\b(bye|goodbye|see you|gotta go|got to go|later|nice (to |ta )?meet(ing)? you|good ?night)\b/i.test(message)) m.wrap = true;
        if (!m.personName) { const g = guessName(message); if (g) { m.personName = g; nameNow = true; } }
      } else if (meetRef.current?.personName) nameNow = true;
      if (meetRef.current?.personName) setMeetName(meetRef.current.personName);
      const personaSent = meetRef.current ? persona + meetDirectorNote(meetRef.current) : persona;
      // A meet is a stage show too: gears while he thinks, then a backdrop for
      // the turn (their name in gold / sparkle to greet, orb ring mid-conversation, hearts goodbye).
      const meetTurn = meetRef.current;
      if (meetTurn) { sfx.prime(); setShowcaseScene("gears"); }
      let staged = false;
      const stageMeet = () => { if (meetTurn && !staged) { staged = true; setShowcaseScene(meetStage(meetTurn, nameNow)); } };
      // A meet is its own conversation: the guest gets only the meet's turns
      // (two per completed step) in a session of its own — not the owner's
      // earlier chat, which he'd otherwise reference ("same goat story?").
      const history = meetTurn ? (meetTurn.step > 0 ? ctx.history.slice(-2 * meetTurn.step) : []) : ctx.history;
      const sessionId = meetTurn ? `meet-${meetTurn.startedAt}` : undefined;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history, facts: ctx.facts, persona: personaSent, ...(sessionId ? { sessionId } : {}) }),
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sse = "";
        let pending = "";
        const pushSentence = (text: string) => {
          const t = text.trim();
          if (!t) return;
          for (const seg of segmentReply(t)) queueRef.current.push(seg);
          void drainQueue();
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelRef.current) break;
          sse += decoder.decode(value, { stream: true });
          const events = sse.split("\n\n");
          sse = events.pop() ?? "";
          for (const ev of events) {
            const line = ev.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let obj: { token?: string; done?: boolean; error?: boolean };
            try { obj = JSON.parse(payload); } catch { continue; }
            if (obj.error) throw new Error("stream error");
            if (obj.token) {
              stageMeet();
              full += obj.token;
              pending += obj.token;
              // Show the words only — any emoji the model emits are stripped here
              // (the face shows emotion via its own on-screen glyph animation).
              setCaption(stripEmoji(full));
              // While the mood queue isn't actively speaking a sentence, hold the
              // neutral talking pose; the queue takes over per-sentence emotion.
              if (!drainingRef.current) setFaceState("talking");
              // pull any complete sentences into the speak queue
              let m: RegExpMatchArray | null;
              while ((m = pending.match(/^([\s\S]*?[.!?]+)(\s+)([\s\S]*)$/))) {
                pushSentence(m[1]!);
                pending = m[3]!;
              }
            }
          }
        }
        if (pending.trim()) pushSentence(pending);
        ok = full.trim().length > 0;
        if (!ok) full = "Hmm, I'm not sure what to say.";
      } catch {
        // Fallback: non-streaming endpoint (still memory-aware), then speak it.
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, history, facts: ctx.facts, persona: personaSent, ...(sessionId ? { sessionId } : {}) }),
          });
          const data = (await res.json()) as { response?: string };
          full = (data.response ?? "").trim() || SERVER_DOWN_MSG;
          ok = res.ok && full !== SERVER_DOWN_MSG;
          stageMeet();
          setCaption(stripEmoji(full));
          for (const seg of segmentReply(full)) queueRef.current.push(seg);
          void drainQueue();
        } catch {
          full = SERVER_DOWN_MSG; ok = false;
          setFaceState("confused"); setCaption(stripEmoji(full));
          await speak(full);
        }
      }

      await waitForQueue();
      // Persist the clean words (no emoji) so recalled history stays speakable.
      appendTurn("atlas", stripEmoji(full));
      // "Meet someone" bookkeeping: what the person said is what he learned;
      // after the wrap-up turn it's kept for real in his memory.
      const meet = meetRef.current;
      if (meet) {
        if (meet.step > 0) { meet.answers.push(message); meet.beatsDone = meetDetectBeats(message, full, meet); }
        meet.step += 1;
        if (meet.wrap) {
          const who = meet.personName ?? "someone new";
          const rel = meet.relation ? ` (${meet.ownerName || "my person"}'s ${meet.relation})` : "";
          const learned = meet.answers.filter((a) => a.split(/\s+/).length >= 3).slice(0, 3).join("; ");
          addFact(`Met ${who}${rel}${learned ? ` — they said: ${learned}` : ""}`, "user");
          meetRef.current = null;
        }
      }
      // Between meet turns the orb ring keeps circling while he listens; the
      // goodbye clears the stage.
      if (meetTurn) { setShowcaseScene(meetRef.current ? "faces" : null); if (!meetRef.current) setMeetName(""); }
      setFaceState("idle");
      clearMood();
      setBusy(false);
    },
    [drainQueue, waitForQueue, speak],
  );
  // The pre-empt effect above runs before handleSend is declared, so it reaches
  // it through this ref, refreshed on every render.
  handleSendRef.current = handleSend;

  // ── Hands-free listening ────────────────────────────────────────────────────
  const { supported: micSupported, listening } = useAtlasListening({
    enabled: micOn,
    paused: busy,
    onUtterance: (text) => { void handleSend(text); },
    onInterim: (text) => setLiveHeard(text),
  });

  useEffect(() => {
    if (busy) return;
    setFaceState((s) => (listening ? "listening" : s === "listening" ? "idle" : s));
  }, [listening, busy]);

  const toggleMic = useCallback(async () => {
    if (micOn) { setMicOn(false); return; }
    // Turning on: make sure we have permission (silent on a robot, prompts on desktop).
    const res = await acquireMic();
    if (res.granted) { setInputMode("voice"); setMicOn(true); }
    else { setCaption("I couldn't turn on the microphone — you can still type to me."); }
  }, [micOn]);

  // ── Wake-from-sleep (any key / tap / voice) ─────────────────────────────────
  // Dormant = sleeping or sitting idle with no panel up. Any key or tap opens
  // the eyes; Enter/Space — or detected speech — also drops straight into the
  // existing listen/talk flow, so the robot works hands-free or keyboard-only.
  // (However sleep was entered — timer, hardware, script — this is the way out.)
  const wake = useCallback(() => {
    setFaceState((s) => (s === "sleeping" ? "idle" : s));
  }, []);
  const wakeAndListen = useCallback(() => {
    wake();
    // Mic already on → the recognizer is running; waking alone resumes the loop.
    if (micSupported && !micOn) void toggleMic();
  }, [wake, micSupported, micOn, toggleMic]);
  const { notifySpeech } = useWake({
    asleep: !busy && !panelOpen && !galleryOpen && !skillsOpen && !settingsOpen
      && (faceState === "sleeping" || faceState === "idle"),
    onWake: wake,
    onWakeAndListen: wakeAndListen,
  });
  // Voice wake: speech reaching the interim caption while dormant counts as a
  // wake — reuses the existing recognizer, no second audio pipeline.
  useEffect(() => { if (liveHeard) notifySpeech(); }, [liveHeard, notifySpeech]);

  // ── Physical face input (touch / knob / press from the hardware panel) ───────
  // Same path whether it's a real panel tap or the on-screen face — the brain
  // broadcasts "atlas.faceInput" over WS. Tap wakes, press interrupts, knob tunes.
  const faceInputEv = useLatestEvent("atlas.faceInput");
  const handledInputAt = useRef<string>("");
  useEffect(() => {
    if (!faceInputEv || faceInputEv.timestamp === handledInputAt.current) return;
    handledInputAt.current = faceInputEv.timestamp;
    const p = (faceInputEv.payload ?? {}) as { kind?: string; dir?: number };
    switch (p.kind) {
      case "tap":
      case "touch":
        void toggleMic();                       // tap the face to start/stop listening
        break;
      case "press":
        cancelRef.current = true;               // knob click interrupts current speech
        break;
      case "knob": {
        const r = nudgeVoiceRate((p.dir ?? 0) > 0 ? 0.06 : -0.06);
        setCaption(`Voice speed ${r.toFixed(2)}×`);
        break;
      }
    }
  }, [faceInputEv, toggleMic]);

  // ── Local-STT utterances (Pi Vosk mic sidecar → brain → WS "voice.heard") ────
  // The robot has no working browser STT, so a Pi sidecar captures the USB mic,
  // runs Vosk, and POSTs finals to /api/voice/heard; the brain broadcasts them as
  // "voice.heard" (text under payload). Feed the SAME entry a typed message uses so
  // a spoken line flows through the existing chat → caption → TTS path with zero
  // new response logic — exactly how onUtterance and faceInput above reuse handleSend.
  // Dedup on timestamp (like faceInput) so a re-render never re-fires; if one lands
  // mid-turn, handleSend's busyRef guard just drops it (fine — the speaker repeats).
  // ── Barge-in: the ears heard the user cut in — stop talking, stop the show ──
  const voiceInterruptEv = useLatestEvent("voice.interrupt");
  const handledInterruptAt = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceInterruptEv || voiceInterruptEv.timestamp === handledInterruptAt.current) return;
    handledInterruptAt.current = voiceInterruptEv.timestamp;
    touched();
    cancelRef.current = true;          // shows, queued sentences, pending asks all check this
    queueRef.current = [];
    pendingAnswerRef.current = null;
    stop();                            // cut the audio that is playing right now
    setShowcaseScene(null);
    setCaption("");
    setFaceState("listening");
    void setEarsMuted(false);
    // Acknowledge it. Going abruptly silent reads as a crash; one short line
    // reads as a person stopping mid-sentence because you started talking.
    const ack = interruptedLine(getPersona().id as Persona);
    setCaption(ack);
    void speak(ack, { voiceId: personaVoiceId() });
  }, [voiceInterruptEv, stop]);

  // A phrase from the REMOTE (not the microphone) also pre-empts: same reason.
  // Ears-sourced speech still queues politely, because a bystander talking over
  // a running demo should not restart it.
  const voiceHeardEv = useLatestEvent("voice.heard");
  const preemptFor = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceHeardEv || voiceHeardEv.source !== "remote") return;
    if (preemptFor.current === voiceHeardEv.timestamp) return;
    preemptFor.current = voiceHeardEv.timestamp;
    if (!busyRef.current && !showRef.current) return;
    cancelRef.current = true;
    queueRef.current = [];
    pendingAnswerRef.current = null;
    stop();
    setShowcaseScene(null);
    // The normal handler has already refused this message (it arrived while he
    // was busy), so cancelling is only half the job: once the old work has
    // unwound we must run the new request ourselves, or the button does nothing
    // but stop him — which is the most confusing possible outcome on a stand.
    const text = String((voiceHeardEv.payload as { text?: string } | undefined)?.text ?? "").trim();
    window.setTimeout(() => {
      cancelRef.current = false;
      busyRef.current = false;
      setBusy(false);
      if (text) void handleSendRef.current?.(text);
    }, 300);
  }, [voiceHeardEv, stop]);
  // Provisioning (POST /api/provision, before a unit ships): apply the build
  // profile — owner name, bot name, personality, eye theme — then reload so
  // every surface picks it up and the first greeting is to the owner by name.
  const provisionEv = useLatestEvent("provision.apply");
  useEffect(() => {
    if (!provisionEv) return;
    const p = (provisionEv.payload ?? {}) as { botName?: string; ownerName?: string; personaId?: string; eyeTheme?: string };
    try {
      if (p.ownerName) setUserName(p.ownerName);
      if (p.botName) setBotName(p.botName);
      if (p.personaId) setPersona(p.personaId);
      if (p.eyeTheme) saveFaceTheme(p.eyeTheme);
    } catch { /* storage unavailable */ }
    window.setTimeout(() => window.location.reload(), 600);
  }, [provisionEv]);
  const handledVoiceAt = useRef<string>("");
  useEffect(() => {
    if (!voiceHeardEv || voiceHeardEv.timestamp === handledVoiceAt.current) return;
    handledVoiceAt.current = voiceHeardEv.timestamp;
    const text = ((voiceHeardEv.payload ?? {}) as { text?: string }).text ?? "";
    // A show is listening for an answer — this is it.
    if (text.trim() && pendingAnswerRef.current) { pendingAnswerRef.current(text.trim()); return; }
    // A transcript arriving right after a show is its own last line echoing
    // through the mic — never the user.
    if (Date.now() - showEndedAtRef.current < 3000) return;
    if (text.trim()) void handleSend(text);
  }, [voiceHeardEv, handleSend]);

  // ── Self-hearing mute bracket — gag the mic sidecar while Nobi talks ─────────
  // The same USB mic would otherwise transcribe Nobi's own TTS and loop forever.
  // Tell the brain to drop incoming voice.heard for the whole turn: POST
  // /api/voice/mute {on:true} at turn start, {on:false} once the last sentence is
  // spoken. `busy` spans the entire turn (thinking beat + every queued sentence),
  // so the flag never flickers open in the gaps *between* sentences the way a bare
  // `speaking` bracket would; `speaking` keeps it closed until the final utterance
  // actually ends (belt-and-suspenders for any speak() outside a busy turn). This
  // mirrors the existing `paused: busy` mic gate, but for the separate Pi pipeline.
  // Fire-and-forget — there's no sidecar in computer mode, so a failed fetch is
  // expected and ignored; the WS event + mute are harmless there, only live on-bot.
  const voiceMuted = busy || speaking;
  useEffect(() => {
    void fetch("/api/voice/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: voiceMuted }),
    }).catch(() => { /* no mic sidecar here — ignore */ });
  }, [voiceMuted]);

  // ── Live brain detection ────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/ai-router/status");
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { claudeAvailable?: boolean; ollamaAvailable?: boolean; activeModel?: string; interactiveModel?: string; models?: { apex?: string; cortex?: string } };
        const online = !!(d.claudeAvailable || d.ollamaAvailable);
        const label = d.claudeAvailable ? "Claude" : d.ollamaAvailable ? "Local" : "Rules";
        // Show the model interactive chat actually uses (Haiku when fast + Claude).
        const model = d.interactiveModel || d.activeModel || d.models?.apex || d.models?.cortex || "rule engine";
        if (alive) setBrain({ label, model, online });
      } catch { if (alive) setBrain({ label: "Offline", model: "—", online: false }); }
    };
    void poll();
    const id = window.setInterval(poll, 6000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // ── Plug-in dock greeting — "thanks for the charge, syncing, anything you need?"
  const dockingRef = useRef(false);
  const runDockGreeting = useCallback(async () => {
    if (dockingRef.current) return;
    dockingRef.current = true;
    cancelRef.current = false;
    queueRef.current = [];
    setBusy(true);
    setFaceState("happy");
    setCaption("Syncing…");
    // The body resets on connect and drops its record a moment later — wait for it.
    let record: { boot: number; lifeSec: number; sessMs: number } | null = null;
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch("/api/body/presence");
        const d = (await r.json()) as { present?: boolean; record?: typeof record };
        if (d.record) { record = d.record; break; }
        if (!d.present) break;
      } catch { /* ignore */ }
      await new Promise((res) => setTimeout(res, 700));
    }
    const dl = dockLines(bot, record);
    setCaption(dl.sync);
    await new Promise((res) => setTimeout(res, 1100));
    const clean = stripEmoji(dl.speak);
    setCaption(clean);
    for (const seg of segmentReply(dl.speak)) queueRef.current.push(seg);
    void drainQueue();
    await waitForQueue();
    appendTurn("atlas", clean);
    setFaceState("idle"); clearMood(); setBusy(false);
    dockingRef.current = false;
  }, [bot, drainQueue, waitForQueue]);

  // ── Greeting, once per mount (warmer if it remembers you) ───────────────────
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    // A pending dock greeting (we were just plugged in) takes over the hello.
    let dockPending = false;
    try { dockPending = sessionStorage.getItem("atlas_dock_pending") === "1"; } catch { /* ignore */ }
    if (dockPending) {
      try { sessionStorage.removeItem("atlas_dock_pending"); } catch { /* ignore */ }
      void runDockGreeting();
      return;
    }
    const name = getUserName().trim();
    const returning = mem.history.length > 0;
    const hello = name
      ? returning
        ? `Welcome back, ${name}.`
        : (getInputMode() === "voice" ? `Hi ${name}! I'm listening — just talk to me.` : `Hi ${name}! What can I do for you?`)
      : `Hi there! I'm ${bot}.`;
    setBusy(true);
    setCaption(hello);
    setFaceState("happy");
    void speak(hello).finally(() => { setFaceState("idle"); setBusy(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak, bot]);

  // Plugged in while already in the buddy → dock greeting.
  useEffect(() => {
    const onPlug = () => { try { sessionStorage.removeItem("atlas_dock_pending"); } catch { /* ignore */ } void runDockGreeting(); };
    window.addEventListener("atlas:pluggedIn", onPlug);
    return () => window.removeEventListener("atlas:pluggedIn", onPlug);
  }, [runDockGreeting]);

  useEffect(() => () => { cancelRef.current = true; }, []);

  // ── Ctrl/⌘+S → Settings ─────────────────────────────────────────────────────
  // The face-locked robot hides the gear, so a keyboard user needs a door into
  // settings + keys (WiFi, Bluetooth speaker, AI keys). Global in every mode; we
  // swallow the browser "Save page" default and toggle the same panel the gear
  // opens (Esc still closes it — BuddySettings owns its own Escape handler). It
  // keys on Ctrl/⌘ only, so plain typing and the input's Enter-to-send are safe.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      setSettingsOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── The face breathes with the actual voice ────────────────────────────────
  // activityFor() gives a flat number per state, so "talking" looked identical
  // whether he was whispering or emphatic. While audio is playing we blend in
  // the real amplitude, sampled on a rAF outside React so it costs no renders.
  const [liveLevel, setLiveLevel] = useState(0);
  const [sayProgress, setSayProgress] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!speaking) { setLiveLevel(0); setSayProgress(undefined); return; }
    let raf = 0, smoothed = 0;
    const tick = () => {
      // ease toward the reading: raw amplitude jitters far too fast to look real
      smoothed += (readAmplitude() - smoothed) * 0.35;
      setLiveLevel(smoothed);
      setSayProgress(speechHasProgress() ? speechProgress() : undefined);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  // Someone is talking to him — the ears say so the moment they start.
  // ── Gaze ───────────────────────────────────────────────────────────────────
  // He should look at what he is talking about. Anything that appears on screen
  // (a QR card, a name, a trick) nudges his eyes toward it for a beat, then they
  // come back to you. Cheap, and it reads as attention rather than animation.
  const [gaze, setGaze] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const gazeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glanceAt = useCallback((x: number, y: number, ms = 1400) => {
    setGaze({ x, y });
    if (gazeTimer.current) clearTimeout(gazeTimer.current);
    gazeTimer.current = setTimeout(() => setGaze({ x: 0, y: 0 }), ms);
  }, []);
  useEffect(() => { if (overlay) glanceAt(0, 0.35, 2200); }, [overlay, glanceAt]);
  useEffect(() => { if (caption) glanceAt(0, 0.22, 900); }, [caption, glanceAt]);

  // The robot's own voice setting, learned at boot and kept current.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { config?: Record<string, string> } | null) => setConfiguredVoiceId(j?.config?.["ELEVENLABS_VOICE_ID"]))
      .catch(() => { /* fall back to the persona map */ });
  }, []);
  const voiceChangedEv = useLatestEvent("voice.changed");
  useEffect(() => {
    if (!voiceChangedEv) return;
    setConfiguredVoiceId((voiceChangedEv.payload as { voiceId?: string } | undefined)?.voiceId);
  }, [voiceChangedEv]);

  // Show overrides: fetched once at boot, then whatever the brain pushes. This
  // is what makes a demo editable at a stand instead of via a three-minute deploy.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/shows/overrides`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { overrides?: Parameters<typeof setShowOverrides>[0] } | null) => { if (j?.overrides) setShowOverrides(j.overrides); })
      .catch(() => { /* built-in scripts are the fallback */ });
  }, []);
  const overridesEv = useLatestEvent("shows.overrides");
  useEffect(() => {
    if (!overridesEv) return;
    setShowOverrides((overridesEv.payload as { overrides?: Parameters<typeof setShowOverrides>[0] } | undefined)?.overrides);
  }, [overridesEv]);

  // ── Games ──────────────────────────────────────────────────────────────────
  // The robot runs the game; the face is its board. A frame arrives on every
  // change and is drawn over the face until the game is put away.
  const gameFrameEv = useLatestEvent("game.frame");
  const [gameFace, setGameFace] = useState<null | {
    title?: string; body?: string; big?: string; mood?: string; color?: string;
    scene?: string | null; speak?: string; scores?: Array<{ name: string; score: number; active?: boolean }>;
    canvas?: Record<string, unknown>;
    /** The running game's identity, stamped on every frame by the engine. */
    icon?: string; accent?: string;
  }>(null);
  const lastSpoken = useRef<string>("");
  useEffect(() => {
    if (!gameFrameEv) return;
    const p = (gameFrameEv.payload ?? {}) as { face?: typeof gameFace };
    setGameFace(p.face ?? null);
    if (!p.face) {
      lastSpoken.current = "";
      // A game just ended or was put away. It may have left a SCENE and an eye
      // colour on him, and nothing else ever takes them off: Dev's Dungeon ends
      // on the lab, so he would sit there holding a bubbling test tube for the
      // rest of the day, long after the game was over. Hand the face back.
      setShowcaseScene(null);
      clearMood();
      setFaceState("idle");
      // And take down the game's join QR. It advertises a PLAY CODE that died
      // with the game, so leaving it up means the next person to scan his face
      // gets a refusal and concludes the robot is broken. Caught in a
      // screenshot: he was still showing a code from a game ended long before.
      setOverlay((o) => (o?.kind === "link" ? null : o));
      return;
    }
    touched();
    if (p.face.mood) setFaceState(p.face.mood as FaceState);
    if (p.face.color) setEyeColor(toEyeRgb(p.face.color));
    if (p.face.scene !== undefined) setShowcaseScene((p.face.scene as ShowcaseScene | null) ?? null);
    // Narration is spoken once per line, never repeated on a re-render.
    if (p.face.speak && p.face.speak !== lastSpoken.current) {
      lastSpoken.current = p.face.speak;
      setCaption(p.face.speak);
      void speak(p.face.speak, { voiceId: personaVoiceId() });
    }
  }, [gameFrameEv]);

  // ── Direct face commands (the remote) ──────────────────────────────────────
  // Instant, no brain in the loop: a mood, an eye colour, where he looks, a
  // trick, a scene. Several of these have no spoken trigger at all, which is
  // exactly why the remote exists — "look left" is not something you can ask for.
  const faceCmdEv = useLatestEvent("face.command");
  const handledFaceCmdAt = useRef<string | null>(null);
  useEffect(() => {
    if (!faceCmdEv || faceCmdEv.timestamp === handledFaceCmdAt.current) return;
    handledFaceCmdAt.current = faceCmdEv.timestamp;
    const p = (faceCmdEv.payload ?? {}) as {
      mood?: string; color?: string | null; gaze?: [number, number];
      trick?: TrickKind; joke?: boolean; scene?: string | null;
      countdown?: number | null; countdownLabel?: string;
      say?: string; showLink?: { title: string; url: string; code?: string; hint?: string };
    };
    touched();
    // A countdown ticking toward something irreversible (a new pairing code).
    // It is painted, never spoken per tick: ten synthesised numbers would cost
    // credits and talk over the person trying to call it off.
    if (p.countdown !== undefined) {
      setCountdown(p.countdown === null ? null : { n: p.countdown, label: p.countdownLabel ?? "" });
    }
    if (p.showLink) setOverlay({ kind: "link", src: p.showLink.url, caption: p.showLink.title, code: p.showLink.code, hint: p.showLink.hint });
    if (p.say) { setCaption(p.say); void speak(p.say, { voiceId: personaVoiceId() }); }
    // A press on the remote wins. Whatever is mid-flight — a show, a trick, a
    // sentence — stops so the new thing starts now: on a stand you press a
    // button because you want THAT, not because you want to queue behind this.
    if (p.trick || p.joke || p.scene !== undefined) {
      cancelRef.current = true;
      queueRef.current = [];
      stop();
      window.setTimeout(() => { cancelRef.current = false; }, 220);
    }
    // An explicit Clear also stops whatever is mid-flight: a trick sets its own
    // scene and mood a beat later, which would otherwise land on top of the
    // reset and leave him wearing the thing you just asked him to drop.
    if (p.scene === null) { cancelRef.current = true; window.setTimeout(() => { cancelRef.current = false; }, 250); }
    if (p.color !== undefined) setEyeColor(p.color ? toEyeRgb(p.color) : null);
    if (p.mood) setFaceState(p.mood as FaceState);
    if (p.gaze) glanceAt(p.gaze[0], p.gaze[1], 6000);
    if (p.scene !== undefined) setShowcaseScene((p.scene as ShowcaseScene | null) ?? null);
    if (p.trick) void runTrick(p.trick);
    if (p.joke) {
      const joke = pickJoke(getPersona().id as Persona);
      setCaption(joke);
      void speak(joke, { voiceId: personaVoiceId() });
    }
  }, [faceCmdEv]);

  // Anything a person does resets the booth loop.
  const [lastInteractionAt, setLastInteractionAt] = useState(Date.now());
  const touched = useCallback(() => setLastInteractionAt(Date.now()), []);

  const listeningEv = useLatestEvent("voice.listening");
  const [earsOpen, setEarsOpen] = useState(false);
  const earsOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!listeningEv) return;
    const on = (listeningEv.payload as { on?: boolean } | undefined)?.on !== false;
    setEarsOpen(on);
    if (on) touched();
    if (earsOffTimer.current) clearTimeout(earsOffTimer.current);
    if (on) earsOffTimer.current = setTimeout(() => setEarsOpen(false), 6000);
  }, [listeningEv]);

  // NOTE: the face engine already reads the live TTS amplitude itself (see
  // AtlasFace → readAmplitude) and drives the talking bounce from it, so this
  // stays the plain per-state hint. Blending amplitude in here pushed activity
  // over the engine's 0.65 auto-morph threshold and replaced his eyes with the
  // neural cluster mid-sentence.
  // ── The booth loop ─────────────────────────────────────────────────────────
  const attracting = useAttract({
    glanceAt,
    mood: (name, color) => demoMood(name, color),
    say: (text) => {
      setCaption(text);
      void setEarsMuted(true, false);          // unprompted: do not open the mic after
      void speak(text, { voiceId: personaVoiceId() }).finally(() => void setEarsMuted(false, false));
    },
    busy: busy || !!showcaseScene || !!overlay,
    lastInteractionAt,
  });

  const activity = activityFor(faceState);
  const canSend = input.trim().length > 0 && !busy;
  const hint = listening
    ? (liveHeard ? `“${liveHeard}”` : "Listening…")
    : `Ask ${bot} anything — I'm here whenever you're ready.`;

  return (
    <div className={"relative flex w-full flex-col items-center justify-center overflow-hidden bg-background px-6 text-foreground " + (robotMode ? "h-screen py-4" : "min-h-screen py-10")}>
      {videoQuery && (
        <YouTubeOverlay ref={videoRef} query={videoQuery} onClose={() => setVideoQuery(null)} />
      )}
      {overlay && (
        <ContentOverlay kind={overlay.kind} src={overlay.src} caption={overlay.caption} code={overlay.code} hint={overlay.hint} onClose={() => setOverlay(null)} />
      )}
      {showcaseScene && (
        <ShowcaseOverlay scene={showcaseScene} label={bot.toUpperCase()} nameTag={meetName} onSkip={skipShow} />
      )}
      {survivorAnim && (
        <SurvivorOverlay variant={survivorAnim}
          banner={survivorBannerRef.current ?? "JEFF, SEND ME TO FIJI!"}
          onDone={() => {
            setSurvivorAnim(null);
            survivorBannerRef.current = null;
            runFireCelebration();
          }} />
      )}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]"
        style={{ width: 520, height: 520, background: "radial-gradient(circle, rgba(var(--primary-rgb),0.16) 0%, transparent 62%)", filter: "blur(8px)" }} />

      {/* live brain indicator (top-left) — computer mode only; on the robot the
          screen is nothing but the face (brain status lives in the Ctrl+S vitals). */}
      {!robotMode && (
      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1">
        <div className="flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/60 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-sm"
             title={brain ? `Active brain: ${brain.label} (${brain.model})` : "Detecting brain…"}>
          <span className={"inline-block h-1.5 w-1.5 rounded-full " + (brain?.online ? "bg-emerald-400" : "bg-amber-400")} />
          <span className="uppercase tracking-wider">{brain ? brain.label : "…"}</span>
          <span className="hidden text-muted-foreground/60 sm:inline">{brain?.model}</span>
        </div>
      </div>
      )}

      {/* corner controls — hidden in robot mode (face is the only screen) */}
      {!robotMode && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"
            className="rounded-full p-2 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Settings className="h-4 w-4" />
          </button>
          <button type="button" onClick={onOpenDeveloper} aria-label="Developer mode" title="Developer mode"
            className="rounded-full p-2 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Code2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {robotMode ? (
        /* ROBOT: the whole round screen IS the face — big bare eyes floating on
           the display, the reply riding just beneath them. No disc, no chat
           chrome (there's no keyboard/mouse; talk by voice, set up from a
           phone, or Ctrl+S in a pinch). Long-press the face escapes to computer. */
        <div className="absolute inset-0 z-[1]"
          onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold}>
          <div className="absolute inset-0 flex items-center justify-center">
            <AtlasFace mode="auto" state={faceState} size={faceFill} bare activity={activity} gaze={gaze}
              eyeColorOverride={eyeColor} discTint={discTint} emoji={emoji} />
            {/* A game that draws its own playfield gets the whole disc, around
                his eyes. Only Meteor uses this so far. */}
            {gameFace?.canvas?.["kind"] === "meteor" && (
              <MeteorCanvas data={gameFace.canvas as unknown as MeteorCanvasData} />
            )}
            {/* The countdown sits under his eyes, big enough to read across a
                room — the whole point is that someone notices in time. */}
            {/* Above the overlay (z-40). A countdown on something irreversible
                is a safety control: if a QR card can cover it, the one moment
                it exists for is the moment you cannot see it. */}
            {countdown && (
              <div className="pointer-events-none fixed inset-x-0 top-[58%] z-50 flex flex-col items-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-300/70">{countdown.label}</div>
                <div className="text-6xl font-bold tabular-nums text-amber-300 drop-shadow-[0_0_18px_rgba(252,211,77,0.45)]">
                  {countdown.n}
                </div>
                <div className="font-mono text-[10px] tracking-wide text-amber-300/60">any remote button cancels</div>
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-[63%] flex justify-center px-10">
            {/* The game board: a thin strip the room can read from across a
                table. His eyes stay the star — the board never covers them. */}
            {gameFace && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1 px-6 pb-3">
                {gameFace.title && (
                  /* The game's own icon and colour ride on the title, so the
                     room can tell which game is on from the doorway. */
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em]"
                    style={{ color: gameFace.accent ?? undefined }}>
                    {gameFace.icon && <span className="text-[15px] tracking-normal">{gameFace.icon}</span>}
                    <span className={gameFace.accent ? "" : "text-primary/60"}>{gameFace.title}</span>
                  </div>
                )}
                {gameFace.big && (
                  <div className="text-4xl font-bold tabular-nums" style={{ color: gameFace.accent ?? undefined }}>{gameFace.big}</div>
                )}
                {!!gameFace.scores?.length && (
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
                    {gameFace.scores.map((s) => (
                      <span key={s.name} className={"font-mono text-[11px] " + (s.active ? "text-primary" : "text-muted-foreground")}>
                        {s.active ? "▸ " : ""}{s.name} {s.score}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* The caption steps aside for a countdown. They occupy the same
                band under his eyes, and stacked on each other neither one can
                be read — which defeats a countdown whose entire job is to be
                noticed in time to stop it. */}
            {!countdown && (
              <FaceCaption text={gameFace?.body ?? caption} hint={attracting ? "Say “Hey Nobi”" : hint} busy={busy} progress={sayProgress} listening={earsOpen} />
            )}
          </div>
        </div>
      ) : (
      <div className="relative z-[1] flex w-full max-w-md flex-col items-center gap-7">
        <div
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
        >
          <AtlasFace mode="auto" state={faceState} size={280} activity={activity}
            eyeColorOverride={eyeColor} discTint={discTint} emoji={emoji} />
        </div>

        {/* Live on-screen subtitle of Nobi's reply (same `caption` state) —
            legible over the face and inside the round bezel; see FaceCaption. */}
        <FaceCaption text={caption} hint={hint} busy={busy} />

        {/* Computer mode gets the full chat + footer chrome. */}
        {(
        <form
          className="flex w-full items-center gap-2 rounded-full border border-primary/25 bg-card/70 p-2 pl-5 shadow-[0_0_24px_rgba(var(--primary-rgb),0.10)] backdrop-blur-sm focus-within:border-primary/60"
          onSubmit={(e) => { e.preventDefault(); void handleSend(input); }}
        >
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={`Talk to ${bot}…`} aria-label={`Talk to ${bot}`} autoComplete="off" enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none" />

          {/* Mic on/off — always available; turning on grabs the mic if needed. */}
          {micSupported && (
            <button type="button" onClick={() => void toggleMic()}
              aria-label={micOn ? "Turn microphone off" : "Turn microphone on"} aria-pressed={micOn}
              title={micOn ? "Microphone on — tap to turn off" : "Microphone off — tap to turn on"}
              className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (listening ? "bg-primary/20 text-primary pulse-glow" : micOn ? "text-primary/70 hover:bg-primary/10 hover:text-primary" : "text-muted-foreground/50 hover:bg-primary/10")}>
              {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
          )}

          <button type="submit" disabled={!canSend} aria-label="Send" title="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </form>
        )}

        {/* small footer controls: history/memory + the collection (computer mode) */}
        {!robotMode && (
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setPanelOpen(true)}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open history and memory">
            <MessageSquare className="h-3 w-3" />
            history &amp; memory{mem.history.length ? ` · ${mem.history.length}` : ""}
          </button>
          <button type="button" onClick={() => setGalleryOpen(true)}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open the collection">
            <Sparkles className="h-3 w-3" />
            collection
          </button>
          <button type="button" onClick={() => setSkillsOpen(true)}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`What ${bot} can do`}>
            <LayoutGrid className="h-3 w-3" />
            what I can do
          </button>
        </div>
        )}
      </div>
      )}

      {galleryOpen && <FacesGallery onClose={() => setGalleryOpen(false)} />}

      {skillsOpen && (
        <CapabilitiesPanel
          onClose={() => setSkillsOpen(false)}
          onAsk={(text) => void handleSend(text)}
        />
      )}

      {settingsOpen && <BuddySettings onClose={() => setSettingsOpen(false)} onShowLink={robotMode ? (title, url, code, hint) => { setSettingsOpen(false); setOverlay({ kind: "link", src: url, caption: title, code, hint }); } : undefined} />}

      {/* history + memory panel */}
      {panelOpen && (
        <div className="absolute inset-0 z-20 flex justify-end bg-black/30 backdrop-blur-sm" onClick={() => setPanelOpen(false)}>
          <aside className="flex h-full w-full max-w-sm flex-col border-l border-primary/20 bg-card/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
              <div className="flex gap-1">
                <button onClick={() => setPanelTab("chat")}
                  className={"rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors " + (panelTab === "chat" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary")}>
                  Chat
                </button>
                <button onClick={() => setPanelTab("memory")}
                  className={"flex items-center gap-1 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors " + (panelTab === "memory" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary")}>
                  <Brain className="h-3 w-3" /> Memory
                </button>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" />
              </button>
            </header>

            {panelTab === "chat" ? (
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {mem.history.length === 0 ? (
                  <p className="pt-8 text-center text-sm text-muted-foreground">Nothing yet — say hello.</p>
                ) : mem.history.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                    <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">{m.role === "user" ? "You" : bot}</span>
                    <span className={"inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm " + (m.role === "user" ? "bg-primary/15 text-foreground" : "bg-muted/50 text-foreground")}>{m.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <p className="px-4 pt-3 text-xs text-muted-foreground">{memorySummary()}</p>
                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {mem.facts.length === 0 ? (
                    <p className="pt-6 text-center text-sm text-muted-foreground">
                      {bot} hasn't learned anything about you yet. Tell it something, or add a note below.
                    </p>
                  ) : mem.facts.map((f) => (
                    <div key={f.id} className="group flex items-start justify-between gap-2 rounded-lg border border-primary/10 bg-primary/[0.03] px-3 py-2">
                      <span className="text-sm text-foreground">{f.text}</span>
                      <button onClick={() => removeFact(f.id)} aria-label="Forget this"
                        className="mt-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <form className="flex gap-2 border-t border-primary/15 p-3"
                  onSubmit={(e) => { e.preventDefault(); if (newFact.trim()) { addFact(newFact.trim(), "user"); setNewFact(""); } }}>
                  <input value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Tell Nobi to remember something…"
                    className="min-w-0 flex-1 rounded-full border border-primary/20 bg-background/60 px-3 py-1.5 text-sm focus:border-primary/50 focus:outline-none" />
                  <button type="submit" className="rounded-full bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40" disabled={!newFact.trim()}>Add</button>
                </form>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
