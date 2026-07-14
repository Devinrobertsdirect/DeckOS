import { Router } from "express";
import { z } from "zod/v4";
import { runAgent } from "../lib/skills.js";

/**
 * POST /api/agent — Atlas's action pre-flight.
 *
 * The buddy sends every message here first. If it's a DeckOS ACTION (drive,
 * remember, open a tool, status…) the skill runs and we return what Atlas should
 * say plus an optional UI instruction. If it's just conversation, we return
 * { mode: "chat" } and the client streams a normal reply. Deterministic and
 * fast, so it never slows down plain chat.
 */
const router = Router();

const Schema = z.object({
  message: z.string().min(1).max(4096),
  facts: z.array(z.string()).optional(),
});

router.post("/agent", async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const decision = await runAgent(parsed.data.message, parsed.data.facts ?? []);
    res.json(decision);
  } catch (err) {
    // Never block the buddy — fall back to conversation on any skill error.
    req.log?.error?.({ err }, "agent skill failed");
    res.json({ mode: "chat" });
  }
});

export default router;
