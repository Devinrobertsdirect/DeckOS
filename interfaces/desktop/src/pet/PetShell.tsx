import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Mic, MicOff, Settings, MessageSquare, X, Brain, Trash2, Sparkles, LayoutGrid } from "lucide-react";
import { FacesGallery } from "@/collection/FacesGallery";
import { CapabilitiesPanel } from "@/pet/CapabilitiesPanel";
import { BuddySettings } from "@/pet/BuddySettings";
import { FaceCaption } from "@/pet/FaceCaption";
import { YouTubeOverlay, type VideoHandle } from "@/components/YouTubeOverlay";
import { ContentOverlay } from "@/components/ContentOverlay";
import SurvivorOverlay from "@/components/SurvivorOverlay";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice, nudgeVoiceRate, setVoiceEngine } from "@/genesis/useAtlasVoice";
import { useLatestEvent } from "@/contexts/WebSocketContext";
import { useAtlasListening } from "@/genesis/useAtlasListening";
import { useWake } from "@/hooks/useWake";
import { getInputMode, setInputMode, acquireMic } from "@/genesis/micAccess";
import { getUserName, getBotName, setExperienceMode } from "@/lib/uiMode";
import { applyClientAction, type UiAction } from "@/pet/agentActions";
import { mirrorFace } from "@/lib/hardwareFace";
import { segmentReply, emojiGlyph, type EmotionSegment } from "@/genesis/emotionDirector";
import { personaPrompt, getPersona } from "@/genesis/personality";
import ShowcaseOverlay, { type ShowcaseScene } from "@/pet/ShowcaseOverlay";
import { sfx, sfxForScene } from "@/pet/showSfx";
import {
  buildDemoScript, buildPitchScript, meetDirectorNote, meetDetectBeats, guessName, line, asPersona,
  TRICK_MOODS, TRICK_TADA, type AskSpec, type MeetCtx, type Persona,
} from "@/pet/showScripts";
import { stripEmoji } from "@/lib/stripText";
import { dockLines } from "@/genesis/dockGreetings";
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
function personaVoiceId(): string | undefined {
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
  const [overlay, setOverlay] = useState<{ kind: "image" | "tutorial"; src: string; caption?: string } | null>(null);
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
  const setEarsMuted = (on: boolean) =>
    fetch("/api/voice/mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).catch(() => { /* no sidecar here */ });
  // Dev/test hook: drive the stage directly (window.__nobiScene("bowl")).
  useEffect(() => {
    (window as unknown as { __nobiScene?: (s: ShowcaseScene | null) => void }).__nobiScene = (s) => setShowcaseScene(s);
  }, []);
  // Sound design: every scene change plays its cue (showSfx.ts); looping cues
  // (the gears' ticking) stop when the scene moves on.
  useEffect(() => {
    const stop = sfxForScene(showcaseScene);
    return () => { stop?.(); };
  }, [showcaseScene]);
  /** Stage backdrop for a "meet someone" turn: sparkle to greet, hearts to say goodbye, the orb ring in between. */
  const meetStage = (m: MeetCtx): ShowcaseScene => (m.wrap ? "hearts" : m.step === 0 ? "sparkle" : "faces");
  /** The face trick: rapid moods under a spinning rainbow ring, then confetti. */
  const runTrick = useCallback(async () => {
    setShowcaseScene("trick");
    for (const [m, col] of TRICK_MOODS) { if (cancelRef.current) break; demoMood(m, col); await demoSleep(650); }
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
    if (ask.branch === "joke-or-trick" && /\b(trick|dance|spin|move|face|show|do (it|one|the trick))\b/i.test(answer) && !/\bjoke\b/i.test(answer)) {
      await runTrick(); await sayDirect(tada); appendTurn("atlas", tada);
      return;
    }
    setFaceState("thinking");
    setShowcaseScene("gears");   // visible "thinking" while the brain works
    // The brain sees ONLY this exchange: the question Nobi just asked and the
    // answer, in a session of its own. With the normal history the last user
    // turn is "give us a quick demo" and the model dutifully starts a tour
    // ("Hey Devin. Quick tour, coming up…") instead of reacting to the answer.
    const ctx = buildContext();   // only .facts is used — no chat history goes out
    const director = `You are in the middle of a live stage show and just asked: "${line(ask.say, p)}". ${ask.director} Never offer a tour, a demo, or a list of what you can do — the show is already running.`;
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
    if (!reply) reply = line(ask.fallback, p);
    setShowcaseScene(stage);
    appendTurn("atlas", reply);
    await sayQueued(reply);
  }, [runTrick]);
  const runShow = useCallback(async (kind: "demo" | "pitch") => {
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
    const script = kind === "demo" ? buildDemoScript(getBotName(), p) : buildPitchScript(getBotName(), p);
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
        const remaining = beat.holdMs - (performance.now() - beatStart);
        if (remaining > 0) await demoSleep(remaining);
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
      if (meetRef.current && meetRef.current.step > 0) {
        const m = meetRef.current;
        if (m.step >= 6 || /\b(bye|goodbye|see you|gotta go|got to go|later|nice (to |ta )?meet(ing)? you|good ?night)\b/i.test(message)) m.wrap = true;
        if (!m.personName) { const g = guessName(message); if (g) m.personName = g; }
      }
      const personaSent = meetRef.current ? persona + meetDirectorNote(meetRef.current) : persona;
      // A meet is a stage show too: gears while he thinks, then a backdrop for
      // the turn (sparkle to greet, orb ring mid-conversation, hearts goodbye).
      const meetTurn = meetRef.current;
      if (meetTurn) { sfx.prime(); setShowcaseScene("gears"); }
      let staged = false;
      const stageMeet = () => { if (meetTurn && !staged) { staged = true; setShowcaseScene(meetStage(meetTurn)); } };
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
      if (meetTurn) setShowcaseScene(meetRef.current ? "faces" : null);
      setFaceState("idle");
      clearMood();
      setBusy(false);
    },
    [drainQueue, waitForQueue, speak],
  );

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
  const voiceHeardEv = useLatestEvent("voice.heard");
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
        <ContentOverlay kind={overlay.kind} src={overlay.src} caption={overlay.caption} onClose={() => setOverlay(null)} />
      )}
      {showcaseScene && (
        <ShowcaseOverlay scene={showcaseScene} label={bot.toUpperCase()} onSkip={skipShow} />
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
            <AtlasFace mode="auto" state={faceState} size={faceFill} bare activity={activity}
              eyeColorOverride={eyeColor} discTint={discTint} emoji={emoji} />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-[63%] flex justify-center px-10">
            <FaceCaption text={caption} hint={hint} busy={busy} />
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

      {settingsOpen && <BuddySettings onClose={() => setSettingsOpen(false)} />}

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
