import { Router } from "express";
import { readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { db, communityPluginsTable, pluginReviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { bus } from "../lib/bus.js";
import { logger } from "../lib/logger.js";

const router = Router();

const SAFE_PLUGIN_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const APPROVED_ENTRYPOINT_ORIGINS = new Set([
  "https://raw.githubusercontent.com",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
]);

const RegistryPluginSchema = z.object({
  id: z.string().regex(SAFE_PLUGIN_ID_RE),
  name: z.string().min(1),
  author: z.string().min(1),
  description: z.string(),
  version: z.string().min(1),
  category: z.string().min(1),
  permissions: z.array(z.string()),
  tags: z.array(z.string()),
  iconUrl: z.string().url().nullable(),
  entrypointUrl: z.string().url().nullable(),
  installCount: z.number().int().nonnegative(),
  readme: z.string(),
});

const RegistrySchema = z.object({
  version: z.string().min(1),
  updatedAt: z.string().min(1),
  plugins: z.array(RegistryPluginSchema),
});

type RegistryPlugin = z.infer<typeof RegistryPluginSchema>;
type Registry = z.infer<typeof RegistrySchema>;

let registryCache: Registry | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchRegistry(): Promise<Registry> {
  if (registryCache && Date.now() < cacheExpiresAt) {
    return registryCache;
  }

  const registryUrl = process.env.PLUGIN_REGISTRY_URL;

  if (registryUrl) {
    const res = await fetch(registryUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
    const raw = await res.json();
    const data = RegistrySchema.parse(raw);
    registryCache = data;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return data;
  }

  const localPath = path.resolve(process.cwd(), "registry.json");
  const raw = readFileSync(localPath, "utf-8");
  const data = RegistrySchema.parse(JSON.parse(raw));
  registryCache = data;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return data;
}

export const COMMUNITY_PLUGINS_DIR = path.resolve(process.cwd(), "community-plugins");

function communityPluginLocalPath(pluginId: string): string {
  return path.join(COMMUNITY_PLUGINS_DIR, `${pluginId}.mjs`);
}

async function downloadPluginFile(entry: RegistryPlugin): Promise<string | null> {
  if (!entry.entrypointUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(entry.entrypointUrl);
  } catch {
    throw new Error(`Malformed entrypointUrl: ${entry.entrypointUrl}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Rejected non-HTTPS entrypointUrl: ${entry.entrypointUrl}`);
  }

  const origin = `${parsed.protocol}//${parsed.hostname}`;
  if (!APPROVED_ENTRYPOINT_ORIGINS.has(origin)) {
    throw new Error(`Rejected unapproved domain '${parsed.hostname}' — not in allowlist`);
  }

  const res = await fetch(entry.entrypointUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${entry.entrypointUrl}`);
  const text = await res.text();

  mkdirSync(COMMUNITY_PLUGINS_DIR, { recursive: true });
  const localPath = communityPluginLocalPath(entry.id);
  writeFileSync(localPath, text, "utf-8");
  return localPath;
}

async function loadCommunityPlugin(entry: RegistryPlugin): Promise<{ loaded: boolean; warning?: string }> {
  let localPath: string | null;
  try {
    localPath = await downloadPluginFile(entry);
  } catch (err) {
    const msg = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn({ pluginId: entry.id, url: entry.entrypointUrl }, `Store: ${msg}`);
    return { loaded: false, warning: msg };
  }

  if (!localPath) {
    return { loaded: false, warning: "No entrypointUrl — runtime activation skipped" };
  }

  try {
    const { registry } = await import("../lib/bootstrap.js");
    if (registry) {
      const loaded = await registry.loadCommunityPlugin(localPath, entry.id);
      if (loaded) {
        logger.info({ pluginId: entry.id, localPath }, "Store: community plugin loaded into sandboxed worker");
        return { loaded: true };
      }
      return { loaded: false, warning: "Worker sandbox failed to initialise plugin — check server logs" };
    }
    return { loaded: false, warning: "Runtime registry not yet initialised" };
  } catch (err) {
    const msg = `Runtime load failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn({ err, pluginId: entry.id }, `Store: ${msg}`);
    return { loaded: false, warning: msg };
  }
}

export async function loadEnabledCommunityPlugins(): Promise<void> {
  let installed: (typeof communityPluginsTable.$inferSelect)[];
  try {
    installed = await db
      .select()
      .from(communityPluginsTable)
      .where(eq(communityPluginsTable.enabled, true));
  } catch (err) {
    logger.warn({ err }, "Store: failed to query community plugins at startup");
    return;
  }

  for (const row of installed) {
    const localPath = communityPluginLocalPath(row.pluginId);

    if (!existsSync(localPath)) {
      if (!row.entrypointUrl) {
        logger.info(
          { pluginId: row.pluginId },
          "Store: community plugin file missing and no entrypointUrl — skipping restore",
        );
        continue;
      }

      // Validate the URL against the allowlist before fetching
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(row.entrypointUrl);
      } catch {
        logger.warn({ pluginId: row.pluginId, url: row.entrypointUrl }, "Store: malformed entrypointUrl — skipping restore");
        continue;
      }

      if (parsedUrl.protocol !== "https:") {
        logger.warn({ pluginId: row.pluginId }, "Store: non-HTTPS entrypointUrl — skipping restore");
        continue;
      }

      const origin = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
      if (!APPROVED_ENTRYPOINT_ORIGINS.has(origin)) {
        logger.warn({ pluginId: row.pluginId, hostname: parsedUrl.hostname }, "Store: unapproved entrypointUrl domain — skipping restore");
        continue;
      }

      try {
        logger.info({ pluginId: row.pluginId, url: row.entrypointUrl }, "Store: re-downloading missing community plugin at startup");
        const res = await fetch(row.entrypointUrl, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          logger.warn({ pluginId: row.pluginId, status: res.status }, "Store: startup re-download failed — skipping restore");
          continue;
        }
        const text = await res.text();
        mkdirSync(COMMUNITY_PLUGINS_DIR, { recursive: true });
        writeFileSync(localPath, text, "utf-8");
        logger.info({ pluginId: row.pluginId }, "Store: plugin file re-downloaded successfully");
      } catch (err) {
        logger.warn({ err, pluginId: row.pluginId }, "Store: startup re-download failed — skipping restore");
        continue;
      }
    }

    try {
      const { registry } = await import("../lib/bootstrap.js");
      if (registry) {
        const loaded = await registry.loadCommunityPlugin(localPath, row.pluginId);
        if (loaded) {
          logger.info({ pluginId: row.pluginId }, "Store: restored community plugin into sandboxed worker");
        } else {
          logger.warn({ pluginId: row.pluginId }, "Store: community plugin restore failed — worker did not initialise");
        }
      }
    } catch (err) {
      logger.warn({ err, pluginId: row.pluginId }, "Store: failed to restore community plugin at startup");
    }
  }
}

router.get("/plugins/store/registry/:pluginId", async (req, res) => {
  const { pluginId } = req.params;

  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  try {
    const storeRegistry = await fetchRegistry();
    const entry = storeRegistry.plugins.find((p) => p.id === pluginId);
    if (!entry) {
      res.status(404).json({ error: `Plugin '${pluginId}' not found in registry` });
      return;
    }

    const installed = await db.select().from(communityPluginsTable);
    const { registry: runtimeRegistry } = await import("../lib/bootstrap.js").catch(() => ({ registry: null }));
    const runtimePluginIds = new Set(runtimeRegistry?.listPlugins().map((p) => p.plugin.id) ?? []);

    const dbRow = installed.find((i) => i.pluginId === entry.id);
    const isInRuntime = runtimePluginIds.has(entry.id);
    const isOfficialBuiltin = entry.author.startsWith("deck-os/official");

    res.json({
      ...entry,
      installed: dbRow != null || (isOfficialBuiltin && isInRuntime),
      enabled: dbRow?.enabled ?? (isOfficialBuiltin && isInRuntime),
      installedAt: dbRow?.installedAt?.toISOString() ?? null,
      official: isOfficialBuiltin,
    });
  } catch (err) {
    logger.error({ err, pluginId }, "Failed to fetch plugin detail");
    res.status(500).json({ error: "Failed to load plugin detail" });
  }
});

router.get("/plugins/store/registry", async (_req, res) => {
  try {
    const storeRegistry = await fetchRegistry();
    const installed = await db.select().from(communityPluginsTable);
    const installedIds = new Set(installed.map((p) => p.pluginId));

    const { registry: runtimeRegistry } = await import("../lib/bootstrap.js").catch(() => ({ registry: null }));
    const runtimePluginIds = new Set(runtimeRegistry?.listPlugins().map((p) => p.plugin.id) ?? []);

    const plugins = storeRegistry.plugins.map((p) => {
      const dbRow = installed.find((i) => i.pluginId === p.id);
      const isInRuntime = runtimePluginIds.has(p.id);
      const isOfficialBuiltin = p.author.startsWith("deck-os/official");

      return {
        ...p,
        installed: dbRow != null || (isOfficialBuiltin && isInRuntime),
        enabled: dbRow?.enabled ?? (isOfficialBuiltin && isInRuntime),
        installedAt: dbRow?.installedAt?.toISOString() ?? null,
        official: isOfficialBuiltin,
      };
    });

    res.json({ version: storeRegistry.version, updatedAt: storeRegistry.updatedAt, plugins });
  } catch (err) {
    logger.error({ err }, "Failed to fetch plugin registry");
    res.status(500).json({ error: "Failed to load plugin registry" });
  }
});

const InstallBody = z.object({ force: z.boolean().optional().default(false) });

router.post("/plugins/store/install/:pluginId", async (req, res) => {
  const { pluginId } = req.params;

  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  const parsed = InstallBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  let storeRegistry: Registry;
  try {
    storeRegistry = await fetchRegistry();
  } catch (err) {
    logger.error({ err }, "Registry unavailable during install");
    res.status(503).json({ error: "Registry unavailable" });
    return;
  }

  const entry = storeRegistry.plugins.find((p) => p.id === pluginId);
  if (!entry) {
    res.status(404).json({ error: `Plugin '${pluginId}' not found in registry` });
    return;
  }

  const existing = await db
    .select()
    .from(communityPluginsTable)
    .where(eq(communityPluginsTable.pluginId, pluginId))
    .limit(1);

  if (existing.length > 0 && !parsed.data.force) {
    res.status(409).json({ error: "Plugin already installed", pluginId });
    return;
  }

  try {
    if (existing.length > 0) {
      const { registry: rtReg } = await import("../lib/bootstrap.js").catch(() => ({ registry: null }));
      if (rtReg) {
        await rtReg.unloadPlugin(pluginId).catch(() => {});
      }

      await db
        .update(communityPluginsTable)
        .set({
          name: entry.name,
          author: entry.author,
          description: entry.description,
          version: entry.version,
          category: entry.category,
          permissions: entry.permissions,
          entrypointUrl: entry.entrypointUrl,
          iconUrl: entry.iconUrl,
          tags: entry.tags,
          installCount: entry.installCount,
          enabled: true,
        })
        .where(eq(communityPluginsTable.pluginId, pluginId));
    } else {
      await db.insert(communityPluginsTable).values({
        pluginId: entry.id,
        name: entry.name,
        author: entry.author,
        description: entry.description,
        version: entry.version,
        category: entry.category,
        permissions: entry.permissions,
        entrypointUrl: entry.entrypointUrl,
        iconUrl: entry.iconUrl,
        tags: entry.tags,
        installCount: entry.installCount,
        enabled: true,
      });
    }

    bus.emit({
      source: "store",
      target: null,
      type: "plugin.installed",
      payload: { pluginId, name: entry.name, version: entry.version },
    });

    const { loaded, warning } = await loadCommunityPlugin(entry);
    logger.info({ pluginId, version: entry.version, runtimeLoaded: loaded }, "Community plugin installed");
    res.json({ pluginId, installed: true, version: entry.version, runtimeLoaded: loaded, ...(warning ? { warning } : {}) });
  } catch (err) {
    logger.error({ err, pluginId }, "Failed to install community plugin");
    res.status(500).json({ error: "Install failed" });
  }
});

router.delete("/plugins/store/uninstall/:pluginId", async (req, res) => {
  const { pluginId } = req.params;

  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  const existing = await db
    .select()
    .from(communityPluginsTable)
    .where(eq(communityPluginsTable.pluginId, pluginId))
    .limit(1);

  if (existing.length === 0) {
    res.status(404).json({ error: `Plugin '${pluginId}' is not installed` });
    return;
  }

  await db.delete(communityPluginsTable).where(eq(communityPluginsTable.pluginId, pluginId));

  const { registry } = await import("../lib/bootstrap.js");
  if (registry) {
    await registry.unloadPlugin(pluginId).catch((err) =>
      logger.warn({ err, pluginId }, "Store: runtime unload failed — removed from DB"),
    );
  }

  const localPath = communityPluginLocalPath(pluginId);
  if (existsSync(localPath)) {
    try {
      unlinkSync(localPath);
      logger.info({ pluginId, localPath }, "Store: community plugin file removed");
    } catch (err) {
      logger.warn({ err, pluginId }, "Store: failed to delete plugin file — continuing");
    }
  }

  bus.emit({
    source: "store",
    target: null,
    type: "plugin.uninstalled",
    payload: { pluginId },
  });

  logger.info({ pluginId }, "Community plugin uninstalled");
  res.json({ pluginId, uninstalled: true });
});

router.patch("/plugins/store/:pluginId/toggle", async (req, res) => {
  const { pluginId } = req.params;

  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  const bodyParsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Body must include { enabled: boolean }" });
    return;
  }

  const { enabled } = bodyParsed.data;

  const existing = await db
    .select()
    .from(communityPluginsTable)
    .where(eq(communityPluginsTable.pluginId, pluginId))
    .limit(1);

  if (existing.length === 0) {
    res.status(404).json({ error: `Plugin '${pluginId}' is not installed` });
    return;
  }

  await db
    .update(communityPluginsTable)
    .set({ enabled })
    .where(eq(communityPluginsTable.pluginId, pluginId));

  const { registry } = await import("../lib/bootstrap.js");
  if (registry) {
    if (enabled && !registry.getPlugin(pluginId)) {
      const localPath = communityPluginLocalPath(pluginId);
      if (existsSync(localPath)) {
        await registry.loadCommunityPlugin(localPath, pluginId).catch((err) =>
          logger.warn({ err, pluginId }, "Store: toggle-enable runtime load failed"),
        );
      }
    } else {
      registry.setEnabled(pluginId, enabled);
    }
  }

  bus.emit({
    source: "store",
    target: null,
    type: "plugin.status_changed",
    payload: { pluginId, enabled },
  });

  res.json({ pluginId, enabled });
});

router.get("/plugins/store/installed", async (_req, res) => {
  const installed = await db
    .select()
    .from(communityPluginsTable)
    .orderBy(communityPluginsTable.installedAt);

  res.json({ plugins: installed, count: installed.length });
});

router.get("/plugins/store/reviews", async (_req, res) => {
  try {
    const rows = await db.select().from(pluginReviewsTable);
    const reviews = Object.fromEntries(
      rows.map((r) => [
        r.pluginId,
        {
          rating: r.rating,
          avgRating: r.rating,
          reviewCount: 1,
          review: r.review,
          createdAt: r.createdAt?.toISOString() ?? null,
          updatedAt: r.updatedAt?.toISOString() ?? null,
        },
      ]),
    );
    res.json({ reviews, count: rows.length });
  } catch (err) {
    logger.error({ err }, "Failed to fetch plugin reviews");
    res.status(500).json({ error: "Failed to load reviews" });
  }
});

router.get("/plugins/store/:pluginId/review", async (req, res) => {
  const { pluginId } = req.params;
  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(pluginReviewsTable)
      .where(eq(pluginReviewsTable.pluginId, pluginId))
      .limit(1);
    const row = rows[0];
    res.json({
      review: row
        ? {
            rating: row.rating,
            avgRating: row.rating,
            reviewCount: 1,
            review: row.review,
            createdAt: row.createdAt?.toISOString() ?? null,
            updatedAt: row.updatedAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err, pluginId }, "Failed to fetch plugin review");
    res.status(500).json({ error: "Failed to load review" });
  }
});

const ReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(1000).optional(),
});

