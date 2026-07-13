import { Router } from "express";
import { db, memoryEntriesTable } from "@workspace/db";
import { eq, ilike, or, and, desc } from "drizzle-orm";
import {
  GetShortTermMemoryResponse,
  StoreShortTermMemoryBody,
  GetLongTermMemoryQueryParams,
  GetLongTermMemoryResponse,
  StoreLongTermMemoryBody,
  DeleteMemoryEntryParams,
  SearchMemoryQueryParams,
  SearchMemoryResponse,
  GetRecentMemoryQueryParams,
  GetRecentMemoryResponse,
  StoreMemoryBody,
  DeleteMemoryByIdParams,
} from "@workspace/api-zod";
import { memoryService } from "../lib/memory-service.js";
import { bus } from "../lib/bus.js";

const router = Router();

function mapEntry(e: typeof memoryEntriesTable.$inferSelect) {
  return {
    id: String(e.id),
    type: e.type as "short_term" | "long_term",
    content: e.content,
    keywords: e.keywords ?? [],
    source: e.source,
    createdAt: e.createdAt.toISOString(),
    expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
  };
}

router.get("/memory/short-term", async (req, res) => {
  const entries = await db.select().from(memoryEntriesTable)
    .where(eq(memoryEntriesTable.type, "short_term"))
    .orderBy(desc(memoryEntriesTable.createdAt))
    .limit(100);

  const body = GetShortTermMemoryResponse.parse({
    entries: entries.map(mapEntry),
    total: entries.length,
  });
  res.json(body);
});

router.post("/memory/short-term", async (req, res) => {
  const parsed = StoreShortTermMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, keywords, source, ttlSeconds } = parsed.data;
  const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : new Date(Date.now() + 3600000);

  const [entry] = await db.insert(memoryEntriesTable).values({
    type: "short_term",
    content,
    keywords: keywords ?? [],
    source,
    expiresAt,
  }).returning();

  bus.emit({
    source: "memory-api",
    target: null,
    type: "memory.stored",
    payload: { entryId: entry.id, type: "short_term", source, keywords: keywords ?? [] },
  });

  res.status(201).json(mapEntry(entry));
});

router.get("/memory/long-term", async (req, res) => {
  const params = GetLongTermMemoryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { query, limit = 20 } = params.data;
  let entries;

  if (query) {
    const allLong = await db.select().from(memoryEntriesTable)
      .where(
        and(
          eq(memoryEntriesTable.type, "long_term"),
          or(
            ilike(memoryEntriesTable.content, `%${query}%`),
            ilike(memoryEntriesTable.source, `%${query}%`),
          ),
        ),
      )
      .orderBy(desc(memoryEntriesTable.createdAt))
      .limit(limit ?? 20);
    entries = allLong;
  } else {
    entries = await db.select().from(memoryEntriesTable)
      .where(eq(memoryEntriesTable.type, "long_term"))
      .orderBy(desc(memoryEntriesTable.createdAt))
      .limit(limit ?? 20);
  }

  const body = GetLongTermMemoryResponse.parse({
    entries: entries.map(mapEntry),
    total: entries.length,
  });
  res.json(body);
});

router.post("/memory/long-term", async (req, res) => {
  const parsed = StoreLongTermMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, keywords, source } = parsed.data;
  const [entry] = await db.insert(memoryEntriesTable).values({
    type: "long_term",
    content,
    keywords: keywords ?? [],
    source,
    expiresAt: null,
  }).returning();

  bus.emit({
    source: "memory-api",
    target: null,
    type: "memory.stored",
    payload: { entryId: entry.id, type: "long_term", source, keywords: keywords ?? [] },
  });

  res.status(201).json(mapEntry(entry));
});

router.delete("/memory/long-term/:id", async (req, res) => {
  const params = DeleteMemoryEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const numericId = parseInt(params.data.id);
  await db.delete(memoryEntriesTable).where(eq(memoryEntriesTable.id, numericId));

  bus.emit({
    source: "memory-api",
    target: null,
    type: "memory.deleted",
    payload: { entryId: numericId },
  });

  res.status(204).send();
});

router.get("/memory/search", async (req, res) => {
  const parsed = SearchMemoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q, limit = 20 } = parsed.data;
  if (!q || q.trim() === "") {
    res.status(400).json({ error: "Query parameter 'q' is required" });
    return;
  }

  const entries = await memoryService.search(q, limit);

  const body = SearchMemoryResponse.parse({
    entries,
    total: entries.length,
    query: q,
  });
  res.json(body);
});

router.get("/memory/recent", async (req, res) => {
  const parsed = GetRecentMemoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { limit = 20 } = parsed.data;
  const entries = await memoryService.getRecent(limit);

  const body = GetRecentMemoryResponse.parse({
    entries,
    total: entries.length,
  });
  res.json(body);
});

router.post("/memory", async (req, res) => {
  const parsed = StoreMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, keywords, source, type, ttlSeconds } = parsed.data;
  const entry = await memoryService.store({ content, keywords, source, type, ttlSeconds: ttlSeconds ?? undefined });

  bus.emit({
    source: "memory-api",
    target: null,
    type: "memory.stored",
    payload: { entryId: entry.id, type, source, keywords: keywords ?? [] },
  });

  res.status(201).json(entry);
});

router.delete("/memory/:id", async (req, res) => {
  const parsed = DeleteMemoryByIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const numericId = parseInt(parsed.data.id);
  if (isNaN(numericId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await memoryService.deleteById(parsed.data.id);

  bus.emit({
    source: "memory-api",
    target: null,
    type: "memory.deleted",
    payload: { entryId: numericId },
  });

  res.status(204).send();
});

export default router;
