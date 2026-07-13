import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Mic, Settings } from "lucide-react";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice } from "@/genesis/useAtlasVoice";
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

// ── Minimal Web Speech API surface (not in the DOM lib) ──────────────────────
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
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
  const [listening, setListening] = useState(false);

  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const gotResultRef = useRef(false);
  const micSupported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  // ── Talk to the brain ──────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;

      setInput("");
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
    [busy, speak],
  );

  // ── Greeting, once per mount ────────────────────────────────────────────────
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    const name = getUserName().trim();
    const hello = name ? `Hi ${name}!` : "Hi there!";
    setFaceState("happy");
    setCaption(hello);
    void speak(hello).finally(() => setFaceState("idle"));
  }, [speak]);

  // ── Voice input (optional, degrades to text-only) ───────────────────────────
  const stopMic = useCallback(() => {
    try {
      recogRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const startMic = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || busy) return;

    const recog = new Ctor();
    recogRef.current = recog;
    gotResultRef.current = false;
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.continuous = false;

    recog.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        gotResultRef.current = true;
        void handleSend(transcript);
      }
    };
    recog.onerror = () => {
      setListening(false);
      setFaceState((s) => (s === "listening" ? "idle" : s));
    };
    recog.onend = () => {
      setListening(false);
      if (!gotResultRef.current) {
        setFaceState((s) => (s === "listening" ? "idle" : s));
      }
    };

    setListening(true);
    setFaceState("listening");
    try {
      recog.start();
    } catch {
      setListening(false);
      setFaceState("idle");
    }
  }, [busy, handleSend]);

  const toggleMic = useCallback(() => {
    if (listening) stopMic();
    else startMic();
  }, [listening, startMic, stopMic]);

  // Stop recognition if the shell unmounts.
  useEffect(() => () => stopMic(), [stopMic]);

  const activity = activityFor(faceState);
  const canSend = input.trim().length > 0 && !busy;
  const hint = listening
    ? "Listening…"
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

          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={busy}
              aria-label={listening ? "Stop listening" : "Talk with your voice"}
              aria-pressed={listening}
              title={listening ? "Stop listening" : "Talk with your voice"}
              className={
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 " +
                (listening
                  ? "bg-primary/20 text-primary pulse-glow"
                  : "text-muted-foreground hover:bg-primary/10 hover:text-primary")
              }
            >
              <Mic className="h-5 w-5" />
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
