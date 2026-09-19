import { Router } from "express";
import { z } from "zod";
import { getOrCreatePairingCode } from "../lib/pairing.js";
import {
  listGames, startGame, joinGame, actInGame, viewFor,
  currentSession, suspendGame, resumeGame, endGame, isPlayCode, currentPlayCode, leaveGame,
} from "../lib/games/engine.js";

/**
 * games.ts — the table, over HTTP.
 *
 * Phones poll `state` (cheap: they send the version they last saw and get a
 * 204 when nothing has changed) and POST `act`. The face is pushed to over the
 * existing WebSocket, so the room never waits on a poll.
 *
 * TWO codes open these routes, and the difference is the whole point:
 *
 *  · the OWNER's pairing code, which also drives the demo and opens the setup
 *    band — that band writes API keys.
 *  · the game's own PLAY code, minted when the game starts and dead when it
 *    ends, which opens these routes and NOTHING else.
 *
 * Guests get the play code. Handing a room of strangers a code that reaches the
 * owner's API keys, so that they could join a word game, was never a fair trade;
 * now the code on the screen is worth exactly one game of Same Page.
 *
 * Starting, ending and suspending a game stay owner-only: a guest may play the
 * game they were invited to, not choose a different one or close the table.
 */
const router = Router();

function given(req: { body?: unknown; query?: unknown }): string {
  const b = (req.body ?? {}) as { code?: string };
  const q = (req.query ?? {}) as { code?: string };
  return String(b.code ?? q.code ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** The owner's code. Required for anything that changes WHICH game is running. */
async function isOwner(req: { body?: unknown; query?: unknown }): Promise<boolean> {
  const g = given(req);
  const want = (await getOrCreatePairingCode()).toUpperCase().replace(/\s+/g, "");
  return !!g && g === want;
}

/** Owner or guest — enough to sit at the table that is already running. */
async function ok(req: { body?: unknown; query?: unknown }): Promise<boolean> {
  return isPlayCode(given(req)) || (await isOwner(req));
}

router.get("/games", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  // Only the owner is told the play code — so he can read it out to the room.
  // A guest already has it; there is no reason to hand it back to them.
  const playCode = (await isOwner(req)) ? currentPlayCode() : undefined;
  res.json({ games: listGames(), session: currentSession(), ...(playCode ? { playCode } : {}) });
});

const StartSchema = z.object({ code: z.string(), gameId: z.string().max(40) });
router.post("/games/start", async (req, res) => {
  if (!(await isOwner(req))) { res.status(403).json({ error: "bad code" }); return; }
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

/**
 * One phone leaving — not the whole table. The engine also sweeps phones that
 * simply stop polling, so this is the polite path rather than the only one.
 */
router.post("/games/leave", async (req, res) => {
  if (!(await ok(req))) { res.status(403).json({ error: "bad code" }); return; }
  const b = (req.body ?? {}) as { playerId?: string };
  res.json(await leaveGame(String(b.playerId ?? "")));
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
  if (!(await isOwner(req))) { res.status(403).json({ error: "bad code" }); return; }
  suspendGame();
  res.json({ ok: true, saved: !!currentSession() });
});

router.post("/games/resume", async (req, res) => {
  if (!(await isOwner(req))) { res.status(403).json({ error: "bad code" }); return; }
  res.json({ ok: resumeGame() });
});

router.post("/games/end", async (req, res) => {
  if (!(await isOwner(req))) { res.status(403).json({ error: "bad code" }); return; }
  await endGame();
  res.json({ ok: true });
});

export default router;
