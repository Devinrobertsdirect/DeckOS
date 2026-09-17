/*
 * memory-vault.ts — Nobi's own local, Obsidian-style memory.
 *
 * A folder of markdown notes (frontmatter + body) the app builds FOR ITSELF about
 * the user — one note per fact/observation, organized by life area. This is the
 * local-first knowledge base that feeds + customizes the Analytics dashboard.
 * File-based on purpose: portable, inspectable, survives with no DB (like config).
 *
 *   Default dir: <ATLAS_DATA_DIR or ~/.atlas>/memory/   (override NEURA_MEMORY_DIR)
 *
 * Note format (INDEX.md links them, like MEMORY.md):
 *   ---
 *   title: Rent auto-pays Thursday
 *   category: money
 *   tags: bills, recurring
 *   weight: 90
 *   updatedAt: 2026-07-18T...
 *   data: {"amount":1450,"dueInDays":2}
 *   ---
 *   Rent is $1,450, auto-pay on the 1st. Balance covers it with ~$210 to spare.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type LifeCategory = "money" | "job" | "school" | "email" | "relationships" | "health" | "general";
export const LIFE_CATEGORIES: LifeCategory[] = ["money", "job", "school", "email", "relationships", "health", "general"];

export interface VaultNote {
  id: string;
  title: string;
  category: LifeCategory;
  tags: string[];
  weight: number; // 0–100 priority
  data: Record<string, unknown>; // structured signals (amount, dueInDays, status…)
  updatedAt: string;
  body: string;
}

function vaultDir(): string {
  if (process.env.NEURA_MEMORY_DIR) return process.env.NEURA_MEMORY_DIR;
  const dataDir = process.env.ATLAS_DATA_DIR?.trim() || join(homedir() || ".", ".atlas");
  return join(dataDir, "memory");
}

function slug(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note");
}

function serialize(n: VaultNote): string {
  return (
    `---\n` +
    `title: ${n.title}\n` +
    `category: ${n.category}\n` +
    `tags: ${n.tags.join(", ")}\n` +
    `weight: ${n.weight}\n` +
    `updatedAt: ${n.updatedAt}\n` +
    `data: ${JSON.stringify(n.data ?? {})}\n` +
    `---\n\n${n.body}\n`
  );
}

function parse(id: string, raw: string): VaultNote | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const cat = (fm.category as LifeCategory) || "general";
  let data: Record<string, unknown> = {};
  try { data = fm.data ? JSON.parse(fm.data) : {}; } catch { /* ignore */ }
  return {
    id,
    title: fm.title || id,
    category: LIFE_CATEGORIES.includes(cat) ? cat : "general",
    tags: (fm.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
    weight: Number.isFinite(Number(fm.weight)) ? Number(fm.weight) : 50,
    data,
    updatedAt: fm.updatedAt || new Date(0).toISOString(),
    body: (m[2] || "").trim(),
  };
}

/** Write (or overwrite) a note. Returns its id. */
export function writeNote(input: {
  id?: string;
  title: string;
  category?: LifeCategory;
  tags?: string[];
  weight?: number;
  data?: Record<string, unknown>;
  body?: string;
}): string {
  const dir = vaultDir();
  mkdirSync(dir, { recursive: true });
  const id = input.id || `${input.category || "general"}-${slug(input.title)}`;
  const note: VaultNote = {
    id,
    title: input.title,
    category: (input.category && LIFE_CATEGORIES.includes(input.category) ? input.category : "general"),
    tags: input.tags ?? [],
    weight: Math.max(0, Math.min(100, input.weight ?? 50)),
    data: input.data ?? {},
    updatedAt: new Date().toISOString(),
    body: input.body ?? "",
  };
  writeFileSync(join(dir, `${id}.md`), serialize(note), "utf8");
  return id;
}

export function listNotes(): VaultNote[] {
  const dir = vaultDir();
  if (!existsSync(dir)) return [];
  const out: VaultNote[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md") || f === "INDEX.md") continue;
    try {
      const n = parse(f.replace(/\.md$/, ""), readFileSync(join(dir, f), "utf8"));
      if (n) out.push(n);
    } catch { /* skip unreadable */ }
  }
  return out;
}

export function notesByCategory(cat: LifeCategory): VaultNote[] {
  return listNotes().filter((n) => n.category === cat);
}

export function deleteNote(id: string): boolean {
  const p = join(vaultDir(), `${id}.md`);
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  return true;
}

export function vaultInfo(): { dir: string; count: number } {
  return { dir: vaultDir(), count: listNotes().length };
}