router.post("/plugins/store/:pluginId/review", async (req, res) => {
  const { pluginId } = req.params;
  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  const parsed = ReviewBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Body must include { rating: 1-5, review?: string }" });
    return;
  }

  const { rating, review } = parsed.data;

  try {
    // Guard: only installed plugins may be reviewed
    const [communityRow] = await db
      .select({ pluginId: communityPluginsTable.pluginId })
      .from(communityPluginsTable)
      .where(eq(communityPluginsTable.pluginId, pluginId))
      .limit(1);
    if (!communityRow) {
      const { registry: runtimeRegistry } = await import("../lib/bootstrap.js").catch(
        () => ({ registry: null as import("../lib/plugin-registry.js").PluginRegistry | null }),
      );
      const isBuiltIn = runtimeRegistry?.getPlugin(pluginId) != null;
      if (!isBuiltIn) {
        res.status(403).json({ error: "Plugin must be installed before it can be reviewed" });
        return;
      }
    }
    const [row] = await db
      .insert(pluginReviewsTable)
      .values({ pluginId, rating, review: review ?? null })
      .onConflictDoUpdate({
        target: pluginReviewsTable.pluginId,
        set: { rating, review: review ?? null, updatedAt: new Date() },
      })
      .returning();

    res.json({
      review: {
        rating: row.rating,
        review: row.review,
        createdAt: row.createdAt?.toISOString() ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, pluginId }, "Failed to save plugin review");
    res.status(500).json({ error: "Failed to save review" });
  }
});

