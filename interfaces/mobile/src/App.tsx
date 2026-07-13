import { useEffect, useRef, useState, useCallback, type FormEvent } from "react";
import { useVoiceRecorder } from "./hooks/useVoiceRecorder";
import { useAudioPlayback } from "./hooks/useAudioPlayback";

const API_BASE = `${window.location.origin}/api`;
const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`;

type Role = "user" | "assistant" | "system";
type Channel = "web" | "mobile" | "whatsapp" | "voice";

type SensorSnapshot = {
  gps?: { lat: number; lon: number; accuracy: number; altitude?: number; speed?: number };
  battery?: { level: number; charging: boolean };
  network?: { type: string; downlink?: number; effectiveType?: string };
  orientation?: { alpha: number; beta: number; gamma: number };
};

function useSensorBridge(sendMessage: (d: unknown) => void, wsState: string) {
  const snap = useRef<SensorSnapshot>({});

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        snap.current.gps = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
          altitude: p.coords.altitude ?? undefined,
          speed: p.coords.speed ?? undefined,
        };
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    type BatteryMgr = EventTarget & { level: number; charging: boolean };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryMgr> };
    if (!nav.getBattery) return;
    nav.getBattery().then((b) => {
      const upd = () => { snap.current.battery = { level: b.level, charging: b.charging }; };
      upd();
      b.addEventListener("levelchange", upd);
      b.addEventListener("chargingchange", upd);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    type Conn = EventTarget & { type?: string; downlink?: number; effectiveType?: string };
    const conn = (navigator as Navigator & { connection?: Conn }).connection;
    if (!conn) return;
    const upd = () => {
      snap.current.network = { type: conn.type ?? "unknown", downlink: conn.downlink, effectiveType: conn.effectiveType };
    };
    upd();
    conn.addEventListener("change", upd);
  }, []);

  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      snap.current.orientation = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);

  useEffect(() => {
    if (wsState !== "open") return;
    const emit = () =>
      sendMessage({
        type: "device.reading",
        payload: {
          deviceId: `mobile-${SESSION_ID}`,
          deviceType: "mobile_browser",
          sensorType: "multi",
          values: { ...snap.current },
          timestamp: new Date().toISOString(),
        },
      });
    emit();
    const iv = setInterval(emit, 10_000);
    return () => clearInterval(iv);
  }, [wsState, sendMessage]);
}

interface ChatMsg {
  id: string;
  role: Role;
  content: string;
  channel?: Channel;
  modelUsed?: string;
  tier?: string;
  latencyMs?: number;
  fromCache?: boolean;
  reasonCode?: string;
  timestamp: string;
  pending?: boolean;
}

interface VoiceIdentity {
  voiceId: string;
  tone: string;
  pacing: string;
  formality: number;
  verbosity: number;
  emotionRange: string;
}

interface Persona {
  aiName?: string;
  voice?: string;
  attitude?: string;
  thinkingDepth?: string;
  responseLength?: string;
  gravityLevel?: number;
  snarkinessLevel?: number;
  textColor?: string;
}

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function applyAccentColor(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  try {
    const hsl = hexToHsl(hex);
    document.documentElement.style.setProperty("--primary", hsl);
    document.documentElement.style.setProperty("--ring", hsl);
  } catch {}
}

interface ChannelEntry {
  configured: boolean;
  instructions: string;
  envVars?: string[];
  note?: string;
}

interface ChannelStatus {
  inboundWebhook: string;
  note: string;
  channels: Record<string, ChannelEntry>;
  supported: string[];
}

const PAIRING_KEY     = "deckos_pairing_code";
const SESSION_ID_KEY  = "deckos_session_id";

/** Returns a stable SESSION_ID based on the stored pairing code.
 *  Falls back to a random ID if the device hasn't been paired yet. */
function resolveSessionId(): string {
  const stored = localStorage.getItem(SESSION_ID_KEY);
  if (stored) return stored;
  const code = localStorage.getItem(PAIRING_KEY);
  if (code) {
    const sid = `mobile_p_${code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    localStorage.setItem(SESSION_ID_KEY, sid);
    return sid;
  }
  return `mobile_${Math.random().toString(36).slice(2, 10)}`;
}

const SESSION_ID = resolveSessionId();

function useWebSocket(onMessage: (data: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [wsState, setWsState] = useState<"connecting" | "open" | "closed">("connecting");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsState("connecting");

    ws.onopen = () => setWsState("open");
    ws.onclose = () => {
      setWsState("closed");
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data as string)); } catch {}
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { wsState, sendMessage };
}

type VoicePipelineState = "idle" | "listening" | "transcribing" | "chatting" | "speaking" | "error";

