/**
 * useStarkConnect — STARK (Synaptic Transmission and Augmented Reality Kinetics) hook
 *
 * Reads bioelectric signals (EMG / EKG / EEG) from Upside Down Labs BioAmp
 * devices connected via USB serial, classifies them into events, and maps
 * those events to dashboard actions — mirroring the ACERA architecture.
 *
 * Tandem operation: Stark and ACERA run independently; both can be enabled
 * simultaneously and both fire into the same handleGestureAction handler.
 *
 * Uses the Web Serial API (Chrome/Edge/Electron — no native modules needed).
 * Serial line format from BioAmp firmware: "ADC\n" or "counter,ADC\n"
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  StarkProcessor,
  starkFrameToAction,
  buildStarkSummary,
  loadStarkBindings,
  DEFAULT_BINDINGS,
  STARK_BINDINGS_KEY,
  type StarkMode,
  type StarkDetectedMode,
  type StarkAction,
  type StarkSignalFrame,
  type StarkBindings,
} from "@/lib/starkSignals";
import { useWebSocket } from "@/contexts/WebSocketContext";

export const STARK_KEY = "deckos_stark_enabled";

// How long (ms) an EMG state must be stable before firing an action
const ACTION_DEBOUNCE_MS = 350;
// How often (ms) we emit scene context to the AI
const SCENE_EMIT_INTERVAL_MS = 600;
// Baud rate for Upside Down Labs BioAmp devices (Arduino default)
const BAUD_RATE = 115200;

export type StarkStatus =
  | "idle"
  | "connecting"
  | "active"
  | "error"
  | "unsupported";

export interface StarkState {
  enabled:       boolean;
  status:        StarkStatus;
  statusMessage: string;
  frame:         StarkSignalFrame | null;
  waveform:      number[];    // last RMS_WINDOW normalized amplitudes for canvas
  portName:      string;
  mode:          StarkMode;
  bindings:      StarkBindings;
  pendingAction: StarkAction;
  toggle:        () => void;
  connect:       () => Promise<void>;
  disconnect:    () => void;
  clearAction:   () => void;
  setMode:       (m: StarkMode) => void;
  setBindings:   (b: StarkBindings) => void;
  recalibrate:   () => void;
}

export function useStarkConnect(): StarkState {
  const [enabled,       setEnabled]       = useState<boolean>(() => localStorage.getItem(STARK_KEY) === "true");
  const [status,        setStatus]        = useState<StarkStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Stark Connect inactive");
  const [frame,         setFrame]         = useState<StarkSignalFrame | null>(null);
  const [waveform,      setWaveform]      = useState<number[]>([]);
  const [portName,      setPortName]      = useState("");
  const [mode,          setModeState]     = useState<StarkMode>("emg");
  const [bindings,      setBindingsState] = useState<StarkBindings>(loadStarkBindings);
  const [pendingAction, setPendingAction] = useState<StarkAction>(null);

  const portRef      = useRef<SerialPort | null>(null);
  const readerRef    = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const processorRef = useRef(new StarkProcessor());
  const activeRef    = useRef(false); // read-loop sentinel

  const lastEmitRef   = useRef(0);
  const lastActionRef = useRef<{ state: string; at: number }>({ state: "", at: 0 });
  const modeRef       = useRef<StarkMode>(mode);
  const bindingsRef   = useRef<StarkBindings>(bindings);

  const { sendEvent } = useWebSocket();

  // Keep refs in sync
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { bindingsRef.current = bindings; }, [bindings]);

  // ── Public API ────────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STARK_KEY, String(next));
      return next;
    });
  }, []);

  const clearAction = useCallback(() => {
    setPendingAction(null);
  }, []);

  const setMode = useCallback((m: StarkMode) => {
    setModeState(m);
    processorRef.current.reset();
  }, []);

  const setBindings = useCallback((b: StarkBindings) => {
    setBindingsState(b);
    localStorage.setItem(STARK_BINDINGS_KEY, JSON.stringify(b));
  }, []);

  const recalibrate = useCallback(() => {
    processorRef.current.reset();
    setFrame(null);
    setWaveform([]);
  }, []);

  // ── Disconnect helper ─────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    activeRef.current = false;
    readerRef.current?.cancel().catch(() => {});
    readerRef.current = null;
    portRef.current?.close().catch(() => {});
    portRef.current = null;
    processorRef.current.reset();
    setStatus("idle");
    setStatusMessage("Stark Connect inactive");
    setFrame(null);
    setWaveform([]);
    setPortName("");
  }, []);

  // ── Connect to a serial port ──────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!("serial" in navigator)) {
      setStatus("unsupported");
      setStatusMessage("Web Serial API not supported — use Chrome, Edge, or Electron");
      return;
    }

    // Disconnect any existing connection first
    if (portRef.current) disconnect();

    setStatus("connecting");
    setStatusMessage("Select your Upside Down Labs device in the browser dialog…");

    let port: SerialPort;
    try {
      // First, see if we already have permission to a port (auto-reconnect)
      const existing = await navigator.serial.getPorts();
      if (existing.length === 1) {
        port = existing[0]!;
        setStatusMessage("Reconnecting to known device…");
      } else {
        port = await navigator.serial.requestPort({
          filters: [
            // CH340/CH341 USB-Serial (common on BioAmp EXG Pill boards)
            { usbVendorId: 0x1a86, usbProductId: 0x7523 },
            { usbVendorId: 0x1a86, usbProductId: 0x7522 },
            // Official Arduino Uno / Nano
            { usbVendorId: 0x2341, usbProductId: 0x0043 },
            { usbVendorId: 0x2341, usbProductId: 0x0001 },
            // FTDI (BioAmp v2 boards)
            { usbVendorId: 0x0403, usbProductId: 0x6001 },
            // CP2102 (some variants)
            { usbVendorId: 0x10c4, usbProductId: 0xea60 },
          ],
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No port selected") || msg.includes("cancelled")) {
        setStatus("idle");
        setStatusMessage("Stark Connect inactive");
      } else {
        setStatus("error");
        setStatusMessage(`Port selection failed: ${msg}`);
      }
      return;
    }

    try {
      await port.open({ baudRate: BAUD_RATE });
    } catch (err) {
      setStatus("error");
      setStatusMessage(`Failed to open serial port: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    portRef.current = port;
    const info = port.getInfo();
    const pName = info.usbVendorId
      ? `VID:${info.usbVendorId.toString(16).toUpperCase()} PID:${info.usbProductId?.toString(16).toUpperCase() ?? "?"}`
      : "USB Serial Device";
    setPortName(pName);
    setStatus("active");
    setStatusMessage(`Receiving signals from ${pName}`);

    sendEvent({
      type: "stark.tracking.started",
      payload: { portName: pName, baudRate: BAUD_RATE, mode: modeRef.current },
    });

    // ── Serial read loop ────────────────────────────────────────────────────
    activeRef.current = true;
    const reader = port.readable!.getReader();
    readerRef.current = reader;

    const decoder  = new TextDecoder();
    let lineBuffer = "";

    const readLoop = async () => {
      try {
        while (activeRef.current) {
          const { value, done } = await reader.read();
          if (done || !activeRef.current) break;

          lineBuffer += decoder.decode(value, { stream: true });

          // Process all complete lines in the buffer
          const lines = lineBuffer.split("\n");
          lineBuffer  = lines.pop() ?? ""; // last element is incomplete

          for (const line of lines) {
            const adcValue = parseAdcLine(line.trim());
            if (adcValue === null) continue;

            const nowMs = performance.now();
            const f = processorRef.current.process(adcValue, modeRef.current, nowMs);
            setFrame(f);
            setWaveform(processorRef.current.getWaveform());

            // ── Action firing ─────────────────────────────────────────────
            const action = starkFrameToAction(f, bindingsRef.current);
            if (action) {
              const stateKey = `${f.contraction}:${f.brainEvent}:${f.heartEvent}`;
              const ref = lastActionRef.current;
              // Fire action only on state CHANGE and after debounce
              if (ref.state !== stateKey && nowMs - ref.at >= ACTION_DEBOUNCE_MS) {
                lastActionRef.current = { state: stateKey, at: nowMs };
                setPendingAction(action);
                sendEvent({
                  type: "stark.signal.event",
                  payload: {
                    mode:        f.detectedMode,
                    contraction: f.contraction,
                    brainEvent:  f.brainEvent,
                    heartEvent:  f.heartEvent,
                    amplitude:   Math.round(f.amplitude * 100),
                    bpm:         f.bpm,
                    action,
                  },
                });
              }
              if (ref.state === stateKey) {
                // Reset state tracker when signal returns to baseline
              }
            } else {
              // Signal returned to baseline — allow same action to fire next time
              const stateKey = "idle";
              if (lastActionRef.current.state !== stateKey) {
                lastActionRef.current = { state: stateKey, at: nowMs };
              }
            }

            // ── AI context emit ───────────────────────────────────────────
            if (nowMs - lastEmitRef.current >= SCENE_EMIT_INTERVAL_MS) {
              lastEmitRef.current = nowMs;
              const summary = buildStarkSummary(f, true, pName);
              sendEvent({
                type: "stark.scene.update",
                payload: {
                  mode:        f.detectedMode,
                  amplitude:   Math.round(f.amplitude * 100),
                  contraction: f.contraction,
                  brainEvent:  f.brainEvent,
                  heartEvent:  f.heartEvent,
                  bpm:         f.bpm,
                  sampleRate:  f.sampleRate,
                  portName:    pName,
                  summary,
                },
              });
            }
          }
        }
      } catch (err) {
        if (activeRef.current) {
          setStatus("error");
          setStatusMessage(`Serial read error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        reader.releaseLock();
        if (activeRef.current) {
          sendEvent({ type: "stark.tracking.stopped", payload: { portName: pName } });
        }
      }
    };

    void readLoop();
  }, [disconnect, sendEvent]);

  // ── Auto-connect on enable ────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    if (!("serial" in navigator)) {
      setStatus("unsupported");
      setStatusMessage("Web Serial API not supported — use Chrome, Edge, or Electron");
      return;
    }

    // Try to silently reconnect to a previously granted port
    navigator.serial.getPorts().then((ports) => {
      if (ports.length === 1 && ports[0] && !portRef.current) {
        void connect();
      } else {
        setStatus("idle");
        setStatusMessage("Click CONNECT to select your BioAmp device");
      }
    }).catch(() => {
      setStatus("idle");
      setStatusMessage("Click CONNECT to select your BioAmp device");
    });

    return () => {
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      activeRef.current = false;
      readerRef.current?.cancel().catch(() => {});
      portRef.current?.close().catch(() => {});
    };
  }, []);

  return {
    enabled, status, statusMessage,
    frame, waveform, portName,
    mode, bindings,
    pendingAction,
    toggle, connect, disconnect, clearAction,
    setMode, setBindings, recalibrate,
  };
}

// ── Line parser ────────────────────────────────────────────────────────────────

/**
 * Parse a serial line from BioAmp firmware.
 * Handles: "512", "1234,512", "1234,512,0" — takes the LAST numeric token.
 * Returns null for empty or non-numeric lines.
 */
function parseAdcLine(line: string): number | null {
  if (!line) return null;
  const parts = line.split(",");
  const last = parts[parts.length - 1]?.trim();
  if (!last) return null;
  const val = parseInt(last, 10);
  if (isNaN(val) || val < 0 || val > 4095) return null;
  return val;
}