router.delete("/plugins/store/:pluginId/review", async (req, res) => {
  const { pluginId } = req.params;
  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  try {
    const deleted = await db
      .delete(pluginReviewsTable)
      .where(eq(pluginReviewsTable.pluginId, pluginId))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: `No review found for plugin '${pluginId}'` });
      return;
    }
    res.json({ deleted: true, pluginId });
  } catch (err) {
    logger.error({ err, pluginId }, "Failed to delete plugin review");
    res.status(500).json({ error: "Failed to delete review" });
  }
});

const CommunityExecuteBody = z.object({
  command: z.string().min(1).default("default"),
  args: z.record(z.unknown()).optional().default({}),
});

const RESERVED_PLUGIN_IDS = new Set(["store", "community"]);

router.all("/plugins/:pluginId/*path", async (req, res, next) => {
  const { pluginId } = req.params;

  if (RESERVED_PLUGIN_IDS.has(pluginId) || !SAFE_PLUGIN_ID_RE.test(pluginId)) {
    next();
    return;
  }

  const rawPathValue = (req.params as Record<string, unknown>)["path"];
  const rawPath = Array.isArray(rawPathValue)
    ? (rawPathValue as string[]).join("/")
    : String(rawPathValue ?? "");
  const subPath = `/${rawPath.replace(/^\/+/, "")}`;
  const method = req.method.toUpperCase();

  const { registry } = await import("../lib/bootstrap.js").catch(() => ({ registry: null as null }));
  if (!registry) {
    next();
    return;
  }

  const pluginRoutes = registry.getPluginRoutes(pluginId);
  if (pluginRoutes.length === 0) {
    next();
    return;
  }

  const match = pluginRoutes.find(
    (r) => r.method === method && (r.pattern === subPath || r.pattern === subPath.slice(1)),
  );

  if (!match) {
    res.status(404).json({
      error: `No route '${method} ${subPath}' registered for community plugin '${pluginId}'`,
      registeredRoutes: pluginRoutes.map((r) => `${r.method} ${r.pattern}`),
    });
    return;
  }

  try {
    const result = await registry.dispatchPluginRoute(pluginId, match.routeId, {
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    logger.error({ err, pluginId, subPath }, "Community plugin route dispatch error");
    res.status(502).json({ error: err instanceof Error ? err.message : "Route dispatch failed" });
  }
});

router.post("/plugins/store/community/:pluginId/execute", async (req, res) => {
  const { pluginId } = req.params;

  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    res.status(400).json({ error: "Invalid plugin ID format" });
    return;
  }

  const bodyParsed = CommunityExecuteBody.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", issues: bodyParsed.error.issues });
    return;
  }

  const { command, args } = bodyParsed.data;

  const { registry } = await import("../lib/bootstrap.js").catch(() => ({ registry: null as null }));
  if (!registry) {
    res.status(503).json({ error: "Plugin registry unavailable" });
    return;
  }

  const entry = registry.getPlugin(pluginId);
  if (!entry) {
    res.status(404).json({
      error: `Community plugin '${pluginId}' is not loaded — ensure it is installed and enabled`,
    });
    return;
  }

  const start = Date.now();
  try {
    const result = await entry.plugin.execute({ command, ...args });
    res.json({
      pluginId,
      command,
      success: true,
      output: (result as Record<string, unknown>)?.["output"] ?? "",
      data: (result as Record<string, unknown>)?.["data"] ?? null,
      executionTimeMs: Date.now() - start,
    });
  } catch (err) {
    logger.error({ err, pluginId, command }, "Community plugin execute error");
    res.status(500).json({
      pluginId,
      command,
      success: false,
      error: err instanceof Error ? err.message : "Execution failed",
      executionTimeMs: Date.now() - start,
    });
  }
});

export default router;
