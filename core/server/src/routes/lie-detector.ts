import { Router } from "express";
import { bus } from "../lib/bus.js";
import { polygraphSession } from "../lib/polygraph-session.js";

const router = Router();

router.get("/lie-detector/session", (_req, res) => {
  const session = polygraphSession.getSession();
  if (!session) {
    res.json({ session: null });
    return;
  }

  const now = Date.now();
  const calibRemaining =
    session.phase === "calibrating" && session.calibrationEndsAt
      ? Math.max(0, Math.ceil((session.calibrationEndsAt - now) / 1000))
      : 0;

  res.json({
    session: {
      ...session,
      calibRemainingSeconds: calibRemaining,
      currentQuestion: session.currentQuestion
        ? { id: session.currentQuestion.id, question: session.currentQuestion.question, askedAt: session.currentQuestion.askedAt }
        : null,
    },
  });
});

router.post("/lie-detector/session/start", (_req, res) => {
  const session = polygraphSession.startSession();
  bus.emit({
    source: "lie_detector",
    target: null,
    type: "lie_detector.session.started",
    payload: { sessionId: session.sessionId },
  });
  res.json({ ok: true, sessionId: session.sessionId, phase: session.phase });
});

router.post("/lie-detector/session/question", (req, res) => {
  const { question } = req.body as { question?: string };
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const session = polygraphSession.getSession();
  if (!session) {
    res.status(409).json({ error: "No active session. Start a session first." });
    return;
  }
  if (session.phase !== "ready") {
    res.status(409).json({ error: `Cannot ask question in phase '${session.phase}'. Phase must be 'ready'.` });
    return;
  }

  const q = polygraphSession.addQuestion(question.trim());
  if (!q) {
    res.status(409).json({ error: "Failed to start question recording" });
    return;
  }

  bus.emit({
    source: "lie_detector",
    target: null,
    type: "lie_detector.question.started",
    payload: { questionId: q.id, question: q.question },
  });

  res.json({ ok: true, questionId: q.id, recordingForSeconds: 10 });
});

router.post("/lie-detector/session/commit", (_req, res) => {
  const session = polygraphSession.getSession();
  if (!session || session.phase !== "recording") {
    res.status(409).json({ error: "No question currently recording." });
    return;
  }

  const scored = polygraphSession.commitQuestion();
  if (!scored) {
    res.status(500).json({ error: "Failed to commit question" });
    return;
  }

  bus.emit({
    source: "lie_detector",
    target: null,
    type: "lie_detector.question.committed",
    payload: { questionId: scored.id, stressScore: scored.stressScore, verdict: scored.verdict },
  });

  res.json({ ok: true, question: scored });
});

router.post("/lie-detector/session/finish", (_req, res) => {
  const ok = polygraphSession.finishSession();
  if (!ok) {
    const session = polygraphSession.getSession();
    const reason = !session
      ? "No active session"
      : session.questions.length === 0
      ? "No questions recorded yet"
      : `Cannot finish in phase '${session.phase}'`;
    res.status(409).json({ error: reason });
    return;
  }

  const session = polygraphSession.getSession()!;
  bus.emit({
    source: "lie_detector",
    target: null,
    type: "lie_detector.session.finished",
    payload: { sessionId: session.sessionId, questionCount: session.questions.length },
  });

  res.json({ ok: true, questionCount: session.questions.length });
});

router.post("/lie-detector/session/analyze", (_req, res) => {
  const session = polygraphSession.getSession();
  if (!session) {
    res.status(409).json({ error: "No active session" });
    return;
  }
  if (session.phase !== "done") {
    res.status(409).json({ error: `Session must be in 'done' phase to analyze. Currently: '${session.phase}'` });
    return;
  }

  bus.emit({
    source: "lie_detector",
    target: null,
    type: "lie_detector.analyze.request",
    payload: { sessionId: session.sessionId },
  });

  res.json({ ok: true, message: "Analysis requested — JARVIS is processing bioelectric data" });
});

router.delete("/lie-detector/session", (_req, res) => {
  polygraphSession.resetSession();
  res.json({ ok: true });
});

export default router;
