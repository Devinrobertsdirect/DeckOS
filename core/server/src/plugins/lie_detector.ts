import { Plugin } from "@workspace/event-bus";
import type { PluginContext, BusEvent } from "@workspace/event-bus";
import { runInference } from "../lib/inference.js";
import { botName } from "../lib/identity.js";
import { polygraphSession } from "../lib/polygraph-session.js";

interface StarkSignalEvent {
  mode: string;
  amplitude: number;
  contraction: string;
  brainEvent: string;
  heartEvent: string;
  bpm: number | null;
}

export default class LieDetectorPlugin extends Plugin {
  readonly id = "lie_detector";
  readonly name = "Lie Detector";
  readonly version = "1.0.0";
  readonly description =
    "Polygraph analysis using Stark bioelectric sensors (EMG/EKG/EEG). Detects physiological stress responses to questions and delivers AI-interpreted verdicts.";
  readonly category = "biometric";

  private ctx!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.ctx = context;

    context.subscribe("stark.signal.event", (event: BusEvent) => {
      if (event.type !== "stark.signal.event") return;
      const p = event.payload as StarkSignalEvent;

      polygraphSession.recordSample({
        ts: Date.now(),
        amplitude: p.amplitude ?? 0,
        bpm: p.bpm ?? null,
        contraction: p.contraction ?? "IDLE",
        brainEvent: p.brainEvent ?? "IDLE",
        heartEvent: p.heartEvent ?? "IDLE",
      });
    });

    context.subscribe("stark.scene.update", (event: BusEvent) => {
      if (event.type !== "stark.scene.update") return;
      const p = event.payload as StarkSignalEvent;

      polygraphSession.recordSample({
        ts: Date.now(),
        amplitude: p.amplitude ?? 0,
        bpm: p.bpm ?? null,
        contraction: p.contraction ?? "IDLE",
        brainEvent: p.brainEvent ?? "IDLE",
        heartEvent: p.heartEvent ?? "IDLE",
      });
    });

    context.subscribe("lie_detector.analyze.request", async (event: BusEvent) => {
      if (event.type !== "lie_detector.analyze.request") return;
      const session = polygraphSession.getSession();
      if (!session || session.phase !== "done") return;

      polygraphSession.setAnalyzing();

      const baseline = session.baseline;
      const questions = session.questions;

      const baselineDesc = baseline
        ? `Baseline amplitude: ${baseline.amplitudeMean.toFixed(3)} ± ${baseline.amplitudeStd.toFixed(3)}. Baseline BPM: ${baseline.bpmMean !== null ? baseline.bpmMean.toFixed(1) : "unavailable"}.`
        : "No baseline data captured (Stark device not connected).";

      const questionLines = questions
        .map(
          (q, i) =>
            `Question ${i + 1}: "${q.question}" — stress score: ${q.stressScore.toFixed(2)}, amplitude delta: ${q.amplitudeDelta.toFixed(3)}, BPM delta: ${q.bpmDelta !== null ? q.bpmDelta.toFixed(1) : "N/A"}, preliminary verdict: ${q.verdict.toUpperCase()}.`,
        )
        .join("\n");

      const prompt = `You are ${botName()} running a psychophysiological polygraph analysis. You have just completed a bioelectric stress-response assessment using Stark sensors (EMG muscle tension, EKG heart rate, EEG brainwave activity).

${baselineDesc}

Stress responses per question (Z-score vs baseline):
${questionLines}

Note: A stress score above 2.0 or BPM delta above 12 indicates significant physiological arousal. A score above 1.0 or BPM delta above 6 is borderline. Below 1.0 is within normal range.

Deliver a formal polygraph analysis report in your own voice — measured, precise, and analytical. Address each question individually, explain what the bioelectric data shows, and give an overall assessment. If the Stark device was not connected, note that this is a simulated analysis based on environmental baselines only. Keep it concise but complete — this is a read-back.`;

      const requestId = `lie_detector_${Date.now()}`;

      try {
        const result = await runInference({ prompt, mode: "fast" });

        const analysisText = result.response;
        polygraphSession.setAnalysis(analysisText);

        context.emit({
          source: this.id,
          target: null,
          type: "ai.chat.response",
          payload: {
            requestId,
            response: analysisText,
            modelUsed: result.modelUsed,
            latencyMs: result.latencyMs,
            fromCache: false,
          },
        });

        context.emit({
          source: this.id,
          target: null,
          type: "lie_detector.analysis.complete",
          payload: { sessionId: session.sessionId, analysis: analysisText },
        });
      } catch (err) {
        const errMsg = `[lie_detector] Analysis failed: ${err instanceof Error ? err.message : String(err)}`;
        polygraphSession.setAnalysis(errMsg);
        context.emit({
          source: this.id,
          target: null,
          type: "lie_detector.analysis.complete",
          payload: { sessionId: session.sessionId, analysis: errMsg },
        });
      }
    });

    this.ctx.logger?.info(`[${this.id}] Lie Detector plugin initialized — subscribed to Stark events`);
  }

  async on_event(_event: BusEvent): Promise<void> {}

  async execute(payload: unknown): Promise<unknown> {
    const p = payload as Record<string, unknown> | null;
    const command = String(p?.command ?? "status");

    if (command === "status") {
      return { session: polygraphSession.getSession() };
    }
    if (command === "reset") {
      polygraphSession.resetSession();
      return { ok: true };
    }
    return { error: `Unknown command: ${command}` };
  }

  async shutdown(): Promise<void> {
    polygraphSession.resetSession();
  }
}
