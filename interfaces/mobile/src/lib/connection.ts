/*
 * connection.ts — the online-mode connection layer.
 *
 * The mobile client speaks to ONE of two backends, chosen by a persisted toggle:
 *
 *   • LOCAL (online mode OFF) — the brain running on the same Wi-Fi. Base `/api`,
 *     paired via a code. Private; only works on the home network.
 *   • CLOUD (online mode ON)  — Nobi Cloud. Base `/v1`, authed with a Bearer
 *     session token. Reachable anywhere; runs the AI on the account's own keys.
 *
 * Chat and the WebSocket paths line up across both once the base is swapped;
 * request/response SHAPES differ, so `sendChat()` adapts. Local-only endpoints
 * (persona, ucm, voice) simply 404 in cloud mode and the callers fall back to
 * defaults — so cloud mode degrades cleanly to "account + chat".
 */

export type Mode = "local" | "cloud";

const MODE_KEY = "neura_mode";
const CLOUD_URL_KEY = "neura_cloud_url";
const TOKEN_KEY = "neura_token";
const PAIRING_KEY = "deckos_pairing_code"; // must match App.tsx

// ── mode + config ─────────────────────────────────────────────────────────────
/**
 * True when this page is being served BY a robot rather than by Nobi Cloud:
 * a private address, a .local name, or localhost. The robot serves the app at
 * :8080/mobile/ and has no /v1/auth — so defaulting such a visit to cloud mode
 * showed a login screen whose POST 404'd against the robot. If you reached the
 * app through the robot, the robot is what you meant to talk to.
 */
function servedByRobot(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" || h === "127.0.0.1" || h.endsWith(".local") ||
    /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function getMode(): Mode {
  const explicit = localStorage.getItem(MODE_KEY);
  if (explicit === "local" || explicit === "cloud") return explicit;
  // Already paired to a local brain, or reached through one → local.
  if (localStorage.getItem(PAIRING_KEY) || servedByRobot()) return "local";
  // Otherwise this came from the website, where Nobi Cloud login is right.
  return "cloud";
}
export function isCloud(): boolean {
  return getMode() === "cloud";
}
export function setMode(m: Mode): void {
  localStorage.setItem(MODE_KEY, m);
}

/** Nobi Cloud base URL. Defaults to this page's origin — so when the app is
 *  served BY Nobi Cloud (at /mobile/), cloud mode targets the same deploy. */
export function getCloudUrl(): string {
  const v = localStorage.getItem(CLOUD_URL_KEY);
  return (v && v.trim()) || window.location.origin;
}
export function setCloudUrl(u: string): void {
  localStorage.setItem(CLOUD_URL_KEY, u.trim().replace(/\/+$/, ""));
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

// ── derived endpoints ─────────────────────────────────────────────────────────
export function apiBase(): string {
  return isCloud() ? `${getCloudUrl()}/v1` : `${window.location.origin}/api`;
}

/** WebSocket URL for the current mode. Empty string ⇒ don't open one. */
export function wsUrl(): string {
  if (isCloud()) {
    const tok = getToken();
    if (!tok) return "";
    const u = new URL(getCloudUrl());
    const proto = u.protocol === "https:" ? "wss" : "ws";
    // Relay socket (for future bot control); chat itself is REST in cloud mode.
    return `${proto}://${u.host}/v1/ws?role=phone&token=${encodeURIComponent(tok)}`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/ws`;
}

export function authHeaders(): Record<string, string> {
  return isCloud() && getToken() ? { Authorization: `Bearer ${getToken()}` } : {};
}

/** Is the current mode ready to use (paired locally / logged in for cloud)? */
export function isReady(): boolean {
  return isCloud() ? !!getToken() : !!localStorage.getItem(PAIRING_KEY);
}

// ── cloud auth + profile ──────────────────────────────────────────────────────
async function cloudPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${getCloudUrl()}/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((data.message as string) || (data.error as string) || `HTTP ${res.status}`);
  }
  return data;
}

export async function cloudSignup(email: string, password: string): Promise<void> {
  const d = await cloudPost("/auth/signup", { email, password });
  setToken(d.token as string);
}
export async function cloudLogin(email: string, password: string): Promise<void> {
  const d = await cloudPost("/auth/login", { email, password });
  setToken(d.token as string);
}
export async function cloudGoogle(idToken: string): Promise<void> {
  const d = await cloudPost("/auth/google", { idToken });
  setToken(d.token as string);
}
export async function cloudLogout(): Promise<void> {
  try {
    await cloudPost("/auth/logout", {});
  } catch {
    /* ignore */
  }
  setToken("");
}

export async function getProfile(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${getCloudUrl()}/v1/profile`, { headers: authHeaders() });
    if (!res.ok) return {};
    const d = (await res.json()) as { profile?: Record<string, unknown> };
    return d.profile || {};
  } catch {
    return {};
  }
}
export async function patchProfile(patch: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${getCloudUrl()}/v1/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ patch }),
    });
  } catch {
    /* best-effort sync */
  }
}

// ── unified chat ──────────────────────────────────────────────────────────────
export type ChatResult = {
  content: string;
  modelUsed?: string;
  latencyMs?: number;
  fromCache?: boolean;
  tier?: string;
  reasonCode?: string;
};

export async function sendChat(
  text: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  opts?: { sessionId?: string; requestId?: string },
): Promise<ChatResult> {
  if (isCloud()) {
    const started = Date.now();
    const res = await fetch(`${getCloudUrl()}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message: text, history: history.slice(-20) }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      reply?: string;
      model?: string;
      message?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    return { content: data.reply || "(no response)", modelUsed: data.model, latencyMs: Date.now() - started };
  }
  // Local brain.
  const res = await fetch(`${window.location.origin}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      channel: "mobile",
      sessionId: opts?.sessionId,
      requestId: opts?.requestId,
    }),
  });
  const data = (await res.json()) as {
    response: string;
    modelUsed: string;
    latencyMs: number;
    fromCache: boolean;
    tier?: string;
    reasonCode?: string;
  };
  return {
    content: data.response,
    modelUsed: data.modelUsed,
    latencyMs: data.latencyMs,
    fromCache: data.fromCache,
    tier: data.tier,
    reasonCode: data.reasonCode,
  };
}
