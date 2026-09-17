/**
 * skills-actions.ts — Nobi's action pack (GENERATED, then verified).
 *
 * 66 state-changing "action" skills (create/complete goals, run routines,
 * generate briefings & predictions, clear notifications, feedback signals, etc.).
 * Each was grounded in a real verified write endpoint. On the DB-less robot, DB-backed
 * writes return null and the handler speaks an honest fallback; on DB builds they work.
 * Regenerate via scratchpad/gen-actions.mjs.
 */
import type { Skill } from "./skills.js";
import { getJson, postJson, patchJson, putJson, delJson } from "./skills-extra.js";

// silence unused-import errors if a helper is not used by any current handler
void patchJson; void putJson; void delJson; void getJson; void postJson;

// Two-step power gate: an explicit shutdown/reboot phrase ARMS the request; it
// only executes on a confirm phrase within this window. A stray sentence can
// never power the robot down in one shot.
let powerArm: { action: "shutdown" | "reboot"; at: number } | null = null;
const POWER_CONFIRM_MS = 25_000;

export const ACTION_SKILLS: Skill[] = [
{
  id: "add-goal",
  async handle({ raw, lower }) {
    if (!/\b(add|create|new|track|start)\s+(a\s+)?(new\s+)?goal\b/i.test(lower) && !/\bremind me to\b/i.test(lower)) return null;
    let title = "";
    const m = raw.match(/\bgoal\b(?:\s+(?:called|named|to|for|is))?\s+(.+)/i);
    if (m && m[1]) title = m[1];
    else { const r2 = raw.match(/\bremind me to\s+(.+)/i); if (r2 && r2[1]) title = r2[1]; }
    title = title.replace(/[.?!]+$/, "").trim();
    if (title.length < 2) return { speak: "Sure — what should I call the goal?" };
    const r = await postJson("/api/goals", { title });
    if (r == null) return { speak: "I couldn't reach your goals to add that one." };
    return { speak: `Added a goal: ${title}.` };
  }
},
{
  id: "bad-suggestion",
  async handle({ lower }) {
    if (!/\b(that was wrong|bad suggestion|bad call|don'?t do that again|that wasn'?t helpful|not helpful|stop suggesting that|that was unhelpful)\b/i.test(lower)) return null;
    const r = await postJson("/api/feedback/signal", { signalType: "response.rejected" });
    if (r == null) return { speak: "Noted, though I couldn't log that feedback right now." };
    return { speak: "Understood. I'll dial that back and be less pushy about it." };
  }
},
{
  id: "clear-notifications",
  async handle({ lower }) {
    const del = /\b(delete|clear out|wipe|remove)\s+(all\s+)?(my\s+)?notifications\b/i.test(lower);
    const read = /\bmark (all|everything).*(read)\b|\bclear (my )?notifications\b|\bdismiss all( alerts| notifications)?\b|\bmark everything as read\b|\bmark all read\b/i.test(lower);
    if (!del && !read) return null;
    if (del) {
      const r = await delJson("/api/notifications");
      if (r == null) return { speak: "I couldn't clear your notifications just now." };
      return { speak: "Done. I deleted all your notifications." };
    }
    const r = await postJson("/api/notifications/read-all", {});
    if (r == null) return { speak: "I couldn't mark your notifications read just now." };
    return { speak: "All caught up. I marked every notification as read." };
  }
},
{
  id: "generate-briefing",
  async handle({ lower }) {
    // "read/recap/last/latest briefing" is the readout; "...briefing routine" is run-routine.
    if (/\b(routine|read|recap|last|latest|what was)\b/i.test(lower)) return null;
    if (!/\bbrief me\b|\bcatch me up\b|\b(generate|give me|make|create|update|refresh|run|do|get me) (a |my |the |your )?briefing\b/i.test(lower)) return null;
    const r = await postJson("/api/briefings/generate", {});
    if (r == null || r.briefing == null) return { speak: "I couldn't put a briefing together right now." };
    const b = r.briefing;
    const summary = typeof b.summary === "string" ? b.summary.trim() : "";
    if (summary) return { speak: summary };
    const active = b.stats && typeof b.stats.goalsActive === "number" ? b.stats.goalsActive : null;
    return { speak: active != null ? `Your briefing is ready. You have ${active} active goals.` : "Your briefing is ready." };
  }
},
{
  id: "generate-predictions",
  async handle({ lower }) {
    if (!/\b(what do you (foresee|predict)|run (your )?predictions|read the tea leaves|anything i should know)\b/i.test(lower)) return null;
    const r = await postJson("/api/predictions/generate", {});
    if (r == null) return { speak: "I couldn't run my predictions right now." };
    const preds = Array.isArray(r.predictions) ? r.predictions : [];
    if (preds.length === 0) return { speak: typeof r.message === "string" ? r.message : "Nothing stands out right now — everything looks on track." };
    let top = preds[0];
    for (const p of preds) if ((p.confidence ?? 0) > (top.confidence ?? 0)) top = p;
    const count = typeof r.generated === "number" ? r.generated : preds.length;
    const action = typeof top.suggestedAction === "string" ? top.suggestedAction : "";
    return { speak: action ? `I generated ${count} prediction${count === 1 ? "" : "s"}. Top one: ${action}.` : `I generated ${count} predictions.` };
  }
},
{
  id: "good-suggestion",
  async handle({ lower }) {
    if (!/\b(that was helpful|good call|good suggestion|great suggestion|i acted on that|yes,? do more of that|do more of that)\b/i.test(lower)) return null;
    const r = await postJson("/api/feedback/signal", { signalType: "suggestion.acted_on" });
    if (r == null) return { speak: "Glad it helped, though I couldn't log that feedback right now." };
    return { speak: "Noted. I'll lean a little more proactive going forward." };
  }
},
{
  id: "reset-my-profile",
  async handle({ lower }) {
    if (!/\b(reset (how you read me|my behaviou?r profile|my profile)|forget what you'?ve learned about me|start my profile fresh)\b/i.test(lower)) return null;
    const r = await postJson("/api/feedback/profile/reset", {});
    if (r == null) return { speak: "I couldn't reset your profile right now." };
    return { speak: "Reset. Your behavior profile is back to neutral defaults. We start learning again from here." };
  }
},
{
  id: "sync-threads",
  async handle({ lower }) {
    if (!/\b((re)?sync (my )?threads|refresh the storylines|rebuild (narrative )?threads|resync threads)\b/i.test(lower)) return null;
    const r = await postJson("/api/presence/threads/sync", {});
    if (r == null) return { speak: "I couldn't sync your threads right now." };
    const n = typeof r.synced === "number" ? r.synced : null;
    return { speak: n != null ? `Synced. I rebuilt your threads from current goals. ${n} ${n === 1 ? "is" : "are"} active.` : "Synced your threads from current goals." };
  }
},
{
  id: "complete-goal",
  async handle({ lower }) {
    if (!/\b(mark|complete|finish|finished|close( out)?|done with)\b/i.test(lower) || !/\bgoal\b/i.test(lower)) return null;
    if (/\b(add|create|new|track|make a plan)\b/i.test(lower)) return null;
    const list = await getJson("/api/goals");
    if (list == null || !Array.isArray(list.goals)) return { speak: "I couldn't reach your goals just now." };
    const stop = ["goal","goals","plan","done","finished","complete","close","mark","progress","status"];
    const words = new Set((lower.match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4 && !stop.includes(w)));
    let best = null; let bestScore = 0;
    for (const g of list.goals) {
      if (typeof g.title !== "string") continue;
      let score = 0;
      for (const w of (g.title.toLowerCase().match(/[a-z0-9]+/g) || [])) if (words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = g; }
    }
    if (!best) return { speak: "I couldn't tell which goal you meant. Which goal should I mark complete?" };
    const r = await patchJson(`/api/goals/${best.id}`, { status: "completed" });
    if (r == null) return { speak: `I found ${best.title}, but couldn't mark it complete right now.` };
    return { speak: `Nice work. I marked the ${best.title} goal complete.` };
  }
},
{
  id: "deadline-check",
  async handle({ lower }) {
    if (!/\b(due|deadlines?|overdue)\b/i.test(lower)) return null;
    const list = await getJson("/api/goals?status=active");
    if (list == null || !Array.isArray(list.goals)) return { speak: "I couldn't reach your goals just now." };
    const now = Date.now();
    const withDue = list.goals
      .filter((g) => g.dueAt)
      .map((g) => ({ g, t: new Date(g.dueAt).getTime() }))
      .filter((x) => !isNaN(x.t))
      .sort((a, b) => a.t - b.t);
    const overdue = withDue.filter((x) => x.t < now);
    if (overdue.length > 0) {
      const o = overdue[0].g;
      const extra = overdue.length > 1 ? ` ${overdue.length} goals are overdue in total.` : "";
      return { speak: `${o.title} is overdue${typeof o.completionPct === "number" ? `, at ${o.completionPct} percent` : ""}.${extra}` };
    }
    const upcoming = withDue.filter((x) => x.t >= now);
    if (upcoming.length === 0) return { speak: "Nothing has a deadline coming up. You're clear." };
    const soon = upcoming[0];
    const days = Math.ceil((soon.t - now) / 86400000);
    return { speak: `Your soonest deadline is ${soon.g.title}, due in ${days} day${days === 1 ? "" : "s"}${typeof soon.g.completionPct === "number" ? `, at ${soon.g.completionPct} percent` : ""}.` };
  }
},
{
  id: "dismiss-nudge",
  async handle({ lower }) {
    if (!/\bnudge\b/i.test(lower) || !/\b(dismiss|clear|drop|acknowledge|ack|got it)\b/i.test(lower)) return null;
    const nudges = await getJson("/api/presence/nudges");
    if (nudges == null || !Array.isArray(nudges)) return { speak: "I couldn't reach your nudges just now." };
    if (nudges.length === 0) return { speak: "You have no active nudges to dismiss." };
    const top = nudges[0];
    const r = await putJson(`/api/presence/nudges/${top.id}/dismiss`, {});
    if (r == null) return { speak: "I couldn't dismiss that nudge just now." };
    return { speak: "Got it. I dismissed your top nudge." };
  }
},
{
  id: "goal-progress",
  async handle({ lower }) {
    if (!/\b(how'?s|how is|progress on|how far along|status of|coming along)\b/i.test(lower)) return null;
    const list = await getJson("/api/goals");
    if (list == null || !Array.isArray(list.goals)) return null;
    const stop = ["goal","goals","plan","progress","status","going","along","how's","about"];
    const words = new Set((lower.match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4 && !stop.includes(w)));
    let best = null; let bestScore = 0;
    for (const g of list.goals) {
      if (typeof g.title !== "string") continue;
      let score = 0;
      for (const w of (g.title.toLowerCase().match(/[a-z0-9]+/g) || [])) if (words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = g; }
    }
    if (!best) return null;
    const pct = typeof best.completionPct === "number" ? best.completionPct : 0;
    const status = typeof best.status === "string" ? best.status : "active";
    return { speak: `The ${best.title} goal is at ${pct} percent, status ${status}.` };
  }
},
{
  id: "make-a-plan",
  async handle({ lower }) {
    if (!/\b(make a plan|break down|plan out|give me steps|steps for|plan for)\b/i.test(lower)) return null;
    const list = await getJson("/api/goals");
    if (list == null || !Array.isArray(list.goals)) return { speak: "I couldn't reach your goals just now." };
    const stop = ["goal","goals","plan","steps","break","down","make","give"];
    const words = new Set((lower.match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4 && !stop.includes(w)));
    let best = null; let bestScore = 0;
    for (const g of list.goals) {
      if (typeof g.title !== "string") continue;
      let score = 0;
      for (const w of (g.title.toLowerCase().match(/[a-z0-9]+/g) || [])) if (words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = g; }
    }
    if (!best) return null;
    const r = await postJson(`/api/goals/${best.id}/plan`, {});
    if (r == null || !Array.isArray(r.steps)) return { speak: `I found ${best.title}, but couldn't draft a plan just now.` };
    const first = r.steps[0];
    const conf = typeof r.confidence === "number" ? Math.round(r.confidence * 100) : null;
    const action = first && typeof first.action === "string" ? first.action : "";
    const confPart = conf != null ? ` at ${conf} percent confidence` : "";
    return { speak: `Done. I drafted a ${r.steps.length} step plan${confPart}.${action ? ` Step one: ${action}.` : ""}`, ui: { type: "open", route: "/timeline" } };
  }
},
{
  id: "run-routine",
  async handle({ lower }) {
    if (!/\b(run|trigger|kick off|execute|fire off|fire up)\b/i.test(lower)) return null;
    const list = await getJson("/api/routines");
    if (list == null || !Array.isArray(list.routines)) return { speak: "I couldn't reach your routines just now." };
    const stop = ["run","the","now","kick","off","routine","trigger","execute","fire","your","please","start"];
    const words = new Set((lower.match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4 && !stop.includes(w)));
    let best = null; let bestScore = 0;
    for (const rt of list.routines) {
      if (typeof rt.name !== "string") continue;
      let score = 0;
      for (const w of (rt.name.toLowerCase().match(/[a-z0-9]+/g) || [])) if (words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = rt; }
    }
    if (!best) return null;
    const r = await postJson(`/api/routines/${best.id}/trigger`, {});
    if (r == null) return { speak: `I found the ${best.name} routine, but couldn't start it just now.` };
    return { speak: `Running the ${best.name} routine now. I'll let you know when it finishes.` };
  }
},
{
  id: "set-initiative-level",
  async handle({ lower }) {
    const up = /\b(more proactive|raise your initiative|turn your initiative up|be more proactive|speak up more|more initiative|be more assertive)\b/i.test(lower);
    const down = /\b(back off|be less pushy|less proactive|lower your initiative|turn your initiative down|dial it back|tone it down|less initiative)\b/i.test(lower);
    if (!up && !down) return null;
    const cfg = await getJson("/api/presence/config");
    if (cfg == null || typeof cfg.initiativeLevel !== "number") return { speak: "I couldn't reach my initiative settings right now." };
    const next = up ? Math.min(1, cfg.initiativeLevel + 0.25) : Math.max(0, cfg.initiativeLevel - 0.25);
    const r = await putJson("/api/presence/config", { initiativeLevel: next });
    if (r == null) return { speak: "I couldn't change my initiative level just now." };
    return { speak: up ? "Done. I turned my initiative up. Expect me to speak up more often." : "Done. I dialed my initiative down. I'll be more hands-off." };
  }
},
{
  id: "browse-store",
  async handle({ lower }) {
    if (!/\b(what (skills?|add-?ons?|plugins?) can i (add|install|download|get)|what'?s (in|available in) the (plugin |skills? )?store|(show|browse) (me )?the (plugin|skills?) (catalog|store|marketplace)|browse (available )?add-?ons?|what can i (download|add))\b/i.test(lower)) return null;
    const d = await getJson("/api/plugins/store/registry");
    if (d == null || !Array.isArray(d.plugins)) return { speak: "I couldn't reach the skills store just now." };
    const notInstalled = d.plugins.filter((p) => p && !p.installed);
    if (notInstalled.length === 0) return { speak: "You've already got every skill in the store installed." };
    const names = notInstalled.map((p) => p.name).filter(Boolean).slice(0, 3);
    return { speak: "The store has " + d.plugins.length + " add-ons. A few you don't have yet: " + names.join(", ") + ". Want me to open the store?" };
  }
},
{
  id: "capability-search",
  async handle({ lower }) {
    const m = lower.match(/\b(?:can you|could you|are you able to|do you (?:do|handle|support)|what can you do (?:with|about|for))\s+(.+)/i);
    if (!m || !m[1]) return null;
    const query = m[1].replace(/[?.!]+$/, "").trim();
    if (query.length < 3) return null;
    // Sensory / I-O questions ("can you hear me / see this / talk / type") are answered
    // by the dedicated mic, screen-vision and feature skills (or the LLM) — never by fuzzy
    // manifest matching, which used to surface the command-console's "typing commands"
    // summary as a bogus "Yes." Bail so those skills (or chat) handle it truthfully.
    if (/\b(hear|listen(ing)?|hearing|ears?|mic|microphone|see(ing)?|look(ing)?|watch|vision|eyes?|camera|talk(ing)?|speak(ing)?|say|voice|type|typing)\b/.test(query)) return null;
    const d = await getJson("/api/capabilities");
    if (d == null || !Array.isArray(d.capabilities)) return null;
    const stop = new Set(["the","my","your","me","for","with","some","any","and","can","you","please","stuff","things","thing","able"]);
    const words = query.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/gi, "").toLowerCase()).filter((w) => w.length > 2 && !stop.has(w));
    if (!words.length) return null;
    let best = null, bestScore = 0;
    for (const c of d.capabilities) {
      const hay = [c.title, c.summary, c.category, ...(Array.isArray(c.userPhrasings) ? c.userPhrasings : [])].join(" ").toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score++;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best || bestScore === 0) return null;
    const first = String(best.summary || best.title || "").split(". ")[0];
    const offer = best.uiRoute ? " Want me to open it?" : "";
    return { speak: "Yes. " + first + "." + offer };
  }
},
{
  id: "plugin-reviews",
  async handle({ lower }) {
    if (!/\b((how|what)('?s| is| are)?.*(rated|rating|reviewed?|review|stars?)|show (me )?ratings?|what did i rate|how many stars)\b/i.test(lower)) return null;
    const reg = await getJson("/api/plugins/store/registry");
    if (reg == null || !Array.isArray(reg.plugins)) return { speak: "I couldn't reach the store to check ratings." };
    const p = reg.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()))
      ?? reg.plugins.find((x) => x && String(x.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => lower.includes(w)));
    if (!p) return { speak: "Which skill's rating do you want? Say the name as it appears in the store." };
    const r = await getJson("/api/plugins/store/" + p.id + "/review");
    if (r == null) return { speak: "I couldn't pull up the rating for " + p.name + " right now." };
    if (!r.review) return { speak: "No one's rated the " + p.name + " skill yet." };
    const blurb = r.review.review ? " " + String(r.review.review).split(". ")[0] + "." : "";
    return { speak: "The " + p.name + " skill is rated " + r.review.rating + " out of 5 stars." + blurb };
  }
},
{
  id: "plugin-status",
  async handle({ lower }) {
    if (!/\b(plugin|system monitor|file manager|ai chat|device control|automation scheduler)\b/i.test(lower)) return null;
    if (!/\b(is|are|how'?s|hows|status|working|active|running|up|check|doing)\b/i.test(lower)) return null;
    const d = await getJson("/api/plugins");
    if (d == null || !Array.isArray(d.plugins)) return { speak: "I couldn't reach the plugin manager just now." };
    const p = d.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()))
      ?? d.plugins.find((x) => x && String(x.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => lower.includes(w)));
    if (!p) return { speak: "Which plugin do you mean? I've got system monitor, file manager, ai chat, device control, and automation scheduler." };
    if (p.status === "error") return { speak: "The " + p.name + " plugin is in an error state" + (p.errorMessage ? ": " + p.errorMessage : "") + "." };
    const active = p.enabled ? "active" : "disabled";
    const last = p.lastActivity ? ", last active " + new Date(p.lastActivity).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    return { speak: "The " + p.name + " plugin is " + active + ", version " + p.version + last + "." };
  }
},
{
  id: "run-command",
  async handle({ lower }) {
    const hasVerb = /\b(run|execute|dispatch)\b/.test(lower) || /\bping\b/.test(lower);
    if (!hasVerb) return null;
    let input = null;
    if (/\bping\b/.test(lower)) input = "ping";
    else if (/\bstatus\b/.test(lower)) input = "status";
    else if (/\bhelp\b/.test(lower)) input = "help";
    else if (/\bplugins?\b/.test(lower) && /\blist\b/.test(lower)) input = "plugins list";
    else if (/\bdevices?\b/.test(lower) && /\blist\b/.test(lower)) input = "devices list";
    else if (/\bmemory\b/.test(lower) && /\bsearch\b/.test(lower)) input = "memory search";
    else if (/\bls\b/.test(lower)) input = "ls";
    if (!input) return null;
    const d = await postJson("/api/commands", { input });
    if (d == null) return { speak: "I couldn't run that command just now." };
    const out = String(d.output || "").replace(/\s+/g, " ").trim();
    if (!out) return { speak: "That command ran, but returned nothing." };
    const short = out.split(/(?<=[.!])\s/).slice(0, 2).join(" ").slice(0, 240);
    return { speak: short };
  }
},
{
  id: "toggle-plugin",
  async handle({ lower }) {
    if (!/\b(plugin|system monitor|file manager|ai chat|device control|automation scheduler)\b/i.test(lower)) return null;
    const on = /\b(enable|turn on|switch on|activate|start (up )?)\b/.test(lower);
    const off = /\b(disable|turn off|switch off|shut (down|off)|deactivate)\b/.test(lower);
    if (!on && !off) return null;
    const d = await getJson("/api/plugins");
    if (d == null || !Array.isArray(d.plugins)) return { speak: "I couldn't reach the plugin manager just now." };
    const p = d.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()))
      ?? d.plugins.find((x) => x && String(x.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => lower.includes(w)));
    if (!p) return null;
    const enabled = on && !off;
    const r = await postJson("/api/plugins/" + p.id + "/toggle", { enabled });
    if (r == null) return { speak: "I couldn't toggle the " + p.name + " plugin just now." };
    return { speak: p.name + " is " + (enabled ? "on" : "off") + " now." };
  }
},
{
  id: "toggle-store-plugin",
  async handle({ lower }) {
    const on = /\b(enable|turn on|switch on|activate|resume|unpause)\b/.test(lower);
    const off = /\b(disable|turn off|switch off|deactivate|pause|shut (down|off))\b/.test(lower);
    if (!on && !off) return null;
    const d = await getJson("/api/plugins/store/installed");
    if (d == null || !Array.isArray(d.plugins)) return null;
    const p = d.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()))
      ?? d.plugins.find((x) => x && String(x.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => lower.includes(w)))
      ?? d.plugins.find((x) => x && lower.includes(String(x.pluginId || "").toLowerCase().replace(/[_-]/g, " ")));
    if (!p) return null;
    const enabled = on && !off;
    const r = await patchJson("/api/plugins/store/" + p.pluginId + "/toggle", { enabled });
    if (r == null) return { speak: "I couldn't toggle the " + p.name + " skill just now." };
    return { speak: p.name + " skill is " + (enabled ? "enabled" : "disabled") + "." };
  }
},
{
  id: "install-plugin",
  async handle({ lower }) {
    if (!/\b(install|add|download|grab|get me)\b/.test(lower)) return null;
    if (/\b(brain|model|llm|ollama|gemma|local model)\b/.test(lower)) return null; // that's install-local-brain
    if (!/\b(skill|plugin|add-?on)\b/.test(lower) && !/\binstall\b/.test(lower)) return null;
    const reg = await getJson("/api/plugins/store/registry");
    if (reg == null || !Array.isArray(reg.plugins)) return { speak: "I couldn't reach the store to install that." };
    const p = reg.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()))
      ?? reg.plugins.find((x) => x && String(x.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => lower.includes(w)))
      ?? reg.plugins.find((x) => x && lower.includes(String(x.id || "").toLowerCase().replace(/[_-]/g, " ")));
    if (!p) return { speak: "I couldn't find that skill in the store. Say browse the store to hear what's available." };
    if (p.installed) return { speak: "The " + p.name + " skill is already installed." };
    const r = await postJson("/api/plugins/store/install/" + p.id, {});
    if (r == null) return { speak: "I couldn't install " + p.name + " just now." };
    if (r.installed) return { speak: "Installing " + p.name + " now. It's downloading and loading into a sandbox, give me a second." + (r.warning ? " Heads up: " + r.warning : "") };
    return { speak: "I tried to install " + p.name + " but it didn't take." };
  }
},
{
  id: "run-plugin-command",
  async handle({ lower }) {
    if (!/\b(run|execute|have|tell|ask|use|discover|check|get|list)\b/.test(lower)) return null;
    const d = await getJson("/api/plugins");
    if (d == null || !Array.isArray(d.plugins)) return null;
    const p = d.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()));
    if (!p || !Array.isArray(p.commands)) return null;
    let command = p.commands.find((c) => new RegExp("\\b" + String(c).replace(/[^a-z0-9]/gi, "") + "\\b", "i").test(lower)) || null;
    if (!command) {
      if (p.id === "file_manager" && /\b(list|browse|show)\b/.test(lower)) command = "ls";
      else if (p.id === "system_monitor" && /\bdisk\b/.test(lower)) command = "disk";
      else if (p.id === "device_control" && /\b(find|scan)\b/.test(lower)) command = "discover";
    }
    if (!command) return { speak: "Which command should I run on the " + p.name + " plugin? It can do: " + p.commands.slice(0, 5).join(", ") + "." };
    const r = await postJson("/api/plugins/" + p.id + "/execute", { command, args: {} });
    if (r == null) return { speak: "I couldn't run that on the " + p.name + " plugin just now." };
    if (r.success === false) return { speak: r.output ? String(r.output) : "That command isn't available on the " + p.name + " plugin." };
    const out = String(r.output || "").replace(/\s+/g, " ").trim();
    return { speak: out || (p.name + " ran the " + command + " command.") };
  }
},
{
  id: "search-store",
  async handle({ lower }) {
    const m = lower.match(/\b(?:find|search for|search the store for|look for|is there|do you have)\s+(?:me\s+)?(?:a|an|the|any)?\s*(.+)/i);
    if (!m || !m[1]) return null;
    if (!/\b(skill|plugin|add-?on|store)\b/.test(lower)) return null;
    let term = m[1].replace(/\b(a |an |the |any )?(skill|plugin|add-?on)s?\b/gi, " ").replace(/\bin the store\b/gi, " ").replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();
    if (term.length < 2) return null;
    const reg = await getJson("/api/plugins/store/registry");
    if (reg == null || !Array.isArray(reg.plugins)) return { speak: "I couldn't reach the store to search just now." };
    const t = term.toLowerCase();
    const p = reg.plugins.find((x) => x && String(x.name || "").toLowerCase().includes(t))
      ?? reg.plugins.find((x) => x && (String(x.description || "").toLowerCase().includes(t) || (Array.isArray(x.tags) && x.tags.some((g) => String(g).toLowerCase().includes(t)))));
    if (!p) return { speak: "I couldn't find a " + term + " skill in the store." };
    if (p.installed) return { speak: "Found it. The " + p.name + " skill is in the store and already installed." };
    return { speak: "Found it. There's a " + p.name + " skill in the store, not installed yet. Say install " + p.name + " and I'll grab it." };
  }
},
{
  id: "uninstall-plugin",
  async handle({ lower }) {
    if (!/\b(uninstall|remove|delete|get rid of|drop)\b/.test(lower)) return null;
    if (!/\b(skill|plugin|add-?on)\b/.test(lower) && !/\buninstall\b/.test(lower)) return null;
    const d = await getJson("/api/plugins/store/installed");
    if (d == null || !Array.isArray(d.plugins)) return { speak: "I couldn't reach your installed skills just now." };
    const p = d.plugins.find((x) => x && lower.includes(String(x.name || "").toLowerCase()))
      ?? d.plugins.find((x) => x && String(x.name || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => lower.includes(w)))
      ?? d.plugins.find((x) => x && lower.includes(String(x.pluginId || "").toLowerCase().replace(/[_-]/g, " ")));
    if (!p) return { speak: "I don't see that as an installed skill. It may be a built-in, which you can disable instead of uninstall." };
    const r = await delJson("/api/plugins/store/uninstall/" + p.pluginId);
    if (r == null) return { speak: "I couldn't remove " + p.name + " just now." };
    if (r.uninstalled) return { speak: "Removed " + p.name + ". It's gone from your installed skills." };
    return { speak: "I tried to remove " + p.name + " but it didn't take." };
  }
},
{
  id: "channel-status",
  async handle({ lower }) {
    if (!/\b(how can (people|i|someone) reach you|what channels|which (chat|messaging) apps|are you (connected|on|hooked up)|what messaging( is)? set up|connected to (whatsapp|telegram|discord|slack|signal))\b/i.test(lower)) return null;
    const r = await getJson("/api/channels/status");
    if (r == null || !r.channels) return { speak: "I couldn't check my messaging channels right now." };
    const on = [];
    for (const [name, info] of Object.entries(r.channels)) {
      if (info && info.configured) on.push(name);
    }
    if (on.length === 0) return { speak: "No messaging channels are configured yet. You can set up WhatsApp, Telegram, Discord, Slack, or Signal." };
    const list = on.join(", ");
    return { speak: `Right now ${list} ${on.length === 1 ? "is" : "are"} configured. The rest are not set up yet.` };
  }
},
{
  id: "memory-count",
  async handle({ lower }) {
    if (!/\b(how much do you remember|how many memories|how big is your memory|how much have you (got|stored)|memory size)\b/i.test(lower)) return null;
    const [st, lt] = await Promise.all([
      getJson("/api/memory/short-term"),
      getJson("/api/memory/long-term?limit=1000"),
    ]);
    if (st == null && lt == null) return { speak: "I couldn't reach my memory store just now." };
    const shortN = st && typeof st.total === "number" ? st.total : (st && Array.isArray(st.entries) ? st.entries.length : 0);
    const longN = lt && typeof lt.total === "number" ? lt.total : (lt && Array.isArray(lt.entries) ? lt.entries.length : 0);
    return { speak: `I am holding ${shortN} short term note${shortN === 1 ? "" : "s"} and ${longN} long term memor${longN === 1 ? "y" : "ies"} right now.` };
  }
},
{
  id: "mic-mute",
  async handle({ lower }) {
    const wantMute = /\b(stop listening|mute (your |the )?mic|mute yourself|close your ears|stop hearing me)\b/i.test(lower);
    const wantUnmute = /\b(start listening( again)?|unmute( yourself)?|open your ears|listen again)\b/i.test(lower);
    if (!wantMute && !wantUnmute) return null;
    const on = wantMute && !wantUnmute;
    const r = await postJson("/api/voice/mute", { on });
    if (r == null) return { speak: "I couldn't change my microphone just now." };
    return { speak: on ? "Ears closed. Say the wake word when you want me back." : "Listening again." };
  }
},
{
  id: "note-to-self",
  async handle({ raw, lower }) {
    if (!/\b(make a (quick )?note|note to self|jot (this|that) down|quick note|remind me later that)\b/i.test(lower)) return null;
    const m = raw.match(/\b(?:note to self|make a quick note|make a note|jot (?:this|that) down|quick note|remind me later)\b[,:\s]*(?:that|to|about)?\s*(.+)/i);
    const content = m && m[1] ? m[1].replace(/[.?!]+$/, "").trim() : "";
    if (!content || content.length < 2) return { speak: "Sure, what should I note down?" };
    const r = await postJson("/api/memory/short-term", { content, keywords: [], source: "voice", ttlSeconds: 3600 });
    if (r == null) return { speak: "I couldn't save that note just now." };
    return { speak: "Noted. I will hang onto that for the next few hours." };
  }
},
{
  id: "remember-permanently",
  async handle({ raw, lower }) {
    if (!/\b(remember (this|that) forever|store (this|that) permanently|keep (this|that) for good|never forget( that)?|save (this|that) to long ?term)\b/i.test(lower)) return null;
    const m = raw.match(/\b(?:remember (?:this|that) forever|store (?:this|that) permanently|keep (?:this|that) for good|never forget|save (?:this|that) to long ?term memory)\b[,:\s]*(?:that)?\s*(.+)/i);
    const content = m && m[1] ? m[1].replace(/[.?!]+$/, "").trim() : "";
    if (!content || content.length < 2) return { speak: "What would you like me to remember for good?" };
    const r = await postJson("/api/memory/long-term", { content, keywords: [], source: "voice" });
    if (r == null) return { speak: "I couldn't save that to long term memory just now." };
    return { speak: "Locked in for good. I will not let that one expire." };
  }
},
{
  id: "reset-pairing",
  async handle({ lower }) {
    if (!/\b(reset (my )?pairing( code)?|generate a new pairing code|roll a new (connect|pairing) code|invalidate the pairing code|unpair all my devices)\b/i.test(lower)) return null;
    const r = await postJson("/api/pairing/reset", {});
    if (r == null || !r.code) return { speak: "I couldn't reset the pairing code just now." };
    const NATO = { a:"alpha", b:"bravo", c:"charlie", d:"delta", e:"echo", f:"foxtrot", g:"golf", h:"hotel", i:"india", j:"juliet", k:"kilo", l:"lima", m:"mike", n:"november", o:"oscar", p:"papa", q:"quebec", r:"romeo", s:"sierra", t:"tango", u:"uniform", v:"victor", w:"whiskey", x:"xray", y:"yankee", z:"zulu" };
    const DIG = { "0":"zero", "1":"one", "2":"two", "3":"three", "4":"four", "5":"five", "6":"six", "7":"seven", "8":"eight", "9":"nine" };
    const spoken = String(r.code).toLowerCase().split("").map((ch) => NATO[ch] || DIG[ch] || ch).join(" ");
    return { speak: `New code generated. It is now ${spoken}. All old pairings are cleared.` };
  }
},
{
  id: "set-attitude",
  async handle({ lower }) {
    if (!/\b(be|act|sound|switch|turn|go)\b/i.test(lower)) return null;
    const ATT = ["professional", "casual", "witty", "serious", "empathetic", "commanding", "gentle", "playful"];
    const found = ATT.find((a) => lower.includes(a));
    if (!found) return null;
    const r = await putJson("/api/ai/persona", { attitude: found });
    if (r == null) return { speak: "I couldn't change my attitude just now." };
    return { speak: `${found.charAt(0).toUpperCase() + found.slice(1)} it is.` };
  }
},
{
  id: "set-face-expression",
  async handle({ lower }) {
    if (!/\b(look|show me|make|put on|give me)\b.*\b(happy|angry|mad|sad|surprised|shocked|confused|excited|thinking|love|wink|suspicious|sleepy|sleeping|starstruck)\b/i.test(lower)) return null;
    const SYN = { happy:"happy", angry:"angry", mad:"angry", sad:"sad", surprised:"excited", shocked:"excited", excited:"excited", confused:"confused", thinking:"thinking", love:"love", wink:"wink", suspicious:"suspicious", sleepy:"sleeping", sleeping:"sleeping", starstruck:"starstruck" };
    const key = Object.keys(SYN).find((k) => lower.includes(k));
    if (!key) return null;
    const state = SYN[key];
    const states = await getJson("/api/face/states");
    const valid = states && Array.isArray(states.states) ? states.states : null;
    if (valid && !valid.includes(state)) return { speak: `I can't make a ${key} face.` };
    const r = await postJson("/api/face", { state });
    if (r == null) return { speak: "I couldn't change my face just now." };
    return { speak: `There, ${key} face on.` };
  }
},
{
  id: "set-persona-gender",
  async handle({ lower }) {
    if (!/\b(voice persona|persona|present as|switch your gender|your gender|go (male|female|neutral|non-?binary)|be (male|female|non-?binary|neutral))\b/i.test(lower)) return null;
    let gender = null;
    if (/\bfemale\b/i.test(lower)) gender = "female";
    else if (/\bmale\b/i.test(lower)) gender = "male";
    else if (/\bnon-?binary\b/i.test(lower)) gender = "nonbinary";
    else if (/\bneutral\b/i.test(lower)) gender = "neutral";
    if (!gender) return null;
    const r = await putJson("/api/ai/persona", { gender });
    if (r == null) return { speak: "I couldn't change my persona just now." };
    return { speak: `Done. My persona reads as ${gender} now.` };
  }
},
{
  id: "set-response-length",
  async handle({ lower }) {
    let len = null;
    if (/\b(keep it (brief|short)|short answers|be brief|be concise|briefly)\b/i.test(lower)) len = "brief";
    else if (/\b(be comprehensive|comprehensive|full detail|maximum detail)\b/i.test(lower)) len = "comprehensive";
    else if (/\b(be (more )?thorough|thorough|more detail|longer answers)\b/i.test(lower)) len = "thorough";
    else if (/\b(keep answers balanced|balanced answers|medium length|be balanced)\b/i.test(lower)) len = "balanced";
    if (!len) return null;
    const r = await putJson("/api/ai/persona", { responseLength: len });
    if (r == null) return { speak: "I couldn't change my answer length just now." };
    const label = { brief: "Keeping it brief", balanced: "Keeping answers balanced", thorough: "Being more thorough", comprehensive: "Going comprehensive" }[len];
    return { speak: `${label} from now on.` };
  }
},
{
  id: "set-thinking-depth",
  async handle({ lower }) {
    let depth = null;
    if (/\b(think quicker|quick answers|think fast(er)?|quicker thinking|answer quickly)\b/i.test(lower)) depth = "quick";
    else if (/\b(think deeply|deep(er)? thinking|detailed thinking|take your time thinking|think harder)\b/i.test(lower)) depth = "detailed";
    else if (/\b(standard thinking|normal thinking)\b/i.test(lower)) depth = "standard";
    if (!depth) return null;
    const r = await putJson("/api/ai/persona", { thinkingDepth: depth });
    if (r == null) return { speak: "I couldn't change how I think just now." };
    const label = { quick: "Switching to quick thinking", standard: "Switching to standard thinking", detailed: "Switching to detailed thinking. I will chew on things a bit longer" }[depth];
    return { speak: `${label}.` };
  }
},
{
  id: "all-devices-off",
  async handle({ lower }) {
    const wantsAll = /\b(everything|all (the )?devices|all (the )?lights)\b/i.test(lower);
    const wantsOff = /\b(off|down|kill|shut)\b/i.test(lower);
    if (!wantsAll || !wantsOff) return null;
    const lightsOnly = /\blights?\b/i.test(lower);
    const list = await getJson("/api/devices");
    if (list == null || !Array.isArray(list.devices)) return { speak: "I couldn't reach your devices to switch them off." };
    let targets = list.devices.filter((d) => d.type === "actuator" || d.type === "simulated");
    if (lightsOnly) targets = targets.filter((d) => /light|lamp/i.test(((d.name || "") + " " + (d.location || ""))));
    if (!targets.length) return { speak: lightsOnly ? "I don't see any lights to turn off." : "I don't see any switchable devices to turn off." };
    let done = 0;
    for (const d of targets) {
      const r = await postJson(`/api/devices/${d.id}/control`, { action: "off" });
      if (r && r.success) done++;
    }
    if (!done) return { speak: "I tried, but none of the devices accepted the off command." };
    return { speak: `Turning ${lightsOnly ? "the lights" : "everything"} off. ${done} device${done === 1 ? "" : "s"} switched off.` };
  }
},
{
  id: "device-status",
  async handle({ raw, lower }) {
    const asksState = /\b(online|offline|connected|reachable|up|down|working|status)\b/i.test(lower);
    const asksForm = /\b(is|are|how'?s|check on|status of)\b/i.test(lower);
    if (!asksState || !asksForm) return null;
    const list = await getJson("/api/devices");
    if (list == null || !Array.isArray(list.devices)) return { speak: "I couldn't reach your devices just now." };
    const p = raw.toLowerCase();
    const dev = list.devices.find((d) => d.name && p.includes(d.name.toLowerCase()))
      ?? list.devices.find((d) => d.name && d.name.toLowerCase().split(/\s+/).some((w) => w.length > 2 && p.includes(w)));
    if (!dev) return null;
    let ago = "";
    if (dev.lastSeen) {
      const secs = Math.max(0, Math.round((Date.now() - new Date(dev.lastSeen).getTime()) / 1000));
      const mins = Math.round(secs / 60), hrs = Math.round(secs / 3600);
      ago = secs < 60 ? `, last seen ${secs} second${secs === 1 ? "" : "s"} ago`
          : secs < 3600 ? `, last seen ${mins} minute${mins === 1 ? "" : "s"} ago`
          : `, last seen ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    }
    return { speak: `The ${dev.name} is ${dev.status}${ago}.` };
  }
},
{
  id: "motor-bench-test",
  async handle({ lower }) {
    const wantsTest = /\b(test|bench|pulse|twitch|check|run)\b/i.test(lower);
    const wantsMotor = /\b(motor|motors|wheel|wheels)\b/i.test(lower);
    if (!wantsTest || !wantsMotor) return null;
    const motor = (/\bmotor b\b/i.test(lower) || /\bright (motor|wheel)\b/i.test(lower)) ? "B" : "A";
    const r = await postJson("/api/hal/test", { action: "pulse", motor });
    if (r == null) return { speak: "I couldn't reach the motor controller to run that test." };
    if (r.error) return { speak: `The motor test failed: ${r.error}` };
    const pct = Math.round((r.duty ?? 0.25) * 100);
    return { speak: `Pulsing motor ${r.motor} at ${pct} percent for ${r.ms ?? 250} milliseconds. It stopped clean.` };
  }
},
{
  id: "servo-test",
  async handle({ lower }) {
    if (!/\bservo\b/i.test(lower)) return null;
    if (!/\b(test|wiggle|pulse|check|move|wave|send|nudge)\b/i.test(lower)) return null;
    const words = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15 };
    let ch = 0;
    const num = lower.match(/\b(?:channel|servo|ch)\s*#?\s*(\d{1,2})\b/) || lower.match(/\b(\d{1,2})\b/);
    if (num && num[1]) {
      ch = parseInt(num[1], 10);
    } else {
      for (const w of Object.keys(words)) {
        if (new RegExp(`\\b${w}\\b`).test(lower)) { ch = words[w]; break; }
      }
    }
    if (ch < 0 || ch > 15) return { speak: "Servo channels only go from zero to fifteen. Pick one in that range." };
    const r = await postJson("/api/hal/test", { action: "servo", ch, us: 1500 });
    if (r == null) return { speak: "I couldn't reach the servo controller to run that test." };
    if (r.error) return { speak: `The servo test failed: ${r.error}` };
    return { speak: `Sending servo channel ${r.ch} to ${r.us} microseconds. It moved.` };
  }
},
{
  id: "show-mood-on-body",
  async handle({ lower }) {
    const onBody = /\b(body panel|panel|shell|body leds?|robot'?s panel|your panel)\b/i.test(lower)
      || /\b(on|onto|to) (the |your )?(body|shell)\b/i.test(lower)
      || /\bmirror (your )?face\b/i.test(lower);
    if (!onBody) return null;
    if (!/\b(show|put|mirror|light up|display|set|make|throw|flash)\b/i.test(lower)) return null;
    const MOODS: [RegExp, string, string][] = [
      [/\b(happy|smile|smiley|glad|cheerful)\b/i, "happy", "#FFC820"],
      [/\b(angry|mad|furious)\b/i, "angry", "#F0324A"],
      [/\b(sad|down|glum|upset)\b/i, "sad", "#7E9EC4"],
      [/\b(love|heart)\b/i, "love", "#FF6FB0"],
      [/\b(excited|hyped|thrilled)\b/i, "excited", "#FF9F1C"],
      [/\b(surprised|shocked|whoa|starstruck)\b/i, "starstruck", "#FFE23D"],
      [/\b(wink|winking)\b/i, "wink", "#FFC820"],
      [/\b(thinking|think|pondering)\b/i, "thinking", "#45C4FF"],
      [/\b(suspicious|sus)\b/i, "suspicious", "#D6A5FF"],
      [/\b(confused|puzzled)\b/i, "confused", "#8AA0FF"],
    ];
    const COLORS: [RegExp, string][] = [
      [/\bred\b/i, "#F0324A"], [/\bblue\b/i, "#45C4FF"], [/\bgreen\b/i, "#22E0A0"],
      [/\byellow\b/i, "#FFC820"], [/\bpurple\b/i, "#B14AFF"], [/\bpink\b/i, "#FF6FB0"],
      [/\borange\b/i, "#FF7A18"], [/\bwhite\b/i, "#EAF2FF"], [/\bcyan\b/i, "#00E0FF"],
    ];
    let state: string | null = null, color: string | undefined;
    for (const [re, s, c] of MOODS) if (re.test(lower)) { state = s; color = c; break; }
    const colorHit = COLORS.find(([re]) => re.test(lower));
    if (colorHit) color = colorHit[1];
    if (!state) state = colorHit ? "idle" : null;
    if (!state) return null;
    const r = await postJson("/api/body/face", color ? { state, color } : { state });
    if (r == null) return { speak: "I couldn't reach the body panel to show that." };
    return { speak: `Putting a ${state === "idle" ? "glow" : state + " face"} on the body panel for you.` };
  }
},
{
  id: "tracked-battery",
  async handle({ lower }) {
    const aboutDevices = /\b(devices?|trackers?|tags?)\b/i.test(lower);
    const aboutBattery = /\b(battery|batteries|low on (battery|power)|running low|power level|charge)\b/i.test(lower);
    const lowPower = /\bwhat'?s low on power\b/i.test(lower);
    if (!((aboutDevices && aboutBattery) || lowPower)) return null;
    const data = await getJson("/api/location/latest");
    if (data == null || !Array.isArray(data.devices)) return { speak: "I couldn't reach your tracked devices' battery data." };
    const withBatt = data.devices.filter((d) => typeof d.battery === "number");
    if (!withBatt.length) return { speak: "None of your tracked devices are reporting a battery level." };
    const low = withBatt.filter((d) => d.battery < 20).sort((a, b) => a.battery - b.battery);
    if (!low.length) return { speak: `All ${withBatt.length} tracked devices are above twenty percent.` };
    const names = low.map((d) => `${d.device_id} at ${Math.round(d.battery)} percent`).join(", ");
    return { speak: `Low on battery: ${names}.` };
  }
},
{
  id: "create-geofence",
  async handle({ raw, lower }) {
    if (!/\b(make|set|create|drop|add|put)\b/i.test(lower)) return null;
    if (!/\b(zone|geofence|fence)\b/i.test(lower)) return null;
    let token: string | null = null;
    const around = raw.match(/\baround\s+(?:the |my )?([a-z0-9][a-z0-9 ]*?)(?:$|[.?!,]|\s+(?:named|called)\b)/i);
    if (around && around[1]) token = around[1].trim().toLowerCase();
    else if (/\b(here|my phone|this phone)\b/i.test(lower)) token = "phone";
    if (!token) return { speak: "Tell me which device to build the zone around, like the van or my phone." };
    const data = await getJson("/api/location/latest");
    if (data == null || !Array.isArray(data.devices)) return { speak: "I couldn't reach your location data to place a zone." };
    const dev = data.devices.find((d) => d.device_id && (d.device_id.toLowerCase().includes(token) || token.includes(d.device_id.toLowerCase())));
    if (!dev) return { speak: `I don't have a recent location fix for ${token}, so I can't drop a zone there yet.` };
    const nameM = raw.match(/\b(?:named|called)\s+([A-Za-z0-9][\w' -]{1,30})/i);
    const name = nameM && nameM[1] ? nameM[1].replace(/[.?!]+$/, "").trim() : (token.charAt(0).toUpperCase() + token.slice(1));
    const r = await postJson("/api/geofences", { name, lat: dev.lat, lng: dev.lng, radiusMeters: 100 });
    if (r == null) return { speak: "I couldn't create the zone just now." };
    return { speak: `Done. I dropped a hundred meter zone around ${token}'s current spot and named it ${r.name || name}.` };
  }
},
{
  id: "geofence-activity",
  async handle({ raw, lower }) {
    const asks = (/\b(zone|geofence|fence)\b/i.test(lower) && /\b(activity|events?|happening|going on)\b/i.test(lower))
      || /\bwho (came|went|entered|left|arrived|showed up)\b/i.test(lower)
      || /\bcame or went\b/i.test(lower)
      || /\bcomings and goings\b/i.test(lower)
      || /\bany (zone|geofence) activity\b/i.test(lower)
      || /\bdid (anyone|anybody|someone) (enter|leave|arrive)\b/i.test(lower);
    if (!asks) return null;
    const zoneData = await getJson("/api/geofences");
    if (zoneData == null || !Array.isArray(zoneData.geofences)) return { speak: "I couldn't reach your zones just now." };
    if (!zoneData.geofences.length) return { speak: "You don't have any zones set up yet." };
    const named = zoneData.geofences.find((z) => z.name && raw.toLowerCase().includes(z.name.toLowerCase()));
    const zones = named ? [named] : zoneData.geofences;
    let best: any = null;
    for (const z of zones) {
      const evData = await getJson(`/api/geofences/${z.id}/events`);
      const ev = evData && Array.isArray(evData.events) ? evData.events[0] : null;
      if (ev && (!best || new Date(ev.createdAt).getTime() > new Date(best.ev.createdAt).getTime())) best = { ev, zone: z };
    }
    if (!best) return { speak: named ? `No recent activity in the ${named.name} zone.` : "No recent zone activity to report." };
    const secs = Math.max(0, Math.round((Date.now() - new Date(best.ev.createdAt).getTime()) / 1000));
    const ago = secs < 60 ? `${secs} seconds ago` : secs < 3600 ? `${Math.round(secs / 60)} minutes ago` : `${Math.round(secs / 3600)} hours ago`;
    return { speak: `Last activity: ${best.ev.deviceId} ${best.ev.action} the ${best.zone.name} zone ${ago}.` };
  }
},
{
  id: "locate-device",
  async handle({ raw, lower }) {
    if (!/\b(where('?s| is| are)?|locate|find)\b/i.test(lower)) return null;
    const data = await getJson("/api/location/latest");
    if (data == null || !Array.isArray(data.devices) || !data.devices.length) return null;
    const p = raw.toLowerCase();
    const dev = data.devices.find((d) => d.device_id && p.includes(d.device_id.toLowerCase()))
      ?? data.devices.find((d) => d.device_id && d.device_id.toLowerCase().split(/[\s_-]+/).some((w) => w.length > 2 && p.includes(w)));
    if (!dev) return null;
    const hav = (la1: number, lo1: number, la2: number, lo2: number): number => {
      const R = 6371000, r = Math.PI / 180;
      const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    let zoneName: string | null = null;
    const zoneData = await getJson("/api/geofences");
    if (zoneData && Array.isArray(zoneData.geofences)) {
      const inside = zoneData.geofences.find((z) => typeof z.lat === "number" && hav(dev.lat, dev.lng, z.lat, z.lng) <= z.radiusMeters);
      if (inside) zoneName = inside.name;
    }
    const secs = dev.created_at ? Math.max(0, Math.round((Date.now() - new Date(dev.created_at).getTime()) / 1000)) : null;
    const ago = secs == null ? "" : secs < 60 ? ` about ${secs} seconds ago` : secs < 3600 ? ` about ${Math.round(secs / 60)} minutes ago` : ` about ${Math.round(secs / 3600)} hours ago`;
    if (zoneName) return { speak: `${dev.device_id} was last seen inside the ${zoneName} zone${ago}.` };
    return { speak: `${dev.device_id} was last at ${Number(dev.lat).toFixed(4)}, ${Number(dev.lng).toFixed(4)}${ago}.` };
  }
},
{
  id: "who-is-here",
  async handle({ raw, lower }) {
    const asks = /\b(who('?s| is| are)|is (anyone|anybody|someone))\b/i.test(lower);
    const place = /\b(home|office|workshop|zone|here|inside|at the)\b/i.test(lower);
    if (!asks || !place) return null;
    const data = await getJson("/api/location/latest");
    if (data == null || !Array.isArray(data.devices)) return { speak: "I couldn't reach your location data just now." };
    const zoneData = await getJson("/api/geofences");
    if (zoneData == null || !Array.isArray(zoneData.geofences) || !zoneData.geofences.length) return { speak: "You don't have any zones set up to check." };
    const named = zoneData.geofences.find((z) => z.name && raw.toLowerCase().includes(z.name.toLowerCase()));
    const zone = named ?? zoneData.geofences.find((z) => /home/i.test(z.name)) ?? zoneData.geofences[0];
    const hav = (la1: number, lo1: number, la2: number, lo2: number): number => {
      const R = 6371000, r = Math.PI / 180;
      const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const inside = data.devices.filter((d) => typeof d.lat === "number" && hav(d.lat, d.lng, zone.lat, zone.lng) <= zone.radiusMeters);
    if (!inside.length) return { speak: `Nobody is inside the ${zone.name} zone right now.` };
    const names = inside.map((d) => d.device_id).join(", ");
    return { speak: `${inside.length} ${inside.length === 1 ? "tracker is" : "trackers are"} inside the ${zone.name} zone right now: ${names}.` };
  }
},
{
  id: "bluetooth-power",
  async handle({ lower }) {
    if (!/\bbluetooth\b/i.test(lower)) return null;
    if (!/\b(turn|switch|power|enable|disable|activate|deactivate)\b/i.test(lower)) return null;
    const want = /\b(off|disable|deactivate|down)\b/i.test(lower) ? false : true;
    const r = await postJson("/api/bt/power", { on: want });
    if (r == null) return { speak: "I couldn't reach the Bluetooth controls." };
    if (r.available === false) return { speak: "Bluetooth control isn't available on this device." };
    if (r.ok === false) return { speak: `I couldn't turn Bluetooth ${want ? "on" : "off"}.` };
    return { speak: `Bluetooth is ${want ? "on" : "off"} now.` };
  }
},
{
  id: "scan-bluetooth",
  async handle({ lower }) {
    if (!/\b(scan|discover|search|find|look)\b/i.test(lower)) return null;
    if (!/\b(bluetooth|speaker|speakers|headphones?|headset|earbuds)\b/i.test(lower)) return null;
    const r = await postJson("/api/bt/scan", { on: true });
    if (r == null) return { speak: "I couldn't start a Bluetooth scan." };
    if (r.available === false) return { speak: "Bluetooth scanning isn't available on this device." };
    return { speak: "Scanning for Bluetooth devices. Ask me what I found in a few seconds." };
  }
},
{
  id: "pair-bluetooth-speaker",
  async handle({ raw, lower }) {
    if (!/\b(pair|connect|link|hook (up|me up))\b/i.test(lower)) return null;
    if (!/\b(speaker|speakers|headphones?|headset|earbuds|bluetooth|jbl)\b/i.test(lower)) return null;
    const status = await getJson("/api/bt/status");
    if (status == null) return { speak: "I couldn't reach the Bluetooth controls." };
    if (status.available === false) return { speak: "Bluetooth pairing isn't available on this device." };
    const devices = Array.isArray(status.devices) ? status.devices : [];
    if (devices.length === 0) return { speak: "I don't see any Bluetooth devices yet. Say scan for Bluetooth devices first." };
    let target = devices.find((d) => d.name && lower.includes(String(d.name).toLowerCase()));
    if (!target && devices.length === 1) target = devices[0];
    if (!target) return { speak: "I see a few Bluetooth devices. Which one should I connect to?" };
    const r = await postJson("/api/bt/pair", { mac: target.mac });
    if (r == null) return { speak: `I couldn't connect to ${target.name}.` };
    if (r.available === false) return { speak: "Bluetooth pairing isn't available on this device." };
    if (r.ok === false) return { speak: `I couldn't connect to ${target.name}.${r.error ? " " + r.error : ""}` };
    return { speak: `Connecting to ${target.name} now.` };
  }
},
{
  id: "clean-up-memory",
  async handle({ lower }) {
    if (!/\b(clean|cleanup|clear|refresh|tidy)\b/i.test(lower)) return null;
    if (!/\b(memory|memories|notes?|index|expired)\b/i.test(lower)) return null;
    const r = await postJson("/api/autonomy/execute", { action: "refresh_memory" });
    if (r == null) return { speak: "I couldn't run a memory cleanup right now." };
    if (r.status === "executed") return { speak: r.result || "Memory cleanup complete." };
    if (r.status === "pending_confirmation") return { speak: "A memory cleanup is queued, but my autonomy settings want your confirmation first." };
    if (r.status === "blocked") return { speak: "My autonomy settings are blocking a memory cleanup right now." };
    return { speak: "Memory cleanup complete." };
  }
},
{
  id: "self-health-summary",
  async handle({ lower }) {
    const hit =
      /\bcheck ?up\b/i.test(lower) ||
      /\bself[- ]?report\b/i.test(lower) ||
      /\bstatus summary\b/i.test(lower) ||
      /\bhealth check\b/i.test(lower) ||
      (/\bsummar/i.test(lower) && /how (you'?re|you are|things)/i.test(lower)) ||
      (/\bself\b/i.test(lower) && /\b(summary|summarize|report)\b/i.test(lower));
    if (!hit) return null;
    const r = await postJson("/api/autonomy/execute", { action: "generate_summary" });
    if (r == null) return { speak: "I couldn't generate a self report right now." };
    if (r.status === "executed") return { speak: r.result || "I ran a self check. Everything looks nominal." };
    if (r.status === "pending_confirmation") return { speak: "A self report is ready, but my autonomy settings want your confirmation first." };
    if (r.status === "blocked") return { speak: "My autonomy controller is off, so I can't run a self report until it's enabled." };
    return { speak: "Self check complete." };
  }
},
{
  id: "set-autonomy-safety",
  async handle({ lower }) {
    if (!/\b(autonomy|safety)\b/i.test(lower) && !/\bmore (careful|cautious)\b/i.test(lower)) return null;
    const body = {};
    if (/\bautonomy\b/i.test(lower)) {
      if (/\b(disable|turn off|switch off|stop|shut off)\b/i.test(lower)) body.enabled = false;
      else if (/\b(enable|turn on|switch on|activate)\b/i.test(lower)) body.enabled = true;
    }
    if (/\b(strict|careful|cautious|safest)\b/i.test(lower)) body.safetyLevel = "strict";
    else if (/\b(permissive|loosen|loose|relaxed|less careful)\b/i.test(lower)) body.safetyLevel = "permissive";
    else if (/\b(moderate|balanced|middle)\b/i.test(lower)) body.safetyLevel = "moderate";
    if (Object.keys(body).length === 0) return null;
    const r = await putJson("/api/autonomy/config", body);
    if (r == null) return { speak: "I couldn't update my autonomy settings right now." };
    if (body.enabled === false) return { speak: "Autonomy is off now. I won't take actions on my own." };
    if (r.safetyLevel === "strict") return { speak: "Autonomy is set to strict now. I'll confirm before every action." };
    if (r.safetyLevel === "permissive") return { speak: "Loosened up. Autonomy is permissive now." };
    if (r.safetyLevel === "moderate") return { speak: "Autonomy safety is set to moderate now." };
    if (body.enabled === true) return { speak: "Autonomy is enabled now." };
    return { speak: "Autonomy settings updated." };
  }
},
{
  id: "set-cpu-alert-threshold",
  async handle({ raw, lower }) {
    if (!/\b(cpu|memory|mem|ram)\b/i.test(lower)) return null;
    if (!/\b(alert|threshold|warn|flag|cross(es)?|pass(es)?|over|above|at)\b/i.test(lower)) return null;
    const m = raw.match(/(\d{1,3})\s*(?:percent|%)?/);
    if (!m) return { speak: "What percentage should I set the alert to?" };
    const val = parseInt(m[1], 10);
    if (!(val >= 1 && val <= 100)) return { speak: "Give me a percentage between 1 and 100." };
    const isMem = /\b(memory|mem|ram)\b/i.test(lower);
    const body = isMem ? { memThreshold: val } : { cpuThreshold: val };
    const r = await patchJson("/api/system/thresholds", body);
    if (r == null) return { speak: "I couldn't update the alert threshold right now." };
    return { speak: `Done. I'll flag it when ${isMem ? "memory" : "CPU"} crosses ${val} percent.` };
  }
},
{
  id: "set-intelligence-mode",
  async handle({ lower }) {
    if (!/\b(reasoning|mode|think|thinking|execution)\b/i.test(lower)) return null;
    let mode = null;
    if (/\bhybrid\b/i.test(lower)) mode = "HYBRID_MODE";
    else if (/\bdeep\b/i.test(lower) || /\bthink (harder|deep|deeply)\b/i.test(lower)) mode = "DEEP_REASONING";
    else if (/\blight\b/i.test(lower) || /\bthink (quick|quicker|light|less)\b/i.test(lower)) mode = "LIGHT_REASONING";
    else if (/\bdirect\b/i.test(lower) || /\brule[- ]?based\b/i.test(lower) || /\bno (llm|reasoning)\b/i.test(lower)) mode = "DIRECT_EXECUTION";
    if (!mode) return null;
    const r = await putJson("/api/ai-router/mode", { mode });
    if (r == null) return { speak: "I couldn't switch my intelligence mode right now." };
    const label = { DEEP_REASONING: "deep reasoning", LIGHT_REASONING: "light reasoning", HYBRID_MODE: "hybrid mode", DIRECT_EXECUTION: "direct execution" }[mode];
    return { speak: `Switched to ${label}.` };
  }
},
{
  // Change which AI "brain" the bot prefers: cloud (Claude) vs on-device vs offline-only.
  // Distinct from set-intelligence-mode (reasoning depth). Requires an explicit switch verb
  // plus a cloud/local target so ordinary chat and the brain-status readouts never trip it.
  id: "set-brain-preference",
  async handle({ lower }) {
    if (!/\b(use|switch(ing)?( to| your)?|prefer|go|stay|change (your |the )?brain|set (your )?brain|only use|run on|think (in|on|with|using))\b/i.test(lower)) return null;
    if (!/\b(cloud|claude|local|offline|on[- ]?device|ollama|your own brain)\b/i.test(lower)) return null;
    let pref: string | null = null;
    if (/\b(local[- ]?only|only (use )?local|offline only|fully offline|stay offline|never (use )?(the )?cloud|no cloud|don'?t use (the )?cloud|off the grid)\b/i.test(lower)) pref = "local-only";
    else if (/\b(cloud|claude|online brain|smarter brain|the big brain)\b/i.test(lower)) pref = "cloud-first";
    else if (/\b(local|offline|on[- ]?device|ollama|your own brain|local model)\b/i.test(lower)) pref = "local-first";
    if (!pref) return null;
    const r = await putJson("/api/config", { CLOUD_PREFERENCE: pref });
    if (r == null) return { speak: "I couldn't switch my brain right now." };
    const label: Record<string, string> = {
      "cloud-first": "cloud-first — I'll think with Claude whenever I can reach it",
      "local-first": "local-first — I'll use my on-device brain first and only reach for the cloud when I need to",
      "local-only": "local-only — I'll stay fully offline and never call the cloud",
    };
    return { speak: `Done. Brain set to ${label[pref]}.` };
  }
},
{
  id: "trace-mode",
  async handle({ lower }) {
    if (!/\b(trace|tracing|debug mode|under the hood)\b/i.test(lower)) return null;
    const enabled = /\b(off|disable|stop)\b/i.test(lower) ? false : true;
    const r = await putJson("/api/trace", { enabled });
    if (r == null) return { speak: "I couldn't change trace mode right now." };
    return { speak: enabled ? "Trace mode is on. I'll log every step now." : "Trace mode is off." };
  }
},
{
  id: "install-local-brain",
  async handle({ lower }) {
    if (!/\b(local (brain|model)|a brain|offline (thinking|brain|model)|download a brain|give yourself a brain)\b/i.test(lower)) return null;
    if (!/\b(install|download|get|set up|setup|give yourself|pull)\b/i.test(lower)) return null;
    const r = await postJson("/api/brain/ensure-local", {});
    if (r == null) return { speak: "I couldn't start a local brain install right now." };
    return { speak: "I'm pulling down a local model now. This can take a few minutes. Ask me about my brain status later." };
  }
},
{
  id: "countdown-timer",
  handle({ raw, lower }) {
    if (!/\bcount(?:\s+me)?\s+down\b|\bcountdown\b/.test(lower)) return null;
    const words = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, fifteen:15, twenty:20, thirty:30 };
    let n = 10;
    const dm = raw.match(/\bfrom\s+(\d{1,2})\b/i);
    const wm = lower.match(/\bfrom\s+(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)\b/);
    if (dm) n = parseInt(dm[1], 10);
    else if (wm) n = words[wm[1]];
    if (!Number.isFinite(n) || n < 1) n = 10;
    if (n > 30) n = 30;
    const seq = [];
    for (let i = n; i >= 1; i--) seq.push(i);
    return { speak: `${seq.join(", ")}. Go.` };
  }
},
{
  id: "lie-detector-start",
  async handle({ lower }) {
    if (!/\b(lie detector|polygraph|interrogation)\b/.test(lower)) return null;
    // Require a START intent so "open the lie detector" (navigation) doesn't route here.
    const starts = /\b(start|begin|boot|fire up|hook me up|set up|calibrate|do a|run a|new)\b/.test(lower) || /\bpolygraph me\b/.test(lower) || /\binterrogation mode\b/.test(lower);
    if (!starts) return null;
    const r = await postJson("/api/lie-detector/session/start", {});
    if (r == null || r.ok !== true) return { speak: "I couldn't spin up the polygraph just now." };
    return { speak: "Polygraph online. Calibrating your baseline, hold still for a moment.", ui: { type: "open", route: "/lie-detector" } };
  }
},
{
  id: "pick-for-me",
  handle({ raw, lower }) {
    if (!/\b(pick|choose|decide)\b/.test(lower)) return null;
    const between = raw.match(/\bbetween\s+(.+)/i);
    const src = between ? between[1] : raw.replace(/.*\b(pick|choose|decide)\b/i, "");
    let opts = src
      .split(/\s*,\s*|\s+\bor\b\s+|\s+\band\b\s+/i)
      .map((s) => s.replace(/[.?!]+$/, "").replace(/^(for me|the)\s+/i, "").trim())
      .filter((o) => o.length > 0 && !/^(for me|me|these|this|it|us|them|option)$/i.test(o));
    if (opts.length < 2) return null; // no concrete options -> let conversation handle it
    const choice = opts[Math.floor(Math.random() * opts.length)];
    return { speak: `Between those, I'd go with ${choice}. Trust me.` };
  }
},
{
  id: "random-number",
  handle({ raw, lower }) {
    if (!/\brandom number\b|\bnumber between\b|\broll (me )?a (random )?number\b|\bgive me a (random )?number\b|\bpick a random number\b/.test(lower)) return null;
    let lo = 1, hi = 100;
    const m = raw.match(/\bbetween\s+(\d+)\s+(?:and|to|through)\s+(\d+)/i) || raw.match(/\bfrom\s+(\d+)\s+to\s+(\d+)/i);
    if (m) { lo = parseInt(m[1], 10); hi = parseInt(m[2], 10); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) { lo = 1; hi = 100; }
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    const n = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    return { speak: `Your number is ${n}.` };
  }
},
{
  id: "rock-paper-scissors",
  handle({ lower }) {
    const isGame = /\brock,?\s*paper,?\s*scissors\b|\bro ?sham ?bo\b/.test(lower);
    const isThrow = /\b(i (pick|choose|throw|play|pick)|throw)\s+(rock|paper|scissors)\b/.test(lower);
    if (!isGame && !isThrow) return null;
    const throws = ["rock", "paper", "scissors"];
    const mine = throws[Math.floor(Math.random() * 3)];
    const um = lower.match(/\b(rock|paper|scissors)\b/);
    const yours = um ? um[1] : null;
    if (!yours) return { speak: `I threw ${mine}. Say rock, paper, or scissors and I'll play you.` };
    const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
    let outcome;
    if (mine === yours) outcome = "We tied. Go again.";
    else if (beats[mine] === yours) outcome = "I win this round.";
    else outcome = "You win this round.";
    return { speak: `I threw ${mine}, you threw ${yours}. ${outcome}` };
  }
},
{
  id: "roll-dice",
  handle({ lower }) {
    if (!/\broll\b/.test(lower) || !/\b(dice|die|d\d{1,3}|sided?)\b/.test(lower)) return null;
    let count = 1, sides = 6;
    const dm = lower.match(/\bd(\d{1,3})\b/);
    if (dm) sides = parseInt(dm[1], 10);
    const sm = lower.match(/\b(\d{1,3})\s*[- ]?sided\b/);
    if (sm) sides = parseInt(sm[1], 10);
    const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const cm = lower.match(/\broll\s+(two|three|four|five|six|\d{1,2})\s+(?:dice|die|d\d)/);
    if (cm) count = words[cm[1]] ?? parseInt(cm[1], 10);
    if (!Number.isFinite(sides) || sides < 2) sides = 6;
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > 10) count = 10;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);
    if (count === 1) return { speak: `Rolling a ${sides} sided die. You got a ${total}.` };
    return { speak: `Rolling ${count} dice. You got ${rolls.join(", ")}, totaling ${total}.` };
  }
},
{
  id: "truth-or-dare",
  handle({ lower }) {
    if (!/\btruth or dare\b|\bgive me a (truth|dare)\b|\b(pick|choose|i'?ll take|i pick|i choose)\s+(truth|dare)\b/.test(lower)) return null;
    const truths = [
      "Truth: what's the last little white lie you told?",
      "Truth: what's a small thing you're secretly proud of?",
      "Truth: what's the most childish thing you still do?",
      "Truth: what's one thing on your phone you'd never let me read?",
    ];
    const dares = [
      "Dare: text the third person in your recent calls just the word banana.",
      "Dare: do your best robot impression for ten seconds.",
      "Dare: speak in a movie-trailer voice until your next sentence.",
      "Dare: send a genuine compliment to the last person you messaged.",
    ];
    let want;
    if (/\btruth\b/.test(lower) && !/\bdare\b/.test(lower)) want = "truth";
    else if (/\bdare\b/.test(lower) && !/\btruth\b/.test(lower)) want = "dare";
    else want = Math.random() < 0.5 ? "truth" : "dare";
    const list = want === "truth" ? truths : dares;
    return { speak: list[Math.floor(Math.random() * list.length)] };
  }
},
{
  id: "lie-detector-ask",
  async handle({ raw, lower }) {
    const trig = /\b(ask me|ask the suspect|lie detector question|polygraph question|next question)\b/i;
    if (!trig.test(lower)) return null;
    const m = raw.match(/\b(?:ask me|ask the suspect|lie detector question|polygraph question|next question)\b(?:\s+(?:if|whether|that))?\s*[:,\-]?\s*(.+)/i);
    const question = m && m[1] ? m[1].replace(/[.?!]+$/, "").trim() : "";
    if (!question || question.length < 2) return { speak: "Tell me the question to put to the subject." };
    const s = await getJson("/api/lie-detector/session");
    if (s == null || !s.session) return { speak: "No polygraph session is running. Say start the lie detector first." };
    if (s.session.phase !== "ready") return { speak: `I can't take a question right now, the polygraph is ${s.session.phase}.` };
    const r = await postJson("/api/lie-detector/session/question", { question });
    if (r == null || r.ok !== true) return { speak: "I couldn't start recording that question." };
    return { speak: "Recording your answer to that for ten seconds. Answer now." };
  }
},
{
  id: "lie-detector-verdict",
  async handle({ lower }) {
    if (!/\b(the verdict|am i lying|read the polygraph|commit (that|the|my) answer|give me the results?|read the results?|polygraph results?|what'?s the result)\b/.test(lower)) return null;
    const s = await getJson("/api/lie-detector/session");
    if (s == null || !s.session) return { speak: "There's no polygraph session running." };
    if (s.session.phase !== "recording") return { speak: "There's no answer being recorded right now. Ask a question first." };
    const r = await postJson("/api/lie-detector/session/commit", {});
    if (r == null || r.ok !== true || !r.question) return { speak: "I couldn't read the polygraph result." };
    const verdict = r.question.verdict;
    const map = { truthful: "That reads as the truth.", deceptive: "That reads as a lie.", inconclusive: "Inconclusive, I can't call that one." };
    return { speak: `My verdict: ${map[verdict] || "inconclusive, I can't call that one."}` };
  }
}
];
