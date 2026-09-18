import { Router } from "express";
import { z } from "zod";
import { getOrCreatePairingCode } from "../lib/pairing.js";
import {
  listGames, startGame, joinGame, actInGame, viewFor,
  currentSession, suspendGame, resumeGame, endGame,
} from "../lib/games/engine.js";

/**
 * games.ts — the table, over HTTP.
 *
 * Phones poll `state` (cheap: they send the version they last saw and get a
 * 204 when nothing has changed) and POST `act`. The face is pushed to over the
 * existing WebSocket, so the room never waits on a poll.
 *
 * Gated by the robot's pairing code, like the rest of the remote: whoever can
 * drive the robot can sit at the table.
 */
const router = Router();

async function ok(req: { body?: unknown; query?: unknown }): Promise<boolean> {
  const b = (req.body ?? {}) as { code?: string };
  const q = (req.query ?? {}) as { code?: string };
  const given = String(b.code ?? q.code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const want = (await getOrCreatePairingCode()).toUpperCase().replace(/\s+/g, "");
  return !!given && given === want;
}

router.get("/games", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  res.json({ games: listGames(), session: currentSession() });
});

const StartSchema = z.object({ code: z.string(), gameId: z.string().max(40) });
router.post("/games/start", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  const p = StartSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "gameId required" }); return; }
  res.json(await startGame(p.data.gameId));
});

router.post("/games/join", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  const b = (req.body ?? {}) as { name?: string; playerId?: string };
  const r = joinGame(String(b.name ?? "").slice(0, 16), b.playerId);
  if ("error" in r) { res.status(409).json(r); return; }
  res.json(r);
});

router.post("/games/act", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  const b = (req.body ?? {}) as { playerId?: string; action?: string; value?: string };
  if (!b.playerId || !b.action) { res.status(400).json({ error: "playerId and action required" }); return; }
  res.json(await actInGame(b.playerId, String(b.action).slice(0, 40), b.value ? String(b.value).slice(0, 200) : undefined));
});

// Long-ish poll: phones send ?since=<version> and get 204 until something moves.
router.get("/games/state", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  const q = req.query as { playerId?: string; since?: string };
  const view = viewFor(String(q.playerId ?? ""));
  if (!view) { res.status(404).json({ error: "no game running" }); return; }
  if (q.since && Number(q.since) === view.version) { res.status(204).end(); return; }
  res.json(view);
});

/** The back arrow: the game keeps its state, the face goes back to being a face. */
router.post("/games/suspend", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  suspendGame();
  res.json({ ok: true, saved: !!currentSession() });
});

router.post("/games/resume", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  res.json({ ok: resumeGame() });
});

router.post("/games/end", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  await endGame();
  res.json({ ok: true });
});

export default router;
