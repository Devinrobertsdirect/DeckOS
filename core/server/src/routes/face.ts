import { Router } from "express";
import { z } from "zod/v4";
import { getFace, isFaceState } from "../lib/faceLink.js";
import { AWP_FACE_STATES } from "../hal/protocol.js";

/**
 * /api/face — the physical FACE node (round-LCD eyes + touch + knob), separate
 * from the drive body. The app mirrors its emotion/FaceState here so the
 * hardware eyes match the browser face; the panel's touch/knob come back in the
 * state as `lastInput`.
 */
const router = Router();

// GET /api/face — current expression + whether a real panel is connected.
router.get("/face", async (_req, res) => {
  const face = await getFace();
  res.json(face.getState());
});

// GET /api/face/states — the valid expression vocabulary (for tooling/UI).
router.get("/face/states", (_req, res) => {
  res.json({ states: AWP_FACE_STATES });
});

const FaceSchema = z.object({
  state: z.string().min(1),
  color: z.string().optional(),   // "r,g,b"
  bright: z.number().min(0).max(100).optional(),
});

// POST /api/face — { state, color?, bright? } set the face. `state` must be one
// of AWP_FACE_STATES; unknown states are rejected so the panel never guesses.
router.post("/face", async (req, res) => {
  const parsed = FaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { state, color?, bright? }" });
    return;
  }
  if (!isFaceState(parsed.data.state)) {
    res.status(400).json({ error: `Unknown face state '${parsed.data.state}'`, states: AWP_FACE_STATES });
    return;
  }
  const face = await getFace();
  const snap = face.setFace(parsed.data.state, parsed.data.color, parsed.data.bright);
  res.json({ ok: true, ...snap });
});

export default router;
