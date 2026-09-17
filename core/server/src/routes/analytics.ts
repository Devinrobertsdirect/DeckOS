/*
 * analytics.ts — the "life dashboard" data, fed by Nobi's own local memory vault.
 *
 * GET  /api/analytics/life  → a life snapshot (email/money/job/school/priorities)
 *   built FROM the markdown memory the app keeps about the user (memory-vault.ts).
 *   Empty vault → clearly-marked SAMPLE data so a new user still sees the shape;
 *   as Nobi learns (writes notes), the dashboard fills in with the real thing.
 * POST /api/analytics/note  → add/update a memory note (also what the `remember`
 *   tool calls), so the app builds + customizes the dashboard for itself.
 *
 * Stable within a rolling 3-day window (generatedAt) = "rebuilds every few days".
 */
import { Router } from "express";
import { z } from "zod";
import { listNotes, writeNote, LIFE_CATEGORIES, type VaultNote, type LifeCategory } from "../lib/memory-vault.js";

const router = Router();
const DAY = 24 * 3600 * 1000;
const WINDOW = 3 * DAY;

type Kind = "email" | "money" | "job" | "school";
function kindOf(cat: LifeCategory): Kind {
  return cat === "money" || cat === "job" || cat === "school" || cat === "email" ? cat : "email";
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const DEMO = {
  demo: true,
  kpis: {
    inbox: { value: 6, sub: "of 41 unread need you", trend: -2 },
    money: { value: 1840, currency: "USD", sub: "net this month", trend: 12 },
    job: { value: 3, sub: "deadlines this week", trend: 0 },
    school: { value: 4, sub: "assignments due soon", trend: 1 },
  },
  priorities: [
    { kind: "money", weight: 98, title: "Rent auto-pays Thursday", detail: "$1,450 — balance covers it, +$210 cushion" },
    { kind: "job", weight: 95, title: "Recruiter reply owed", detail: "waiting since Mon; role closes Fri" },
    { kind: "school", weight: 90, title: "CS-340 milestone due", detail: "tomorrow 11:59 PM · 60% done" },
    { kind: "email", weight: 82, title: "Landlord: renewal terms", detail: "needs a yes/no by the weekend" },
  ],
  money: { spark: [120, 240, 180, 300, 260, 420, 380, 510, 470, 560, 540, 620], net: 1840, bills: [
    { name: "Rent", amount: 1450, dueInDays: 2 }, { name: "Phone", amount: 55, dueInDays: 6 }, { name: "Utilities", amount: 96, dueInDays: 9 },
  ] },
  deadlines: [
    { kind: "school", label: "CS-340 milestone", whenInDays: 1 }, { kind: "job", label: "Application closes", whenInDays: 3 },
    { kind: "school", label: "Stats problem set", whenInDays: 4 }, { kind: "job", label: "Portfolio review call", whenInDays: 5 },
  ],
  brief: "This is sample data. As we talk, I'll remember what matters — money, job, school, the people in your life — and this dashboard fills in with your real world.",
};

function buildFromVault(notes: VaultNote[]) {
  const by = (c: LifeCategory) => notes.filter((n) => n.category === c);
  const moneyNotes = by("money");
  const netTracked = moneyNotes.reduce((s, n) => s + (num(n.data.amount) ?? 0), 0);

  const kpis = {
    inbox: { value: by("email").length, sub: "items need you", trend: 0 },
    money: { value: Math.round(netTracked), currency: "USD", sub: "tracked", trend: 0 },
    job: { value: by("job").length, sub: "job items", trend: 0 },
    school: { value: by("school").length, sub: "school items", trend: 0 },
  };

  const priorities = [...notes]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map((n) => ({ kind: kindOf(n.category), weight: n.weight, title: n.title, detail: n.body.split("\n")[0]?.slice(0, 90) || "" }));

  const deadlines = notes
    .filter((n) => num(n.data.dueInDays) !== undefined)
    .map((n) => ({ kind: kindOf(n.category), label: n.title, whenInDays: num(n.data.dueInDays)! }))
    .sort((a, b) => a.whenInDays - b.whenInDays)
    .slice(0, 8);

  const bills = moneyNotes
    .filter((n) => num(n.data.amount) !== undefined)
    .map((n) => ({ name: n.title, amount: num(n.data.amount)!, dueInDays: num(n.data.dueInDays) ?? 0 }))
    .slice(0, 6);

  // A stored brief note wins; else a short auto-summary of the top items.
  const briefNote = notes.find((n) => n.tags.includes("brief"));
  const brief = briefNote
    ? briefNote.body
    : priorities.length
      ? `Right now the things that matter most: ${priorities.slice(0, 3).map((p) => p.title).join("; ")}.`
      : "I'm still learning your world — tell me what's going on and I'll start tracking it here.";

  return { demo: false, kpis, priorities, money: { spark: [], net: Math.round(netTracked), bills }, deadlines, brief };
}

router.get("/analytics/life", (_req, res) => {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW) * WINDOW;
  const header = {
    generatedAt: new Date(windowStart).toISOString(),
    nextRefreshInDays: Math.max(1, Math.ceil((windowStart + WINDOW - now) / DAY)),
  };
  let notes: VaultNote[] = [];
  try { notes = listNotes(); } catch { /* vault unavailable */ }
  res.json({ ...header, ...(notes.length ? buildFromVault(notes) : DEMO) });
});

// POST /api/analytics/note — add/update a memory note that feeds the dashboard.
const noteSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(LIFE_CATEGORIES as [LifeCategory, ...LifeCategory[]]).optional(),
  tags: z.array(z.string()).optional(),
  weight: z.number().min(0).max(100).optional(),
  data: z.record(z.unknown()).optional(),
  body: z.string().max(4000).optional(),
});
router.post("/analytics/note", (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid note" }); return; }
  const id = writeNote(parsed.data);
  res.json({ ok: true, id });
});

export default router;
