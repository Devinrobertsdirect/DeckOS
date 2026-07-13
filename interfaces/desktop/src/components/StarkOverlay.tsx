/**
 * StarkOverlay — floating bioelectric signal HUD
 *
 * Mirrors AceraOverlay's architecture but positioned bottom-LEFT with a
 * red/amber color theme so both overlays can coexist on screen simultaneously.
 *
 * Shows:
 *  - Device connection status + port info
 *  - Live scrolling waveform (canvas)
 *  - Signal mode (EMG / EKG / EEG) + detected state
 *  - BPM readout (EKG / EEG mode)
 *  - Action binding reference (collapsible)
 *  - Connect / Disconnect button
 */

import { useRef, useState, useEffect } from "react";
import { Activity, Zap, X, Radio, Unplug, Plug, RotateCcw } from "lucide-react";
import type { StarkState } from "@/hooks/useStarkConnect";
import type { StarkAction } from "@/lib/starkSignals";

interface StarkOverlayProps {
  stark: StarkState;
  onAction?: (action: StarkAction) => void;
}

const STATUS_DOTS: Record<string, string> = {
  idle:        "bg-primary/30",
  connecting:  "bg-[#ffc820] animate-pulse",
  active:      "bg-[#ff4444] animate-pulse",
  error:       "bg-[#f03248]",
  unsupported: "bg-primary/30",
};

const STATUS_COLORS: Record<string, string> = {
  idle:        "text-primary/40",
  connecting:  "text-[#ffc820]",
  active:      "text-[#ff4444]",
  error:       "text-[#f03248]",
  unsupported: "text-[#f03248]",
};

const CONTRACTION_COLORS: Record<string, string> = {
  IDLE:        "text-primary/40",
  FLEX:        "text-[#ff4444]",
  DOUBLE_FLEX: "text-[#ff6a00]",
  SUSTAINED:   "text-[#ffc820]",
  RELAX:       "text-[#22ff44]",
};

const BRAIN_COLORS: Record<string, string> = {
  IDLE:        "text-primary/40",
  BLINK:       "text-[#ff4444]",
  FOCUS:       "text-[#ffc820]",
  RELAX_ALPHA: "text-[#22ff44]",
};

const ACTION_LABELS: { state: string; label: string; action: string; icon: string }[] = [
  { state: "FLEX",        label: "Flex (EMG)",       action: "Confirm / Click",   icon: "💪" },
  { state: "DOUBLE_FLEX", label: "Double Flex (EMG)", action: "Dismiss / Cancel",  icon: "⚡" },
  { state: "SUSTAINED",   label: "Hold Flex (EMG)",   action: "Fullscreen / Hold", icon: "🔒" },
  { state: "BLINK",       label: "Blink (EEG)",       action: "Next page",         icon: "👁" },
  { state: "RELAX_ALPHA", label: "Alpha (EEG)",        action: "Previous page",     icon: "🌊" },
  { state: "FOCUS",       label: "Focus (EEG)",        action: "Command Console",   icon: "🧠" },
];