function PairingGate({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/pairing/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (!res.ok) { setStatus("error"); setErrorMsg("Server error. Try again."); return; }
      const { valid } = await res.json() as { valid: boolean };
      if (valid) {
        localStorage.setItem(PAIRING_KEY, trimmed);
        localStorage.removeItem(SESSION_ID_KEY);
        onPaired();
      } else {
        setStatus("error");
        setErrorMsg("Invalid code. Check the MOBILE ACCESS tab in desktop Settings.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Cannot reach the server. Make sure you're on the same network.");
    }
  };

  const fmt = (v: string) => {
    const clean = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7);
    if (clean.length > 3) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
    return clean;
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-primary">
      <div className="scanline pointer-events-none" />
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">

        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full border-2 border-primary/40 flex items-center justify-center bg-primary/5">
            <span className="font-mono text-2xl font-bold text-primary">J</span>
          </div>
          <div className="text-center">
            <p className="font-mono text-sm text-primary tracking-widest uppercase">DeckOS Mobile</p>
            <p className="font-mono text-[10px] text-primary/30 mt-1 uppercase tracking-widest">JARVIS Command Center</p>
          </div>
        </div>

        <div className="text-center space-y-1">
          <p className="font-mono text-xs text-primary/60">Enter your desktop pairing code</p>
          <p className="font-mono text-[10px] text-primary/30 leading-relaxed">
            Open DeckOS on your desktop → Settings → Mobile Access
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-xs space-y-4">
          <div className="flex flex-col gap-2">
            <input
              value={code}
              onChange={(e) => setCode(fmt(e.target.value))}
              maxLength={8}
              placeholder="XXX-0000"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={`w-full text-center bg-transparent border px-4 py-4 font-mono text-3xl tracking-[0.3em] text-primary placeholder-primary/15 outline-none transition-colors ${
                status === "error" ? "border-[#f03248]/60" : "border-primary/30 focus:border-primary/60"
              }`}
            />
            {status === "error" && (
              <p className="font-mono text-[10px] text-[#f03248] text-center leading-relaxed">{errorMsg}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={code.length < 7 || status === "loading"}
            className="w-full py-3 font-mono text-xs border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-30 transition-colors uppercase tracking-widest"
          >
            {status === "loading" ? "Linking…" : "Link to Desktop →"}
          </button>
        </form>

        <p className="font-mono text-[9px] text-primary/15 text-center leading-relaxed max-w-xs">
          The pairing code links your mobile device to a specific DeckOS instance. You only need to do this once.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [paired, setPaired] = useState(() => !!localStorage.getItem(PAIRING_KEY));

  const handleUnpair = () => {
    localStorage.removeItem(PAIRING_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    setPaired(false);
  };

  if (!paired) {
    return (
      <PairingGate
        onPaired={() => {
          setPaired(true);
          window.location.reload();
        }}
      />
    );
  }

  return <PairedApp onUnpair={handleUnpair} />;
}

function PairedApp({ onUnpair }: { onUnpair: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [identity, setIdentity] = useState<VoiceIdentity | null>(null);
  const [aiName, setAiName] = useState("JARVIS");
  const [userName, setUserName] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoicePipelineState>("idle");
  const [showSettings, setShowSettings] = useState(false);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voicePressedRef = useRef(false);

  /* Silent startup re-validation — if the desktop reset its code, send user back to pairing gate */
  useEffect(() => {
    const code = localStorage.getItem(PAIRING_KEY);
    if (!code) { onUnpair(); return; }
    fetch(`${API_BASE}/pairing/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then((r) => r.json())
      .then(({ valid }: { valid: boolean }) => { if (!valid) onUnpair(); })
      .catch(() => { /* network error — assume still valid, carry on */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { recorderState, micDenied, supported: micSupported, startRecording, stopRecording, cancelRecording } = useVoiceRecorder();
  const { speak } = useAudioPlayback();

  const tierByRequestRef = useRef<Map<string, string>>(new Map());

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { type?: string; payload?: Record<string, unknown> };

    if (msg.type === "ai.inference_started" && msg.payload?.requestId && msg.payload?.tier) {
      const map = tierByRequestRef.current;
      map.set(msg.payload.requestId as string, msg.payload.tier as string);
      if (map.size > 50) {
        map.delete(map.keys().next().value!);
      }
    }

    if (msg.type === "persona.updated" && msg.payload) {
      setPersona((prev) => ({ ...prev, ...(msg.payload as Persona) }));
      const incoming = msg.payload as Persona & { userName?: string };
      if (incoming.aiName?.trim()) {
        setAiName(incoming.aiName.trim());
      }
      if ((incoming as { userName?: string }).userName?.trim()) {
        setUserName((incoming as { userName?: string }).userName!.trim());
      }
      if (incoming.textColor) {
        applyAccentColor(incoming.textColor);
      }
    }
  }, [setPersona, setAiName, setUserName]);

  const { wsState, sendMessage } = useWebSocket(handleWsMessage);
  useSensorBridge(sendMessage, wsState);

  useEffect(() => {
    document.documentElement.classList.add("dark");

    const loadHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/chat/history?sessionId=${SESSION_ID}&limit=30`);
        const data = await res.json() as { messages: Array<{ id: number; role: string; content: string; channel: string; modelUsed?: string; latencyMs?: number; createdAt: string }> };
        const msgs: ChatMsg[] = data.messages.map((m) => ({
          id: String(m.id),
          role: m.role as Role,
          content: m.content,
          channel: m.channel as Channel,
          modelUsed: m.modelUsed ?? undefined,
          latencyMs: m.latencyMs ?? undefined,
          timestamp: m.createdAt,
        }));
        if (msgs.length > 0) setMessages(msgs);
        else setMessages([jarvisWelcome()]);
      } catch {
        setMessages([jarvisWelcome()]);
      }
    };

    const loadIdentity = async () => {
      try {
        const res = await fetch(`${API_BASE}/voice-identity`);
        setIdentity(await res.json() as VoiceIdentity);
      } catch {}
    };

    const loadUcmIdentity = async () => {
      try {
        const res  = await fetch(`${API_BASE}/ucm`);
        const data = await res.json() as { layers: { identity: { data: { aiName?: string; userName?: string } } } };
        const id   = data?.layers?.identity?.data;
        if (id?.aiName?.trim())   setAiName(id.aiName.trim());
        if (id?.userName?.trim()) setUserName(id.userName.trim());
      } catch {}
    };

    const loadPersona = async () => {
      try {
        const res = await fetch(`${API_BASE}/ai/persona`);
        if (res.ok) {
          const p = await res.json() as Persona;
          setPersona(p);
          if (p.textColor) applyAccentColor(p.textColor);
        }
      } catch {}
    };

    const loadChannelStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/channels/status`);
        if (res.ok) setChannelStatus(await res.json() as ChannelStatus);
      } catch {}
    };

    void loadHistory();
    void loadIdentity();
    void loadUcmIdentity();
    void loadPersona();
    void loadChannelStatus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: ChatMsg = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
      channel: "mobile",
      timestamp: new Date().toISOString(),
    };
    const pendingMsg: ChatMsg = {
      id: `p_${Date.now()}`,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setLoading(true);

    const requestId = `mob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, channel: "mobile", sessionId: SESSION_ID, requestId }),
      });
      const data = await res.json() as { response: string; modelUsed: string; latencyMs: number; fromCache: boolean; tier?: string; reasonCode?: string };
      const tier = tierByRequestRef.current.get(requestId) ?? data.tier;
      tierByRequestRef.current.delete(requestId);
      const aiMsg: ChatMsg = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: data.response,
        channel: "mobile",
        modelUsed: data.modelUsed,
        tier,
        latencyMs: data.latencyMs,
        fromCache: data.fromCache,
        reasonCode: data.reasonCode,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev.filter((m) => !m.pending), aiMsg]);
    } catch {
      setMessages((prev) => [...prev.filter((m) => !m.pending), {
        id: `e_${Date.now()}`,
        role: "assistant",
        content: "Connection lost. Please check your network.",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onVoicePressStart = useCallback(async () => {
    if (loading || voiceState !== "idle" || !micSupported || micDenied) return;
    voicePressedRef.current = true;
    try {
      await startRecording();
      setVoiceState("listening");
    } catch {
      setVoiceState("error");
      setTimeout(() => setVoiceState("idle"), 2000);
    }
  }, [loading, voiceState, micSupported, micDenied, startRecording]);

  const onVoicePressEnd = useCallback(async () => {
    if (!voicePressedRef.current) return;
    voicePressedRef.current = false;
    if (recorderState !== "listening" && voiceState !== "listening") return;

    let base64Audio: string;
    try {
      base64Audio = await stopRecording();
    } catch {
      setVoiceState("error");
      setTimeout(() => setVoiceState("idle"), 2000);
      return;
    }

    if (!base64Audio || base64Audio.length < 100) { setVoiceState("idle"); return; }

    try {
      setVoiceState("transcribing");
      const sttRes = await fetch(`${API_BASE}/vision/stt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio }),
      });
      if (!sttRes.ok) {
        setVoiceState("idle");
        const errData = await sttRes.json().catch(() => ({})) as { reason?: string };
        const reason = errData.reason ?? (sttRes.status === 503 ? "no-stt-key" : "stt-failed");
        const errMsg = reason === "no-stt-key"
          ? "Voice input requires an OpenAI API key. Configure it in desktop Settings → API Keys, then try again."
          : "Voice transcription failed. Please try again or type your message.";
        setMessages((prev) => [...prev, {
          id: `sys_${Date.now()}`,
          role: "system" as const,
          content: errMsg,
          timestamp: new Date().toISOString(),
        }]);
        return;
      }
      const { transcript } = await sttRes.json() as { transcript: string };
      if (!transcript?.trim()) { setVoiceState("idle"); return; }

      const userMsg: ChatMsg = {
        id: `u_voice_${Date.now()}`,
        role: "user",
        content: transcript.trim(),
        channel: "voice",
        timestamp: new Date().toISOString(),
      };
      const pendingMsg: ChatMsg = {
        id: `p_voice_${Date.now()}`,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, pendingMsg]);

      setVoiceState("chatting");
      const voiceRequestId = `mob_v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const chatRes = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: transcript.trim(), channel: "voice", sessionId: SESSION_ID, requestId: voiceRequestId }),
      });
      const chatData = await chatRes.json() as { response: string; modelUsed?: string; tier?: string; latencyMs?: number };
      const voiceTier = tierByRequestRef.current.get(voiceRequestId) ?? chatData.tier;
      tierByRequestRef.current.delete(voiceRequestId);
      const aiMsg: ChatMsg = {
        id: `a_voice_${Date.now()}`,
        role: "assistant",
        content: chatData.response,
        channel: "voice",
        modelUsed: chatData.modelUsed,
        tier: voiceTier,
        latencyMs: chatData.latencyMs,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev.filter((m) => !m.pending), aiMsg]);

      setVoiceState("speaking");
      // Prefer the server-persisted voice from persona (synced across devices),
      // falling back to the locally stored voice key for offline resilience.
      const storedVoice = persona?.voice ?? localStorage.getItem("deckos_voice") ?? undefined;
      const ttsRes = await fetch(`${API_BASE}/vision/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chatData.response, voice: storedVoice }),
      });
      if (ttsRes.ok) {
        const { audio, format } = await ttsRes.json() as { audio: string; format?: string };
        if (audio) await speak(audio, format ?? "mp3").catch(() => {});
      }
    } catch {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setVoiceState("error");
      setTimeout(() => setVoiceState("idle"), 2000);
      return;
    }

    setVoiceState("idle");
  }, [voiceState, recorderState, stopRecording, speak, persona]);

  const onVoiceCancel = useCallback(() => {
    if (!voicePressedRef.current) return;
    voicePressedRef.current = false;
    cancelRecording();
    setVoiceState("idle");
  }, [cancelRecording]);

  return (
    <div className="h-full flex flex-col bg-background text-foreground overflow-hidden select-none">
      <div className="scanline" />

      {/* HEADER */}
      <header className="shrink-0 border-b border-primary/30 bg-card/80 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary/60 flex items-center justify-center bg-primary/10">
            <span className="font-mono text-xs text-primary font-bold">{aiName.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <div className="font-bold text-primary tracking-widest text-sm uppercase leading-none">{aiName}</div>
            <div className="font-mono text-xs text-primary/40 leading-none mt-0.5">
              {userName ? `${userName} · Mobile` : "DeckOS.Mobile"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <WsIndicator state={wsState} />
          <button
            onClick={() => setShowSettings(true)}
            className="w-8 h-8 flex items-center justify-center border border-primary/20 text-primary/40 hover:border-primary/50 hover:text-primary/70 transition-colors"
            aria-label="Settings"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 overscroll-contain">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* CHANNEL INDICATOR */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-t border-primary/10 bg-card/30">
        <span className="font-mono text-xs text-primary/30">CHANNEL:</span>
        <span className="font-mono text-xs text-[#00d4ff]">MOBILE</span>
        <span className="font-mono text-xs text-primary/20 ml-auto">SESSION.{SESSION_ID.slice(-6).toUpperCase()}</span>
      </div>

      {/* VOICE STATE INDICATOR */}
      {voiceState !== "idle" && (
        <div className={`shrink-0 px-4 py-2 border-t flex items-center gap-2 font-mono text-xs ${
          voiceState === "listening"   ? "border-[#f03248]/30 bg-[#f03248]/5 text-[#f03248]" :
          voiceState === "speaking"    ? "border-[#11d97a]/30 bg-[#11d97a]/5 text-[#11d97a]" :
          voiceState === "error"       ? "border-[#f03248]/30 bg-[#f03248]/5 text-[#f03248]" :
          "border-[#ffc820]/30 bg-[#ffc820]/5 text-[#ffc820]"
        }`}>
          <span className="animate-pulse">●</span>
          <span className="uppercase tracking-wider">
            {voiceState === "listening" ? "LISTENING — release to send" :
             voiceState === "transcribing" ? "TRANSCRIBING…" :
             voiceState === "chatting" ? "THINKING…" :
             voiceState === "speaking" ? "SPEAKING…" : "ERROR"}
          </span>
        </div>
      )}

      {/* SETTINGS PANEL */}
      {showSettings && (
        <SettingsPanel
          aiName={aiName}
          userName={userName ?? ""}
          identity={identity}
          persona={persona}
          channelStatus={channelStatus}
          saving={settingsSaving}
          onClose={() => setShowSettings(false)}
          onSave={async (fields) => {
            setSettingsSaving(true);
            try {
              if (fields.aiName !== undefined || fields.userName !== undefined) {
                await fetch(`${API_BASE}/ucm/identity`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    data: {
                      ...(fields.aiName   !== undefined ? { aiName: fields.aiName }     : {}),
                      ...(fields.userName !== undefined ? { userName: fields.userName } : {}),
                    },
                    merge: true,
                  }),
                });
                if (fields.aiName   !== undefined) setAiName(fields.aiName || "JARVIS");
                if (fields.userName !== undefined) setUserName(fields.userName || null);
              }
              if (fields.persona) {
                const personaRes = await fetch(`${API_BASE}/ai/persona`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(fields.persona),
                });
                if (personaRes.ok) {
                  setPersona((prev) => ({ ...prev, ...fields.persona }));
                  // Keep localStorage in sync so TTS fallback always has the latest voice
                  if (fields.persona.voice) {
                    localStorage.setItem("deckos_voice", fields.persona.voice);
                  }
                }
              }
            } catch {}
            setSettingsSaving(false);
          }}
        />
      )}

      {/* INPUT */}
      <div className="shrink-0 border-t border-primary/30 bg-card/80 p-3">
        <div className={`flex gap-2 items-end border px-3 py-2 transition-colors ${loading ? "border-primary/20 opacity-60" : "pulse-border"}`}>
          <span className="font-mono text-primary/50 text-sm leading-none mt-1.5 shrink-0">&gt;</span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Send a message..."
            className="flex-1 bg-transparent font-mono text-sm text-primary placeholder-primary/25 resize-none outline-none leading-5 max-h-28 disabled:cursor-not-allowed"
            style={{ minHeight: "1.25rem" }}
          />
          {micSupported && !micDenied && (
            <button
              type="button"
              disabled={loading || (voiceState !== "idle" && voiceState !== "listening")}
              className={`shrink-0 w-9 h-9 flex items-center justify-center border transition-all select-none touch-none ${
                voiceState === "listening" ? "border-[#f03248]/60 text-[#f03248]" :
                voiceState === "speaking"  ? "border-[#11d97a]/60 text-[#11d97a]" :
                voiceState !== "idle"      ? "border-[#ffc820]/40 text-[#ffc820]" :
                "border-primary/30 text-primary/50 hover:border-primary/60 hover:text-primary"
              }`}
              aria-label="Voice input"
              onMouseDown={(e) => { e.preventDefault(); void onVoicePressStart(); }}
              onMouseUp={() => void onVoicePressEnd()}
              onMouseLeave={() => { if (voicePressedRef.current) onVoiceCancel(); }}
              onTouchStart={(e) => { e.preventDefault(); void onVoicePressStart(); }}
              onTouchEnd={(e) => { e.preventDefault(); void onVoicePressEnd(); }}
              onTouchCancel={onVoiceCancel}
            >
              {voiceState === "listening" ? (
                <span className="text-[10px] font-mono animate-pulse">●</span>
              ) : voiceState === "speaking" ? (
                <span className="text-[10px] font-mono animate-pulse">♪</span>
              ) : voiceState !== "idle" ? (
                <span className="text-[10px] font-mono animate-spin inline-block">◌</span>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
          )}
          <button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="shrink-0 font-mono text-xs px-3 py-1.5 border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            SEND
          </button>
        </div>
        <div className="font-mono text-xs text-primary/20 mt-1.5 text-right">↵ Enter to send · Shift+↵ newline · hold 🎤 to speak</div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="font-mono text-xs text-primary/30 px-3 py-1 border border-primary/10 bg-card/30">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 msg-in ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* avatar */}
      <div className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center font-mono text-xs mt-1 ${isUser ? "border-primary/30 bg-primary/10 text-primary" : "border-[#00d4ff]/30 bg-[#00d4ff]/5 text-[#00d4ff]"}`}>
        {isUser ? "U" : "J"}
      </div>

      {/* bubble */}
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className={`px-3 py-2 border font-sans text-sm leading-relaxed ${isUser ? "border-primary/30 bg-primary/10 text-primary" : "border-[#00d4ff]/20 bg-[#00d4ff]/5 text-foreground"}`}>
          {msg.pending ? (
            <div className="flex gap-1.5 items-center h-4">
              <div className="typing-dot w-1.5 h-1.5 rounded-full bg-[#00d4ff]/60" />
              <div className="typing-dot w-1.5 h-1.5 rounded-full bg-[#00d4ff]/60" />
              <div className="typing-dot w-1.5 h-1.5 rounded-full bg-[#00d4ff]/60" />
            </div>
          ) : (
            <span className="whitespace-pre-wrap break-words">{msg.content}</span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-primary/25 flex-wrap">
          <span>{formatTime(msg.timestamp)}</span>
          {!msg.pending && msg.role === "assistant" && msg.tier && (
            <TierBadge tier={msg.tier} />
          )}
          {!msg.pending && msg.role === "assistant" && msg.modelUsed && (
            <ReasonBadge reasonCode={msg.reasonCode} modelUsed={msg.modelUsed} fromCache={msg.fromCache} latencyMs={msg.latencyMs} />
          )}
          {!msg.pending && msg.role === "assistant" && !msg.id.startsWith("welcome") && (
            <>
              <span>·</span>
              <span className="text-primary/15">saved to memory</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const color =
    tier === "cortex"    ? "text-[#cc44ff]" :
    tier === "reflex"    ? "text-[#ffc820]" :
                           "text-[#11d97a]";
  return (
    <>
      <span>·</span>
      <span className={`uppercase font-bold tracking-wider ${color}`}>{tier}</span>
    </>
  );
}

function ReasonBadge({ reasonCode, modelUsed, fromCache, latencyMs }: {
  reasonCode?: string;
  modelUsed: string;
  fromCache?: boolean;
  latencyMs?: number;
}) {
  const code  = reasonCode ?? (fromCache ? "cached" : modelUsed.includes("rule-engine") ? "rule-engine" : "ai-inference");
  const label = code === "cached" ? "⚡ cached" : code === "rule-engine" ? "rule engine" : "AI inference";
  const color = code === "cached" ? "text-[#aa88ff]/50" : code === "rule-engine" ? "text-[#ffcc00]/40" : "text-[#00d4ff]/35";
  return (
    <>
      <span>·</span>
      <span className={color}>{label}</span>
      {!!latencyMs && latencyMs > 0 && (
        <>
          <span>·</span>
          <span>{latencyMs}ms</span>
        </>
      )}
    </>
  );
}

function WsIndicator({ state }: { state: "connecting" | "open" | "closed" }) {
  const color = state === "open" ? "bg-[#00ff88]" : state === "connecting" ? "bg-[#ffaa00]" : "bg-[#ff3333]";
  const label = state === "open" ? "LIVE" : state === "connecting" ? "SYNC" : "OFF";
  return (
    <div className="flex items-center gap-1.5 font-mono text-xs">
      <div className={`w-1.5 h-1.5 rounded-full ${color} ${state !== "open" ? "ws-blink" : ""}`} />
      <span className={state === "open" ? "text-[#00ff88]" : state === "connecting" ? "text-[#ffaa00]" : "text-[#ff3333]"}>{label}</span>
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-primary/40">{label}:</span>
      <span className="text-primary/70 truncate">{value}</span>
    </div>
  );
}

type SaveFields = {
  aiName?: string;
  userName?: string;
  persona?: Partial<Persona>;
};

const MOBILE_VOICES = [
  { value: "local-male",     label: "ARGUS",   desc: "Local · Deep, authoritative" },
  { value: "local-female",   label: "ARIA",    desc: "Local · Clear, energetic"    },
  { value: "local-nonbinary", label: "AXIOM",  desc: "Local · Mid-range tone"      },
  { value: "alloy",          label: "ALLOY",   desc: "Cloud · Neutral, balanced"   },
  { value: "echo",           label: "ECHO",    desc: "Cloud · Male, smooth"        },
  { value: "onyx",           label: "ONYX",    desc: "Cloud · Deep, authoritative" },
  { value: "nova",           label: "NOVA",    desc: "Cloud · Female, energetic"   },
  { value: "shimmer",        label: "SHIMMER", desc: "Cloud · Soft, gentle"        },
];

function SettingsPanel({
  aiName, userName, identity, persona, channelStatus, saving, onClose, onSave,
}: {
  aiName: string;
  userName: string;
  identity: VoiceIdentity | null;
  persona: Persona | null;
  channelStatus: ChannelStatus | null;
  saving: boolean;
  onClose: () => void;
  onSave: (fields: SaveFields) => Promise<void>;
}) {
  const [tab, setTab] = useState<"identity" | "persona" | "channels">("identity");
  const [draftAiName, setDraftAiName] = useState(aiName);
  const [draftUserName, setDraftUserName] = useState(userName);
  const [draftAttitude, setDraftAttitude] = useState(persona?.attitude ?? "professional");
  const [draftDepth, setDraftDepth] = useState(persona?.thinkingDepth ?? "standard");
  const [draftLength, setDraftLength] = useState(persona?.responseLength ?? "balanced");
  const [draftVoice, setDraftVoice] = useState(
    persona?.voice ?? localStorage.getItem("deckos_voice") ?? "onyx"
  );
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  // Keep draft in sync with live prop updates (e.g. from desktop rename via WebSocket),
  // but only when the user hasn't already diverged the field from the last known prop value.
  const prevAiNameRef = useRef(aiName);
  useEffect(() => {
    if (draftAiName === prevAiNameRef.current) {
      setDraftAiName(aiName);
    }
    prevAiNameRef.current = aiName;
  }, [aiName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any playing sample when the panel closes
  useEffect(() => () => { sampleAudioRef.current?.pause(); }, []);

  const handleIdentitySave = async (e: FormEvent) => {
    e.preventDefault();
    await onSave({ aiName: draftAiName.trim() || "JARVIS", userName: draftUserName.trim() || undefined });
    onClose();
  };

  const handlePersonaSave = async (e: FormEvent) => {
    e.preventDefault();
    await onSave({
      persona: {
        attitude: draftAttitude,
        thinkingDepth: draftDepth,
        responseLength: draftLength,
        voice: draftVoice,
      },
    });
    onClose();
  };

  const playSample = async (voiceId: string) => {
    if (playingVoice === voiceId) {
      sampleAudioRef.current?.pause();
      setPlayingVoice(null);
      return;
    }
    setPlayingVoice(voiceId);
    try {
      const res = await fetch(`${API_BASE}/vision/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${voiceId} voice online and ready.`, voice: voiceId }),
      });
      if (res.ok) {
        const { audio, format } = await res.json() as { audio: string; format?: string };
        if (!audio) { setPlayingVoice(null); return; }
        const mime = format === "wav" ? "audio/wav" : format === "ogg" ? "audio/ogg" : "audio/mpeg";
        sampleAudioRef.current?.pause();
        const el = new Audio(`data:${mime};base64,${audio}`);
        sampleAudioRef.current = el;
        el.onended = () => setPlayingVoice(null);
        el.onerror = () => setPlayingVoice(null);
        await el.play().catch(() => setPlayingVoice(null));
      } else {
        setPlayingVoice(null);
      }
    } catch {
      setPlayingVoice(null);
    }
  };

  const ATTITUDES = ["professional", "casual", "witty", "serious", "empathetic", "commanding", "gentle", "playful"];
  const DEPTHS    = ["quick", "standard", "detailed"];
  const LENGTHS   = ["brief", "balanced", "thorough", "comprehensive"];

  const CHANNEL_ICONS: Record<string, string> = {
    discord: "🟣", telegram: "✈️", whatsapp: "💬", imessage: "🍎",
    slack: "🔷", signal: "🔵", line: "🟢", matrix: "⬛", irc: "📡", sms: "📱",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="scanline pointer-events-none" />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-primary/30 bg-card/80">
        <span className="font-mono text-sm text-primary tracking-widest uppercase">System Settings</span>
        <button onClick={onClose} className="font-mono text-xs px-2 py-1 border border-primary/20 text-primary/50 hover:border-primary/50 hover:text-primary transition-colors">
          ✕ CLOSE
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-primary/20">
        {(["identity", "persona", "channels"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${
              tab === t ? "border-b-2 border-primary text-primary bg-primary/5" : "text-primary/30 hover:text-primary/60"
            }`}
          >
            {t === "identity" ? "Identity" : t === "persona" ? "AI Persona" : "Channels"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {/* Identity Tab */}
        {tab === "identity" && (
          <form onSubmit={(e) => void handleIdentitySave(e)} className="space-y-4">
            <p className="font-mono text-xs text-primary/30 leading-relaxed">
              These values control how the AI introduces itself and addresses you across all channels.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block font-mono text-xs text-primary/40 uppercase tracking-widest mb-1.5">AI Designation</label>
                <input
                  value={draftAiName}
                  onChange={(e) => setDraftAiName(e.target.value)}
                  maxLength={32}
                  placeholder="JARVIS"
                  className="w-full bg-transparent border border-primary/30 px-3 py-2 font-mono text-sm text-primary placeholder-primary/20 outline-none focus:border-primary/60"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-primary/40 uppercase tracking-widest mb-1.5">Your Name</label>
                <input
                  value={draftUserName}
                  onChange={(e) => setDraftUserName(e.target.value)}
                  maxLength={32}
                  placeholder="Commander"
                  className="w-full bg-transparent border border-primary/30 px-3 py-2 font-mono text-sm text-primary placeholder-primary/20 outline-none focus:border-primary/60"
                />
              </div>
              {identity && (
                <div className="border border-primary/10 bg-primary/5 p-3 space-y-1">
                  <p className="font-mono text-[9px] text-primary/25 uppercase tracking-widest mb-2">Voice Identity (read-only)</p>
                  {[
                    ["Voice ID", identity.voiceId],
                    ["Tone", identity.tone],
                    ["Pacing", identity.pacing],
                    ["Formality", `${identity.formality}%`],
                    ["Verbosity", `${identity.verbosity}%`],
                    ["Emotion Range", identity.emotionRange],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between font-mono text-xs">
                      <span className="text-primary/30">{l}</span>
                      <span className="text-primary/60">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 font-mono text-xs border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-40 transition-colors uppercase tracking-widest"
            >
              {saving ? "Saving…" : "Save Identity"}
            </button>

            {/* Pairing status & re-link */}
            {localStorage.getItem(PAIRING_KEY) && (
              <div className="border-t border-primary/10 pt-3 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[9px] text-primary/30 uppercase tracking-widest">Linked to Desktop</p>
                  <p className="font-mono text-[10px] text-primary/50">
                    Code: <span className="text-primary/70">{localStorage.getItem(PAIRING_KEY)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem(PAIRING_KEY);
                    localStorage.removeItem(SESSION_ID_KEY);
                    window.location.reload();
                  }}
                  className="font-mono text-[10px] text-primary/30 border border-primary/15 px-2 py-1 hover:border-[#f03248]/40 hover:text-[#f03248]/60 transition-colors"
                >
                  RE-LINK
                </button>
              </div>
            )}
          </form>
        )}

        {/* Persona Tab */}
        {tab === "persona" && (
          <form onSubmit={(e) => void handlePersonaSave(e)} className="space-y-4">
            <p className="font-mono text-xs text-primary/30 leading-relaxed">
              Controls the AI's communication style across all channels including Discord, Telegram, and WhatsApp.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block font-mono text-xs text-primary/40 uppercase tracking-widest mb-2">Attitude</label>
                <div className="grid grid-cols-2 gap-2">
                  {ATTITUDES.map((a) => (
                    <button
                      key={a} type="button"
                      onClick={() => setDraftAttitude(a)}
                      className={`py-2 font-mono text-xs border transition-colors capitalize ${
                        draftAttitude === a ? "border-primary/60 bg-primary/10 text-primary" : "border-primary/15 text-primary/35 hover:border-primary/35"
                      }`}
                    >{a}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-mono text-xs text-primary/40 uppercase tracking-widest mb-2">Thinking Depth</label>
                <div className="flex gap-2">
                  {DEPTHS.map((d) => (
                    <button
                      key={d} type="button"
                      onClick={() => setDraftDepth(d)}
                      className={`flex-1 py-2 font-mono text-xs border transition-colors capitalize ${
                        draftDepth === d ? "border-primary/60 bg-primary/10 text-primary" : "border-primary/15 text-primary/35 hover:border-primary/35"
                      }`}
                    >{d}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-mono text-xs text-primary/40 uppercase tracking-widest mb-2">Response Length</label>
                <div className="flex gap-2 flex-wrap">
                  {LENGTHS.map((l) => (
                    <button
                      key={l} type="button"
                      onClick={() => setDraftLength(l)}
                      className={`flex-1 py-2 font-mono text-xs border transition-colors capitalize ${
                        draftLength === l ? "border-primary/60 bg-primary/10 text-primary" : "border-primary/15 text-primary/35 hover:border-primary/35"
                      }`}
                    >{l}</button>
                  ))}
                </div>
              </div>

              {/* Voice Picker */}
              <div>
                <label className="block font-mono text-xs text-primary/40 uppercase tracking-widest mb-2">Voice</label>
                <div className="grid grid-cols-2 gap-2">
                  {MOBILE_VOICES.map((v) => {
                    const isSelected = draftVoice === v.value;
                    const isPlaying  = playingVoice === v.value;
                    return (
                      <div
                        key={v.value}
                        onClick={() => setDraftVoice(v.value)}
                        className={`relative flex items-center justify-between px-3 py-2.5 border cursor-pointer transition-colors ${
                          isSelected
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-primary/15 text-primary/35 hover:border-primary/35"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className={`font-mono text-xs tracking-wider ${isSelected ? "text-primary" : "text-primary/50"}`}>
                            {v.label}
                          </p>
                          <p className={`font-mono text-[9px] leading-tight mt-0.5 ${isSelected ? "text-primary/50" : "text-primary/25"}`}>
                            {v.desc}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void playSample(v.value); }}
                          className={`shrink-0 ml-2 w-6 h-6 flex items-center justify-center border text-[9px] transition-colors ${
                            isPlaying
                              ? "border-primary/60 text-primary animate-pulse"
                              : "border-primary/20 text-primary/30 hover:border-primary/50 hover:text-primary/60"
                          }`}
                          aria-label={isPlaying ? "Stop sample" : "Play sample"}
                        >
                          {isPlaying ? "■" : "▶"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 font-mono text-xs border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-40 transition-colors uppercase tracking-widest"
            >
              {saving ? "Saving…" : "Save Persona"}
            </button>
          </form>
        )}

        {/* Channels Tab */}
        {tab === "channels" && channelStatus && (
          <div className="space-y-3">
            <div className="border border-primary/10 bg-primary/5 p-3">
              <p className="font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-1">Inbound Webhook (OpenClaw)</p>
              <p className="font-mono text-xs text-primary/60 break-all">{channelStatus.inboundWebhook}</p>
              <p className="font-mono text-[9px] text-primary/25 mt-1 leading-relaxed">{channelStatus.note}</p>
            </div>
            {Object.entries(channelStatus.channels).map(([name, ch]) => (
              <div key={name} className={`border p-3 ${ch.configured ? "border-[#00ff88]/20 bg-[#00ff88]/3" : "border-primary/10 bg-card/20"}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span>{CHANNEL_ICONS[name] ?? "📨"}</span>
                    <span className="font-mono text-xs text-primary/70 uppercase tracking-wider">{name}</span>
                  </div>
                  <span className={`font-mono text-[10px] ${ch.configured ? "text-[#00ff88]" : "text-primary/25"}`}>
                    {ch.configured ? "● ACTIVE" : "○ NOT SET"}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-primary/35 leading-relaxed">{ch.instructions}</p>
                {ch.note && <p className="font-mono text-[9px] text-primary/20 mt-1 italic">{ch.note}</p>}
              </div>
            ))}
            <div className="border border-primary/10 p-3 bg-card/20">
              <p className="font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-1">OpenClaw Setup</p>
              <p className="font-mono text-[10px] text-primary/40 leading-relaxed">
                Run <span className="text-primary/60">openclaw configure</span> to set up your channels, then point OpenClaw's AI bridge to POST to the webhook URL above.
              </p>
            </div>
          </div>
        )}
        {tab === "channels" && !channelStatus && (
          <div className="flex items-center justify-center h-32">
            <span className="font-mono text-xs text-primary/25 animate-pulse">Loading channel status…</span>
          </div>
        )}

      </div>
    </div>
  );
}

function getTimeGreeting(): string {
  try {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    if (hour >= 17 && hour < 22) return "Good evening";
    return "Good night";
  } catch {
    return "Hello";
  }
}

function jarvisWelcome(): ChatMsg {
  return {
    id: "welcome",
    role: "assistant",
    content: `${getTimeGreeting()}. DeckOS online. All systems nominal. How can I assist you?`,
    channel: "mobile",
    timestamp: new Date().toISOString(),
  };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
