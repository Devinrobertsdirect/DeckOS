import { Router } from "express";
import { SNARK, SNARK_TRIGGERS, snarkFor, snarkGate, allSnarkLines, type SnarkTrigger } from "../lib/snark.js";

const router = Router();

// GET /api/snark              → a random quip from the whole matrix (ungated)
// GET /api/snark?trigger=mute → a COOLDOWN-GATED quip for that event.
//   Returns { line } the first time; { line: null, cooldown: true, retryInMs }
//   until the cooldown passes — so repeating the same action stays quiet.
//   Optional: &cooldownMs=<n> to override the window, &force=1 to bypass it.
router.get("/snark", (req, res) => {
  const trigger = String(req.query.trigger || "") as SnarkTrigger;
  if (trigger && (SNARK_TRIGGERS as string[]).includes(trigger)) {
    if (req.query.force === "1") {
      res.json({ trigger, line: snarkFor(trigger), forced: true });
      return;
    }
    const cooldownMs = Number(req.query.cooldownMs);
    const gate = snarkGate(trigger, Number.isFinite(cooldownMs) && cooldownMs >= 0 ? { cooldownMs } : undefined);
    if (gate.line) {
      res.json({ trigger, line: gate.line, cooldownMs: gate.cooldownMs });
    } else {
      res.json({ trigger, line: null, cooldown: true, retryInMs: gate.retryInMs });
    }
    return;
  }
  const all = allSnarkLines();
  res.json({ trigger: "any", line: all[Math.floor(Math.random() * all.length)] });
});

// GET /api/snark/all → the full matrix (triggers + lines), for tooling/UI.
router.get("/snark/all", (_req, res) => {
  res.json({ triggers: SNARK_TRIGGERS, count: allSnarkLines().length, matrix: SNARK });
});

export default router;
