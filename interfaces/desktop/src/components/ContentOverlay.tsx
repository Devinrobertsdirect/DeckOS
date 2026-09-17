import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";

/**
 * ContentOverlay — a full-screen layer over the face for rich content the voice
 * skills summon: a generated image ("draw me a fox") or the animated tutorial
 * ("tutorial mode"). Mirrors the YouTubeOverlay pattern. Cover-sized so it fills
 * the round robot screen; a close control and "close the image/tutorial" voice
 * command both dismiss it.
 */
export interface ContentOverlayProps {
  /** "link": a QR card (phone pairing, the shop) — `src` is the URL, `caption` the title. */
  kind: "image" | "tutorial" | "link";
  src: string;
  caption?: string;
  /** link only: a pairing code to show under the QR. */
  code?: string;
  /** link only: one short line of guidance. */
  hint?: string;
  onClose: () => void;
}

/** QR as an SVG path (zero-dependency encoder; fits the round screen at ~200px). */
function qrSvg(url: string): string {
  try {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch { return ""; }
}

/**
 * The QR is a physical thing in Nobi's world: he rolls up to it, ducks behind
 * it, then leans out from the edge and glances at it so you look where he looks.
 *
 * He is painted BEHIND the card and never travels far enough to overlap it —
 * a robot standing on top of the code would stop a phone reading it, which
 * would defeat the whole point of showing it.
 */
const PEEK_CSS = `
/* Act 1 (once): roll in from the left with a little squash on landing, duck behind the card.
   Act 2 (loops, 16s): peek right and glance at the code; duck; pop out LEFT for the
   surprise; duck; come back right, hop, go wide-eyed at you, then nod at the code twice
   and squint happily. Every stop is a spot the card fully covers or fully clears —
   he is never in front of it. */
@keyframes nobiRollUp {
  0%   { transform: translate(-230px, 0) rotate(-14deg); opacity: 0 }
  14%  { opacity: 1 }
  46%  { transform: translate(-8px, 0) rotate(7deg) scale(1, 1) }
  54%  { transform: translate(0, 4px) rotate(0deg) scale(1.08, .9) }
  62%  { transform: translate(0, 0) rotate(0deg) scale(.97, 1.04) }
  70%  { transform: translate(0, 0) rotate(0deg) scale(1, 1) }
  100% { transform: translate(126px, 0) rotate(0deg) }
}
@keyframes nobiTour {
  0%, 17%  { transform: translate(126px, 0) }
  22%, 28% { transform: translate(0, 0) }
  34%, 48% { transform: translate(-126px, 0) }
  54%, 60% { transform: translate(0, 0) }
  66%      { transform: translate(126px, 0) }
  70%      { transform: translate(126px, -14px) }
  73%      { transform: translate(126px, 0) scale(1.06, .94) }
  76%, 100%{ transform: translate(126px, 0) scale(1, 1) }
}
/* lean toward the card from whichever side he is on; a firm nod at 86-92% */
@keyframes nobiLean {
  0%, 5%   { transform: rotate(0deg) }
  10%, 15% { transform: rotate(-5deg) }
  17%, 34% { transform: rotate(0deg) }
  40%, 46% { transform: rotate(5deg) }
  48%, 82% { transform: rotate(0deg) }
  86%      { transform: rotate(-7deg) }
  89%      { transform: rotate(0deg) }
  92%      { transform: rotate(-7deg) }
  95%,100% { transform: rotate(0deg) }
}
/* eyes: glance at the code (toward it), look at you wide, nod, happy squint */
@keyframes nobiEyes {
  0%, 5%   { transform: translate(0, 0) scale(1, 1) }
  9%, 15%  { transform: translate(-2.6px, 0) scale(1, 1) }
  17%, 36% { transform: translate(0, 0) scale(1, 1) }
  40%, 46% { transform: translate(2.6px, 0) scale(1, 1) }
  48%, 68% { transform: translate(0, 0) scale(1, 1) }
  70%, 78% { transform: translate(0, -1px) scale(1.12, 1.28) }
  82%      { transform: translate(0, 0) scale(1, 1) }
  86%      { transform: translate(-2px, 2px) scale(1, .9) }
  89%      { transform: translate(0, 0) scale(1, 1) }
  92%      { transform: translate(-2px, 2px) scale(1, .9) }
  95%, 99% { transform: translate(0, 1px) scale(1.1, .5) }
  100%     { transform: translate(0, 0) scale(1, 1) }
}
@keyframes nobiBlink { 0%, 93%, 100% { transform: scaleY(1) } 96% { transform: scaleY(.08) } }
@keyframes nobiSeam { 0%, 100% { opacity: .85 } 50% { opacity: .45 } }
.nobi-travel { animation: nobiRollUp 2.1s cubic-bezier(.22,.9,.3,1.05) both, nobiTour 16s 2.1s ease-in-out infinite; }
.nobi-lean   { animation: nobiLean 16s 2.1s ease-in-out infinite; transform-origin: 50% 100%; }
.nobi-eyes   { animation: nobiEyes 16s 2.1s ease-in-out infinite; transform-origin: 34px 36px; transform-box: view-box; }
.nobi-eyes rect { animation: nobiBlink 4.7s 2.1s infinite; transform-origin: 50% 50%; transform-box: fill-box; }
.nobi-seam   { animation: nobiSeam 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .nobi-travel { animation: none; transform: translateX(126px) }
  .nobi-lean, .nobi-eyes, .nobi-eyes rect, .nobi-seam { animation: none }
}`;

function PeekingNobi({ accent }: { accent: string }) {
  return (
    <div aria-hidden className="nobi-travel" style={{ position: "absolute", left: "50%", bottom: -6, marginLeft: -34, width: 68, zIndex: 0, pointerEvents: "none" }}>
      <div className="nobi-lean">
        <svg viewBox="0 0 68 92" style={{ display: "block", width: "100%", height: "auto", filter: "drop-shadow(0 8px 18px rgba(0,0,0,.55))" }}>
          <path d="M8 84 L8 34 Q8 6 34 6 Q60 6 60 34 L60 84 Z" fill="#eef2f9" stroke="#0b1220" strokeWidth="2.4" />
          <path d="M14 78 L14 36 Q14 14 30 10" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
          <circle cx="34" cy="36" r="19" fill="#1a2433" stroke="#0b1220" strokeWidth="1.6" />
          <g className="nobi-eyes" fill={accent}>
            <rect x="24" y="28" width="6.5" height="16" rx="3.25" />
            <rect x="37.5" y="28" width="6.5" height="16" rx="3.25" />
          </g>
          <g fill="#0b1220" opacity=".65">
            <circle cx="27" cy="64" r="1.5" /><circle cx="31" cy="65.5" r="1.5" /><circle cx="35" cy="66" r="1.5" />
            <circle cx="39" cy="65.5" r="1.5" /><circle cx="43" cy="64" r="1.5" />
          </g>
          <rect className="nobi-seam" x="10" y="80" width="48" height="4" rx="2" fill={accent} opacity=".85" />
        </svg>
      </div>
    </div>
  );
}

export function ContentOverlay({ kind, src, caption, code, hint, onClose }: ContentOverlayProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const svg = useMemo(() => (kind === "link" ? qrSvg(src) : ""), [kind, src]);

  if (kind === "link") {
    return (
      <div onClick={onClose} role="presentation" style={{ position: "fixed", inset: 0, zIndex: 40, background: "#05070f", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{PEEK_CSS}</style>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", maxWidth: 360 }}>
          <div style={{ color: "#c9dcf0", fontSize: 13, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600 }}>{caption ?? "Scan me"}</div>
          {/* the robot lives in this box too, behind the card — see PeekingNobi */}
          <div style={{ position: "relative", width: 196, height: 196 }}>
            <PeekingNobi accent={code ? "#f5b83d" : "#c9dcf0"} />
            <div style={{ position: "relative", zIndex: 1, width: 196, height: 196, background: "#fff", borderRadius: 18, padding: 12, boxShadow: "0 0 0 6px rgba(201,220,240,.12), 0 20px 60px rgba(0,0,0,.6)" }}
              dangerouslySetInnerHTML={{ __html: svg.replace("<svg", '<svg style="width:100%;height:100%;display:block"') }} />
          </div>
          {code && <div style={{ color: "#f5b83d", fontFamily: "ui-monospace,Menlo,Consolas,monospace", fontSize: 26, letterSpacing: ".28em", fontWeight: 700, marginTop: 2 }}>{code}</div>}
          <div style={{ color: "#eaf1ff", fontSize: 13, wordBreak: "break-all", opacity: .9 }}>{src.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}</div>
          {hint && <div style={{ color: "#9fb2d6", fontSize: 12 }}>{hint}</div>}
        </div>
        <button aria-label="Close" onClick={onClose} style={closeBtn}>×</button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "#05070f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {kind === "image" ? (
        <>
          <img
            src={src}
            alt={caption ?? "generated image"}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: loaded ? 1 : 0,
              transition: "opacity .5s ease",
            }}
          />
          {!loaded && !failed && (
            <div style={spinnerWrap}>
              <div style={spinner} />
              <div style={{ color: "#9fb2d6", fontSize: 14 }}>
                {caption ? `Painting “${caption}”…` : "Painting…"}
              </div>
            </div>
          )}
          {failed && (
            <div style={{ ...spinnerWrap, color: "#9fb2d6", fontSize: 14 }}>
              Couldn’t reach the image service. Check the connection and try again.
            </div>
          )}
          {loaded && caption && <div style={captionBar}>{caption}</div>}
        </>
      ) : (
        <iframe
          src={src}
          title="Nobi tutorial"
          onLoad={() => setLoaded(true)}
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
          allow="autoplay"
        />
      )}

      <button aria-label="Close" onClick={onClose} style={closeBtn}>
        ×
      </button>

      <style>{"@keyframes co-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

const spinnerWrap: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 24,
};
const spinner: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: "3px solid rgba(79,139,255,.25)",
  borderTopColor: "#4f8bff",
  animation: "co-spin 0.9s linear infinite",
};
const captionBar: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "10px 16px 14px",
  textAlign: "center",
  color: "#eaf1ff",
  fontSize: 14,
  fontStyle: "italic",
  background: "linear-gradient(transparent, rgba(5,7,15,.85))",
};
const closeBtn: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 12,
  width: 40,
  height: 40,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,.25)",
  background: "rgba(10,19,39,.6)",
  color: "#fff",
  fontSize: 24,
  lineHeight: "36px",
  cursor: "pointer",
  backdropFilter: "blur(6px)",
};
