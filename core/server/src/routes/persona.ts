import { Router } from "express";
import { z } from "zod";
import { db, aiPersonaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { bus } from "../lib/bus.js";
import { broadcast } from "../lib/ws-server.js";

const router = Router();

const VALID_GENDERS   = ["male", "female", "nonbinary", "neutral"] as const;
const VALID_ATTITUDES = ["professional", "casual", "witty", "serious", "empathetic", "commanding", "gentle", "playful"] as const;
const VALID_DEPTHS    = ["quick", "standard", "detailed"] as const;
const VALID_LENGTHS   = ["brief", "balanced", "thorough", "comprehensive"] as const;

const PersonaBody = z.object({
  aiName:               z.string().min(1).max(32).optional(),
  gender:               z.enum(VALID_GENDERS).optional(),
  // Accept any non-empty voice string — includes standard OpenAI voices
  // (alloy/echo/fable/onyx/nova/shimmer) as well as ElevenLabs voice IDs.
  voice:                z.string().min(1).max(256).optional(),
  attitude:             z.enum(VALID_ATTITUDES).optional(),
  thinkingDepth:        z.enum(VALID_DEPTHS).optional(),
  responseLength:       z.enum(VALID_LENGTHS).optional(),
  textColor:            z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  gravityLevel:         z.number().int().min(0).max(100).optional(),
  snarkinessLevel:      z.number().int().min(0).max(100).optional(),
  flirtatiousnessLevel: z.number().int().min(0).max(100).optional(),
});

async function getOrCreate() {
  const rows = await db.select().from(aiPersonaTable).limit(1);
  if (rows.length > 0) return rows[0]!;
  const [created] = await db.insert(aiPersonaTable).values({}).returning();
  return created!;
}

router.get("/ai/persona", async (_req, res) => {
  const persona = await getOrCreate();
  res.json(persona);
});

router.put("/ai/persona", async (req, res) => {
  const parsed = PersonaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const persona = await getOrCreate();
  const updates: Partial<typeof aiPersonaTable.$inferInsert> = {};
  const d = parsed.data;

  if (d.aiName               !== undefined) updates.aiName               = d.aiName;
  if (d.gender               !== undefined) updates.gender               = d.gender;
  if (d.voice                !== undefined) updates.voice                = d.voice;
  if (d.attitude             !== undefined) updates.attitude             = d.attitude;
  if (d.thinkingDepth        !== undefined) updates.thinkingDepth        = d.thinkingDepth;
  if (d.responseLength       !== undefined) updates.responseLength       = d.responseLength;
  if (d.textColor            !== undefined) updates.textColor            = d.textColor;
  if (d.gravityLevel         !== undefined) updates.gravityLevel         = d.gravityLevel;
  if (d.snarkinessLevel      !== undefined) updates.snarkinessLevel      = d.snarkinessLevel;
  if (d.flirtatiousnessLevel !== undefined) updates.flirtatiousnessLevel = d.flirtatiousnessLevel;

  const [updated] = await db
    .update(aiPersonaTable)
    .set(updates)
    .where(eq(aiPersonaTable.id, persona.id))
    .returning();

  bus.emit({
    source: "ai.persona",
    target: null,
    type:   "system.config_changed",
    payload: { component: "ai_persona", changes: updates },
  });

  broadcast({ type: "persona.updated", payload: updated });

  res.json(updated);
});

export { getOrCreate as getOrCreatePersona };
export default router;
