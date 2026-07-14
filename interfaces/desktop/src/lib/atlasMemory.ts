import { useCallback, useEffect, useState } from "react";

/**
 * atlasMemory — the part of Atlas that makes it feel like a friend who
 * remembers you.
 *
 * Two persistent stores, both in localStorage so they survive reloads AND
 * full app restarts, with no database anywhere in sight:
 *
 *  - Chat history  ("atlas_chat_history")  → the raw back-and-forth.
 *  - Memory facts  ("atlas_memory_facts")  → durable things Atlas knows about
 *                                             YOU (name, likes, job, …).
 *
 * Everything that touches storage is wrapped in try/catch: a full quota or a
 * corrupt JSON blob must never throw into the UI. Worst case we forget — we
 * never crash.
 *
 * Whenever anything mutates we dispatch a `atlas:memoryChanged` window event so
 * the optional `useAtlasMemory()` hook (and anyone else who cares) can re-read.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ChatRole = "user" | "atlas";

export interface ChatTurn {
  role: ChatRole;
  text: string;
  ts: number;
}

export type FactSource = "auto" | "user";

export interface MemoryFact {
  id: string;
  text: string;
  ts: number;
  source: FactSource;
}

// ── Keys & limits ────────────────────────────────────────────────────────────

const HISTORY_KEY = "atlas_chat_history";
const FACTS_KEY = "atlas_memory_facts";

const MAX_TURNS = 400;
const MAX_FACTS = 200;
const MAX_FACT_LEN = 120;
const DEFAULT_CONTEXT_TURNS = 12;

export const MEMORY_CHANGED_EVENT = "atlas:memoryChanged";

// ── Low-level storage helpers (never throw) ──────────────────────────────────

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded / serialization failure — forget silently */
  }
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT));
  } catch {
    /* no window (SSR / worker) — nothing to notify */
  }
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Chat history ─────────────────────────────────────────────────────────────

export function getHistory(): ChatTurn[] {
  return readArray<ChatTurn>(HISTORY_KEY);
}

export function appendTurn(role: ChatRole, text: string): ChatTurn {
  const turn: ChatTurn = { role, text: String(text ?? ""), ts: Date.now() };
  const history = getHistory();
  history.push(turn);
  // Keep only the most recent MAX_TURNS so the store can't grow forever.
  const capped = history.length > MAX_TURNS ? history.slice(history.length - MAX_TURNS) : history;
  writeArray(HISTORY_KEY, capped);
  notifyChanged();
  return turn;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
  notifyChanged();
}

// ── Memory facts ─────────────────────────────────────────────────────────────

export function getFacts(): MemoryFact[] {
  return readArray<MemoryFact>(FACTS_KEY);
}

/**
 * Normalized form used for near-identical dedupe: lowercased, punctuation
 * stripped, whitespace collapsed. "Likes hiking." and "likes  hiking" collapse
 * to the same key.
 */
function normalizeFact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicate(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // One phrase fully contained in the other (e.g. "has a dog" vs
  // "has a dog named rex") counts as a duplicate — keep the richer one already
  // stored rather than piling on.
  return a.includes(b) || b.includes(a);
}

export function addFact(text: string, source: FactSource = "user"): MemoryFact {
  let clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length > MAX_FACT_LEN) clean = clean.slice(0, MAX_FACT_LEN).trim();

  const facts = getFacts();
  const norm = normalizeFact(clean);

  // Dedupe against what we already know.
  if (norm) {
    const existing = facts.find((f) => isNearDuplicate(normalizeFact(f.text), norm));
    if (existing) return existing;
  }

  const fact: MemoryFact = { id: makeId(), text: clean, ts: Date.now(), source };

  // Blank facts are never persisted, but we still honor the return contract.
  if (!norm) return fact;

  facts.push(fact);
  const capped = facts.length > MAX_FACTS ? facts.slice(facts.length - MAX_FACTS) : facts;
  writeArray(FACTS_KEY, capped);
  notifyChanged();
  return fact;
}

export function removeFact(id: string): void {
  const facts = getFacts();
  const next = facts.filter((f) => f.id !== id);
  if (next.length !== facts.length) {
    writeArray(FACTS_KEY, next);
    notifyChanged();
  }
}

