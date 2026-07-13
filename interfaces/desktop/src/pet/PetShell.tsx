import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Mic, MicOff, Settings } from "lucide-react";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice } from "@/genesis/useAtlasVoice";
import { useAtlasListening } from "@/genesis/useAtlasListening";
import { getInputMode } from "@/genesis/micAccess";
import { getUserName } from "@/lib/uiMode";

/**
 * PetShell — the DEFAULT Atlas experience.
 *
 * A super-computer pet you just talk to: one big face, one friendly input,
 * almost no chrome. Built for a kid, a grandparent, anyone non-technical.
 * The gear (settings) and developer toggle sit tiny and low-contrast in the
 * corner so they stay out of the way.
 *
 * Local face state machine:
 *   idle      → quiet, gentle breathing (activity 0.15)
 *   listening → mic is open
 *   thinking  → waiting on the brain (activity 0.9)
 *   talking   → speaking the reply
 *   happy     → greeting / success
 *   confused  → couldn't reach the server
 */

const SERVER_DOWN_MSG =
  "I can't reach my brain right now — is the server running?";

/** How hard the face looks like it's working, per state (0..1). */
function activityFor(state: FaceState): number {
  switch (state) {
    case "thinking":
      return 0.9;
    case "talking":
      return 0.65;
    case "listening":
      return 0.5;
    case "happy":
    case "excited":
      return 0.5;
    case "confused":
      return 0.3;
    default:
      return 0.15;
  }
}

export function PetShell({
  onOpenDeveloper,
  onOpenSettings,
}: {
  onOpenDeveloper: () => void;
  onOpenSettings: () => void;
}) {
  const { speak } = useAtlasVoice();

  const [faceState, setFaceState] = useState<FaceState>("idle");
  const [caption, setCaption] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveHeard, setLiveHeard] = useState("");
  const [muted, setMuted] = useState(false);

  // Voice mode is chosen in the Type-or-Talk gate. When on, Atlas listens
  // hands-free with semantic endpointing; text input always stays available.
  const voiceMode = getInputMode() === "voice";
  const busyRef = useRef(false);
  busyRef.current = busy;

  // ── Talk to the brain ──────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busyRef.current) return;

      setInput("");
      setLiveHeard("");
      setBusy(true);
      setCaption("");
      setFaceState("thinking");

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

      setFaceState(ok ? "talking" : "confused");
      setCaption(reply);
      try {
        await speak(reply);
      } finally {
        setFaceState("idle");
        setBusy(false);
      }
    },
    [speak],
  );

  // ── Hands-free listening (semantic turn detection) ──────────────────────────
  // Deaf while thinking/speaking so Atlas never hears itself.
  const { supported: micSupported, listening } = useAtlasListening({
    enabled: voiceMode && !muted,
    paused: busy,
    onUtterance: (text) => { void handleSend(text); },
    onInterim: (text) => setLiveHeard(text),
  });

  // Reflect listening in the face when otherwise idle.
  useEffect(() => {
    if (busy) return;
    setFaceState((s) => (listening ? "listening" : s === "listening" ? "idle" : s));
  }, [listening, busy]);

  // ── Greeting, once per mount ────────────────────────────────────────────────
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    const name = getUserName().trim();
    const hello = name
      ? (voiceMode ? `Hi ${name}! I'm listening — just talk to me.` : `Hi ${name}! What can I do for you?`)
      : "Hi there!";
    setBusy(true);
    setCaption(hello);
    setFaceState("happy");
    void speak(hello).finally(() => { setFaceState("idle"); setBusy(false); });
  }, [speak, voiceMode]);

  const activity = activityFor(faceState);
  const canSend = input.trim().length > 0 && !busy;
  const hint = listening
    ? (liveHeard ? `“${liveHeard}”` : "Listening…")
    : voiceMode && muted
      ? "Muted — tap the mic to listen again."
      : "Ask me anything — I'm here whenever you're ready.";

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background px-6 py-10 text-foreground">
      {/* soft glow behind the face */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]"
        style={{
          width: 520,
          height: 520,
          background:
            "radial-gradient(circle, rgba(var(--primary-rgb),0.16) 0%, transparent 62%)",
          filter: "blur(8px)",
        }}
      />

      {/* tiny, low-contrast corner controls — kids ignore these */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className="rounded-full p-2 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenDeveloper}
          aria-label="Developer mode"
          title="Developer mode"
          className="rounded-full p-2 text-muted-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Code2 className="h-4 w-4" />
        </button>
      </div>

      {/* the pet */}
      <div className="relative z-[1] flex w-full max-w-md flex-col items-center gap-7">
        <AtlasFace mode="auto" state={faceState} size={280} activity={activity} />

        {/* what Atlas is saying */}
        <p
          aria-live="polite"
          className="min-h-[3.25rem] w-full text-center text-xl font-medium leading-snug text-foreground sm:text-2xl"
        >
          {caption || (
            <span className="text-base font-normal text-muted-foreground sm:text-lg">
              {hint}
            </span>
          )}
        </p>

        {/* one friendly input */}
        <form
          className="flex w-full items-center gap-2 rounded-full border border-primary/25 bg-card/70 p-2 pl-5 shadow-[0_0_24px_rgba(var(--primary-rgb),0.10)] backdrop-blur-sm focus-within:border-primary/60"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend(input);
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Talk to Atlas…"
            aria-label="Talk to Atlas"
            autoComplete="off"
            enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />

          {voiceMode && micSupported && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Resume listening" : "Mute microphone"}
              aria-pressed={!muted}
              title={muted ? "Resume listening" : "Mute microphone"}
              className={
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (listening
                  ? "bg-primary/20 text-primary pulse-glow"
                  : muted
                    ? "text-muted-foreground/50 hover:bg-primary/10"
                    : "text-primary/70 hover:bg-primary/10 hover:text-primary")
              }
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
          )}

          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            title="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowUp className="h-5 w-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
