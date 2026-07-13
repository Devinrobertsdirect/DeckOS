/**
 * Stark Signal Engine
 * Processes raw ADC samples from Upside Down Labs BioAmp devices (EMG / EKG / EEG).
 * Runs entirely in-browser — zero external dependencies.
 *
 * Hardware context:
 *   - BioAmp EXG Pill / BioAmp Band connects via USB serial (Arduino, 115200 baud)
 *   - Firmware sends one ADC reading per newline: "512\n"  or "counter,512\n"
 *   - 10-bit ADC: 0–1023, DC midpoint ≈ 512
 *   - Typical sample rate: 500 Hz (2 ms loop delay in BioAmp firmware)
 *
 * Pipeline per sample:
 *   raw → center (adaptive DC baseline) → normalize → RMS window
 *       → amplitude → mode-specific event detection → StarkAction
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type StarkMode = "emg" | "ekg" | "eeg" | "auto";
export type StarkDetectedMode = "emg" | "ekg" | "eeg";

/** EMG contraction states */
export type StarkContraction =
  | "IDLE"         // below threshold
  | "FLEX"         // single contraction above threshold
  | "DOUBLE_FLEX"  // two FLEXes within the double-tap window
  | "SUSTAINED"    // FLEX held longer than FLEX_HOLD_MS
  | "RELAX";       // just released (debounce event, cleared next frame)

/** EEG brain-state events */
export type StarkBrainEvent =
  | "IDLE"
  | "BLINK"        // large-amplitude spike → eye blink
  | "FOCUS"        // sustained mid-amplitude → beta activity
  | "RELAX_ALPHA"; // sustained low-amplitude oscillation → alpha activity

/** EKG cardiac events */
export type StarkHeartEvent =
  | "IDLE"
  | "BEAT";        // R-peak detected

/** Dashboard actions Stark can fire — same vocabulary as ACERA DashboardAction */
export type StarkAction =
  | "nav:prev"
  | "nav:next"
  | "nav:console"
  | "nav:ai"
  | "ui:confirm"
  | "ui:dismiss"
  | "ui:fullscreen"
  | null;

/** Per-frame output from StarkProcessor.process() */
export interface StarkSignalFrame {
  rawValue:    number;
  centered:    number;           // raw minus adaptive baseline
  rms:         number;           // root-mean-square of recent window (normalized 0–1)
  amplitude:   number;           // 0–1 relative to calibrated max
  baseline:    number;           // current adaptive DC center
  contraction: StarkContraction;
  brainEvent:  StarkBrainEvent;
  heartEvent:  StarkHeartEvent;
  bpm:         number | null;
  sampleRate:  number;           // measured samples / second
  detectedMode: StarkDetectedMode;
}

/** User-configurable action bindings (persisted in localStorage) */
export interface StarkBindings {
  emg: {
    flex:       StarkAction;
    doubleFlex: StarkAction;
    sustained:  StarkAction;
  };
  eeg: {
    blink:      StarkAction;
    relaxAlpha: StarkAction;
    focus:      StarkAction;
  };
}

export const DEFAULT_BINDINGS: StarkBindings = {
  emg: {
    flex:       "ui:confirm",
    doubleFlex: "ui:dismiss",
    sustained:  "ui:fullscreen",
  },
  eeg: {
    blink:      "nav:next",
    relaxAlpha: "nav:prev",
    focus:      "nav:console",
  },
};

export const STARK_BINDINGS_KEY = "deckos_stark_bindings";

