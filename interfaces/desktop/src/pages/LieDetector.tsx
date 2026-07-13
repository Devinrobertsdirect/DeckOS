import { useEffect, useRef, useState, useCallback } from "react";
import { useLatestEvent } from "@/contexts/WebSocketContext";
import { useStarkConnect } from "@/hooks/useStarkConnect";
import { HudCorners } from "@/components/HudCorners";
import {
  Scan,
  Activity,
  Brain,
  Heart,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  ChevronRight,
  RotateCcw,
  Loader2,
  ShieldAlert,
} from "lucide-react";

const BASE = "/api";

type Phase = "idle" | "calibrating" | "ready" | "recording" | "done" | "analyzing";

interface QuestionResult {
  id: string;
  question: string;
  stressScore: number;
  amplitudeDelta: number;
  bpmDelta: number | null;
  verdict: "truthful" | "inconclusive" | "deceptive";
}

interface SessionData {
  sessionId: string;
  phase: Phase;
  calibRemainingSeconds: number;
  baseline: { amplitudeMean: number; amplitudeStd: number; bpmMean: number | null } | null;
  questions: QuestionResult[];
  currentQuestion: { id: string; question: string; askedAt: number } | null;
  analysis: string | null;
}

const VERDICT_COLOR: Record<QuestionResult["verdict"], string> = {
  truthful: "text-emerald-400",
  inconclusive: "text-yellow-400",
  deceptive: "text-red-400",
};

const VERDICT_LABEL: Record<QuestionResult["verdict"], string> = {
  truthful: "TRUTHFUL",
  inconclusive: "INCONCLUSIVE",
  deceptive: "DECEPTIVE",
};

const VERDICT_ICON: Record<QuestionResult["verdict"], React.ReactNode> = {
  truthful: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
  inconclusive: <AlertTriangle className="w-3 h-3 text-yellow-400" />,
  deceptive: <XCircle className="w-3 h-3 text-red-400" />,
};

function StressBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, (score / 3) * 100));
  const color = score > 2 ? "bg-red-500" : score > 1 ? "bg-yellow-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-primary/10 overflow-hidden">
        <div className={`h-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-primary/60 w-8 text-right">{score.toFixed(1)}σ</span>
    </div>
  );
}

function LiveWaveform({ waveform, active }: { waveform: number[]; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!active || waveform.length < 2) {
      ctx.strokeStyle = "rgba(var(--primary-rgb),0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    const step = w / (waveform.length - 1);
    ctx.strokeStyle = "rgba(var(--primary-rgb),0.9)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(var(--primary-rgb),0.6)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    waveform.forEach((v, i) => {
      const x = i * step;
      const y = h / 2 - (v * h * 0.45);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [waveform, active]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={60}
      className="w-full h-[60px]"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

function RecordingCountdown({ askedAt }: { askedAt: number }) {
  const [remaining, setRemaining] = useState(10);

  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - askedAt) / 1000;
      setRemaining(Math.max(0, Math.ceil(10 - elapsed)));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [askedAt]);

  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="text-primary/50">RECORDING CLOSES IN</span>
      <span className="text-2xl font-bold text-red-400">{remaining}</span>
      <span className="text-primary/50">SEC</span>
    </div>
  );
}

export default function LieDetector() {
  const stark = useStarkConnect();
  const analysisEvent = useLatestEvent("lie_detector.analysis.complete");

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [localPhase, setLocalPhase] = useState<Phase>("idle");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/lie-detector/session`);
      const json = await res.json() as { session: SessionData | null };
      setSession(json.session);
      if (json.session) setLocalPhase(json.session.phase);
      else setLocalPhase("idle");
    } catch {
      // ignore transient
    }
  }, []);

  useEffect(() => {
    fetchSession();
    pollingRef.current = setInterval(fetchSession, 1000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchSession]);

  useEffect(() => {
    if (analysisEvent && session) {
      fetchSession();
    }
  }, [analysisEvent, fetchSession]);

  async function startSession() {
    setLoading(true); setError(null);
    try {
      await fetch(`${BASE}/lie-detector/session/start`, { method: "POST" });
      await fetchSession();
    } catch { setError("Failed to start session."); } finally { setLoading(false); }
  }

  async function askQuestion() {
    if (!question.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/lie-detector/session/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      if (!res.ok) {
        const j = await res.json() as { error: string };
        setError(j.error);
      } else {
        setQuestion("");
        await fetchSession();
      }
    } catch { setError("Failed to submit question."); } finally { setLoading(false); }
  }

  async function commitQuestion() {
    setLoading(true); setError(null);
    try {
      await fetch(`${BASE}/lie-detector/session/commit`, { method: "POST" });
      await fetchSession();
    } catch { setError("Failed to commit."); } finally { setLoading(false); }
  }

  async function finishSession() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/lie-detector/session/finish`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json() as { error: string };
        setError(j.error);
      } else {
        await fetchSession();
      }
    } catch { setError("Failed to finish session."); } finally { setLoading(false); }
  }

  async function analyzeSession() {
    setLoading(true); setError(null);
    try {
      await fetch(`${BASE}/lie-detector/session/analyze`, { method: "POST" });
      await fetchSession();
    } catch { setError("Failed to request analysis."); } finally { setLoading(false); }
  }

  async function resetSession() {
    setLoading(true); setError(null);
    try {
      await fetch(`${BASE}/lie-detector/session`, { method: "DELETE" });
      setSession(null);
      setLocalPhase("idle");
      setQuestion("");
    } catch { setError("Failed to reset."); } finally { setLoading(false); }
  }

  const phase = session?.phase ?? localPhase;
  const starkActive = stark.status === "active";

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="relative border border-primary/30 bg-card/40 p-4">
        <HudCorners />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scan className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-mono text-sm text-primary tracking-widest">POLYGRAPH.SUITE</h1>
              <p className="font-mono text-[10px] text-primary/50">PSYCHOPHYSIOLOGICAL DECEPTION ANALYSIS // STARK-INTEGRATED</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <Activity className={`w-3 h-3 ${starkActive ? "text-emerald-400" : "text-primary/30"}`} />
              <span className={starkActive ? "text-emerald-400" : "text-primary/30"}>
                {starkActive ? `${stark.mode.toUpperCase()} ACTIVE` : "STARK DISCONNECTED"}
              </span>
            </div>
            {phase !== "idle" && (
              <button
                onClick={resetSession}
                className="hud-glow-hover flex items-center gap-1 font-mono text-[10px] text-primary/40 hover:text-primary/80 transition-colors border border-primary/20 px-2 py-1"
              >
                <RotateCcw className="w-3 h-3" /> RESET
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stark warning if not connected */}
      {!starkActive && phase === "idle" && (
        <div className="border border-yellow-500/30 bg-yellow-500/5 p-3 font-mono text-[11px] text-yellow-400/80 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Stark biosensor not connected. The polygraph will run in software-only mode using simulated baseline
            deviation. For full physiological accuracy, connect a BioAmp EXG Pill or compatible sensor before starting.
          </span>
        </div>
      )}

      {error && (
        <div className="border border-red-500/40 bg-red-500/5 p-3 font-mono text-xs text-red-400">{error}</div>
      )}

      {/* PHASE: IDLE */}
      {phase === "idle" && (
        <div className="relative border border-primary/20 bg-card/30 p-8 flex flex-col items-center gap-6">
          <HudCorners />
          <Scan className="w-12 h-12 text-primary/30" />
          <div className="text-center space-y-2">
            <p className="font-mono text-sm text-primary/70 tracking-wider">POLYGRAPH SUITE READY</p>
            <p className="font-mono text-[10px] text-primary/40 max-w-md">
              Begin a 30-second baseline calibration, then ask your subject questions. JARVIS will analyze
              physiological stress responses and deliver a deception-probability report.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center font-mono text-[10px]">
            {[
              { icon: <Activity className="w-4 h-4" />, label: "EMG", desc: "Muscle tension" },
              { icon: <Heart className="w-4 h-4" />, label: "EKG", desc: "Heart rate" },
              { icon: <Brain className="w-4 h-4" />, label: "EEG", desc: "Brainwaves" },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="border border-primary/15 bg-primary/5 px-4 py-3 space-y-1">
                <div className="flex justify-center text-primary/50">{icon}</div>
                <div className="text-primary/80 font-bold">{label}</div>
                <div className="text-primary/40">{desc}</div>
              </div>
            ))}
          </div>
          <button
            onClick={startSession}
            disabled={loading}
            className="hud-glow-hover flex items-center gap-2 border border-primary/50 bg-primary/10 hover:bg-primary/20 px-8 py-3 font-mono text-sm text-primary transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            BEGIN CALIBRATION
          </button>
        </div>
      )}

      {/* PHASE: CALIBRATING */}
      {phase === "calibrating" && session && (
        <div className="relative border border-yellow-500/30 bg-yellow-500/5 p-6 space-y-4">
          <HudCorners />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-xs text-yellow-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              ESTABLISHING PHYSIOLOGICAL BASELINE
            </div>
            <div className="font-mono text-2xl font-bold text-yellow-400">
              {session.calibRemainingSeconds}s
            </div>
          </div>
          <div className="font-mono text-[10px] text-yellow-400/60">
            Remain still and breathe normally. JARVIS is recording your baseline EMG amplitude, heart rate, and EEG activity.
          </div>
          <div className="border border-yellow-500/20 bg-black/30 p-3">
            <div className="font-mono text-[9px] text-yellow-400/40 mb-2 uppercase tracking-wider">Live Signal</div>
            <LiveWaveform waveform={stark.waveform} active={starkActive} />
          </div>
          <div className="w-full h-1 bg-primary/10">
            <div
              className="h-full bg-yellow-400/60 transition-all"
              style={{ width: `${((30 - session.calibRemainingSeconds) / 30) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* PHASE: READY or RECORDING */}
      {(phase === "ready" || phase === "recording") && session && (
        <div className="space-y-4">
          {/* Baseline summary */}
          {session.baseline && (
            <div className="border border-primary/15 bg-primary/5 px-4 py-2 font-mono text-[10px] flex items-center gap-6">
              <span className="text-primary/40">BASELINE</span>
              <span className="text-primary/60">
                AMP {session.baseline.amplitudeMean.toFixed(3)} ± {session.baseline.amplitudeStd.toFixed(3)}
              </span>
              {session.baseline.bpmMean !== null && (
                <span className="text-primary/60">BPM {session.baseline.bpmMean.toFixed(1)}</span>
              )}
              {!starkActive && <span className="text-yellow-400/70">— software baseline</span>}
            </div>
          )}

          {/* Current recording phase */}
          {phase === "recording" && session.currentQuestion && (
            <div className="relative border border-red-500/40 bg-red-500/5 p-4 space-y-3">
              <HudCorners />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono text-xs text-red-400">
                  <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  RECORDING PHYSIOLOGICAL RESPONSE
                </div>
                <RecordingCountdown askedAt={session.currentQuestion.askedAt} />
              </div>
              <div className="border border-red-500/20 bg-black/30 p-3">
                <div className="font-mono text-[10px] text-primary/70 mb-2">
                  "{session.currentQuestion.question}"
                </div>
                <LiveWaveform waveform={stark.waveform} active={starkActive} />
                {stark.frame && (
                  <div className="mt-2 flex gap-4 font-mono text-[9px] text-red-400/60">
                    <span>AMP {stark.frame.amplitude.toFixed(3)}</span>
                    {stark.frame.bpm !== null && <span>BPM {stark.frame.bpm}</span>}
                    <span>{stark.frame.contraction}</span>
                    <span>{stark.frame.brainEvent}</span>
                  </div>
                )}
              </div>
              <button
                onClick={commitQuestion}
                disabled={loading}
                className="hud-glow-hover w-full border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 font-mono text-xs text-red-400 transition-all flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                COMMIT RESPONSE NOW
              </button>
            </div>
          )}

          {/* Question input */}
          {phase === "ready" && (
            <div className="relative border border-primary/25 bg-card/30 p-4 space-y-3">
              <HudCorners />
              <div className="font-mono text-xs text-primary/50 uppercase tracking-wider">Enter Question</div>
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") askQuestion(); }}
                  placeholder="e.g. Were you present at the incident on the 14th?"
                  className="flex-1 bg-black/40 border border-primary/30 px-3 py-2 font-mono text-xs text-primary placeholder:text-primary/25 focus:outline-none focus:border-primary/60"
                />
                <button
                  onClick={askQuestion}
                  disabled={loading || !question.trim()}
                  className="hud-glow-hover flex items-center gap-2 border border-primary/40 bg-primary/10 hover:bg-primary/20 px-4 py-2 font-mono text-xs text-primary transition-all disabled:opacity-40"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                  ASK
                </button>
              </div>
              <div className="font-mono text-[10px] text-primary/30">
                JARVIS will record a 10-second physiological window after you submit each question.
              </div>
            </div>
          )}

          {/* Previous questions list */}
          {session.questions.length > 0 && (
            <div className="relative border border-primary/20 bg-card/20 p-4 space-y-3">
              <HudCorners />
              <div className="font-mono text-[10px] text-primary/50 uppercase tracking-wider">
                RECORDED QUESTIONS — {session.questions.length}
              </div>
              <div className="space-y-2">
                {session.questions.map((q, i) => (
                  <div key={q.id} className="border border-primary/10 bg-black/20 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[11px] text-primary/70">
                        <span className="text-primary/40">{i + 1}. </span>"{q.question}"
                      </span>
                      <div className={`flex items-center gap-1 font-mono text-[10px] shrink-0 ${VERDICT_COLOR[q.verdict]}`}>
                        {VERDICT_ICON[q.verdict]}
                        {VERDICT_LABEL[q.verdict]}
                      </div>
                    </div>
                    <StressBar score={q.stressScore} />
                    <div className="flex gap-4 font-mono text-[9px] text-primary/35">
                      <span>AMP Δ {q.amplitudeDelta.toFixed(3)}</span>
                      {q.bpmDelta !== null && <span>BPM Δ {q.bpmDelta > 0 ? "+" : ""}{q.bpmDelta.toFixed(1)}</span>}
                      <span>Z={q.stressScore.toFixed(2)}σ</span>
                    </div>
                  </div>
                ))}
              </div>

              {phase === "ready" && session.questions.length > 0 && (
                <button
                  onClick={finishSession}
                  disabled={loading}
                  className="hud-glow-hover w-full border border-primary/40 bg-primary/10 hover:bg-primary/20 px-4 py-2 font-mono text-xs text-primary transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  FINISH SESSION &amp; PREPARE ANALYSIS
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* PHASE: DONE — ready to analyze */}
      {phase === "done" && session && !session.analysis && (
        <div className="space-y-4">
          <div className="relative border border-primary/25 bg-card/30 p-6 space-y-4">
            <HudCorners />
            <div className="font-mono text-xs text-primary/60 uppercase tracking-wider">Session Complete — {session.questions.length} Questions Recorded</div>
            <div className="space-y-2">
              {session.questions.map((q, i) => (
                <div key={q.id} className="border border-primary/10 bg-black/20 p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[11px] text-primary/70">
                      <span className="text-primary/40">{i + 1}. </span>"{q.question}"
                    </span>
                    <div className={`flex items-center gap-1 font-mono text-[10px] shrink-0 ${VERDICT_COLOR[q.verdict]}`}>
                      {VERDICT_ICON[q.verdict]}
                      {VERDICT_LABEL[q.verdict]}
                    </div>
                  </div>
                  <StressBar score={q.stressScore} />
                </div>
              ))}
            </div>
            <button
              onClick={analyzeSession}
              disabled={loading}
              className="hud-glow-hover w-full border border-primary/50 bg-primary/15 hover:bg-primary/25 px-4 py-3 font-mono text-sm text-primary transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              ANALYZE WITH JARVIS
            </button>
          </div>
        </div>
      )}

      {/* PHASE: ANALYZING */}
      {phase === "analyzing" && (
        <div className="relative border border-primary/25 bg-card/30 p-8 flex flex-col items-center gap-4">
          <HudCorners />
          <Brain className="w-8 h-8 text-primary/50 animate-pulse" />
          <div className="font-mono text-xs text-primary/60 tracking-wider">JARVIS IS PROCESSING BIOELECTRIC DATA…</div>
          <div className="font-mono text-[10px] text-primary/35">Cross-referencing physiological markers against baseline — please wait</div>
        </div>
      )}

      {/* ANALYSIS RESULT */}
      {session?.analysis && phase === "done" && (
        <div className="relative border border-primary/30 bg-card/30 p-5 space-y-3">
          <HudCorners />
          <div className="flex items-center gap-2 font-mono text-xs text-primary/60">
            <Brain className="w-4 h-4" />
            JARVIS POLYGRAPH ANALYSIS REPORT
          </div>
          <div className="border-t border-primary/10 pt-3">
            <p className="font-mono text-xs text-primary/75 leading-relaxed whitespace-pre-wrap">
              {session.analysis}
            </p>
          </div>
          <div className="pt-2 grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
            {session.questions.map((q, i) => (
              <div key={q.id} className={`border px-2 py-1.5 ${q.verdict === "deceptive" ? "border-red-500/40 bg-red-500/5" : q.verdict === "inconclusive" ? "border-yellow-500/30 bg-yellow-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                <div className="text-primary/40 truncate">Q{i + 1}</div>
                <div className={`font-bold ${VERDICT_COLOR[q.verdict]}`}>{VERDICT_LABEL[q.verdict]}</div>
                <div className="text-primary/30">{q.stressScore.toFixed(1)}σ</div>
              </div>
            ))}
          </div>
          <button
            onClick={resetSession}
            disabled={loading}
            className="hud-glow-hover w-full border border-primary/30 hover:border-primary/50 px-4 py-2 font-mono text-xs text-primary/60 hover:text-primary transition-all flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-3 h-3" />
            START NEW SESSION
          </button>
        </div>
      )}
    </div>
  );
}
