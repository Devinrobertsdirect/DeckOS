import { db, memoryEntriesTable } from "@workspace/db";
import { eq, ilike, or, desc, lt, and, sql } from "drizzle-orm";
import type { PluginMemory, MemoryEntry, MemoryStoreOptions } from "@workspace/event-bus";

function mapEntry(e: typeof memoryEntriesTable.$inferSelect): MemoryEntry {
  return {
    id: String(e.id),
    type: e.type as "short_term" | "long_term",
    content: e.content,
    keywords: e.keywords ?? [],
    source: e.source,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt ?? null,
  };
}

export class MemoryService implements PluginMemory {
  private expireTimer: NodeJS.Timeout | null = null;

  start(intervalMs = 60_000): void {
    this.expireTimer = setInterval(() => {
      this.expire().catch(() => {});
    }, intervalMs);
  }

  stop(): void {
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }
  }

  async store(opts: MemoryStoreOptions): Promise<MemoryEntry> {
    const expiresAt =
      opts.type === "short_term"
        ? new Date(Date.now() + (opts.ttlSeconds ?? 3600) * 1000)
        : null;

    const [entry] = await db
      .insert(memoryEntriesTable)
      .values({
        type: opts.type,
        content: opts.content,
        keywords: opts.keywords ?? [],
        source: opts.source,
        expiresAt,
      })
      .returning();

    return mapEntry(entry);
  }

  async search(keyword: string, limit = 20): Promise<MemoryEntry[]> {
    const pattern = `%${keyword}%`;
    const now = new Date();
    const rows = await db
      .select()
      .from(memoryEntriesTable)
      .where(
        and(
          or(
            ilike(memoryEntriesTable.content, pattern),
            ilike(memoryEntriesTable.source, pattern),
            sql`${memoryEntriesTable.keywords}::text ilike ${pattern}`,
          ),
          or(
            sql`${memoryEntriesTable.expiresAt} IS NULL`,
            sql`${memoryEntriesTable.expiresAt} > ${now}`,
          ),
        ),
      )
      .orderBy(desc(memoryEntriesTable.createdAt))
      .limit(limit);

    return rows.map(mapEntry);
  }

  async getRecent(limit = 20): Promise<MemoryEntry[]> {
    const now = new Date();
    const rows = await db
      .select()
      .from(memoryEntriesTable)
      .where(
        or(
          sql`${memoryEntriesTable.expiresAt} IS NULL`,
          sql`${memoryEntriesTable.expiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(memoryEntriesTable.createdAt))
      .limit(limit);

    return rows.map(mapEntry);
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    const rows = await db
      .select()
      .from(memoryEntriesTable)
      .where(eq(memoryEntriesTable.id, parseInt(id)));

    return rows.length > 0 ? mapEntry(rows[0]) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const numericId = parseInt(id);
    if (isNaN(numericId)) return false;
    const deleted = await db
      .delete(memoryEntriesTable)
      .where(eq(memoryEntriesTable.id, numericId))
      .returning();
    return deleted.length > 0;
  }

  async expire(): Promise<number> {
    const now = new Date();
    const deleted = await db
      .delete(memoryEntriesTable)
      .where(
        and(
          eq(memoryEntriesTable.type, "short_term"),
          lt(memoryEntriesTable.expiresAt, now),
        ),
      )
      .returning();

    return deleted.length;
  }
}

export const memoryService = new MemoryService();
