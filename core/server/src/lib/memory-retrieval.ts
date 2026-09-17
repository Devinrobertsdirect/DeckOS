/*
 * memory-retrieval.ts — pull the RELEVANT memories, not just the recent ones.
 *
 * Before: the prompt got the last 3 memory entries chronologically. Now: from a
 * wider pool we retrieve the top-K most relevant to what the user just said —
 * so Nobi can actually recall "what did I decide about X last week."
 *
 * Semantic (OpenAI embeddings) when a key is present; a lexical keyword+recency
 * scorer otherwise. Always returns something useful, key or no key.
 */
import { getConfig } from "./app-config.js";

const STOP = new Set(
  "the a an and or but of to in on for with is are was were be been it this that i you he she they we my your his her their our as at by from up down out so if then than about into over after before your you're im i'm".split(
    /\s+/,
  ),
);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((t) => !STOP.has(t));
}

/** Crude stem so word variants match (allergy≈allergic, database≈databases). */
function stem(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

/** Keyword-overlap (stemmed) score with a small recency tiebreak. No network. */
function lexicalRank(query: string, memories: string[], k: number): string[] {
  const q = new Set(tokenize(query).map(stem));
  if (q.size === 0) return memories.slice(0, k);
  const scored = memories.map((m, i) => {
    const seen = new Set<string>();
    let overlap = 0;
    for (const t of tokenize(m)) { const s = stem(t); if (q.has(s) && !seen.has(s)) { overlap++; seen.add(s); } }
    const recency = ((memories.length - i) / Math.max(1, memories.length)) * 0.4;
    return { m, score: overlap + recency };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.m);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** True semantic ranking via OpenAI embeddings (one batched call). */
async function embedRank(query: string, memories: string[], k: number, key: string): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: [query, ...memories] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  const vecs = data.data.map((d) => d.embedding);
  const qv = vecs[0]!;
  return memories
    .map((m, i) => ({ m, score: cosine(qv, vecs[i + 1]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.m);
}

/** Retrieve the top-K memories most relevant to `query`. Never throws. */
export async function retrieveRelevant(query: string, memories: string[], k = 6): Promise<string[]> {
  const pool = [...new Set(memories.map((m) => (m || "").trim()).filter(Boolean))];
  if (pool.length <= k) return pool;
  const key = await getConfig("OPENAI_API_KEY").catch(() => null);
  if (key) {
    try {
      return await embedRank(query, pool, k, key);
    } catch {
      /* embeddings unavailable → fall back */
    }
  }
  return lexicalRank(query, pool, k);
}
