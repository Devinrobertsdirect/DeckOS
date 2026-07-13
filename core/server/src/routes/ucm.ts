import { Router } from "express";
import { z } from "zod";
import { db, userCognitiveModelTable, ucmSettingsTable, behaviorProfileTable, goalsTable, memoryEntriesTable, feedbackSignalsTable, UCM_LAYERS } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { bus } from "../lib/bus.js";
import { broadcast } from "../lib/ws-server.js";

const router = Router();

const LAYER_LABEL: Record<string, string> = {
  identity: "Identity Layer",
  preferences: "Preference Layer",
  context: "Context Layer",
  goals: "Goal Layer",
  behaviorPatterns: "Behavior Patterns",
  emotionalModel: "Emotional Model",
  domainExpertise: "Domain Expertise Map",
};

async function getOrCreateModel() {
  const rows = await db.select().from(userCognitiveModelTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(userCognitiveModelTable).values({}).returning();
  return created;
}

async function getOrCreateSettings() {
  const rows = await db.select().from(ucmSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(ucmSettingsTable).values({}).returning();
  return created;
}

function formatModel(row: typeof userCognitiveModelTable.$inferSelect) {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    layers: {
      identity: { label: LAYER_LABEL.identity, data: row.identity ?? {} },
      preferences: { label: LAYER_LABEL.preferences, data: row.preferences ?? {} },
      context: { label: LAYER_LABEL.context, data: row.context ?? {} },
      goals: { label: LAYER_LABEL.goals, data: row.goals ?? {} },
      behaviorPatterns: { label: LAYER_LABEL.behaviorPatterns, data: row.behaviorPatterns ?? {} },
      emotionalModel: { label: LAYER_LABEL.emotionalModel, data: row.emotionalModel ?? {} },
      domainExpertise: { label: LAYER_LABEL.domainExpertise, data: row.domainExpertise ?? {} },
    },
  };
}

const PatchLayerBody = z.object({
  data: z.record(z.string(), z.unknown()),
  merge: z.boolean().optional().default(true),
});

const PatchSettingsBody = z.object({
  proactiveMode: z.boolean().optional(),
  memoryRetentionLevel: z.enum(["low", "medium", "high"]).optional(),
  emotionalModelingEnabled: z.boolean().optional(),
  personalizationLevel: z.enum(["off", "minimal", "full"]).optional(),
});

const VALID_LAYERS = new Set(UCM_LAYERS);

router.get("/ucm", async (req, res) => {
  const model = await getOrCreateModel();
  res.json(formatModel(model));
});

router.patch("/ucm/:layer", async (req, res) => {
  const layer = req.params.layer;
  if (!VALID_LAYERS.has(layer as typeof UCM_LAYERS[number])) {
    res.status(400).json({ error: `Invalid layer. Must be one of: ${UCM_LAYERS.join(", ")}` });
    return;
  }

  const parsed = PatchLayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { data, merge } = parsed.data;
  const model = await getOrCreateModel();
  const current = (model[layer as keyof typeof model] as Record<string, unknown>) ?? {};
  const updated = merge ? { ...current, ...data } : data;

  await db.update(userCognitiveModelTable)
    .set({ [layer]: updated })
    .where(eq(userCognitiveModelTable.id, model.id));

  bus.emit({
    source: "ucm",
    target: null,
    type: "memory.stored",
    payload: { layer, keys: Object.keys(data), operation: "patch" },
  });

  // Broadcast identity changes (aiName, userName) as persona.updated so
  // all connected clients (desktop + mobile) update in real time.
  if (layer === "identity") {
    const identityData = data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof identityData["aiName"] === "string") patch["aiName"] = identityData["aiName"];
    if (typeof identityData["userName"] === "string") patch["userName"] = identityData["userName"];
    if (Object.keys(patch).length > 0) {
      broadcast({ type: "persona.updated", payload: patch });
    }
  }

  const fresh = await getOrCreateModel();
  res.json(formatModel(fresh));
});

