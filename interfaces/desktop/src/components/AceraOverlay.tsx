/**
 * AceraOverlay — floating camera + gesture tracking HUD
 *
 * Shows a corner panel with:
 *  - Live camera feed with hand landmark skeleton overlaid
 *  - Current detected gesture + confidence
 *  - Hand count, activity inference, FPS
 *  - Gesture reference cheat-sheet (collapsible)
 *
 * Position: bottom-right corner, draggable-feeling via CSS.
 * Minimises to a small status pill when not active.
 */

import { useRef, useState, useEffect } from "react";
import { Eye, EyeOff, Hand, Zap, Radio, X } from "lucide-react";
import type { AceraState } from "@/hooks/useAceraConnect";
import type { Gesture, DashboardAction } from "@/lib/aceraGestures";

interface AceraOverlayProps {
  acera: AceraState;
  onAction?: (action: DashboardAction) => void;
}

const GESTURE_LABELS: Record<Gesture, string> = {
  OPEN_PALM:    "Open Palm",
  CLOSED_FIST:  "Closed Fist",
  POINTING_UP:  "Pointing Up",
  PEACE:        "Peace Sign",
  THREE_FINGERS:"Three Fingers",
  THUMBS_UP:    "Thumbs Up",
  THUMBS_DOWN:  "Thumbs Down",
  PINCH:        "Pinch",
  SWIPE_LEFT:   "Swipe Left",
  SWIPE_RIGHT:  "Swipe Right",
  SWIPE_UP:     "Swipe Up",
  UNKNOWN:      "Unknown",
};

const GESTURE_ACTIONS: { gesture: string; action: string; icon: string }[] = [
  { gesture: "Swipe Left",    action: "Previous page",      icon: "←" },
  { gesture: "Swipe Right",   action: "Next page",          icon: "→" },
  { gesture: "Peace Sign",    action: "Command Console",    icon: "✌" },
  { gesture: "Thumbs Up",     action: "AI Chat",            icon: "👍" },
  { gesture: "Open Palm",     action: "Fullscreen / Focus", icon: "✋" },
  { gesture: "Closed Fist",   action: "Dismiss / Cancel",   icon: "✊" },
  { gesture: "Three Fingers", action: "Confirm",            icon: "🤟" },
];

const STATUS_COLORS: Record<string, string> = {
  idle:        "text-primary/40",
  loading:     "text-[#ffc820]",
  active:      "text-[#22ff44]",
  denied:      "text-[#f03248]",
  error:       "text-[#f03248]",
  unsupported: "text-[#f03248]",
};

const STATUS_DOTS: Record<string, string> = {
  idle:        "bg-primary/30",
  loading:     "bg-[#ffc820] animate-pulse",
  active:      "bg-[#22ff44] animate-pulse",
  denied:      "bg-[#f03248]",
  error:       "bg-[#f03248]",
  unsupported: "bg-primary/30",
};

