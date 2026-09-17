import { useState } from "react";

/**
 * ContentOverlay — a full-screen layer over the face for rich content the voice
 * skills summon: a generated image ("draw me a fox") or the animated tutorial
 * ("tutorial mode"). Mirrors the YouTubeOverlay pattern. Cover-sized so it fills
 * the round robot screen; a close control and "close the image/tutorial" voice
 * command both dismiss it.
 */
export interface ContentOverlayProps {
  kind: "image" | "tutorial";
  src: string;
  caption?: string;
  onClose: () => void;
}

export function ContentOverlay({ kind, src, caption, onClose }: ContentOverlayProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

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