router.delete("/ucm/:layer", async (req, res) => {
  const layer = req.params.layer;
  if (!VALID_LAYERS.has(layer as typeof UCM_LAYERS[number])) {
    res.status(400).json({ error: `Invalid layer. Must be one of: ${UCM_LAYERS.join(", ")}` });
    return;
  }

  const model = await getOrCreateModel();
  await db.update(userCognitiveModelTable)
    .set({ [layer]: {} })
    .where(eq(userCognitiveModelTable.id, model.id));

  bus.emit({
    source: "ucm",
    target: null,
    type: "memory.deleted",
    payload: { layer, operation: "clear" },
  });

  res.json({ success: true, layer, cleared: true });
});

router.delete("/ucm", async (req, res) => {
  const model = await getOrCreateModel();
  await db.update(userCognitiveModelTable)
    .set({
      identity: {},
      preferences: {},
      context: {},
      goals: {},
      behaviorPatterns: {},
      emotionalModel: {},
      domainExpertise: {},
    })
    .where(eq(userCognitiveModelTable.id, model.id));

  bus.emit({
    source: "ucm",
    target: null,
    type: "memory.deleted",
    payload: { operation: "full-reset" },
  });

  res.json({ success: true, cleared: true });
});

router.get("/ucm/settings", async (req, res) => {
  const settings = await getOrCreateSettings();
  res.json({
    proactiveMode: settings.proactiveMode,
    memoryRetentionLevel: settings.memoryRetentionLevel,
    emotionalModelingEnabled: settings.emotionalModelingEnabled,
    personalizationLevel: settings.personalizationLevel,
    updatedAt: settings.updatedAt.toISOString(),
  });
});

