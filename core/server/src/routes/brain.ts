import { Router } from "express";
import { getBrainStatus, ensureLocalModel, localPullState } from "../lib/local-model.js";

const router = Router();

// GET /api/brain/status — can Nobi reach a brain, and which one is active?
router.get("/brain/status", async (_req, res) => {
  res.json(await getBrainStatus());
});

// POST /api/brain/ensure-local — kick the auto-install of a local model (if a
// local runtime is present but empty). Fire-and-forget; poll /brain/status.
router.post("/brain/ensure-local", async (_req, res) => {
  void ensureLocalModel();
  res.json({ started: true, ...localPullState() });
});

export default router;
