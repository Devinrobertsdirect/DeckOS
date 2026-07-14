import { Router } from "express";
import { DECKOS_CAPABILITIES } from "../lib/capabilities.js";

/**
 * GET /api/capabilities — the DeckOS capability manifest.
 *
 * Serves the same list Atlas's brain is briefed on, so the buddy's "what can I
 * do?" launcher shows exactly what DeckOS can do and can open any tool by its
 * uiRoute. Static, DB-free, always available.
 */
const router = Router();

router.get("/capabilities", (_req, res) => {
  res.json({ capabilities: DECKOS_CAPABILITIES, count: DECKOS_CAPABILITIES.length });
});

export default router;
