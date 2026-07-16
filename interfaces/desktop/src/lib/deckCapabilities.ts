import { useEffect, useState } from "react";

/**
 * The DeckOS capability manifest, client side. Atlas is the face; DeckOS is the
 * body — this is what the "what can I do?" launcher shows, so the buddy can open
 * any tool. Fetched from GET /api/capabilities (the authoritative server list);
 * a small offline fallback keeps the launcher useful with the server down.
 */

export type CapabilityCategory =
  | "brain" | "memory" | "automation" | "devices" | "comms" | "insight" | "system" | "setup";

export interface DeckCapability {
  id: string;
  title: string;
  summary: string;
  category: CapabilityCategory;
  /** UI route to open the tool, or "" if it's purely conversational. */
  uiRoute: string;
  primaryEndpoint: string;
  userPhrasings: string[];
}

export const CATEGORY_LABEL: Record<CapabilityCategory, string> = {
  brain: "Thinking & conversation",
  memory: "Memory",
  automation: "Automations & agency",
  insight: "Awareness & insight",
  devices: "Devices & the physical world",
  comms: "Voice & messaging",
  system: "System & activity",
  setup: "Setup & connections",
};

export const CATEGORY_ORDER: CapabilityCategory[] = [
  "brain", "memory", "automation", "insight", "devices", "comms", "system", "setup",
];

// Minimal fallback (server offline) — the launchable highlights.
const FALLBACK: DeckCapability[] = [
  { id: "memory", title: "Memory & Your Profile", category: "memory", uiRoute: "/memory", primaryEndpoint: "", userPhrasings: ["What do you know about me?", "Remember this for me"],
    summary: "Everything Neura remembers about you — view, search, edit, or wipe it." },
  { id: "routines-automation", title: "Routines & Automations", category: "automation", uiRoute: "/routines", primaryEndpoint: "", userPhrasings: ["Set up a morning routine"],
    summary: "Create and run scheduled or triggered routines." },
  { id: "daily-briefings", title: "Briefings", category: "insight", uiRoute: "/briefings", primaryEndpoint: "", userPhrasings: ["Give me my briefing"],
    summary: "A short catch-up of what matters right now." },
  { id: "device-control", title: "Devices & Control", category: "devices", uiRoute: "/devices", primaryEndpoint: "", userPhrasings: ["What devices do you know about?"],
    summary: "See and control your connected gadgets and sensors." },
  { id: "location-geofences", title: "Location & Map", category: "devices", uiRoute: "/map", primaryEndpoint: "", userPhrasings: ["Show me the map"],
    summary: "Track devices and people on a live map with zones." },
  { id: "activity-timeline", title: "Activity Timeline", category: "system", uiRoute: "/timeline", primaryEndpoint: "", userPhrasings: ["What happened today?"],
    summary: "A searchable history of everything across the system." },
  { id: "skills-plugins", title: "Skills & Plugins", category: "automation", uiRoute: "/plugins/store", primaryEndpoint: "", userPhrasings: ["What add-ons can I install?"],
    summary: "Extend Neura with skills from the store." },
  { id: "provider-setup", title: "AI Providers & Settings", category: "setup", uiRoute: "/settings", primaryEndpoint: "", userPhrasings: ["Connect my Claude key"],
    summary: "Connect cloud AIs, keys, and preferences." },
];

let cache: DeckCapability[] | null = null;

/** Fetch the capability manifest once, caching it for the session. */
export function useDeckCapabilities(): { capabilities: DeckCapability[]; loading: boolean } {
  const [capabilities, setCapabilities] = useState<DeckCapability[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetch("/api/capabilities")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { capabilities?: DeckCapability[] } | null) => {
        if (!alive) return;
        const list = d?.capabilities?.length ? d.capabilities : FALLBACK;
        cache = list;
        setCapabilities(list);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setCapabilities(FALLBACK);
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  return { capabilities, loading };
}