export function loadStarkBindings(): StarkBindings {
  try {
    const raw = localStorage.getItem(STARK_BINDINGS_KEY);
    if (raw) return { ...DEFAULT_BINDINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_BINDINGS;
}

export function saveStarkBindings(b: StarkBindings): void {
  localStorage.setItem(STARK_BINDINGS_KEY, JSON.stringify(b));
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ADC_MIDPOINT   = 512;   // nominal center of 10-bit ADC at 5 V
const ADC_HALF_RANGE = 512;   // values span −512 … +512 after centering
const RMS_WINDOW     = 128;   // samples in rolling RMS window (~256 ms at 500 Hz)
const BASELINE_ALPHA = 0.001; // EWMA coefficient for DC baseline (~1000-sample time constant)
const MAX_ALPHA      = 0.003; // EWMA for calibrated-max adaptation

const FLEX_THRESHOLD       = 0.25;  // normalized RMS to detect a contraction
const BLINK_THRESHOLD      = 0.72;  // normalized amplitude for EEG blink
const EKG_PEAK_THRESHOLD   = 0.42;  // normalized amplitude for R-peak
const EKG_REFRACTORY_MS    = 280;   // minimum ms between R-peaks
const FLEX_HOLD_MS         = 800;   // ms held above threshold to become SUSTAINED
const DOUBLE_FLEX_WINDOW_MS = 480;  // ms between consecutive FLEXes for DOUBLE_FLEX
const BLINK_HOLD_MS        = 180;   // ms to hold BLINK event after detection

// ── Circular buffer ───────────────────────────────────────────────────────────

class RingBuffer {
  private data: Float32Array;
  private head = 0;
  private _count = 0;

  constructor(private size: number) {
    this.data = new Float32Array(size);
  }

  push(val: number): void {
    this.data[this.head] = val;
    this.head = (this.head + 1) % this.size;
    if (this._count < this.size) this._count++;
  }

  get count(): number { return this._count; }

  computeRMS(): number {
    if (this._count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this._count; i++) sum += this.data[i]! ** 2;
    return Math.sqrt(sum / this._count);
  }

  computeMean(): number {
    if (this._count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this._count; i++) sum += this.data[i]!;
    return sum / this._count;
  }

  computeVariance(): number {
    if (this._count < 2) return 0;
    const m = this.computeMean();
    let sum = 0;
    for (let i = 0; i < this._count; i++) sum += (this.data[i]! - m) ** 2;
    return sum / this._count;
  }

  toArray(): number[] {
    if (this._count < this.size) return Array.from(this.data.subarray(0, this._count));
    const out: number[] = [];
    for (let i = 0; i < this.size; i++) out.push(this.data[(this.head + i) % this.size]!);
    return out;
  }
}

// ── Main processor class ──────────────────────────────────────────────────────

export class StarkProcessor {
  private rmsBuffer  = new RingBuffer(RMS_WINDOW);
  private autoBuffer: number[] = [];

  private baseline      = ADC_MIDPOINT;
  private calibratedMax = 0.12; // starts conservative, adapts upward

  // EMG state
  private contractionState: StarkContraction = "IDLE";
  private flexStartMs    = 0;
  private lastFlexEndMs  = 0;

  // EKG state
  private lastPeakMs     = 0;
  private peakIntervals: number[] = [];
  private bpm: number | null = null;
  private inPeak = false;

  // EEG state
  private brainEvent: StarkBrainEvent = "IDLE";
  private blinkDetectedMs = 0;

  // Sample-rate measurement
  private sampleBucket   = 0;
  private bucketStartMs  = 0;
  private measuredSr     = 500;

  // Auto-mode detection
  private detectedMode: StarkDetectedMode = "emg";
  private modeDetected   = false;

  process(rawValue: number, mode: StarkMode, nowMs: number): StarkSignalFrame {
    // ── Sample-rate measurement ─────────────────────────────────────────────
    if (this.bucketStartMs === 0) this.bucketStartMs = nowMs;
    this.sampleBucket++;
    const elapsed = nowMs - this.bucketStartMs;
    if (elapsed >= 1000) {
      this.measuredSr    = Math.round(this.sampleBucket * (1000 / elapsed));
      this.sampleBucket  = 0;
      this.bucketStartMs = nowMs;
    }

    // ── Center & normalize ──────────────────────────────────────────────────
    this.baseline += BASELINE_ALPHA * (rawValue - this.baseline);
    const centered   = rawValue - this.baseline;
    const normalized = Math.abs(centered) / ADC_HALF_RANGE; // 0–1

    // ── RMS window ─────────────────────────────────────────────────────────
    this.rmsBuffer.push(normalized);
    const rms = this.rmsBuffer.computeRMS();

    // ── Calibrate max amplitude ─────────────────────────────────────────────
    if (rms > this.calibratedMax * 0.75) {
      this.calibratedMax += MAX_ALPHA * (rms * 1.3 - this.calibratedMax);
    }
    this.calibratedMax = Math.max(this.calibratedMax, 0.06);
    const amplitude = Math.min(rms / this.calibratedMax, 1.0);

    // ── Auto-detect mode (after 1 second of data) ───────────────────────────
    if (!this.modeDetected && mode === "auto") {
      this.autoBuffer.push(amplitude);
      if (this.autoBuffer.length >= 600) {
        this.detectedMode = this.detectMode(this.autoBuffer);
        this.modeDetected = true;
        this.autoBuffer   = [];
      }
    } else if (mode !== "auto") {
      this.detectedMode = mode;
    }

    const effectiveMode = mode === "auto" ? this.detectedMode : (mode as StarkDetectedMode);

    // ── Mode-specific processing ────────────────────────────────────────────
    let contraction: StarkContraction = "IDLE";
    let brainEvent:  StarkBrainEvent  = "IDLE";
    let heartEvent:  StarkHeartEvent  = "IDLE";

    if (effectiveMode === "emg") {
      contraction = this.processEmg(amplitude, nowMs);
    } else if (effectiveMode === "eeg") {
      brainEvent = this.processEeg(amplitude, nowMs);
    } else {
      heartEvent = this.processEkg(amplitude, nowMs);
    }

    return {
      rawValue,
      centered,
      rms,
      amplitude,
      baseline: this.baseline,
      contraction,
      brainEvent,
      heartEvent,
      bpm:        this.bpm,
      sampleRate: this.measuredSr,
      detectedMode: this.detectedMode,
    };
  }

  // ── EMG ───────────────────────────────────────────────────────────────────

  private processEmg(amplitude: number, nowMs: number): StarkContraction {
    const above = amplitude > FLEX_THRESHOLD;

    switch (this.contractionState) {
      case "IDLE":
      case "RELAX":
        if (above) {
          this.contractionState = "FLEX";
          this.flexStartMs = nowMs;
        } else {
          this.contractionState = "IDLE";
        }
        break;

      case "FLEX":
        if (above) {
          if (nowMs - this.flexStartMs >= FLEX_HOLD_MS) {
            this.contractionState = "SUSTAINED";
          }
        } else {
          // Release
          const isDouble =
            this.lastFlexEndMs > 0 &&
            nowMs - this.lastFlexEndMs <= DOUBLE_FLEX_WINDOW_MS;
          this.lastFlexEndMs = nowMs;
          this.contractionState = isDouble ? "DOUBLE_FLEX" : "RELAX";
        }
        break;

      case "SUSTAINED":
        if (!above) {
          this.lastFlexEndMs = nowMs;
          this.contractionState = "RELAX";
        }
        break;

      case "DOUBLE_FLEX":
        // Clear on next frame
        this.contractionState = "IDLE";
        break;
    }

    return this.contractionState;
  }

  // ── EEG ───────────────────────────────────────────────────────────────────

  private processEeg(amplitude: number, nowMs: number): StarkBrainEvent {
    if (amplitude > BLINK_THRESHOLD) {
      this.brainEvent     = "BLINK";
      this.blinkDetectedMs = nowMs;
    } else if (nowMs - this.blinkDetectedMs < BLINK_HOLD_MS) {
      this.brainEvent = "BLINK";
    } else if (amplitude > 0.18 && amplitude < 0.55) {
      this.brainEvent = "FOCUS";
    } else if (amplitude > 0.05 && amplitude <= 0.18) {
      this.brainEvent = "RELAX_ALPHA";
    } else {
      this.brainEvent = "IDLE";
    }
    return this.brainEvent;
  }

  // ── EKG ───────────────────────────────────────────────────────────────────

  private processEkg(amplitude: number, nowMs: number): StarkHeartEvent {
    const above = amplitude > EKG_PEAK_THRESHOLD;
    const sinceLastPeak = nowMs - this.lastPeakMs;

    if (above && !this.inPeak && sinceLastPeak > EKG_REFRACTORY_MS) {
      this.inPeak = true;
      if (this.lastPeakMs > 0) {
        this.peakIntervals.push(sinceLastPeak);
        if (this.peakIntervals.length > 10) this.peakIntervals.shift();
        const avg = this.peakIntervals.reduce((a, b) => a + b, 0) / this.peakIntervals.length;
        this.bpm = Math.round(60_000 / avg);
      }
      this.lastPeakMs = nowMs;
      return "BEAT";
    }

    if (!above) this.inPeak = false;
    return "IDLE";
  }

  // ── Auto-mode detection ───────────────────────────────────────────────────

  private detectMode(samples: number[]): StarkDetectedMode {
    // Look for evenly-spaced large peaks → EKG
    const peaks: number[] = [];
    for (let i = 1; i < samples.length - 1; i++) {
      const v = samples[i]!;
      if (v > 0.5 && v > (samples[i - 1] ?? 0) && v > (samples[i + 1] ?? 0)) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1]! > 100) {
          peaks.push(i);
        }
      }
    }

    if (peaks.length >= 2 && peaks.length <= 6) {
      const intervals = peaks.slice(1).map((p, i) => p - peaks[i]!);
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
      if (variance / (mean ** 2) < 0.15) return "ekg"; // low coefficient of variation = regular rhythm
    }

    // High variance → EMG; low variance → EEG
    let sum = 0, sumSq = 0;
    for (const v of samples) { sum += v; sumSq += v * v; }
    const m = sum / samples.length;
    const variance = sumSq / samples.length - m * m;

    return variance > 0.008 ? "emg" : "eeg";
  }

  /** Expose the last RMS_WINDOW samples for waveform rendering */
  getWaveform(): number[] {
    return this.rmsBuffer.toArray();
  }

  reset(): void {
    this.baseline        = ADC_MIDPOINT;
    this.calibratedMax   = 0.12;
    this.contractionState = "IDLE";
    this.flexStartMs     = 0;
    this.lastFlexEndMs   = 0;
    this.lastPeakMs      = 0;
    this.peakIntervals   = [];
    this.bpm             = null;
    this.inPeak          = false;
    this.brainEvent      = "IDLE";
    this.blinkDetectedMs = 0;
    this.autoBuffer      = [];
    this.modeDetected    = false;
    this.sampleBucket    = 0;
    this.bucketStartMs   = 0;
    this.measuredSr      = 500;
  }
}

