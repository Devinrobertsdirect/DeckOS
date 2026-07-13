import { Router } from "express";
import { z } from "zod";
import { traceState } from "../lib/trace.js";

const router = Router();

router.get("/trace", (req, res) => {
  res.json({ traceMode: traceState.isEnabled() });
});

router.put("/trace", (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Body must be { enabled: boolean }" });
    return;
  }
  traceState.setEnabled(parsed.data.enabled);
  res.json({ traceMode: traceState.isEnabled() });
});

export default router;
