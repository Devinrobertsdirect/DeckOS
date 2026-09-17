/*
 * store.ts — Nobi Cloud persistence (durable, dependency-free JSON store).
 *
 * Accounts, sessions, the encrypted key vault, and the bot registry, persisted
 * as one atomically-written JSON doc. Runs with zero setup on Replit or locally
 * and survives restarts; a Postgres/Drizzle implementation can drop in behind
 * the same `Store` interface.
 *
 * Durability model:
 *   - Security-relevant mutations (create account/session/key/bot, deletes) are
 *     flushed immediately via an async, serialized, atomic write.
 *   - High-frequency "touch" updates (lastSeen) only mark the doc dirty and are
 *     flushed on a short debounce — so a burst of authed requests can't turn into
 *     a burst of synchronous whole-file rewrites (the previous DoS vector).
 */
import { readFileSync } from "node:fs";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export type Account = {
  id: string;
  email: string;
  passwordHash?: string;
  googleSub?: string;
  displayName: string;
  createdAt: number;
};

export type Session = {
  tokenHash: string;
  accountId: string;
  createdAt: number;
  lastSeen: number;
};

export type VaultEntry = {
  accountId: string;
  name: string;
  ciphertext: string;
  updatedAt: number;
};

export type Bot = {
  id: string;
  accountId: string;
  name: string;
  linkTokenHash: string;
  createdAt: number;
  lastSeen: number;
};

// Per-account settings blob (NOT secret — AI identity, eye color, personality,
// life-priority profile, aiSetupComplete flag, etc.). Syncs the "AI setup" +
// personality across every device the account logs into.
export type Profile = {
  accountId: string;
  data: Record<string, unknown>;
  updatedAt: number;
};

/** A physical unit: its serial (bot #), an optional claim code, and the account that owns it. */
export type Unit = {
  botNumber: string;          // zero-padded, e.g. "0000042"
  claimCodeHash?: string;     // sha256 of the code printed with the unit (optional)
  accountId?: string;
  createdAt: number;
  claimedAt?: number;
  note?: string;
};

type DbDoc = {
  accounts: Account[];
  sessions: Session[];
  vault: VaultEntry[];
  bots: Bot[];
  profiles: Profile[];
  units: Unit[];
  meta: { nextBot: number };
};

const MAX_SESSIONS_PER_ACCOUNT = 25;
const MAX_BOTS_PER_ACCOUNT = 50;
const FLUSH_DEBOUNCE_MS = 500;

export interface Store {
  createAccount(a: Account): Promise<Account>;
  getAccountById(id: string): Promise<Account | undefined>;
  getAccountByEmail(email: string): Promise<Account | undefined>;
  getAccountByGoogleSub(sub: string): Promise<Account | undefined>;
  updateAccount(id: string, patch: Partial<Account>): Promise<void>;