// ── Action mapping ─────────────────────────────────────────────────────────────

/** Convert a StarkSignalFrame to a DashboardAction, or null if no action fires */
export function starkFrameToAction(
  frame: StarkSignalFrame,
  bindings: StarkBindings,
): StarkAction {
  if (frame.detectedMode === "emg") {
    switch (frame.contraction) {
      case "FLEX":        return bindings.emg.flex;
      case "DOUBLE_FLEX": return bindings.emg.doubleFlex;
      case "SUSTAINED":   return bindings.emg.sustained;
      default: return null;
    }
  }

  if (frame.detectedMode === "eeg") {
    switch (frame.brainEvent) {
      case "BLINK":       return bindings.eeg.blink;
      case "RELAX_ALPHA": return bindings.eeg.relaxAlpha;
      case "FOCUS":       return bindings.eeg.focus;
      default: return null;
    }
  }

  return null;
}

// ── AI-context summary ─────────────────────────────────────────────────────────

export function buildStarkSummary(
  frame: StarkSignalFrame | null,
  connected: boolean,
  portName: string,
): string {
  if (!connected || !frame) return "[STARK] No bioelectric device connected.";
  const mode = frame.detectedMode.toUpperCase();
  const parts: string[] = [`[STARK] BioAmp device connected (${portName}). Mode: ${mode}.`];
  parts.push(`Signal amplitude: ${(frame.amplitude * 100).toFixed(0)}% of calibrated max.`);
  parts.push(`Sample rate: ${frame.sampleRate} Hz.`);

  if (frame.detectedMode === "emg") {
    parts.push(`Muscle state: ${frame.contraction}.`);
  } else if (frame.detectedMode === "eeg") {
    parts.push(`Brain event: ${frame.brainEvent}.`);
  } else {
    parts.push(`Heart event: ${frame.heartEvent}.`);
    if (frame.bpm) parts.push(`Heart rate: ${frame.bpm} BPM.`);
  }

  return parts.join(" ");
}
