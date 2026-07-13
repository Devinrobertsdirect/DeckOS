import { randomUUID } from "crypto";

export type SessionPhase =
  | "idle"
  | "calibrating"
  | "ready"
  | "recording"
  | "done"
  | "analyzing";

export interface SignalSample {
  ts: number;
  amplitude: number;
  bpm: number | null;
  contraction: string;
  brainEvent: string;
  heartEvent: string;
}

export interface QuestionRecord {
  id: string;
  question: string;
  askedAt: number;
  samples: SignalSample[];
  stressScore: number;
  bpmDelta: number | null;
  amplitudeDelta: number;
  verdict: "truthful" | "inconclusive" | "deceptive";
}

export interface BaselineStats {
  amplitudeMean: number;
  amplitudeStd: number;
  bpmMean: number | null;
  samples: SignalSample[];
}

export interface PolygraphSession {
  sessionId: string;
  phase: SessionPhase;
  startedAt: number;
  calibrationStartedAt: number | null;
  calibrationEndsAt: number | null;
  baseline: BaselineStats | null;
  questions: QuestionRecord[];
  currentQuestion: QuestionRecord | null;
  analysis: string | null;
  analysisAt: number | null;
}

const CALIBRATION_MS = 30_000;

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr: number[], mu: number): number {
  if (arr.length < 2) return 0.01;
  const variance = arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length;
  return Math.max(Math.sqrt(variance), 0.01);
}

function computeBaseline(samples: SignalSample[]): BaselineStats {
  const amps = samples.map((s) => s.amplitude);
  const bpms = samples.map((s) => s.bpm).filter((b): b is number => b !== null);
  const aMean = mean(amps);
  return {
    amplitudeMean: aMean,
    amplitudeStd: std(amps, aMean),
    bpmMean: bpms.length > 0 ? mean(bpms) : null,
    samples,
  };
}

function scoreQuestion(q: QuestionRecord, baseline: BaselineStats): QuestionRecord {
  const qAmps = q.samples.map((s) => s.amplitude);
  const qBpms = q.samples.map((s) => s.bpm).filter((b): b is number => b !== null);

  const qAmpMean = mean(qAmps);
  const stressScore = (qAmpMean - baseline.amplitudeMean) / baseline.amplitudeStd;

  const bpmDelta =
    baseline.bpmMean !== null && qBpms.length > 0
      ? mean(qBpms) - baseline.bpmMean
      : null;

  let verdict: QuestionRecord["verdict"] = "truthful";
  if (stressScore > 2.0 || (bpmDelta !== null && bpmDelta > 12)) {
    verdict = "deceptive";
  } else if (stressScore > 1.0 || (bpmDelta !== null && bpmDelta > 6)) {
    verdict = "inconclusive";
  }

  return { ...q, stressScore, amplitudeDelta: qAmpMean - baseline.amplitudeMean, bpmDelta, verdict };
}

class PolygraphSessionManager {
  private session: PolygraphSession | null = null;
  private calibTimer: NodeJS.Timeout | null = null;

  getSession(): PolygraphSession | null {
    return this.session;
  }

  startSession(): PolygraphSession {
    if (this.calibTimer) clearTimeout(this.calibTimer);

    const now = Date.now();
    this.session = {
      sessionId: randomUUID(),
      phase: "calibrating",
      startedAt: now,
      calibrationStartedAt: now,
      calibrationEndsAt: now + CALIBRATION_MS,
      baseline: null,
      questions: [],
      currentQuestion: null,
      analysis: null,
      analysisAt: null,
    };

    this.calibTimer = setTimeout(() => {
      if (this.session?.phase === "calibrating") {
        const baseline = computeBaseline(this._calibSamples);
        this.session = { ...this.session, phase: "ready", baseline };
      }
      this._calibSamples = [];
    }, CALIBRATION_MS);

    return this.session;
  }

  private _calibSamples: SignalSample[] = [];
  private _questionSamples: SignalSample[] = [];
  private _questionTimer: NodeJS.Timeout | null = null;

  recordSample(sample: SignalSample): void {
    if (!this.session) return;

    if (this.session.phase === "calibrating") {
      this._calibSamples.push(sample);
    } else if (this.session.phase === "recording") {
      this._questionSamples.push(sample);
    }
  }

  addQuestion(question: string): QuestionRecord | null {
    if (!this.session || this.session.phase !== "ready") return null;

    if (this._questionTimer) clearTimeout(this._questionTimer);

    const qRecord: QuestionRecord = {
      id: randomUUID(),
      question,
      askedAt: Date.now(),
      samples: [],
      stressScore: 0,
      bpmDelta: null,
      amplitudeDelta: 0,
      verdict: "inconclusive",
    };

    this._questionSamples = [];
    this.session = { ...this.session, phase: "recording", currentQuestion: qRecord };

    this._questionTimer = setTimeout(() => {
      this.commitQuestion();
    }, 10_000);

    return qRecord;
  }

  commitQuestion(): QuestionRecord | null {
    if (!this.session || this.session.phase !== "recording" || !this.session.currentQuestion) return null;
    if (this._questionTimer) { clearTimeout(this._questionTimer); this._questionTimer = null; }

    const q: QuestionRecord = {
      ...this.session.currentQuestion,
      samples: [...this._questionSamples],
    };

    const scored = this.session.baseline ? scoreQuestion(q, this.session.baseline) : q;
    this._questionSamples = [];

    this.session = {
      ...this.session,
      phase: "ready",
      questions: [...this.session.questions, scored],
      currentQuestion: null,
    };

    return scored;
  }

  finishSession(): boolean {
    if (!this.session || this.session.phase !== "ready") return false;
    if (this.session.questions.length === 0) return false;
    this.session = { ...this.session, phase: "done" };
    return true;
  }

  setAnalyzing(): void {
    if (this.session) this.session = { ...this.session, phase: "analyzing" };
  }

  setAnalysis(text: string): void {
    if (this.session) {
      this.session = { ...this.session, phase: "done", analysis: text, analysisAt: Date.now() };
    }
  }

  resetSession(): void {
    if (this.calibTimer) clearTimeout(this.calibTimer);
    if (this._questionTimer) clearTimeout(this._questionTimer);
    this.session = null;
    this._calibSamples = [];
    this._questionSamples = [];
  }
}

export const polygraphSession = new PolygraphSessionManager();