  createSession(s: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | undefined>;
  touchSession(tokenHash: string, at: number): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  purgeExpiredSessions(ttlMs: number): Promise<number>;

  setKey(e: VaultEntry): Promise<void>;
  getKey(accountId: string, name: string): Promise<VaultEntry | undefined>;
  listKeys(accountId: string): Promise<VaultEntry[]>;
  deleteKey(accountId: string, name: string): Promise<void>;

  createBot(b: Bot): Promise<void>;
  listBots(accountId: string): Promise<Bot[]>;
  getBot(id: string): Promise<Bot | undefined>;
  getBotByLinkTokenHash(hash: string): Promise<Bot | undefined>;
  updateBot(id: string, patch: Partial<Bot>): Promise<void>;
  deleteBot(id: string, accountId: string): Promise<boolean>;
  touchBot(id: string, at: number): Promise<void>;

  getProfile(accountId: string): Promise<Record<string, unknown> | undefined>;
  setProfile(accountId: string, data: Record<string, unknown>): Promise<void>;
  /** Every stored profile (fulfilment: list saved build profiles). */
  listProfiles(): Promise<Profile[]>;

  /** Serials: the next bot # (zero-padded, 7 digits), and the unit registry. */
  nextBotNumber(): Promise<string>;
  createUnit(u: Unit): Promise<void>;
  getUnit(botNumber: string): Promise<Unit | undefined>;
  updateUnit(botNumber: string, patch: Partial<Unit>): Promise<void>;
  listUnits(): Promise<Unit[]>;
}

export class FileStore implements Store {
  private doc: DbDoc = { accounts: [], sessions: [], vault: [], bots: [], profiles: [], units: [], meta: { nextBot: 1 } };
  private file: string;
  private writeChain: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dataDir?: string) {
    const dir = dataDir || process.env.NEURA_DATA_DIR || join(process.cwd(), ".neura-cloud");
    this.file = join(dir, "db.json");
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<DbDoc>;
      this.doc = {
        accounts: parsed.accounts ?? [],
        sessions: parsed.sessions ?? [],
        vault: parsed.vault ?? [],
        bots: parsed.bots ?? [],
        profiles: parsed.profiles ?? [],
        units: parsed.units ?? [],
        meta: { nextBot: parsed.meta?.nextBot ?? 1 },
      };
    } catch {
      /* first run or unreadable → start empty */
    }
  }

  /** Durable async atomic write, serialized so concurrent flushes never interleave. */
  private persistNow(): Promise<void> {
    const snapshot = JSON.stringify(this.doc, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, snapshot, "utf8");
        await rename(tmp, this.file);
      } catch (err) {
        console.error("[neura-cloud] persist failed:", (err as Error).message);
      }
    });
    return this.writeChain;
  }

  /** Non-blocking lazy flush for high-frequency, low-value updates. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.persistNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  async createAccount(a: Account): Promise<Account> {
    this.doc.accounts.push(a);
    await this.persistNow();
    return a;
  }
  async getAccountById(id: string) {
    return this.doc.accounts.find((a) => a.id === id);
  }
  async getAccountByEmail(email: string) {
    const e = email.toLowerCase();
    return this.doc.accounts.find((a) => a.email === e);
  }
  async getAccountByGoogleSub(sub: string) {
    return this.doc.accounts.find((a) => a.googleSub === sub);
  }
  async updateAccount(id: string, patch: Partial<Account>) {
    const acc = this.doc.accounts.find((a) => a.id === id);
    if (acc) Object.assign(acc, patch);
    await this.persistNow();
  }

  async createSession(s: Session) {
    // Cap sessions per account (keep the newest), so an attacker can't bloat the
    // store by looping logins.
    const mine = this.doc.sessions
      .filter((x) => x.accountId === s.accountId)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (mine.length >= MAX_SESSIONS_PER_ACCOUNT) {
      const keep = new Set(mine.slice(0, MAX_SESSIONS_PER_ACCOUNT - 1).map((x) => x.tokenHash));
      this.doc.sessions = this.doc.sessions.filter(
        (x) => x.accountId !== s.accountId || keep.has(x.tokenHash),
      );
    }
    this.doc.sessions.push(s);
    await this.persistNow();
  }
  async getSession(tokenHash: string) {
    return this.doc.sessions.find((s) => s.tokenHash === tokenHash);
  }
  async touchSession(tokenHash: string, at: number) {
    const s = this.doc.sessions.find((x) => x.tokenHash === tokenHash);
    if (s) {
      s.lastSeen = at;
      this.scheduleFlush(); // lazy — not a synchronous write per request
    }
  }
  async deleteSession(tokenHash: string) {
    this.doc.sessions = this.doc.sessions.filter((s) => s.tokenHash !== tokenHash);
    await this.persistNow();
  }
  async purgeExpiredSessions(ttlMs: number): Promise<number> {
    const now = Date.now();
    const before = this.doc.sessions.length;
    this.doc.sessions = this.doc.sessions.filter((s) => now - s.createdAt <= ttlMs);
    const removed = before - this.doc.sessions.length;
    if (removed > 0) await this.persistNow();
    return removed;
  }

  async setKey(e: VaultEntry) {
    const existing = this.doc.vault.find((v) => v.accountId === e.accountId && v.name === e.name);
    if (existing) {
      existing.ciphertext = e.ciphertext;
      existing.updatedAt = e.updatedAt;
    } else {
      this.doc.vault.push(e);
    }
    await this.persistNow();
  }
  async getKey(accountId: string, name: string) {
    return this.doc.vault.find((v) => v.accountId === accountId && v.name === name);
  }
  async listKeys(accountId: string) {
    return this.doc.vault.filter((v) => v.accountId === accountId);
  }
  async deleteKey(accountId: string, name: string) {
    this.doc.vault = this.doc.vault.filter(
      (v) => !(v.accountId === accountId && v.name === name),
    );
    await this.persistNow();
  }

  async createBot(b: Bot) {
    const count = this.doc.bots.filter((x) => x.accountId === b.accountId).length;
    if (count >= MAX_BOTS_PER_ACCOUNT) throw new Error("too many bots for this account");
    this.doc.bots.push(b);
    await this.persistNow();
  }
  async listBots(accountId: string) {
    return this.doc.bots.filter((b) => b.accountId === accountId);
  }
  async getBot(id: string) {
    return this.doc.bots.find((b) => b.id === id);
  }
  async getBotByLinkTokenHash(hash: string) {
    return this.doc.bots.find((b) => b.linkTokenHash === hash);
  }
  async updateBot(id: string, patch: Partial<Bot>) {
    const b = this.doc.bots.find((x) => x.id === id);
    if (b) Object.assign(b, patch);
    await this.persistNow();
  }
  async deleteBot(id: string, accountId: string): Promise<boolean> {
    const before = this.doc.bots.length;
    this.doc.bots = this.doc.bots.filter((b) => !(b.id === id && b.accountId === accountId));
    const removed = this.doc.bots.length < before;
    if (removed) await this.persistNow();
    return removed;
  }
  async touchBot(id: string, at: number) {
    const b = this.doc.bots.find((x) => x.id === id);
    if (b) {
      b.lastSeen = at;
      this.scheduleFlush();
    }
  }

  async getProfile(accountId: string) {
    return this.doc.profiles.find((p) => p.accountId === accountId)?.data;
  }
  async listProfiles() {
    return [...this.doc.profiles];
  }

  async nextBotNumber() {
    const n = this.doc.meta.nextBot++;
    await this.persistNow();
    return String(n).padStart(7, "0");
  }
  async createUnit(u: Unit) {
    if (this.doc.units.some((x) => x.botNumber === u.botNumber)) throw new Error("unit exists");
    this.doc.units.push(u);
    const n = Number(u.botNumber);
    if (Number.isFinite(n) && n >= this.doc.meta.nextBot) this.doc.meta.nextBot = n + 1;
    await this.persistNow();
  }
  async getUnit(botNumber: string) {
    return this.doc.units.find((x) => x.botNumber === botNumber);
  }
  async updateUnit(botNumber: string, patch: Partial<Unit>) {
    const u = this.doc.units.find((x) => x.botNumber === botNumber);
    if (u) { Object.assign(u, patch); await this.persistNow(); }
  }
  async listUnits() {
    return [...this.doc.units];
  }
  async setProfile(accountId: string, data: Record<string, unknown>) {
    const existing = this.doc.profiles.find((p) => p.accountId === accountId);
    if (existing) {
      existing.data = data;
      existing.updatedAt = Date.now();
    } else {
      this.doc.profiles.push({ accountId, data, updatedAt: Date.now() });
    }
    await this.persistNow();
  }
}
