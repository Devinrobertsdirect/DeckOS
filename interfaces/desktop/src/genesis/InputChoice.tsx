import { useEffect, useRef, useState } from "react";
import { Keyboard, Mic } from "lucide-react";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice } from "@/genesis/useAtlasVoice";
import { getUserName } from "@/lib/uiMode";
import { acquireMic, hasMicDevice, setInputMode } from "@/genesis/micAccess";

/**
 * Right after the intro, Atlas asks a single binary question out loud —
 * "Would you rather talk to me, or type?" — and the answer is what triggers the
 * mic permission request. We probe for a mic on mount (no prompt) so on a robot,
 * where there's no permission barrier, "Talk" just works instantly.
 */
export function InputChoice({ onComplete }: { onComplete: () => void }) {
  const { speak, stop } = useAtlasVoice();
  const [faceState, setFaceState] = useState<FaceState>("happy");
  const [micPresent, setMicPresent] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const askedRef = useRef(false);

  const who = getUserName().trim();

  useEffect(() => {
    // Probe for a mic without prompting, and voice the question once.
    void hasMicDevice().then(setMicPresent);
    if (askedRef.current) return;
    askedRef.current = true;
    const q = who
      ? `So ${who}, would you rather talk to me out loud, or type? You can change this any time.`
      : `Would you rather talk to me out loud, or type? You can change this any time.`;
    setFaceState("talking");
    void speak(q).finally(() => setFaceState("listening"));
    return () => stop();
  }, [speak, stop, who]);

  async function chooseTalk() {
    if (busy) return;
    setBusy(true);
    setStatus("Looking for a microphone…");
    setFaceState("thinking");
    const res = await acquireMic();
    if (res.granted) {
      setInputMode("voice");
      setFaceState("excited");
      setStatus("");
      await speak("Great — I'm listening. Just talk to me whenever you're ready.");
      onComplete();
      return;
    }
    // Couldn't get the mic — be gentle and let them type instead.
    setFaceState("confused");
    const msg =
      res.reason === "denied"
        ? "No problem — it looks like microphone access was blocked. You can type to me for now and enable the mic later in Settings."
        : "I couldn't find a microphone, so let's type for now. You can switch to voice any time in Settings.";
    setStatus(msg);
    setInputMode("text");
    await speak(msg);
    setBusy(false);
  }

  function chooseType() {
    if (busy) return;
    setInputMode("text");
    stop();
    onComplete();
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 55,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "clamp(1.5rem, 4vh, 2.5rem)",
        background: "radial-gradient(120% 120% at 50% 35%, #16222e 0%, #0c1219 60%, #080b10 100%)",
        color: "#dbe6f2", padding: "2rem", textAlign: "center", userSelect: "none",
      }}
    >
      <AtlasFace mode="atlas" state={faceState} size={Math.min(240, typeof window !== "undefined" ? window.innerWidth * 0.6 : 240)} activity={0.3} />

      <h1 style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)", fontWeight: 300, margin: 0 }}>
        How would you like to talk with me?
      </h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "center" }}>
        <button
          onClick={chooseTalk}
          disabled={busy}
          style={choiceStyle("#4A7FB5")}
        >
          <Mic style={{ width: 28, height: 28 }} />
          <span style={{ fontSize: "1.1rem", fontWeight: 600 }}>Talk to me</span>
          <span style={{ fontSize: "0.78rem", opacity: 0.7 }}>
            {micPresent === false ? "No mic detected" : "Hands-free — just speak"}
          </span>
        </button>

        <button
          onClick={chooseType}
          disabled={busy}
          style={choiceStyle("#2a3a4a")}
        >
          <Keyboard style={{ width: 28, height: 28 }} />
          <span style={{ fontSize: "1.1rem", fontWeight: 600 }}>Type to me</span>
          <span style={{ fontSize: "0.78rem", opacity: 0.7 }}>Use the keyboard</span>
        </button>
      </div>

      {status && (
        <p style={{ maxWidth: "32rem", fontSize: "0.9rem", opacity: 0.75, minHeight: "2.5rem" }}>
          {status}
        </p>
      )}

      {status && !busy && (
        <button
          onClick={onComplete}
          style={{
            background: "transparent", border: "1px solid rgba(201,220,240,0.3)", color: "#dbe6f2",
            padding: "0.6rem 1.4rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.9rem",
          }}
        >
          Continue →
        </button>
      )}
    </div>
  );
}

function choiceStyle(bg: string): React.CSSProperties {
  return {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem",
    width: "13rem", padding: "1.5rem 1rem", borderRadius: "1rem",
    background: bg, color: "#fff", border: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer", transition: "transform 0.15s ease, filter 0.15s ease",
  };
}
