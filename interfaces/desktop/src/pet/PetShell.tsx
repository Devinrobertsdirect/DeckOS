import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Mic, MicOff, Settings, MessageSquare, X, Brain, Trash2, Sparkles } from "lucide-react";
import { FacesGallery } from "@/collection/FacesGallery";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice } from "@/genesis/useAtlasVoice";
import { useAtlasListening } from "@/genesis/useAtlasListening";
import { getInputMode, setInputMode, acquireMic } from "@/genesis/micAccess";
import { getUserName, getBotName } from "@/lib/uiMode";
import { segmentReply, emojiGlyph, type EmotionSegment } from "@/genesis/emotionDirector";
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
  onOpenSettings,
}: {
  onOpenDeveloper: () => void;
  onOpenSettings: () => void;
}) {
  const bot = getBotName();
  const { speak } = useAtlasVoice();
  const mem = useAtlasMemory();

  const [faceState, setFaceState] = useState<FaceState>("idle");
  const [caption, setCaption] = useState("");
  const [eyeColor, setEyeColor] = useState<string | null>(null);
  const [discTint, setDiscTint] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveHeard, setLiveHeard] = useState("");
  const [micOn, setMicOn] = useState(() => getInputMode() === "voice");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"chat" | "memory">("chat");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [brain, setBrain] = useState<{ label: string; model: string; online: boolean } | null>(null);

  const busyRef = useRef(false);
  busyRef.current = busy;
  const cancelRef = useRef(false);

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
      await speak(seg.text);
    }
    drainingRef.current = false;
  }, [speak]);
  const waitForQueue = useCallback(async () => {
    while ((queueRef.current.length || drainingRef.current) && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }, []);

  // ── Talk to the brain (streaming) ───────────────────────────────────────────
  const handleSend = useCallback(
    async (raw: string) => {
      const message = raw.trim();
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
      appendTurn("user", message);
      ingestUserMessage(message);

      let full = "";
      let ok = false;
      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history: ctx.history, facts: ctx.facts }),
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
              full += obj.token;
              pending += obj.token;
              setCaption(full);
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
            body: JSON.stringify({ message, history: ctx.history, facts: ctx.facts }),
          });
          const data = (await res.json()) as { response?: string };
          full = (data.response ?? "").trim() || SERVER_DOWN_MSG;
          ok = res.ok && full !== SERVER_DOWN_MSG;
          setCaption(full);
          for (const seg of segmentReply(full)) queueRef.current.push(seg);
          void drainQueue();
        } catch {
          full = SERVER_DOWN_MSG; ok = false;
          setFaceState("confused"); setCaption(full);
          await speak(full);
        }
      }

      await waitForQueue();
      appendTurn("atlas", full);
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

  // ── Greeting, once per mount (warmer if it remembers you) ───────────────────
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
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

  useEffect(() => () => { cancelRef.current = true; }, []);

  const activity = activityFor(faceState);
  const canSend = input.trim().length > 0 && !busy;
  const hint = listening
    ? (liveHeard ? `“${liveHeard}”` : "Listening…")
    : `Ask ${bot} anything — I'm here whenever you're ready.`;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background px-6 py-10 text-foreground">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]"
        style={{ width: 520, height: 520, background: "radial-gradient(circle, rgba(var(--primary-rgb),0.16) 0%, transparent 62%)", filter: "blur(8px)" }} />

      {/* live brain indicator + memory summary (top-left) */}
      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1">
        <div className="flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/60 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-sm"
             title={brain ? `Active brain: ${brain.label} (${brain.model})` : "Detecting brain…"}>
          <span className={"inline-block h-1.5 w-1.5 rounded-full " + (brain?.online ? "bg-emerald-400" : "bg-amber-400")} />
          <span className="uppercase tracking-wider">{brain ? brain.label : "…"}</span>
          <span className="hidden text-muted-foreground/60 sm:inline">{brain?.model}</span>
        </div>
      </div>

      {/* corner controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button type="button" onClick={onOpenSettings} aria-label="Settings" title="Settings"
          className="rounded-full p-2 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Settings className="h-4 w-4" />
        </button>
        <button type="button" onClick={onOpenDeveloper} aria-label="Developer mode" title="Developer mode"
          className="rounded-full p-2 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Code2 className="h-4 w-4" />
        </button>
      </div>

      {/* the pet */}
      <div className="relative z-[1] flex w-full max-w-md flex-col items-center gap-7">
        <AtlasFace mode="auto" state={faceState} size={280} activity={activity}
          eyeColorOverride={eyeColor} discTint={discTint} emoji={emoji} />

        <p aria-live="polite" className="min-h-[3.25rem] w-full text-center text-xl font-medium leading-snug text-foreground sm:text-2xl">
          {caption || <span className="text-base font-normal text-muted-foreground sm:text-lg">{hint}</span>}
        </p>

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

        {/* small footer controls: history/memory + the collection */}
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
        </div>
      </div>

      {galleryOpen && <FacesGallery onClose={() => setGalleryOpen(false)} />}

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
                  <input value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Tell Atlas to remember something…"
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