export function StarkOverlay({ stark, onAction }: StarkOverlayProps) {
  const [expanded,  setExpanded]  = useState(true);
  const [showRef,   setShowRef]   = useState(false);
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);

  // Fire dashboard actions
  useEffect(() => {
    if (stark.pendingAction) {
      onAction?.(stark.pendingAction);
      stark.clearAction();
    }
  }, [stark.pendingAction, onAction, stark]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const data = stark.waveform;
    if (data.length < 2) return;

    // Background grid line
    ctx.strokeStyle = "rgba(255,68,68,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Waveform line
    const step = w / (data.length - 1);
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ff4444";
    ctx.shadowColor = "#ff4444";
    ctx.shadowBlur  = 4;

    data.forEach((val, i) => {
      const x = i * step;
      const y = h - val * h * 0.9 - h * 0.05;
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Threshold line
    const threshY = h - 0.25 * h * 0.9 - h * 0.05;
    ctx.strokeStyle = "rgba(255,200,32,0.3)";
    ctx.lineWidth   = 0.8;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [stark.waveform]);

  const isActive    = stark.status === "active";
  const frame       = stark.frame;
  const modeLabel   = frame ? frame.detectedMode.toUpperCase() : stark.mode.toUpperCase();
  const stateLabel  = frame
    ? (frame.contraction !== "IDLE" ? frame.contraction
      : frame.brainEvent  !== "IDLE" ? frame.brainEvent
      : frame.heartEvent  !== "IDLE" ? frame.heartEvent
      : "IDLE")
    : "—";

  const stateColor =
    CONTRACTION_COLORS[stateLabel] ??
    BRAIN_COLORS[stateLabel] ??
    "text-primary/40";

  const amplitudePct = frame ? Math.round(frame.amplitude * 100) : 0;

  // Minimised pill — bottom-left
  if (!expanded) {
    return (
      <div
        className="fixed bottom-24 left-4 z-50 flex items-center gap-2 px-3 py-1.5 border border-[#ff4444]/30 bg-black/80 backdrop-blur-sm cursor-pointer font-mono text-[10px] select-none"
        onClick={() => setExpanded(true)}
      >
        <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[stark.status]}`} />
        <Activity className="w-3 h-3 text-[#ff4444]" />
        <span className={`uppercase tracking-wider ${STATUS_COLORS[stark.status]}`}>
          STARK {isActive ? `· ${modeLabel} · ${stateLabel}` : `· ${stark.status}`}
        </span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-24 left-4 z-50 w-72 border border-[#ff4444]/30 bg-black/90 backdrop-blur-md font-mono text-[10px] select-none shadow-[0_0_30px_rgba(255,68,68,0.08)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#ff4444]/20 bg-[#ff4444]/5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOTS[stark.status]}`} />
        <Activity className="w-3 h-3 text-[#ff4444] flex-shrink-0" />
        <span className="text-[#ff4444] uppercase tracking-widest flex-1">STARK.CONNECT</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRef((s) => !s)}
            className="p-1 text-primary/40 hover:text-primary/80 transition-colors"
            title="Action reference"
          >
            <Zap className="w-3 h-3" />
          </button>
          <button
            onClick={stark.recalibrate}
            className="p-1 text-primary/40 hover:text-primary/80 transition-colors"
            title="Recalibrate baseline"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="p-1 text-primary/40 hover:text-primary/80 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Waveform canvas */}
      <div className="relative w-full bg-black/60" style={{ height: 64 }}>
        <canvas
          ref={canvasRef}
          width={272}
          height={64}
          className="w-full h-full"
        />
        {/* Mode badge */}
        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 text-[#ff4444] text-[9px] uppercase tracking-widest">
          {modeLabel}
        </div>
        {/* Amplitude badge */}
        {isActive && (
          <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/70 text-[#ffc820] text-[9px]">
            {amplitudePct}%
          </div>
        )}
        {/* State badge */}
        {isActive && stateLabel !== "IDLE" && (
          <div className={`absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 text-[9px] font-bold uppercase tracking-wider ${stateColor}`}>
            {stateLabel.replace("_", " ")}
          </div>
        )}
        {/* BPM badge */}
        {isActive && frame?.bpm && (
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-[#ff6a00] text-[9px]">
            {frame.bpm} BPM
          </div>
        )}
        {/* Scan-line effect */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,68,68,0.012) 2px, rgba(255,68,68,0.012) 4px)"
        }} />
      </div>

      {/* Non-active / loading state */}
      {!isActive && (
        <div className="p-3 flex flex-col items-center gap-2">
          {stark.status === "connecting" ? (
            <>
              <Radio className="w-5 h-5 text-[#ffc820] animate-pulse" />
              <span className="text-[#ffc820] text-center leading-tight text-[10px]">{stark.statusMessage}</span>
            </>
          ) : stark.status === "error" ? (
            <>
              <Unplug className="w-5 h-5 text-[#f03248]" />
              <span className="text-[#f03248] text-center leading-tight text-[10px]">{stark.statusMessage}</span>
            </>
          ) : (
            <>
              <Unplug className="w-5 h-5 text-primary/30" />
              <span className="text-primary/50 text-center leading-tight text-[10px]">{stark.statusMessage}</span>
            </>
          )}
        </div>
      )}

      {/* Port info */}
      {stark.portName && (
        <div className="px-3 py-1.5 border-t border-[#ff4444]/15 flex items-center gap-2">
          <Plug className="w-2.5 h-2.5 text-[#ff4444]/60 flex-shrink-0" />
          <span className="text-primary/40 text-[9px] truncate">{stark.portName}</span>
          {frame && (
            <span className="ml-auto text-primary/30 text-[9px] shrink-0">{frame.sampleRate} Hz</span>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 border-t border-[#ff4444]/15">
        <Stat label="SIGNAL"  value={`${amplitudePct}%`}               color="#ff4444" />
        <Stat label="STATE"   value={stateLabel.replace("_", " ")}     color={stateLabel !== "IDLE" ? "#ffc820" : "#ffffff30"} small />
        <Stat label="STATUS"  value={stark.status.toUpperCase()}        color={isActive ? "#22ff44" : "#ffffff30"} small />
      </div>

      {/* Connect / Disconnect button */}
      <div className="border-t border-[#ff4444]/15 p-2">
        {isActive ? (
          <button
            onClick={stark.disconnect}
            className="w-full px-3 py-1.5 border border-[#f03248]/40 bg-[#f03248]/10 text-[#f03248] hover:bg-[#f03248]/20 transition-colors text-[9px] uppercase tracking-widest font-bold flex items-center justify-center gap-1.5"
          >
            <Unplug className="w-3 h-3" />
            DISCONNECT
          </button>
        ) : (
          <button
            onClick={() => void stark.connect()}
            disabled={stark.status === "connecting" || stark.status === "unsupported"}
            className="w-full px-3 py-1.5 border border-[#ff4444]/40 bg-[#ff4444]/10 text-[#ff4444] hover:bg-[#ff4444]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[9px] uppercase tracking-widest font-bold flex items-center justify-center gap-1.5"
          >
            <Plug className="w-3 h-3" />
            {stark.status === "connecting" ? "CONNECTING…" : "CONNECT DEVICE"}
          </button>
        )}
      </div>

      {/* Action reference */}
      {showRef && (
        <div className="border-t border-[#ff4444]/15 p-2 space-y-1 bg-black/60">
          <div className="text-[#ff4444]/60 uppercase tracking-widest text-[9px] mb-1.5">SIGNAL ACTION REFERENCE</div>
          {ACTION_LABELS.map(({ state, label, action, icon }) => (
            <div key={state} className="flex items-center justify-between">
              <span className="text-primary/50">{icon} {label}</span>
              <span className="text-[#ffc820]/70">→ {action}</span>
            </div>
          ))}
          <div className="mt-2 text-[9px] text-primary/25 leading-relaxed">
            Actions fire on signal state change after {/* 350 ms */}350 ms debounce.
            Recalibrate (↺) resets baseline.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, color, small,
}: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="px-2 py-1.5 flex flex-col items-center gap-0.5">
      <span className="text-primary/30 text-[9px] uppercase tracking-wider">{label}</span>
      <span className={`font-bold ${small ? "text-[8px]" : "text-[9px]"} truncate w-full text-center`} style={{ color }}>
        {value}
      </span>
    </div>
  );
}
