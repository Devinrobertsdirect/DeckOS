import { Router } from "express";
import { z } from "zod";
import { getConfig, setConfig } from "../lib/app-config.js";
import { broadcast } from "../lib/ws-server.js";

/**
 * shows.ts — edit a show without rebuilding the robot.
 *
 * The demo/pitch/order scripts are compiled into the kiosk bundle, so changing
 * one spoken line meant a typecheck, a build, a transfer and a kiosk reload:
 * three minutes, which is three minutes you do not have at a stand with someone
 * waiting. This keeps a small OVERRIDE layer in config that the face merges over
 * the built-in script at run time, and reloads it live.
 *
 * An override is deliberately narrow — text and timing, not structure. You can
 * reword any line, retime any beat or drop a beat; you cannot invent new scenes,
 * because a scene is code. That keeps a bad edit from breaking a live show.
 *
 *   GET    /api/shows/overrides          → { overrides }
 *   PUT    /api/shows/overrides { ... }  → saved + pushed to the face
 *   DELETE /api/shows/overrides          → back to the built-in scripts
 */
const router = Router();
const KEY = "NOBI_SHOW_OVERRIDES";

/** One override per beat index, per show. Everything optional. */
const BeatOverride = z.object({
  say: z.string().max(400).optional(),
  holdMs: z.number().int().min(0).max(60_000).optional(),
  skip: z.boolean().optional(),
});
const Schema = z.object({
  demo: z.record(z.string(), BeatOverride).optional(),
  pitch: z.record(z.string(), BeatOverride).optional(),
  order: z.record(z.string(), BeatOverride).optional(),
}).strict();

export type ShowOverrides = z.infer<typeof Schema>;

async function read(): Promise<ShowOverrides> {
  const raw = await getConfig(KEY).catch(() => null);
  if (!raw) return {};
  try {
    const parsed = Schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch { return {}; }
}

router.get("/shows/overrides", async (_req, res) => {
  res.json({ overrides: await read() });
});

router.put("/shows/overrides", async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await setConfig(KEY, JSON.stringify(parsed.data));
  // The face is holding the old script in memory; tell it to pick the new one up.
  broadcast({ type: "shows.overrides", source: "shows", payload: { overrides: parsed.data }, timestamp: new Date().toISOString() });
  res.json({ ok: true, overrides: parsed.data });
});

router.delete("/shows/overrides", async (_req, res) => {
  await setConfig(KEY, "");
  broadcast({ type: "shows.overrides", source: "shows", payload: { overrides: {} }, timestamp: new Date().toISOString() });
  res.json({ ok: true, overrides: {} });
});

export default router;