export function AceraOverlay({ acera, onAction }: AceraOverlayProps) {
  const [expanded, setExpanded] = useState(true);
  const [showRef, setShowRef] = useState(false);
  const canvasElRef = useRef<HTMLCanvasElement>(null);

  // Sync the hook's canvasRef to our canvas element
  useEffect(() => {
    if (canvasElRef.current) {
      (acera.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvasElRef.current;
    }
    return () => {
      (acera.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = null;
    };
  }, [acera.canvasRef]);

  // Fire dashboard actions
  useEffect(() => {
    if (acera.pendingAction) {
      onAction?.(acera.pendingAction);
      acera.clearAction();
    }
  }, [acera.pendingAction, onAction, acera]);

  const isActive = acera.status === "active";
  const gestureLabel = acera.dominantGesture ? (GESTURE_LABELS[acera.dominantGesture] ?? acera.dominantGesture) : null;

  if (!expanded) {
    return (
      <div
        className="fixed bottom-24 right-4 z-50 flex items-center gap-2 px-3 py-1.5 border border-[#00d4ff]/30 bg-black/80 backdrop-blur-sm cursor-pointer font-mono text-[10px] select-none"
        onClick={() => setExpanded(true)}
      >
        <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[acera.status]}`} />
        <Hand className="w-3 h-3 text-[#00d4ff]" />
        <span className={`uppercase tracking-wider ${STATUS_COLORS[acera.status]}`}>
          ACERA {acera.status === "active" ? `· ${acera.hands.length} hand${acera.hands.length !== 1 ? "s" : ""}` : `· ${acera.status}`}
        </span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 w-72 border border-[#00d4ff]/30 bg-black/90 backdrop-blur-md font-mono text-[10px] select-none shadow-[0_0_30px_rgba(0,212,255,0.08)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#00d4ff]/20 bg-[#00d4ff]/5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOTS[acera.status]}`} />
        <Hand className="w-3 h-3 text-[#00d4ff] flex-shrink-0" />
        <span className="text-[#00d4ff] uppercase tracking-widest flex-1">ACERA.CONNECT</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRef((s) => !s)}
            className="p-1 text-primary/40 hover:text-primary/80 transition-colors"
            title="Gesture reference"
          >
            <Zap className="w-3 h-3" />
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="p-1 text-primary/40 hover:text-primary/80 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Camera canvas */}
      {isActive && (
        <div className="relative w-full" style={{ aspectRatio: "4/3" }}>
          <canvas
            ref={canvasElRef}
            width={640}
            height={480}
            className="w-full h-full object-cover"
          />
          {/* FPS badge */}
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 text-[#00d4ff] text-[9px]">
            {acera.fps} FPS
          </div>
          {/* Gesture badge */}
          {gestureLabel && acera.dominantGesture !== "UNKNOWN" && (
            <div className="absolute bottom-1 left-1 right-1 flex justify-between items-center px-1.5 py-0.5 bg-black/70">
              <span className="text-[#ffc820] font-bold uppercase tracking-wider">{gestureLabel}</span>
              <span className="text-primary/40">{acera.hands[0]?.result.confidence !== undefined ? `${(acera.hands[0].result.confidence * 100).toFixed(0)}%` : ""}</span>
            </div>
          )}
          {/* Scan lines effect */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,212,255,0.015) 2px, rgba(0,212,255,0.015) 4px)"
          }} />
        </div>
      )}

      {/* Status / non-active state */}
      {!isActive && (
        <div className="p-4 flex flex-col items-center gap-2">
          {acera.status === "loading" ? (
            <>
              <Radio className="w-6 h-6 text-[#ffc820] animate-pulse" />
              <span className="text-[#ffc820] text-center leading-tight">{acera.statusMessage}</span>
            </>
          ) : (
            <>
              <EyeOff className="w-6 h-6 text-primary/30" />
              <span className="text-primary/50 text-center leading-tight">{acera.statusMessage}</span>
            </>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 border-t border-[#00d4ff]/15">
        <Stat label="HANDS" value={String(acera.hands.length)} color="#00d4ff" />
        <Stat label="ACTIVITY" value={acera.activity.toUpperCase()} color="#ffc820" small />
        <Stat label="STATUS" value={acera.status.toUpperCase()} color={acera.status === "active" ? "#22ff44" : "#f03248"} small />
      </div>

      {/* Finger state */}
      {isActive && acera.hands[0] && (
        <div className="px-3 py-1.5 border-t border-[#00d4ff]/15 flex items-center gap-2">
          <span className="text-primary/40 uppercase tracking-wider text-[9px]">FINGERS</span>
          <div className="flex gap-1 ml-auto">
            {["T","I","M","R","P"].map((f, i) => (
              <div
                key={f}
                className={`w-5 h-5 flex items-center justify-center text-[9px] font-bold border ${
                  acera.hands[0]!.result.fingers[i]
                    ? "border-[#00d4ff] text-[#00d4ff] bg-[#00d4ff]/10"
                    : "border-primary/20 text-primary/25"
                }`}
              >
                {f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gesture reference */}
      {showRef && (
        <div className="border-t border-[#00d4ff]/15 p-2 space-y-1 bg-black/60">
          <div className="text-[#00d4ff]/60 uppercase tracking-widest text-[9px] mb-1.5">GESTURE REFERENCE</div>
          {GESTURE_ACTIONS.map(({ gesture, action, icon }) => (
            <div key={gesture} className="flex items-center justify-between">
              <span className="text-primary/50">{icon} {gesture}</span>
              <span className="text-[#ffc820]/70">→ {action}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hold indicator */}
      {isActive && (
        <div className="px-3 py-1 border-t border-[#00d4ff]/15 flex items-center gap-1.5">
          <Eye className="w-2.5 h-2.5 text-[#00d4ff]/50" />
          <span className="text-primary/30 text-[9px]">Hold gesture 400ms to trigger action</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="px-2 py-1.5 flex flex-col items-center gap-0.5">
      <span className="text-primary/30 text-[9px] uppercase tracking-wider">{label}</span>
      <span className={`font-bold text-[9px] ${small ? "text-[8px]" : ""}`} style={{ color }}>
        {value}
      </span>
    </div>
  );
}
