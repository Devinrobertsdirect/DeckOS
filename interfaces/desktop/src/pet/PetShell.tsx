import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Mic, MicOff, Settings, MessageSquare, X } from "lucide-react";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice } from "@/genesis/useAtlasVoice";
import { useAtlasListening } from "@/genesis/useAtlasListening";
import { getInputMode } from "@/genesis/micAccess";
import { getUserName, getBotName } from "@/lib/uiMode";
import { segmentReply } from "@/genesis/emotionDirector";

/**
 * PetShell — the DEFAULT Atlas experience.
 *
 * A super-computer pet you just talk to: one big face, one friendly input,
 * almost no chrome. Atlas *acts* while it speaks — its eyes go red and slanted
 * when it's angry, dart when it's being sneaky, arc up when it's happy — driven
 * by the emotion director reading each reply. Hands-free voice with a mic
 * on/off toggle, a live "which brain am I using" indicator, and a tiny button
 * that expands the chat history.
 */

const SERVER_DOWN_MSG = "I can't reach my brain right now — is the server running?";

/** How hard the face looks like it's working, per state (0..1). */
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

interface ChatEntry { role: "you" | "atlas"; text: string }
interface Brain { label: string; model: string; online: boolean }

export function PetShell({
  onOpenDeveloper,
  onOpenSettings,
}: {
  onOpenDeveloper: () => void;
  onOpenSettings: () => void;
}) {
  const bot = getBotName();
  const { speak, stop } = useAtlasVoice();

  const [faceState, setFaceState] = useState<FaceState>("idle");
  const [caption, setCaption] = useState("");
  const [eyeColor, setEyeColor] = useState<string | null>(null);
  const [discTint, setDiscTint] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveHeard, setLiveHeard] = useState("");
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [brain, setBrain] = useState<Brain | null>(null);

  const voiceMode = getInputMode() === "voice";
  const busyRef = useRef(false);
  busyRef.current = busy;
  const cancelRef = useRef(false);

  const clearMood = () => { setEyeColor(null); setDiscTint(null); };

  // ── Speak a reply, acting it out emotion-segment by segment ─────────────────
  const speakReply = useCallback(async (reply: string, ok: boolean) => {
    setCaption(reply);
    if (!ok) {
      setFaceState("confused"); clearMood();
      await speak(reply);
      return;
    }
    const segs = segmentReply(reply);
    for (const seg of segs) {
      if (cancelRef.current) break;
      setFaceState(seg.style.expression);
      setEyeColor(seg.style.eyeColor);
      setDiscTint(seg.style.discTint);
      await speak(seg.text);
    }
    clearMood();
  }, [speak]);

  // ── Talk to the brain ──────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busyRef.current) return;

      cancelRef.current = false;
      setInput("");
      setLiveHeard("");
      setBusy(true);
      setCaption("");
      setFaceState("thinking");
      setHistory((h) => [...h, { role: "you", text: message }]);

      let reply = "";
      let ok = false;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok) throw new Error(`chat ${res.status}`);
        const data = (await res.json()) as { response?: string };
        reply = (data.response ?? "").trim() || "Hmm, I'm not sure what to say.";
        ok = true;
      } catch {
        reply = SERVER_DOWN_MSG;
        ok = false;
      }

      setHistory((h) => [...h, { role: "atlas", text: reply }]);
      try {
        await speakReply(reply, ok);
      } finally {
        setFaceState("idle");
        clearMood();
        setBusy(false);
      }
    },
    [speakReply],
  );

  // ── Hands-free listening (semantic turn detection) ──────────────────────────
  const { supported: micSupported, listening } = useAtlasListening({
    enabled: voiceMode && !muted,
    paused: busy,
    onUtterance: (text) => { void handleSend(text); },
    onInterim: (text) => setLiveHeard(text),
  });

  useEffect(() => {
    if (busy) return;
    setFaceState((s) => (listening ? "listening" : s === "listening" ? "idle" : s));
  }, [listening, busy]);

  // ── Live "which brain am I using" detection ─────────────────────────────────
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/ai-router/status");
        if (!r.ok) throw new Error();
        const d = (await r.json()) as {
          claudeAvailable?: boolean; ollamaAvailable?: boolean; activeModel?: string;
          models?: { apex?: string; cortex?: string };
        };
        const online = !!(d.claudeAvailable || d.ollamaAvailable);
        const label = d.claudeAvailable ? "Claude" : d.ollamaAvailable ? "Local" : "Rules";
        const model = d.activeModel || d.models?.apex || d.models?.cortex || "rule engine";
        if (alive) setBrain({ label, model, online });
      } catch {
        if (alive) setBrain({ label: "Offline", model: "—", online: false });
      }
    };
    void poll();
    const id = window.setInterval(poll, 6000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // ── Greeting, once per mount ────────────────────────────────────────────────
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    const name = getUserName().trim();
    const hello = name
      ? (voiceMode ? `Hi ${name}! I'm listening — just talk to me.` : `Hi ${name}! What can I do for you?`)
      : `Hi there! I'm ${bot}.`;
    setBusy(true);
    setCaption(hello);
    setFaceState("happy");
    void speak(hello).finally(() => { setFaceState("idle"); setBusy(false); });
  }, [speak, voiceMode, bot]);

  useEffect(() => () => { cancelRef.current = true; stop(); }, [stop]);

  const activity = activityFor(faceState);
  const canSend = input.trim().length > 0 && !busy;
  const hint = listening
    ? (liveHeard ? `“${liveHeard}”` : "Listening…")
    : voiceMode && muted
      ? "Muted — tap the mic to listen again."
      : `Ask ${bot} anything — I'm here whenever you're ready.`;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background px-6 py-10 text-foreground">
      {/* soft glow behind the face */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]"
        style={{ width: 520, height: 520, background: "radial-gradient(circle, rgba(var(--primary-rgb),0.16) 0%, transparent 62%)", filter: "blur(8px)" }}
      />

      {/* live brain indicator (top-left) — Atlas detects which API it has */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/60 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-sm"
           title={brain ? `Active brain: ${brain.label} (${brain.model})` : "Detecting brain…"}>
        <span className={"inline-block h-1.5 w-1.5 rounded-full " + (brain?.online ? "bg-emerald-400" : "bg-amber-400")} />
        <span className="uppercase tracking-wider">{brain ? brain.label : "…"}</span>
        <span className="hidden text-muted-foreground/60 sm:inline">{brain?.model}</span>
      </div>

      {/* tiny, low-contrast corner controls */}
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
          eyeColorOverride={eyeColor} discTint={discTint} />

        <p aria-live="polite" className="min-h-[3.25rem] w-full text-center text-xl font-medium leading-snug text-foreground sm:text-2xl">
          {caption || <span className="text-base font-normal text-muted-foreground sm:text-lg">{hint}</span>}
        </p>

        {/* one friendly input */}
        <form
          className="flex w-full items-center gap-2 rounded-full border border-primary/25 bg-card/70 p-2 pl-5 shadow-[0_0_24px_rgba(var(--primary-rgb),0.10)] backdrop-blur-sm focus-within:border-primary/60"
          onSubmit={(e) => { e.preventDefault(); void handleSend(input); }}
        >
          <input
            type="text" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={`Talk to ${bot}…`} aria-label={`Talk to ${bot}`}
            autoComplete="off" enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />

          {voiceMode && micSupported && (
            <button
              type="button" onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Turn microphone on" : "Turn microphone off"} aria-pressed={!muted}
              title={muted ? "Microphone is off — tap to turn on" : "Microphone is on — tap to turn off"}
              className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (listening ? "bg-primary/20 text-primary pulse-glow" : muted ? "text-muted-foreground/50 hover:bg-primary/10" : "text-primary/70 hover:bg-primary/10 hover:text-primary")}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
          )}

          <button
            type="submit" disabled={!canSend} aria-label="Send" title="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </form>

        {/* very small open-history button */}
        <button
          type="button" onClick={() => setHistoryOpen(true)}
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open chat history"
        >
          <MessageSquare className="h-3 w-3" />
          history{history.length ? ` · ${history.length}` : ""}
        </button>
      </div>

      {/* chat history panel */}
      {historyOpen && (
        <div className="absolute inset-0 z-20 flex justify-end bg-black/30 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
          <aside
            className="flex h-full w-full max-w-sm flex-col border-l border-primary/20 bg-card/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
              <h2 className="font-mono text-xs uppercase tracking-widest text-primary/70">Chat history</h2>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {history.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">Nothing yet — say hello.</p>
              ) : history.map((m, i) => (
                <div key={i} className={m.role === "you" ? "text-right" : "text-left"}>
                  <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    {m.role === "you" ? "You" : bot}
                  </span>
                  <span className={"inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm " +
                    (m.role === "you" ? "bg-primary/15 text-foreground" : "bg-muted/50 text-foreground")}>
                    {m.text}
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