router.get("/ucm/export", async (req, res) => {
  const [model, settings] = await Promise.all([
    getOrCreateModel(),
    getOrCreateSettings(),
  ]);

  const [profileRows, goals, memories, feedbackSignals] = await Promise.all([
    db.select().from(behaviorProfileTable).limit(1),
    db.select().from(goalsTable).orderBy(desc(goalsTable.createdAt)),
    db.select().from(memoryEntriesTable).orderBy(desc(memoryEntriesTable.createdAt)),
    db.select().from(feedbackSignalsTable).orderBy(desc(feedbackSignalsTable.createdAt)),
  ]);

  const profile = profileRows[0] ?? null;

  const snapshot = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    ucm: {
      identity:       model.identity ?? {},
      preferences:    model.preferences ?? {},
      context:        model.context ?? {},
      goals:          model.goals ?? {},
      behaviorPatterns: model.behaviorPatterns ?? {},
      emotionalModel: model.emotionalModel ?? {},
      domainExpertise: model.domainExpertise ?? {},
    },
    settings: {
      proactiveMode:            settings.proactiveMode,
      memoryRetentionLevel:     settings.memoryRetentionLevel,
      emotionalModelingEnabled: settings.emotionalModelingEnabled,
      personalizationLevel:     settings.personalizationLevel,
    },
    behaviorProfile: profile ? {
      verbosityLevel:      profile.verbosityLevel,
      proactiveFrequency:  profile.proactiveFrequency,
      toneFormality:       profile.toneFormality,
      confidenceThreshold: profile.confidenceThreshold,
      learnedPatterns:     profile.learnedPatterns,
    } : null,
    goals: goals.map((g) => ({
      title:           g.title,
      description:     g.description,
      status:          g.status,
      priority:        g.priority,
      completionPct:   g.completionPct,
      tags:            g.tags,
      dueAt:           g.dueAt?.toISOString() ?? null,
      decayRatePerHour: g.decayRatePerHour,
    })),
    memories: memories.map((m) => ({
      type:      m.type,
      content:   m.content,
      keywords:  m.keywords ?? [],
      source:    m.source,
    })),
    feedbackSignals: feedbackSignals.map((f) => ({
      signalType: f.signalType,
      context:    f.context,
      weight:     f.weight,
    })),
  };

  res.setHeader("Content-Disposition", `attachment; filename="deckos-profile-${Date.now()}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.json(snapshot);
});

const ImportBody = z.object({
  exportVersion: z.number().optional(),
  replace: z.boolean().optional().default(false),
  ucm: z.object({
    identity:         z.record(z.unknown()).optional().default({}),
    preferences:      z.record(z.unknown()).optional().default({}),
    context:          z.record(z.unknown()).optional().default({}),
    goals:            z.record(z.unknown()).optional().default({}),
    behaviorPatterns: z.record(z.unknown()).optional().default({}),
    emotionalModel:   z.record(z.unknown()).optional().default({}),
    domainExpertise:  z.record(z.unknown()).optional().default({}),
  }).optional(),
  settings: z.object({
    proactiveMode:            z.boolean().optional(),
    memoryRetentionLevel:     z.enum(["low", "medium", "high"]).optional(),
    emotionalModelingEnabled: z.boolean().optional(),
    personalizationLevel:     z.enum(["off", "minimal", "full"]).optional(),
  }).optional(),
  behaviorProfile: z.object({
    verbosityLevel:      z.number().min(0).max(1).optional(),
    proactiveFrequency:  z.number().min(0).max(1).optional(),
    toneFormality:       z.number().min(0).max(1).optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    learnedPatterns:     z.record(z.number()).optional(),
  }).nullable().optional(),
  goals: z.array(z.object({
    title:            z.string(),
    description:      z.string().nullable().optional(),
    status:           z.string().optional().default("active"),
    priority:         z.number().int().optional().default(50),
    completionPct:    z.number().int().optional().default(0),
    decayRatePerHour: z.number().optional().default(0.5),
    tags:             z.array(z.string()).optional().default([]),
    dueAt:            z.string().nullable().optional(),
  })).optional(),
  memories: z.array(z.object({
    type:     z.enum(["short_term", "long_term"]),
    content:  z.string(),
    keywords: z.array(z.string()).optional().default([]),
    source:   z.string().optional().default("import"),
  })).optional(),
  feedbackSignals: z.array(z.object({
    signalType: z.string(),
    context:    z.record(z.unknown()).optional().default({}),
    weight:     z.number().optional().default(1.0),
  })).optional(),
});

router.post("/ucm/import", async (req, res) => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ucm, settings, behaviorProfile, goals, memories, feedbackSignals, replace } = parsed.data;
  const results: string[] = [];

  if (replace) {
    await Promise.all([
      goals     && goals.length > 0     ? db.delete(goalsTable) : Promise.resolve(),
      memories  && memories.length > 0  ? db.delete(memoryEntriesTable) : Promise.resolve(),
      feedbackSignals && feedbackSignals.length > 0 ? db.delete(feedbackSignalsTable) : Promise.resolve(),
    ]);
    results.push("cleared_existing");
  }

  if (ucm) {
    const model = await getOrCreateModel();
    await db.update(userCognitiveModelTable)
      .set({
        identity:         ucm.identity,
        preferences:      ucm.preferences,
        context:          ucm.context,
        goals:            ucm.goals,
        behaviorPatterns: ucm.behaviorPatterns,
        emotionalModel:   ucm.emotionalModel,
        domainExpertise:  ucm.domainExpertise,
      })
      .where(eq(userCognitiveModelTable.id, model.id));
    results.push("ucm_layers");
  }

  if (settings) {
    const s = await getOrCreateSettings();
    const updates: Record<string, unknown> = {};
    if (settings.proactiveMode !== undefined) updates.proactiveMode = settings.proactiveMode;
    if (settings.memoryRetentionLevel !== undefined) updates.memoryRetentionLevel = settings.memoryRetentionLevel;
    if (settings.emotionalModelingEnabled !== undefined) updates.emotionalModelingEnabled = settings.emotionalModelingEnabled;
    if (settings.personalizationLevel !== undefined) updates.personalizationLevel = settings.personalizationLevel;
    if (Object.keys(updates).length > 0) {
      await db.update(ucmSettingsTable)
        .set(updates as Partial<typeof ucmSettingsTable.$inferSelect>)
        .where(eq(ucmSettingsTable.id, s.id));
      results.push("settings");
    }
  }

  if (behaviorProfile) {
    const profileRows = await db.select().from(behaviorProfileTable).limit(1);
    const bpValues = {
      verbosityLevel:      behaviorProfile.verbosityLevel      ?? 0.5,
      proactiveFrequency:  behaviorProfile.proactiveFrequency  ?? 0.5,
      toneFormality:       behaviorProfile.toneFormality        ?? 0.5,
      confidenceThreshold: behaviorProfile.confidenceThreshold ?? 0.7,
      learnedPatterns:     (behaviorProfile.learnedPatterns ?? {}) as Record<string, number>,
    };
    if (profileRows.length > 0) {
      await db.update(behaviorProfileTable)
        .set(bpValues)
        .where(eq(behaviorProfileTable.id, profileRows[0].id));
    } else {
      await db.insert(behaviorProfileTable).values(bpValues);
    }
    results.push("behavior_profile");
  }

  if (goals && goals.length > 0) {
    const goalRows = goals.map((g) => ({
      title:            g.title,
      description:      g.description ?? null,
      status:           g.status ?? "active",
      priority:         g.priority ?? 50,
      completionPct:    g.completionPct ?? 0,
      decayRatePerHour: g.decayRatePerHour ?? 0.5,
      tags:             g.tags ?? [],
      dueAt:            g.dueAt ? new Date(g.dueAt) : null,
    }));
    await db.insert(goalsTable).values(goalRows);
    results.push(`goals(${goalRows.length})`);
  }

  if (memories && memories.length > 0) {
    const rows = memories.map((m) => ({
      type:     m.type,
      content:  m.content,
      keywords: m.keywords,
      source:   m.source,
      expiresAt: m.type === "short_term" ? new Date(Date.now() + 3600_000) : null,
    }));
    await db.insert(memoryEntriesTable).values(rows);
    results.push(`memories(${rows.length})`);
  }

  if (feedbackSignals && feedbackSignals.length > 0) {
    const rows = feedbackSignals.map((f) => ({
      signalType: f.signalType,
      context:    f.context as Record<string, unknown>,
      weight:     f.weight ?? 1.0,
    }));
    await db.insert(feedbackSignalsTable).values(rows);
    results.push(`feedback_signals(${rows.length})`);
  }

  bus.emit({
    source: "ucm",
    target: null,
    type: "memory.stored",
    payload: { event: "profile.imported", restored: results },
  });

  res.json({ success: true, restored: results });
});

router.put("/ucm/settings", async (req, res) => {
  const parsed = PatchSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await getOrCreateSettings();
  const updates: Record<string, unknown> = {};
  if (parsed.data.proactiveMode !== undefined) updates.proactiveMode = parsed.data.proactiveMode;
  if (parsed.data.memoryRetentionLevel !== undefined) updates.memoryRetentionLevel = parsed.data.memoryRetentionLevel;
  if (parsed.data.emotionalModelingEnabled !== undefined) updates.emotionalModelingEnabled = parsed.data.emotionalModelingEnabled;
  if (parsed.data.personalizationLevel !== undefined) updates.personalizationLevel = parsed.data.personalizationLevel;

  await db.update(ucmSettingsTable)
    .set(updates as Partial<typeof ucmSettingsTable.$inferSelect>)
    .where(eq(ucmSettingsTable.id, settings.id));

  bus.emit({
    source: "ucm",
    target: null,
    type: "system.config_changed",
    payload: { component: "ucm_settings", changes: updates },
  });

  const fresh = await getOrCreateSettings();
  res.json({
    proactiveMode: fresh.proactiveMode,
    memoryRetentionLevel: fresh.memoryRetentionLevel,
    emotionalModelingEnabled: fresh.emotionalModelingEnabled,
    personalizationLevel: fresh.personalizationLevel,
    updatedAt: fresh.updatedAt.toISOString(),
  });
});

export default router;
