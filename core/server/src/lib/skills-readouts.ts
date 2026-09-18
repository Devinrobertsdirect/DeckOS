/**
 * skills-readouts.ts — Nobi's live status voice pack (GENERATED).
 *
 * 47 endpoint-backed "readout" skills: ask a question, Nobi calls its own
 * API over loopback and speaks a short, plain answer. Every endpoint + field name
 * was verified against the real route handlers. Regenerate with scratchpad/gen-readouts.mjs;
 * hand-edit sparingly. Triggers are ordered specific-before-generic.
 */
import type { Skill } from "./skills.js";
import { getJson } from "./skills-extra.js";
import { brainOnline } from "./inference.js";

export const READOUT_SKILLS: Skill[] = [
  {
    id: "installed-plugins",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("what have i installed|installed plugins|community plugins|installed skills|plugins have i added|downloaded from the store|how many plugins", "i").test(lower)) return null;
      const d = await getJson("/api/plugins/store/installed");
      if (d == null) return { speak: "I couldn't reach the plugin store to check what you've installed." };
      try {
        const __r: any = (() => { if (!Array.isArray(d.plugins)) return "I couldn't check your installed plugins just now."; const n = typeof d.count === 'number' ? d.count : d.plugins.length; if (n === 0) return "You haven't installed any community plugins yet."; const names = d.plugins.map(function(p){return p && p.name;}).filter(Boolean).slice(0, 3); const word = n === 1 ? 'plugin' : 'plugins'; let speak = "You've installed " + n + ' community ' + word; if (names.length) speak += ', including ' + names.join(', '); return speak + '.'; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't reach the plugin store to check what you've installed." };
      } catch { return { speak: "I couldn't reach the plugin store to check what you've installed." }; }
    },
  },
  {
    id: "list-wifi-networks",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bwifi networks\\b|scan for wifi|nearby wifi|available networks|networks (can you see|are around)|list nearby wifi", "i").test(lower)) return null;
      const d = await getJson("/api/net/wifi/networks");
      if (d == null) return { speak: "I can't scan for WiFi networks right now." };
      try {
        const __r: any = (() => { if (!d || d.available === false) return "I can't scan for WiFi networks on this device."; const nets = Array.isArray(d.networks) ? d.networks : []; if (nets.length === 0) return "I don't see any WiFi networks right now."; const names = nets.slice(0, 3).map(function(n){ return n && n.ssid; }).filter(Boolean); const count = nets.length; const lead = names.length === 1 ? "The strongest is " : "The strongest are "; return "I can see " + count + (count === 1 ? " network. " : " networks. ") + lead + names.join(", ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't scan for WiFi networks right now." };
      } catch { return { speak: "I can't scan for WiFi networks right now." }; }
    },
  },
  {
    id: "autonomy-log",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bautonomy (log|history)\\b|\\bdone on your own\\b|\\byour recent actions\\b|\\b(did|do) you do (automatically|on your own)\\b|\\bwithout me\\b|\\bacted on your own\\b|\\banything you did\\b", "i").test(lower)) return null;
      const d = await getJson("/api/autonomy/log");
      if (d == null) return { speak: "I could not reach my autonomy log right now." };
      try {
        const __r: any = (() => { const logs = Array.isArray(d && d.logs) ? d.logs : []; if (logs.length === 0) return "I have not taken any actions on my own yet."; const top = logs.slice(0,3).map(l => String((l && l.action) || "action").replace(/_/g," ")); const good = logs.slice(0,3).filter(l => l && l.outcome === "success").length; const list = top.length === 1 ? top[0] : top.slice(0,-1).join(", ") + " and " + top[top.length-1]; return "Lately I ran " + list + ". " + (good === top.length ? "All went fine." : good + " of them went fine."); })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not reach my autonomy log right now." };
      } catch { return { speak: "I could not reach my autonomy log right now." }; }
    },
  },
  {
    id: "device-health",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bdevices? (down|offline|health|okay|ok)\\b|\\banything offline\\b|\\beverything online\\b|\\bhow are my devices\\b|\\bdevice health\\b|\\bany devices down\\b", "i").test(lower)) return null;
      const d = await getJson("/api/devices/stats");
      if (d == null) return { speak: "I could not reach the device manager right now." };
      try {
        const __r: any = (() => { const total = (d && d.total) || 0; const online = (d && d.online) || 0; const offline = (d && d.offline) || 0; const err = (d && d.error) || 0; if (total === 0) return "You have no devices registered yet."; let out = total + (total === 1 ? " device" : " devices") + " total, " + online + " online"; if (offline) out += ", " + offline + " offline"; if (err) out += ", " + err + " in an error state"; out += ". " + ((offline === 0 && err === 0) ? "Everything looks healthy." : ""); return out.trim(); })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not reach the device manager right now." };
      } catch { return { speak: "I could not reach the device manager right now." }; }
    },
  },
  {
    id: "devices-by-type",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("how many (sensors?|cameras?|actuators?|displays?|devices?)|what kinds? of devices|device breakdown|devices? by type", "i").test(lower)) return null;
      const d = await getJson("/api/devices/stats");
      if (d == null) return { speak: "I can't reach the device registry right now." };
      try {
        const __r: any = (() => { const bt = d.byType && typeof d.byType === "object" ? d.byType : {}; const keys = Object.keys(bt); if (keys.length === 0) return "You have no devices registered yet."; const parts = keys.map(k => bt[k] + " " + k + (bt[k] === 1 ? "" : "s")); const last = parts.pop(); return "You've got " + (parts.length ? parts.join(", ") + " and " + last : last) + " registered."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach the device registry right now." };
      } catch { return { speak: "I can't reach the device registry right now." }; }
    },
  },
  {
    id: "hardware-diagnostics",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(hardware diagnostics|motor drivers|is the gpio working|check the hardware|is pigpio|hardware self report|drivers loaded)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/hal/test");
      if (d == null) return { speak: "I can't run the hardware self-check right now." };
      try {
        const __r: any = (() => { const profile = d?.profile ?? 'unknown'; const pigpio = d?.modules?.pigpio === true; const i2c = d?.modules?.i2cBus === true; const hasBody = !!d?.body; if (!pigpio && !i2c) return `On the ${profile} profile, but neither pigpio nor i2c drivers are loaded here, so I can't reach the motors. That's normal when I'm off the robot.`; const loaded = [pigpio ? 'pigpio' : null, i2c ? 'i2c-bus' : null].filter(Boolean).join(' and '); return `Hardware profile is ${profile}. ${loaded} loaded${hasBody ? ' and a body is active' : ''}. ${pigpio && i2c ? 'Ready to move.' : 'Partial driver load.'}`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't run the hardware self-check right now." };
      } catch { return { speak: "I can't run the hardware self-check right now." }; }
    },
  },
  {
    id: "hardware-drivers-check",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bhardware drivers?\\b|\\bgpio\\b|\\bcheck your hal\\b|\\breach your motors\\b|\\bnative modules?\\b|\\bdrivers? loaded\\b", "i").test(lower)) return null;
      const d = await getJson("/api/diag");
      if (d == null) return { speak: "I could not run a hardware check right now." };
      try {
        const __r: any = (() => { const hal = (d && d.hal) || {}; const profile = hal.profile; const m = hal.modules || {}; const loaded = []; if (m.pigpio) loaded.push("pigpio"); if (m.i2cBus) loaded.push("i2c"); if (!profile && loaded.length === 0) return "No hardware profile is loaded and the motor drivers are not available on this machine."; const profPart = profile ? "HAL profile " + profile + " is loaded." : "No HAL profile is loaded."; const modPart = loaded.length ? " Drivers up: " + loaded.join(" and ") + "." : " No native motor drivers loaded here."; return profPart + modPart; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not run a hardware check right now." };
      } catch { return { speak: "I could not run a hardware check right now." }; }
    },
  },
  {
    id: "read-latest-briefing",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("last briefing|read my briefing|recap the briefing|latest briefing|\\bmy briefing\\b", "i").test(lower)) return null;
      const d = await getJson("/api/briefings/latest");
      if (d == null) return { speak: "I couldn't pull up your latest briefing right now." };
      try {
        const __r: any = (() => { const b = d && d.briefing; if (!b || !b.summary) return "I don't have a briefing yet. Want me to generate one?"; let s = String(b.summary).replace(/\s+/g, ' ').trim(); if (s.length > 260) s = s.slice(0, 257).trim() + '...'; return "Here's your latest briefing. " + s; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't pull up your latest briefing right now." };
      } catch { return { speak: "I couldn't pull up your latest briefing right now." }; }
    },
  },
  {
    id: "whats-on-my-plate",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("on my plate|\\bmy goals\\b|list my goals|what am i working on|active goals", "i").test(lower)) return null;
      const d = await getJson("/api/goals?status=active");
      if (d == null) return { speak: "I can't reach your goals right now." };
      try {
        const __r: any = (() => { const goals = Array.isArray(d.goals) ? d.goals : []; const active = goals.filter(g => g && g.status === "active"); const n = active.length; if (n === 0) return "You have no active goals right now."; const word = n === 1 ? "goal" : "goals"; const top = active.slice(0, 3).map(g => g.title).filter(Boolean); if (top.length === 0) return "You have " + n + " active " + word + "."; return "You have " + n + " active " + word + ". Top of the list is " + top.join(", then ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach your goals right now." };
      } catch { return { speak: "I can't reach your goals right now." }; }
    },
  },
  {
    id: "next-goal",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("what should i work on|what'?s next|top priority|next task|what should i do next", "i").test(lower)) return null;
      const d = await getJson("/api/goals?status=active");
      if (d == null) return { speak: "I can't reach your goals right now." };
      try {
        const __r: any = (() => { const goals = Array.isArray(d.goals) ? d.goals : []; const active = goals.filter(g => g && g.status === "active"); if (active.length === 0) return "You have no active goals right now, so nothing is pressing."; const top = active[0]; const pct = typeof top.completionPct === "number" ? Math.round(top.completionPct) : null; return "I'd start on " + (top.title || "your top goal") + (pct !== null ? ", sitting at " + pct + " percent complete." : "."); })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach your goals right now." };
      } catch { return { speak: "I can't reach your goals right now." }; }
    },
  },
  {
    id: "what-are-we-working-on",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(what threads|what are we working on|storylines|narrative threads|open threads)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/presence/threads");
      if (d == null) return { speak: "I can't pull the active threads right now." };
      try {
        const __r: any = (() => { const active = Array.isArray(d?.active) ? d.active : []; const dormant = Array.isArray(d?.dormant) ? d.dormant : []; if (active.length === 0) return `No active threads right now${dormant.length ? `, though ${dormant.length} ${dormant.length===1?'is':'are'} dormant` : ''}.`; const titles = active.map((t) => t?.title).filter(Boolean).slice(0, 3); const dormPart = dormant.length ? ` Plus ${dormant.length} dormant.` : ''; return `${active.length} active thread${active.length===1?'':'s'}: ${titles.join(', ')}.${dormPart}`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't pull the active threads right now." };
      } catch { return { speak: "I can't pull the active threads right now." }; }
    },
  },
  {
    id: "roast-me",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\broast me\\b|\\broast\\b|insult me|\\bburn me\\b|hit me with (a|your)", "i").test(lower)) return null;
      const d = await getJson("/api/snark");
      if (d == null) return { speak: "I've got nothing. You win this round." };
      try {
        const __r: any = (() => { const line = typeof d.line === "string" ? d.line : ""; return line; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I've got nothing. You win this round." };
      } catch { return { speak: "I've got nothing. You win this round." }; }
    },
  },
  {
    id: "identity-readout",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bwho are you\\b|what('| i)?s your name|your name\\b|introduce yourself|what should i call you|tell me who you are", "i").test(lower)) return null;
      if (brainOnline()) return null;   // hand-edit: offline voice only — in character from the brain otherwise
      const d = await getJson("/api/ai/persona");
      if (d == null) return { speak: "I am Nobi, your desk companion." };
      try {
        const __r: any = (() => { const name = d && d.aiName ? String(d.aiName) : "Nobi"; const attitude = d && d.attitude ? String(d.attitude) : null; return "I am " + name + ", your desk companion." + (attitude ? " My attitude is set to " + attitude + " right now." : ""); })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I am Nobi, your desk companion." };
      } catch { return { speak: "I am Nobi, your desk companion." }; }
    },
  },
  {
    id: "describe-personality",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(describe your personality|your personality|your traits|how snarky|your vibe|how are you set up)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/ai/persona");
      if (d == null) return { speak: "I can't read my personality settings right now." };
      try {
        const __r: any = (() => { const attitude = d?.attitude ?? 'balanced'; const snark = Number(d?.snarkinessLevel ?? 0); const gravity = Number(d?.gravityLevel ?? 50); const length = d?.responseLength ?? 'balanced'; const gravWord = gravity >= 66 ? 'high' : gravity <= 33 ? 'low' : 'even'; return `My attitude is ${attitude}, snark dialed to ${snark}, gravity ${gravWord}, and I keep answers ${length}.`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't read my personality settings right now." };
      } catch { return { speak: "I can't read my personality settings right now." }; }
    },
  },
  {
    id: "brain-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(which brain|what brain|what model is running|thinking (locally|in the cloud)|local or (the )?cloud|is your brain online|do you have a brain)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/ai-router/status");
      if (d == null) return { speak: "I can't reach my brain status right now." };
      try {
        const __r: any = (() => { const cloud = !!(d && d.claudeAvailable); const ollama = !!(d && d.ollamaAvailable); const model = (d && (d.interactiveModel || (d.models && d.models.cortex))) || "the rule engine"; if (cloud) return "I'm thinking in the cloud on " + model + " right now."; if (ollama) return "I'm thinking locally on " + model + ", no cloud needed."; return "I'm running on my built in rule engine right now, no language model connected."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach my brain status right now." };
      } catch { return { speak: "I can't reach my brain status right now." }; }
    },
  },
  {
    id: "brain-version",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(what version|firmware version|what build is this|which version of you|version info)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/diag");
      if (d == null) return { speak: "I can't read my version info at the moment." };
      try {
        const __r: any = (() => { const brain = String(d?.versions?.brain ?? 'unknown').replace(/^v/,''); const node = String(d?.versions?.node ?? 'unknown').replace(/^v/,''); if (brain === 'unknown') return 'I could not read my brain version right now.'; return `I'm on brain version ${brain}, running Node ${node}.`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't read my version info at the moment." };
      } catch { return { speak: "I can't read my version info at the moment." }; }
    },
  },
  {
    id: "list-commands",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(what commands|list.*commands|console commands|what can i (type|run)|available commands|commands do you know)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/commands");
      if (d == null) return { speak: "I can't list the console commands right now." };
      try {
        const __r: any = (() => { const cmds = Array.isArray(d?.commands) ? d.commands : []; if (cmds.length === 0) return `I don't have any console commands registered right now.`; const names = cmds.map((c) => c?.name).filter(Boolean).slice(0, 7); return `Console commands include ${names.join(', ')}.`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't list the console commands right now." };
      } catch { return { speak: "I can't list the console commands right now." }; }
    },
  },
  {
    id: "command-history",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("command history|console history|(what|which).{0,20}commands?.{0,12}(have|did) i (run|type)|(last|recent).{0,12}commands?|what did i run", "i").test(lower)) return null;
      const d = await getJson("/api/commands/history?limit=5");
      if (d == null) return { speak: "I could not pull your command history right now." };
      try {
        const __r: any = (() => { const h = Array.isArray(d.history) ? d.history : []; if (h.length === 0) return "You have not run any console commands yet."; const inputs = h.slice(0,3).map(x => (x && x.input) ? String(x.input).trim() : "").filter(Boolean); if (inputs.length === 0) return "You have not run any console commands yet."; const word = inputs.length === 1 ? "command was" : (inputs.length === 2 ? "two commands were" : "three commands were"); return "Your last " + word + " " + inputs.join(", ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not pull your command history right now." };
      } catch { return { speak: "I could not pull your command history right now." }; }
    },
  },
  {
    id: "recent-memory",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bremember lately\\b|\\brecent memor(y|ies)\\b|\\bwhat have we talked about\\b|\\bcatch me up\\b|\\byour recent memory\\b|\\bread back .*memory\\b", "i").test(lower)) return null;
      const d = await getJson("/api/memory/recent?limit=5");
      if (d == null) return { speak: "I could not read back my recent memory right now." };
      try {
        const __r: any = (() => { const entries = Array.isArray(d && d.entries) ? d.entries : []; if (entries.length === 0) return "I do not have any recent memories stored yet."; const trim = (t) => { const s = String(t == null ? "" : t).replace(/\s+/g," ").trim(); return s.length > 90 ? s.slice(0,90) + "..." : s; }; const top = entries.slice(0,3).map(e => trim(e && e.content)).filter(Boolean); return "Lately I have " + entries.length + (entries.length === 1 ? " thing" : " things") + " on my mind. Most recent, " + top[0] + (top[1] ? ". Before that, " + top[1] : "") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not read back my recent memory right now." };
      } catch { return { speak: "I could not read back my recent memory right now." }; }
    },
  },
  {
    id: "list-routines",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("what routines|list my automations|what'?s automated|show my routines|\\bmy routines\\b", "i").test(lower)) return null;
      const d = await getJson("/api/routines");
      if (d == null) return { speak: "I couldn't reach your routines right now." };
      try {
        const __r: any = (() => { if (!Array.isArray(d.routines)) return "I couldn't read your routines just now."; const total = typeof d.total === 'number' ? d.total : d.routines.length; if (total === 0) return "You don't have any routines set up yet."; const enabled = d.routines.filter(function(r){return r && r.enabled;}).length; const names = d.routines.map(function(r){return r && r.name;}).filter(Boolean).slice(0, 2); const word = total === 1 ? 'routine' : 'routines'; let speak = 'You have ' + total + ' ' + word + ', ' + enabled + ' enabled'; if (names.length) speak += '. A couple are ' + names.join(' and '); return speak + '.'; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't reach your routines right now." };
      } catch { return { speak: "I couldn't reach your routines right now." }; }
    },
  },
  {
    id: "activity-today",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(how busy|commands today|how many commands|(my|daily) activity|how much have we (done|gotten done)|what'?s my activity)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/system/summary");
      if (d == null) return { speak: "I can't pull today's activity right now." };
      try {
        const __r: any = (() => { const cmds = Number(d?.commandsToday ?? 0); const mem = Number(d?.memoryEntries ?? 0); const alerts = Number(d?.alertCount ?? 0); const alertPart = alerts > 0 ? `${alerts} open alert${alerts===1?'':'s'}` : 'no open alerts'; return `We've run ${cmds} command${cmds===1?'':'s'} so far and I'm holding ${mem} memor${mem===1?'y':'ies'}, with ${alertPart}.`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't pull today's activity right now." };
      } catch { return { speak: "I can't pull today's activity right now." }; }
    },
  },
  {
    id: "mic-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(are you listening|is your mic|can you hear me|microphone muted|mic status|is the mic (on|muted|live))\\b", "i").test(lower)) return null;
      const d = await getJson("/api/voice/state");
      if (d == null) return { speak: "I can't check my microphone state right now." };
      try {
        const __r: any = (() => {
        // HAND-EDITED (see header): `muted` is the echo latch that is true while
        // he is speaking — and he is always about to speak when answering this —
        // so keying off it made him claim his mic was muted every single time.
        // The sidecar's own report is the only honest source.
        const ears = d?.ears; const last = d?.lastHeardAt;
        const asksHear = /\b(can you hear me|are you listening)\b/.test(lower);
        const ago = (t: any) => { const secs = Math.max(0, Math.round((Date.now() - Number(t)) / 1000)); return secs < 60 ? `${secs} second${secs === 1 ? "" : "s"} ago` : `${Math.round(secs / 60)} minute${Math.round(secs / 60) === 1 ? "" : "s"} ago`; };
        if (ears && ears.capturing === false) return asksHear ? `Not at the moment — I have no microphone open. Check my speaker is connected.` : `No microphone is open right now.`;
        if (ears && ears.capturing) {
          if (last) return asksHear ? `Loud and clear. I last heard you ${ago(last)}.` : `My mic is live; I last heard you ${ago(last)}.`;
          return asksHear ? `Yes, I can hear you. My mic is live.` : `My mic is live and listening.`;
        }
        if (last) return asksHear ? `Yes, I can hear you. I last heard you ${ago(last)}.` : `My mic is live; I last heard you ${ago(last)}.`;
        return asksHear ? `I believe so, though I have not heard a phrase yet.` : `Listening, but nothing heard yet this session.`;
      })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't check my microphone state right now." };
      } catch { return { speak: "I can't check my microphone state right now." }; }
    },
  },
  {
    id: "recent-alerts",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(any alerts|anything wrong|any errors|system warnings|is everything ok(ay)?)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/system/events");
      if (d == null) return { speak: "I can't reach the system event log right now." };
      try {
        const __r: any = (() => { const events = Array.isArray(d?.events) ? d.events : []; const bad = events.filter((e) => e?.level === 'error' || e?.level === 'critical'); if (bad.length === 0) return `No errors or critical alerts recently. Everything looks clean.`; const latest = bad[0]?.message ?? 'an unspecified issue'; return `${bad.length} recent alert${bad.length===1?'':'s'}. The latest: ${latest}.`; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach the system event log right now." };
      } catch { return { speak: "I can't reach the system event log right now." }; }
    },
  },
  {
    id: "charge-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bare you charging\\b|\\bon the dock\\b|\\bare you docked\\b|\\bcharge status\\b|\\bemergency stop\\b|\\be-?stop\\b|\\bmotors? (locked|lock)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/body");
      if (d == null) return { speak: "I could not read my body state right now." };
      try {
        const __r: any = (() => { const s = (d && d.state) || {}; const onDock = s.dock === true; const estop = s.estop === true; const dockPart = onDock ? "I'm on the dock and topping up" : "I'm off the dock"; const estopPart = estop ? "Emergency stop is engaged, so my motors are locked." : "E-stop is clear, so I can move whenever you need."; return dockPart + ". " + estopPart; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not read my body state right now." };
      } catch { return { speak: "I could not read my body state right now." }; }
    },
  },
  {
    id: "list-expressions",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bfaces? can you make\\b|\\blist your expressions\\b|\\bmoods do you have\\b|\\bfaces do you know\\b|\\bwhat can your face do\\b|\\byour expressions\\b", "i").test(lower)) return null;
      const d = await getJson("/api/face/states");
      if (d == null) return { speak: "I could not list my expressions right now." };
      try {
        const __r: any = (() => { const states = Array.isArray(d && d.states) ? d.states : []; if (states.length === 0) return "I do not have any expressions loaded right now."; const few = states.slice(0,6).join(", "); return "I can make " + states.length + " expressions, including " + few + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not list my expressions right now." };
      } catch { return { speak: "I could not list my expressions right now." }; }
    },
  },
  {
    id: "my-ip-address",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bip address\\b|\\byour ip\\b|\\bmy ip\\b|\\bwhat ip\\b|\\bnetwork address\\b", "i").test(lower)) return null;
      const d = await getJson("/api/net/status");
      if (d == null) return { speak: "I could not read my network address right now." };
      try {
        const __r: any = (() => { if (d && d.available === false) return "Network details are not available on this machine."; const ip = d && d.wifi && d.wifi.ip; if (!ip) return "I am not on wifi right now, so I do not have a local IP to report."; return "My IP on the local network is " + ip + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not read my network address right now." };
      } catch { return { speak: "I could not read my network address right now." }; }
    },
  },
  {
    id: "whats-nagging-me",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bnudges?\\b|\\bnudging me\\b|\\bbugging you\\b|\\bwant to flag\\b|\\banything .*flag\\b", "i").test(lower)) return null;
      const d = await getJson("/api/presence/nudges");
      if (d == null) return { speak: "I could not check my nudges right now." };
      try {
        const __r: any = (() => { const nudges = Array.isArray(d) ? d : []; if (nudges.length === 0) return "Nothing is nagging me right now, you are all clear."; const top = nudges[0] || {}; const urgency = Number(top.urgencyScore || 0); const level = urgency >= 0.75 ? "high urgency" : urgency >= 0.4 ? "medium urgency" : "low urgency"; const msg = String(top.content || "something needs your attention").replace(/\s+/g," ").trim(); const countPart = nudges.length === 1 ? "One nudge" : nudges.length + " nudges"; return countPart + ", top one is " + level + ". " + msg; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not check my nudges right now." };
      } catch { return { speak: "I could not check my nudges right now." }; }
    },
  },
  {
    id: "autonomy-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bautonomy\\b|safety level|(on your own|by yourself)|allowed to (do|act)", "i").test(lower)) return null;
      const d = await getJson("/api/autonomy/config");
      if (d == null) return { speak: "I can't reach my autonomy settings right now." };
      try {
        const __r: any = (() => { const enabled = !!d.enabled; const lvl = d.safetyLevel || "moderate"; if (!enabled) return "Autonomy is currently off, so I won't act on my own."; return "Autonomy is on at " + lvl + " safety, so I'll check with you before anything big."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach my autonomy settings right now." };
      } catch { return { speak: "I can't reach my autonomy settings right now." }; }
    },
  },
  {
    id: "check-notifications",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bnotifications?\\b|what did i miss|\\bunread\\b", "i").test(lower)) return null;
      const d = await getJson("/api/notifications");
      if (d == null) return { speak: "I can't reach your notifications right now." };
      try {
        const __r: any = (() => { const n = typeof d.unreadCount === "number" ? d.unreadCount : (Array.isArray(d.unread) ? d.unread.length : 0); if (n === 0) return "You have no unread notifications."; const word = n === 1 ? "notification" : "notifications"; const top = Array.isArray(d.unread) && d.unread[0] ? d.unread[0] : null; if (top && top.title) return "You have " + n + " unread " + word + ". The newest is " + top.title + "."; return "You have " + n + " unread " + word + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach your notifications right now." };
      } catch { return { speak: "I can't reach your notifications right now." }; }
    },
  },
  {
    id: "how-do-you-read-me",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("how do you read me|behavior profile|how are you tuned|what (have|did) you learn(ed)? about me", "i").test(lower)) return null;
      const d = await getJson("/api/feedback/profile");
      if (d == null) return { speak: "I can't reach your behavior profile right now." };
      try {
        const __r: any = (() => { const i = d.interpretation || {}; const v = i.verbosity || "balanced"; const p = i.proactivity || "reactive"; const t = i.tone || "neutral"; const total = typeof d.totalSignals === "number" ? d.totalSignals : 0; return "Right now I read you as " + v + " on detail, " + p + " with suggestions, and " + t + " in tone, built from " + total + " signal" + (total === 1 ? "" : "s") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach your behavior profile right now." };
      } catch { return { speak: "I can't reach your behavior profile right now." }; }
    },
  },
  {
    id: "list-geofences",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bgeofences?\\b|\\bzones?\\b", "i").test(lower)) return null;
      const d = await getJson("/api/geofences");
      if (d == null) return { speak: "I can't reach your zones right now." };
      try {
        const __r: any = (() => { const zones = Array.isArray(d.geofences) ? d.geofences : []; const n = zones.length; if (n === 0) return "You have no zones set up yet."; const word = n === 1 ? "zone" : "zones"; const names = zones.map(z => z && z.name).filter(Boolean).slice(0, 4); if (names.length === 0) return "You have " + n + " " + word + " set up."; return "You have " + n + " " + word + " set up: " + names.join(", ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach your zones right now." };
      } catch { return { speak: "I can't reach your zones right now." }; }
    },
  },
  {
    id: "bluetooth-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bbluetooth\\b|\\bblue ?tooth\\b|\\b(speaker|headset)\\b.{0,15}(connect|on|status)|(connect|on|status).{0,15}\\b(speaker|headset)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/bt/status");
      if (d == null) return { speak: "I could not check Bluetooth right now." };
      try {
        const __r: any = (() => { if (d && d.available === false) return "Bluetooth control is not available on this device."; if (!d || !d.powered) return "Bluetooth is currently off."; const devs = Array.isArray(d.devices) ? d.devices : []; const conn = devs.filter(x => x && x.connected); if (conn.length === 0) return "Bluetooth is on, but nothing is connected right now."; const names = conn.map(x => (x && x.name) ? String(x.name) : "an unknown device"); return "Bluetooth is on and connected to " + names.slice(0,2).join(" and ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not check Bluetooth right now." };
      } catch { return { speak: "I could not check Bluetooth right now." }; }
    },
  },
  {
    id: "disk-space",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bdisk\\b|\\bstorage\\b|free space|running out of space|space (is )?(left|free)|how much space", "i").test(lower)) return null;
      const d = await getJson("/api/diag");
      if (d == null) return { speak: "I could not check the disk space right now." };
      try {
        const __r: any = (() => { const disk = d && d.disk ? d.disk : null; if (!disk || !disk.totalMb) return "I could not read the disk size on this machine."; const freeGb = Math.round((disk.freeMb || 0) / 1024); const totalGb = Math.round(disk.totalMb / 1024); return "You've got about " + freeGb + " gigs free out of " + totalGb + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not check the disk space right now." };
      } catch { return { speak: "I could not check the disk space right now." }; }
    },
  },
  {
    id: "list-plugins",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bplugins?\\b|\\badd[- ]?ons?\\b|installed abilities", "i").test(lower)) return null;
      const d = await getJson("/api/plugins");
      if (d == null) return { speak: "I could not list my plugins right now." };
      try {
        const __r: any = (() => { const p = Array.isArray(d.plugins) ? d.plugins : []; if (p.length === 0) return "I do not have any plugins registered right now."; const active = p.filter(x => x && (x.enabled || x.status === "active")); const names = active.map(x => (x && (x.name || x.id))).filter(Boolean); const namePart = names.length ? " The active ones are " + names.slice(0,4).join(", ") + "." : ""; return "I have " + p.length + " plugins." + namePart; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not list my plugins right now." };
      } catch { return { speak: "I could not list my plugins right now." }; }
    },
  },
  {
    id: "pairing-code",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("pairing code|pair(ing)? (my |the )?(phone|device)|connect (my )?phone|link a device|connect code|connect my phone", "i").test(lower)) return null;
      const d = await getJson("/api/pairing/code");
      if (d == null) return { speak: "I could not get the pairing code right now." };
      try {
        const __r: any = (() => { const code = d && d.code ? String(d.code) : ""; if (!code) return "I do not have a pairing code right now."; const nato = {a:"alpha",b:"bravo",c:"charlie",d:"delta",e:"echo",f:"foxtrot",g:"golf",h:"hotel",i:"india",j:"juliet",k:"kilo",l:"lima",m:"mike",n:"november",o:"oscar",p:"papa",q:"quebec",r:"romeo",s:"sierra",t:"tango",u:"uniform",v:"victor",w:"whiskey",x:"xray",y:"yankee",z:"zulu"}; const digits = {"0":"zero","1":"one","2":"two","3":"three","4":"four","5":"five","6":"six","7":"seven","8":"eight","9":"nine"}; const spoken = code.split("").map(ch => { const l = ch.toLowerCase(); return nato[l] || digits[ch] || ch; }).join(" "); return "Your pairing code is " + spoken + ". Open the devices page and enter it on your phone."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not get the pairing code right now." };
      } catch { return { speak: "I could not get the pairing code right now." }; }
    },
  },
  {
    id: "routine-history",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("routine history|what ran recently|(did|have).{0,20}(routine|automation)s?.{0,12}(run|ran|execute)|automations? (ran|run)", "i").test(lower)) return null;
      const d = await getJson("/api/routines/executions/all");
      if (d == null) return { speak: "I could not pull the routine history right now." };
      try {
        const __r: any = (() => { const ex = Array.isArray(d.executions) ? d.executions : []; if (ex.length === 0) return "None of your routines have run yet."; const top = ex.slice(0,2).map(e => { const n = (e && e.routineName) ? String(e.routineName) : "a routine"; const o = (e && e.outcome === "success") ? "succeeded" : ((e && e.outcome === "error") ? "failed" : "ran"); return n + " " + o; }); return "Most recently, " + top.join(", and before that ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not pull the routine history right now." };
      } catch { return { speak: "I could not pull the routine history right now." }; }
    },
  },
  {
    id: "whatsapp-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bwhats ?app\\b", "i").test(lower)) return null;
      const d = await getJson("/api/whatsapp/status");
      if (d == null) return { speak: "I could not check WhatsApp right now." };
      try {
        const __r: any = (() => { const configured = !!(d && d.configured); const provider = d && d.provider ? String(d.provider) : "Twilio"; if (!configured) return "WhatsApp is not set up yet. Add your Twilio credentials to enable it."; const from = d && d.from ? String(d.from) : null; return "WhatsApp is active through " + provider + (from ? ", sending from " + from + "." : "."); })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I could not check WhatsApp right now." };
      } catch { return { speak: "I could not check WhatsApp right now." }; }
    },
  },
  {
    id: "body-lifetime",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bboot count\\b|how many times.*\\bboot|\\bbeen a robot\\b|body'?s? lifetime|\\blifetime\\b|board.*(alive|been alive)|how long.*been.*robot", "i").test(lower)) return null;
      const d = await getJson("/api/body/presence");
      if (d == null) return { speak: "I couldn't read my body's lifetime record just now." };
      try {
        const __r: any = (() => { const rec = d && d.record; if (!rec || typeof rec.boot !== 'number') return "I'm on the virtual body right now, so I don't have a lifetime record to share."; const boots = Math.round(rec.boot); const hours = Math.round((Number(rec.lifeSec) || 0) / 3600); const bootStr = boots + (boots === 1 ? ' time' : ' times'); const hourStr = hours + (hours === 1 ? ' hour' : ' hours'); return 'This board has booted ' + bootStr + ' and racked up about ' + hourStr + ' of life so far.'; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't read my body's lifetime record just now." };
      } catch { return { speak: "I couldn't read my body's lifetime record just now." }; }
    },
  },
  {
    id: "cpu-temperature",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("how hot are you|your temperature|\\bcpu temp\\b|overheating|how warm.*(you|running)|how hot.*running", "i").test(lower)) return null;
      const d = await getJson("/api/diag");
      if (d == null) return { speak: "I couldn't get a temperature reading just now." };
      try {
        const __r: any = (() => { const t = d && d.cpu ? d.cpu.tempC : null; if (t == null || typeof t !== 'number') return "I can't read a CPU temperature on this machine, so I'm probably not running on the Pi right now."; const temp = Math.round(t); const mood = temp < 55 ? ', nice and cool' : temp < 70 ? ', running warm but fine' : ', getting pretty toasty'; return 'My CPU is sitting at ' + temp + ' degrees' + mood + '.'; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't get a temperature reading just now." };
      } catch { return { speak: "I couldn't get a temperature reading just now." }; }
    },
  },
  {
    id: "feature-check",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(what features|feature check|do you have voice|what'?s turned on|what are you capable of|your capabilities)\\b", "i").test(lower)) return null;
      const d = await getJson("/api/features");
      if (d == null) return { speak: "I couldn't check which features are available right now." };
      try {
        const __r: any = (() => { const on = []; if (d.inference && d.inference.available) on.push('local thinking'); if (d.tts && d.tts.available) on.push('text to speech'); if (d.stt && d.stt.available) on.push('speech to text'); if (d.vision && d.vision.available) on.push('vision'); let speak; if (on.length === 0) speak = 'Most of my features are offline right now.'; else if (on.length === 1) speak = 'I have ' + on[0] + ' available.'; else speak = 'I have ' + on.slice(0, -1).join(', ') + ', and ' + on[on.length - 1] + '.'; if (!(d.vision && d.vision.available)) speak += ' Vision needs an OpenAI key.'; return speak; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't check which features are available right now." };
      } catch { return { speak: "I couldn't check which features are available right now." }; }
    },
  },
  {
    id: "run-diagnostics",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("run a? diagnostic|field report|full system check|run diagnostics|how are all your systems|system check", "i").test(lower)) return null;
      const d = await getJson("/api/diag");
      if (d == null) return { speak: "I couldn't complete a full diagnostic just now." };
      try {
        const __r: any = (() => { const parts = []; const up = Number(d.uptimeSec) || 0; const hrs = Math.floor(up / 3600); const mins = Math.round((up % 3600) / 60); if (hrs >= 1) parts.push('up ' + hrs + (hrs === 1 ? ' hour' : ' hours')); else parts.push('up ' + mins + (mins === 1 ? ' minute' : ' minutes')); if (d.cpu && typeof d.cpu.tempC === 'number') parts.push('CPU at ' + Math.round(d.cpu.tempC) + ' degrees'); if (d.disk && Number(d.disk.freeMb)) parts.push(Math.round(Number(d.disk.freeMb) / 1024) + ' gigs free'); if (d.net && d.net.connected && d.net.ssid) parts.push('on ' + d.net.ssid + ' wifi'); if (parts.length === 0) return 'Systems are up, but I could not read the detailed stats.'; return 'Field report. ' + parts.join(', ') + '.'; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't complete a full diagnostic just now." };
      } catch { return { speak: "I couldn't complete a full diagnostic just now." }; }
    },
  },
  {
    id: "wifi-status",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("am i on wifi|what network|what'?s my wifi|how'?s my signal|which wifi|\\bwifi status\\b|what wifi", "i").test(lower)) return null;
      const d = await getJson("/api/net/status");
      if (d == null) return { speak: "I couldn't check the WiFi status just now." };
      try {
        const __r: any = (() => { if (d.available === false) return "WiFi control isn't available on this device."; const w = d.wifi || {}; if (!w.connected) return "I'm not connected to any WiFi right now."; let speak = 'Connected to ' + (w.ssid || 'an unnamed network'); if (typeof w.signal === 'number') speak += ' with a ' + Math.round(w.signal) + ' percent signal'; return speak + '.'; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I couldn't check the WiFi status just now." };
      } catch { return { speak: "I couldn't check the WiFi status just now." }; }
    },
  },
  {
    id: "current-expression",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(what|which) (face|expression|mood)\\b|face are you making|how do you look|what are you showing|mood on your face", "i").test(lower)) return null;
      const d = await getJson("/api/face");
      if (d == null) return { speak: "I can't read my current expression right now." };
      try {
        const __r: any = (() => { const st = d && d.state ? String(d.state) : null; if (!st) return "I can't tell what expression I'm showing right now."; const panel = (d && d.board) ? " on my real face panel" : ""; return "Right now my eyes are set to " + st + panel + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't read my current expression right now." };
      } catch { return { speak: "I can't read my current expression right now." }; }
    },
  },
  {
    id: "get-alert-thresholds",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\balert (threshold|limit)s?\\b|\\bthresholds?\\b|when do you (warn|flag)|memory alert|cpu (alert|threshold)|high usage", "i").test(lower)) return null;
      const d = await getJson("/api/system/thresholds");
      if (d == null) return { speak: "I can't reach my alert threshold settings right now." };
      try {
        const __r: any = (() => { const cpu = Number(d && d.cpuThreshold); const mem = Number(d && d.memThreshold); if (!Number.isFinite(cpu) || !Number.isFinite(mem)) return "I don't have alert thresholds configured right now."; return "I alert when CPU passes " + Math.round(cpu) + " percent or memory passes " + Math.round(mem) + " percent."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach my alert threshold settings right now." };
      } catch { return { speak: "I can't reach my alert threshold settings right now." }; }
    },
  },
  {
    id: "is-body-connected",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bdo you have a body\\b|board (plugged|connected)|are you a robot|hardware connected|is there hardware|physical you", "i").test(lower)) return null;
      const d = await getJson("/api/body/presence");
      if (d == null) return { speak: "I can't check whether a body is connected right now." };
      try {
        const __r: any = (() => { if (d && d.present) { const board = d.board ? " It's a " + d.board + " board." : ""; const lead = d.connected ? "Yes, a board is plugged in and I'm connected to it. I've got a body." : "A board is plugged in and I'm linking to it now."; return lead + board; } return "No board is plugged in right now, so I'm running on my virtual body."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't check whether a body is connected right now." };
      } catch { return { speak: "I can't check whether a body is connected right now." }; }
    },
  },
  {
    id: "read-predictions",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\bpredictions?\\b|what did you predict|the forecast", "i").test(lower)) return null;
      const d = await getJson("/api/predictions?status=pending");
      if (d == null) return { speak: "I can't reach my predictions right now." };
      try {
        const __r: any = (() => { const preds = d && Array.isArray(d.predictions) ? d.predictions : []; if (preds.length === 0) return "You have no pending predictions right now."; const count = preds.length; const top = preds.slice(0, 2).map(function(p){ return p && (p.suggestedAction || p.prediction); }).filter(Boolean); return count + (count === 1 ? " pending prediction. " : " pending predictions. ") + top.join(". ") + "."; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I can't reach my predictions right now." };
      } catch { return { speak: "I can't reach my predictions right now." }; }
    },
  },
  {
    id: "snark-quip",
    async handle({ raw, lower }) {
      void raw;
      if (!new RegExp("\\b(snarky|snark|quip|sassy)\\b|sass me|be sass|inner jarvis", "i").test(lower)) return null;
      const d = await getJson("/api/snark");
      if (d == null) return { speak: "I've got nothing snarky loaded at the moment." };
      try {
        const __r: any = (() => { const line = d && d.line ? String(d.line) : ""; if (!line) return "My snark generator came up empty, which is honestly the snarkiest outcome."; return line; })();
        const speak = __r == null ? "" : String(__r).trim();
        return { speak: speak || "I've got nothing snarky loaded at the moment." };
      } catch { return { speak: "I've got nothing snarky loaded at the moment." }; }
    },
  },
];