/**
 * Forget the fact that best matches a free-text query ("forget that I have a
 * dog" → removes "has a dog…"). Returns the removed fact's text, or null if
 * nothing matched. Used by the "forget" skill.
 */
export function forgetByText(query: string): string | null {
  const q = normalizeFact(query);
  if (!q) return null;
  const facts = getFacts();
  const qWords = new Set(q.split(" ").filter((w) => w.length > 2));
  let best: { fact: MemoryFact; score: number } | null = null;
  for (const f of facts) {
    const nf = normalizeFact(f.text);
    let score = 0;
    if (nf.includes(q) || q.includes(nf)) score = 100;
    else {
      const fw = nf.split(" ");
      for (const w of fw) if (qWords.has(w)) score++;
    }
    if (score > 0 && (!best || score > best.score)) best = { fact: f, score };
  }
  if (!best) return null;
  removeFact(best.fact.id);
  return best.fact.text;
}

export function clearFacts(): void {
  try {
    localStorage.removeItem(FACTS_KEY);
  } catch {
    /* ignore */
  }
  notifyChanged();
}

// ── Auto-extraction ──────────────────────────────────────────────────────────

/** Trim surrounding quotes/punctuation/whitespace and collapse inner spaces. */
function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’.,!?;:()\-]+/, "")
    .replace(/[\s"'“”‘’.,!?;:()\-]+$/, "")
    .trim();
}

function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const QUESTION_LEADERS =
  /^(who|what|when|where|why|how|which|whose|do|does|did|is|are|am|was|were|can|could|would|will|shall|should|may|might|have|has|had)\b/i;

function isQuestion(sentence: string): boolean {
  if (sentence.endsWith("?")) return true;
  return QUESTION_LEADERS.test(sentence.trim());
}

// Words that follow "I'm"/"I am" but are feelings/states, not a name.
const NOT_A_NAME = new Set([
  "ok",
  "okay",
  "fine",
  "good",
  "great",
  "here",
  "back",
  "home",
  "sorry",
  "tired",
  "happy",
  "sad",
  "ready",
  "done",
  "sure",
  "busy",
  "right",
  "wrong",
  "hungry",
  "bored",
  "curious",
  "confused",
  "excited",
  "glad",
]);

// Short pronoun-ish values that make useless likes/dislikes ("Likes you").
const PRONOUN_VALUES = new Set([
  "you",
  "it",
  "that",
  "this",
  "them",
  "him",
  "her",
  "us",
  "me",
  "these",
  "those",
]);

// "my <thing> is X" where <thing> is not really a possession.
const NOT_A_POSSESSION = new Set([
  "name",
  "point",
  "guess",
  "question",
  "problem",
  "issue",
  "concern",
  "goal",
  "plan",
  "answer",
  "only",
  "whole",
  "main",
  "biggest",
  "understanding",
  "advice",
  "hope",
  "job",
]);

// Verb → label for the likes/dislikes family.
function likeLabel(verb: string): string {
  const v = verb.toLowerCase();
  if (v === "love" || v === "adore") return "Loves";
  return "Likes";
}

/**
 * Pull durable, first-person facts out of what the USER said. Deliberately
 * conservative — it is far better to miss a fact than to store noise. Returns
 * concise strings like "Name is Devin", "Likes hiking", "Works as a nurse",
 * "Has a dog named Rex". Questions are ignored.
 */
export function extractFacts(userText: string): string[] {
  const text = String(userText ?? "");
  if (!text.trim()) return [];

  const found: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    let fact = tidy(raw);
    if (!fact) return;
    fact = capitalizeFirst(fact);
    if (fact.length > MAX_FACT_LEN) fact = fact.slice(0, MAX_FACT_LEN).trim();
    const key = normalizeFact(fact);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(fact);
  };

  for (const sentence of splitSentences(text)) {
    if (isQuestion(sentence)) continue;

    // ── Explicit "remember that X" / "don't forget X" ────────────────────────
    // Highest-signal: the user is telling us straight out.
    const remember = sentence.match(
      /\b(?:please\s+)?(?:remember|don['’]?t\s+forget|do\s+not\s+forget|note|keep\s+in\s+mind)\s+(?:that\s+|to\s+)?(.+)/i,
    );
    if (remember && remember[1]) {
      push(remember[1]);
      // A "remember" sentence is a full instruction — don't also mine it for
      // likes/jobs and risk duplicating the same content.
      continue;
    }

    // ── Name ─────────────────────────────────────────────────────────────────
    const nameIs = sentence.match(
      /\bmy\s+name\s+is\s+([A-Za-z][A-Za-z'’-]{1,29}(?:\s+[A-Z][A-Za-z'’-]{1,29})?)/i,
    );
    if (nameIs && nameIs[1]) {
      push(`Name is ${capitalizeFirst(tidy(nameIs[1]))}`);
    }

    const callMe = sentence.match(/\bcall\s+me\s+([A-Z][A-Za-z'’-]{1,29})\b/);
    if (callMe && callMe[1]) {
      push(`Name is ${capitalizeFirst(tidy(callMe[1]))}`);
    }

    // "I'm Devin" / "I am Devin" — only when the whole sentence is basically
    // just that (short & capitalized), and the word isn't a feeling.
    const bareName = sentence.match(/^I(?:['’]m| am)\s+([A-Z][a-z'’-]{1,29})[.!]?$/);
    if (bareName && bareName[1] && !NOT_A_NAME.has(bareName[1].toLowerCase())) {
      push(`Name is ${capitalizeFirst(bareName[1])}`);
    }

    // ── Likes / loves ────────────────────────────────────────────────────────
    const likeRe =
      /\bI\s+(?:really\s+|absolutely\s+|kinda\s+|kind\s+of\s+|totally\s+)?(like|love|enjoy|prefer|adore)\s+([^.,!?;:]+)/gi;
    for (let m = likeRe.exec(sentence); m; m = likeRe.exec(sentence)) {
      const value = tidy(m[2] ?? "");
      if (!value || PRONOUN_VALUES.has(value.toLowerCase())) continue;
      push(`${likeLabel(m[1] ?? "")} ${value}`);
    }

    // "I'm into X" / "I am into X"
    const into = sentence.match(/\bI(?:['’]m| am)\s+(?:really\s+)?into\s+([^.,!?;:]+)/i);
    if (into && into[1]) {
      const value = tidy(into[1]);
      if (value && !PRONOUN_VALUES.has(value.toLowerCase())) push(`Likes ${value}`);
    }

    // ── Dislikes ─────────────────────────────────────────────────────────────
    const dislikeRe =
      /\bI\s+(?:really\s+|absolutely\s+)?(?:hate|dislike|despise|can(?:['’]t|not)\s+stand|do\s?n['’]?t\s+like|do\s+not\s+like)\s+([^.,!?;:]+)/gi;
    for (let m = dislikeRe.exec(sentence); m; m = dislikeRe.exec(sentence)) {
      const value = tidy(m[1] ?? "");
      if (!value || PRONOUN_VALUES.has(value.toLowerCase())) continue;
      push(`Dislikes ${value}`);
    }

    // ── Job / role ───────────────────────────────────────────────────────────
    const workAs = sentence.match(/\bI\s+work\s+as\s+(a\s+|an\s+|the\s+)?([^.,!?;:]+)/i);
    if (workAs && workAs[2]) {
      const article = (workAs[1] ?? "").toLowerCase();
      push(`Works as ${article}${tidy(workAs[2])}`);
    }

    const workAt = sentence.match(/\bI\s+work\s+(?:at|for)\s+([^.,!?;:]+)/i);
    if (workAt && workAt[1]) {
      push(`Works at ${tidy(workAt[1])}`);
    }

    // "I am a nurse" / "I'm an engineer" — role via article. Skip filler like
    // "I'm a big fan" that reads better as a like; keep it simple and store the
    // noun phrase as a role.
    const roleIs = sentence.match(/\bI(?:['’]m| am)\s+(a|an)\s+([^.,!?;:]+)/i);
    if (roleIs && roleIs[2]) {
      const value = tidy(roleIs[2]);
      if (value && !PRONOUN_VALUES.has(value.toLowerCase())) {
        push(`Is ${roleIs[1].toLowerCase()} ${value}`);
      }
    }

    // ── Location ─────────────────────────────────────────────────────────────
    const liveIn = sentence.match(/\bI\s+live\s+in\s+([^.,!?;:]+)/i);
    if (liveIn && liveIn[1]) {
      push(`Lives in ${tidy(liveIn[1])}`);
    }

    const from = sentence.match(/\bI(?:['’]m| am)\s+from\s+([^.,!?;:]+)/i);
    if (from && from[1]) {
      push(`From ${tidy(from[1])}`);
    }

    // ── Possessions / relations ──────────────────────────────────────────────
    // "I have a dog named Rex" → "Has a dog named Rex". Skip "I have to …",
    // "I have been …", "I have no …".
    const have = sentence.match(
      /\bI\s+have\s+(a\s+|an\s+|two\s+|three\s+|some\s+|my\s+|\d+\s+)?([^.,!?;:]+)/i,
    );
    if (have && have[2]) {
      const article = (have[1] ?? "").toLowerCase();
      const value = tidy(have[2]);
      const lead = value.toLowerCase();
      const skip =
        !value ||
        !article || // require an explicit quantity/article to avoid "I have to"
        lead.startsWith("to ") ||
        lead.startsWith("been ") ||
        lead.startsWith("no ") ||
        lead === "no";
      if (!skip) push(`Has ${article}${value}`);
    }

    // "my dog is Rex" / "my sister is a teacher" → keep the phrase as-is.
    const myThing = sentence.match(
      /\bmy\s+([a-z][a-z]{1,20}(?:\s+[a-z]{2,20})?)\s+(is|are|was|were)\s+([^.,!?;:]+)/i,
    );
    if (myThing && myThing[1] && myThing[3]) {
      const thing = tidy(myThing[1]).toLowerCase();
      const firstWord = thing.split(" ")[0] ?? "";
      const value = tidy(myThing[3]);
      if (value && !NOT_A_POSSESSION.has(firstWord) && !PRONOUN_VALUES.has(value.toLowerCase())) {
        push(`My ${thing} ${myThing[2].toLowerCase()} ${value}`);
      }
    }
  }

  return found;
}

/** Extract durable facts from a user message and store them as "auto" facts. */
export function ingestUserMessage(text: string): void {
  for (const fact of extractFacts(text)) {
    addFact(fact, "auto");
  }
}

// ── Context for the chat API ─────────────────────────────────────────────────

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MemoryContext {
  history: ContextMessage[];
  facts: string[];
}

/**
 * Everything Atlas needs to sound like it remembers you: the last `maxTurns`
 * turns (default 12) mapped into chat-API shape (atlas → assistant) plus every
 * durable fact. Feed this into the chat request on every message.
 */
export function buildContext(opts?: { maxTurns?: number }): MemoryContext {
  const maxTurns =
    opts && typeof opts.maxTurns === "number" && opts.maxTurns > 0
      ? Math.floor(opts.maxTurns)
      : DEFAULT_CONTEXT_TURNS;

  const all = getHistory();
  const recent = all.length > maxTurns ? all.slice(all.length - maxTurns) : all;

  const history: ContextMessage[] = recent.map((t) => ({
    role: t.role === "atlas" ? "assistant" : "user",
    content: t.text,
  }));

  return { history, facts: getFacts().map((f) => f.text) };
}

// ── Human-readable summary ───────────────────────────────────────────────────

export function memorySummary(): string {
  const factCount = getFacts().length;
  const msgCount = getHistory().length;
  const things = factCount === 1 ? "thing" : "things";
  const messages = msgCount === 1 ? "message" : "messages";
  return `Remembers ${factCount} ${things} about you across ${msgCount} ${messages}.`;
}

// ── React hook ───────────────────────────────────────────────────────────────

export interface UseAtlasMemory {
  facts: MemoryFact[];
  history: ChatTurn[];
  refresh: () => void;
}

/**
 * Live view of Atlas's memory. Re-reads whenever anything in this module
 * mutates (via the `atlas:memoryChanged` event) and across tabs (via the
 * native `storage` event).
 */
export function useAtlasMemory(): UseAtlasMemory {
  const [facts, setFacts] = useState<MemoryFact[]>(getFacts);
  const [history, setHistory] = useState<ChatTurn[]>(getHistory);

  const refresh = useCallback(() => {
    setFacts(getFacts());
    setHistory(getHistory());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(MEMORY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MEMORY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  return { facts, history, refresh };
}
