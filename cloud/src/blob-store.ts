/**
 * blob-store.ts — the Store on Netlify Blobs, so Nobi Cloud can run as a
 * Netlify Function behind the site (developmentindustries.org/api) instead of
 * a Replit VM. One key per record; small prefix indexes for the lookups the
 * app does (email → account, google sub → account, link-token → bot).
 *
 * Consistency is "strong" so a write is visible to the next request even on a
 * different function instance. Counters (the bot-number serial) are a
 * read-modify-write; contention at this scale is negligible, and createUnit
 * refuses duplicates anyway.
 */
import { getStore, type Store as BlobStoreHandle } from "@netlify/blobs";
import type { Store, Account, Session, VaultEntry, Bot, Profile, Unit } from "./store.js";

const MAX_SESSIONS_PER_ACCOUNT = 25;

export class BlobStore implements Store {
  private s: BlobStoreHandle;
  constructor(name = process.env["NOBI_BLOB_STORE"] || "nobi-cloud") {
    this.s = getStore({ name, consistency: "strong" });
  }
  private async get<T>(key: string): Promise<T | undefined> {
    const v = (await this.s.get(key, { type: "json" })) as T | null;
    return v ?? undefined;
  }
  private async put(key: string, value: unknown): Promise<void> { await this.s.setJSON(key, value as Record<string, unknown>); }
  private async del(key: string): Promise<void> { await this.s.delete(key); }
  private async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const res = await this.s.list({ prefix });
    for (const b of res.blobs) out.push(b.key);
    return out;
  }
  private async all<T>(prefix: string): Promise<T[]> {
    const ks = await this.keys(prefix);
    const out: T[] = [];
    for (const row of await Promise.all(ks.map((k) => this.get<T>(k)))) if (row) out.push(row as T);
    return out;
  }

  // ── accounts ──────────────────────────────────────────────────────────────
  async createAccount(a: Account) {
    await this.put(`acc/${a.id}`, a);
    await this.put(`email/${a.email.toLowerCase()}`, { id: a.id });
    if (a.googleSub) await this.put(`gsub/${a.googleSub}`, { id: a.id });
    return a;
  }
  async getAccountById(id: string) { return this.get<Account>(`acc/${id}`); }
  async getAccountByEmail(email: string) {
    const idx = await this.get<{ id: string }>(`email/${email.toLowerCase()}`);
    return idx ? this.getAccountById(idx.id) : undefined;
  }
  async getAccountByGoogleSub(sub: string) {
    const idx = await this.get<{ id: string }>(`gsub/${sub}`);
    return idx ? this.getAccountById(idx.id) : undefined;
  }
  async updateAccount(id: string, patch: Partial<Account>) {
    const a = await this.getAccountById(id);
    if (!a) return;
    const next = { ...a, ...patch };
    await this.put(`acc/${id}`, next);
    if (patch.googleSub) await this.put(`gsub/${patch.googleSub}`, { id });
    if (patch.email && patch.email !== a.email) { await this.del(`email/${a.email.toLowerCase()}`); await this.put(`email/${patch.email.toLowerCase()}`, { id }); }
  }

  // ── sessions ──────────────────────────────────────────────────────────────
  async createSession(sess: Session) {
    await this.put(`sess/${sess.tokenHash}`, sess);
    // cap sessions per account (oldest out)
    const mine = (await this.all<Session>("sess/")).filter((x) => x.accountId === sess.accountId).sort((a, b) => a.createdAt - b.createdAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_ACCOUNT))) await this.del(`sess/${old.tokenHash}`);
  }
  async getSession(tokenHash: string) { return this.get<Session>(`sess/${tokenHash}`); }
  async touchSession(tokenHash: string, at: number) {
    const s = await this.getSession(tokenHash);
    // throttle: only persist a touch every 10 minutes (each is a blob write)
    if (s && at - s.lastSeen > 10 * 60_000) await this.put(`sess/${tokenHash}`, { ...s, lastSeen: at });
  }
  async deleteSession(tokenHash: string) { await this.del(`sess/${tokenHash}`); }
  async purgeExpiredSessions(ttlMs: number) {
    const now = Date.now(); let n = 0;
    for (const s of await this.all<Session>("sess/")) if (now - s.lastSeen > ttlMs) { await this.del(`sess/${s.tokenHash}`); n++; }
    return n;
  }

  // ── vault ─────────────────────────────────────────────────────────────────
  async setKey(e: VaultEntry) { await this.put(`key/${e.accountId}/${e.name}`, e); }
  async getKey(accountId: string, name: string) { return this.get<VaultEntry>(`key/${accountId}/${name}`); }
  async listKeys(accountId: string) { return this.all<VaultEntry>(`key/${accountId}/`); }
  async deleteKey(accountId: string, name: string) { await this.del(`key/${accountId}/${name}`); }

  // ── bots (relay registry; kept for API compatibility) ─────────────────────
  async createBot(b: Bot) {
    await this.put(`bot/${b.id}`, b);
    const link = (b as unknown as { linkTokenHash?: string }).linkTokenHash;
    if (link) await this.put(`botlink/${link}`, { id: b.id });
  }
  async listBots(accountId: string) { return (await this.all<Bot>("bot/")).filter((b) => b.accountId === accountId); }
  async getBot(id: string) { return this.get<Bot>(`bot/${id}`); }
  async getBotByLinkTokenHash(hash: string) {
    const idx = await this.get<{ id: string }>(`botlink/${hash}`);
    return idx ? this.getBot(idx.id) : undefined;
  }
  async updateBot(id: string, patch: Partial<Bot>) { const b = await this.getBot(id); if (b) await this.put(`bot/${id}`, { ...b, ...patch }); }
  async deleteBot(id: string, accountId: string) {
    const b = await this.getBot(id);
    if (!b || b.accountId !== accountId) return false;
    await this.del(`bot/${id}`);
    return true;
  }
  async touchBot(id: string, at: number) { const b = await this.getBot(id); if (b) await this.put(`bot/${id}`, { ...b, lastSeen: at }); }

  // ── profiles ──────────────────────────────────────────────────────────────
  async getProfile(accountId: string) { return (await this.get<Profile>(`prof/${accountId}`))?.data; }
  async setProfile(accountId: string, data: Record<string, unknown>) { await this.put(`prof/${accountId}`, { accountId, data, updatedAt: Date.now() } satisfies Profile); }
  async listProfiles() { return this.all<Profile>("prof/"); }

  // ── units / serials ───────────────────────────────────────────────────────
  async nextBotNumber() {
    const meta = (await this.get<{ nextBot: number }>("meta/nextBot")) ?? { nextBot: 1 };
    const n = meta.nextBot;
    await this.put("meta/nextBot", { nextBot: n + 1 });
    return String(n).padStart(7, "0");
  }
  async createUnit(u: Unit) {
    if (await this.getUnit(u.botNumber)) throw new Error("unit exists");
    await this.put(`unit/${u.botNumber}`, u);
    const n = Number(u.botNumber);
    const meta = (await this.get<{ nextBot: number }>("meta/nextBot")) ?? { nextBot: 1 };
    if (Number.isFinite(n) && n >= meta.nextBot) await this.put("meta/nextBot", { nextBot: n + 1 });
  }
  async getUnit(botNumber: string) { return this.get<Unit>(`unit/${botNumber}`); }
  async updateUnit(botNumber: string, patch: Partial<Unit>) { const u = await this.getUnit(botNumber); if (u) await this.put(`unit/${botNumber}`, { ...u, ...patch }); }
  async listUnits() { return this.all<Unit>("unit/"); }

  // ── small kv (sync codes) ─────────────────────────────────────────────────
  async kvGet<T = unknown>(key: string) { return this.get<T>(`kv/${key}`); }
  async kvSet(key: string, value: unknown) { await this.put(`kv/${key}`, value); }
  async kvDel(key: string) { await this.del(`kv/${key}`); }
}
