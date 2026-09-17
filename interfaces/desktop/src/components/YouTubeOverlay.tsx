import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * YouTubeOverlay — a voice-summoned video layer over Nobi's face.
 *
 * "robot play <query>" mounts this; it resolves the spoken query to a videoId via
 * the brain's keyless /api/yt/resolve, then plays it in a YouTube IFrame Player
 * sized to COVER the (often round) screen — no black bars, the circular bezel
 * crops the sides. Chrome disabled (controls/branding off) since voice is the only
 * input. "robot pause/resume video" call the imperative handle; "robot close
 * video" (or the clip ending) unmounts us and reveals the bare-eyes face again.
 * Autoplay is unmuted because the kiosk runs --autoplay-policy=no-user-gesture-required.
 */

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: unknown) => YtPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(id: string): void;
  destroy(): void;
}

export interface VideoHandle {
  pause: () => void;
  resume: () => void;
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** COVER fit: fill the viewport with a 16:9 video, cropping the overflow. */
function coverSize(): { w: number; h: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = vw, h = Math.ceil((vw * 9) / 16);
  if (h < vh) { h = vh; w = Math.ceil((vh * 16) / 9); }
  return { w, h };
}

interface Props {
  query: string;
  onClose: () => void;
}

export const YouTubeOverlay = forwardRef<VideoHandle, Props>(function YouTubeOverlay(
  { query, onClose },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const idsRef = useRef<string[]>([]);
  const idxRef = useRef(0);
  const [title, setTitle] = useState(query);
  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");
  const [size] = useState(coverSize);
  // Keep onClose in a ref so the player effect depends ONLY on `query`. Otherwise
  // its inline-arrow identity changes on every parent re-render (brain poll, mute,
  // caption…) and the effect tears the half-built iframe down before it appears.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useImperativeHandle(ref, () => ({
    pause: () => { try { playerRef.current?.pauseVideo(); } catch { /* not ready */ } },
    resume: () => { try { playerRef.current?.playVideo(); } catch { /* not ready */ } },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    (async () => {
      try {
        const r = await fetch(`/api/yt/resolve?q=${encodeURIComponent(query)}`);
        const j = (await r.json()) as { ok?: boolean; ids?: string[]; title?: string };
        if (cancelled) return;
        if (!j.ok || !j.ids?.length) { setStatus("error"); setTitle("I couldn't find that one."); return; }
        idsRef.current = j.ids; idxRef.current = 0;
        if (j.title) setTitle(j.title);
        await loadYouTubeApi();
        if (cancelled || !container || !window.YT) return;
        // The IFrame API only reliably builds the player when handed an element
        // *id string* — passing a DOM node silently no-ops. Create the host node
        // imperatively (React never sees the iframe it gets swapped for).
        const host = document.createElement("div");
        host.id = "neura-yt-host";
        container.replaceChildren(host);
        const { w, h } = size;
        playerRef.current = new window.YT.Player(host.id, {
          width: w, height: h, videoId: j.ids[0],
          playerVars: {
            autoplay: 1, controls: 0, modestbranding: 1, rel: 0,
            playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e: { target: YtPlayer }) => { e.target.playVideo(); setStatus("playing"); },
            onStateChange: (e: { data: number }) => { if (e.data === window.YT!.PlayerState.ENDED) onCloseRef.current(); },
            onError: () => {
              idxRef.current += 1;
              const next = idsRef.current[idxRef.current];
              if (next && playerRef.current) { playerRef.current.loadVideoById(next); }
              else { setStatus("error"); setTitle("That one won't play here."); }
            },
          },
        });
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
      try { container?.replaceChildren(); } catch { /* gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-black">
      <div
        style={{
          position: "absolute", top: "50%", left: "50%",
          width: size.w, height: size.h,
          transform: "translate(-50%, -50%)", pointerEvents: "none",
        }}
      >
        <div ref={containerRef} style={{ width: size.w, height: size.h }} />
      </div>
      {status !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center px-10 text-center">
          <span className="text-sm tracking-wide text-[color:var(--primary,#7fb2ff)] opacity-80">
            {status === "error" ? title : `Loading ${title}…`}
          </span>
        </div>
      )}
    </div>
  );
});
