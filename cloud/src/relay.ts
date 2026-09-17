/*
 * relay.ts — the bot relay hub + device registry.
 *
 * Reachability problem: a bot (Pi/desktop) usually sits behind home NAT, so the
 * phone can't dial it directly from the internet. Solution: the BOT dials OUT to
 * this cloud over a WebSocket and holds the connection open. The phone sends a
 * command to the cloud (REST or WS); the cloud forwards it down the bot's socket
 * and routes the bot's reply back. No port-forwarding, no public bot IP.
 *
 *   Bot:    wss://<cloud>/v1/ws?role=bot     (credential in Sec-WebSocket-Protocol)
 *   Phone:  wss://<cloud>/v1/ws?role=phone   (credential in Sec-WebSocket-Protocol)
 *
 * Credentials travel in the `Sec-WebSocket-Protocol` header (offered as
 * `neura.v1.<token>`), NOT the URL query string, so they don't leak into proxy
 * access logs. A `?token=`/`?linkToken=` query is still accepted as a fallback.
 *
 * Ownership is enforced everywhere: a phone can only command bots on its own
 * account, and a bot socket is bound to the account that created its link token.
 */
import type { Server, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Router, type Response } from "express";
import { z } from "zod";
import type { Store, Bot } from "./store.js";
import { requireAuth, validateSession, type AuthedRequest } from "./auth.js";
import { randomToken, sha256, randomId } from "./crypto.js";
import { rateLimit } from "./ratelimit.js";

const COMMAND_TIMEOUT_MS = 15_000;
const MAX_WS_PAYLOAD = 64 * 1024; // 64KB frames — commands are small
const MAX_PHONE_SOCKETS_PER_ACCOUNT = 8;
const MAX_PENDING_PER_ACCOUNT = 16;
const MAX_COMMAND_PAYLOAD_BYTES = 16 * 1024;
const PROTO_PREFIX = "neura.v1.";

type Pending = { resolve: (v: unknown) => void; timer: NodeJS.Timeout; accountId: string };

/** Pull a credential from the Sec-WebSocket-Protocol header, else the query. */
function credential(req: IncomingMessage, url: URL, queryKey: string): string {
  const proto = req.headers["sec-websocket-protocol"];
  if (proto) {
    const hit = String(proto)
      .split(",")
      .map((s) => s.trim())
      .find((s) => s.startsWith(PROTO_PREFIX));
    if (hit) return hit.slice(PROTO_PREFIX.length);
  }
  return url.searchParams.get(queryKey) || "";
}

const commandPayloadSchema = z.object({
  botId: z.string().min(1).max(64),
  type: z.string().min(1).max(60),
  payload: z.unknown().optional(),
});

export class RelayHub {
  private botSockets = new Map<string, WebSocket>(); // botId → live socket
  private phoneSockets = new Map<string, Set<WebSocket>>(); // accountId → phone sockets
  private pending = new Map<string, Pending>(); // requestId → awaiting REST caller
  private pendingByAccount = new Map<string, number>();

  constructor(private store: Store) {}

  attach(server: Server): void {
    const allowed = (process.env.NEURA_WS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const wss = new WebSocketServer({
      server,
      path: "/v1/ws",
      maxPayload: MAX_WS_PAYLOAD,
      // Native apps send no Origin → allowed. If an allowlist is configured,
      // browser origins must be on it (blocks cross-site socket hijacking).
      verifyClient: allowed.length
        ? (info, cb) => {
            const origin = info.origin;
            if (!origin || allowed.includes(origin)) cb(true);
            else cb(false, 403, "origin not allowed");
          }
        : undefined,
    });
    wss.on("connection", (ws, req) => {
      void this.onConnection(ws, req);
    });
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || "", "http://localhost");
    const role = url.searchParams.get("role");

    if (role === "bot") {
      const linkToken = credential(req, url, "linkToken");
      const bot = await this.store.getBotByLinkTokenHash(sha256(linkToken));
      if (!bot) {
        ws.close(4401, "invalid link token");
        return;
      }
      this.botSockets.set(bot.id, ws);
      void this.store.touchBot(bot.id, Date.now());
      ws.send(JSON.stringify({ op: "linked", botId: bot.id, name: bot.name }));
      ws.on("message", (raw) => this.onBotMessage(bot, String(raw)));
      ws.on("close", () => {
        if (this.botSockets.get(bot.id) === ws) this.botSockets.delete(bot.id);
      });
      ws.on("error", () => {});
      return;
    }

    if (role === "phone") {
      const token = credential(req, url, "token");
      // Same TTL + account-existence checks as REST (shared validator), so an
      // expired token can't open a relay socket after REST would reject it.
      const account = await validateSession(this.store, token);
      if (!account) {
        ws.close(4401, "invalid or expired session");
        return;
      }
      const accountId = account.id;
      let set = this.phoneSockets.get(accountId);
      if (!set) this.phoneSockets.set(accountId, (set = new Set()));
      if (set.size >= MAX_PHONE_SOCKETS_PER_ACCOUNT) {
        ws.close(4429, "too many connections");
        return;
      }
      set.add(ws);
      ws.send(JSON.stringify({ op: "ready" }));
      ws.on("message", (raw) => this.onPhoneMessage(accountId, String(raw)));
      ws.on("close", () => {
        const s = this.phoneSockets.get(accountId);
        if (s) {
          s.delete(ws);
          if (s.size === 0) this.phoneSockets.delete(accountId); // no empty-Set leak
        }
      });
      ws.on("error", () => {});
      return;
    }

    ws.close(4400, "role required");
  }

  private onBotMessage(bot: Bot, raw: string): void {
    let msg: { op?: string; requestId?: string; ok?: boolean; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    void this.store.touchBot(bot.id, Date.now());
    if (msg.op === "result" && msg.requestId) {
      const p = this.pending.get(msg.requestId);
      if (p && p.accountId === bot.accountId) {
        clearTimeout(p.timer);
        this.clearPending(msg.requestId);
        p.resolve({ ok: msg.ok ?? true, data: msg.data ?? null });
      }
      this.toPhones(bot.accountId, {
        op: "result",
        botId: bot.id,
        requestId: msg.requestId,
        ok: msg.ok ?? true,
        data: msg.data ?? null,
      });
    }
  }

  private onPhoneMessage(accountId: string, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = commandPayloadSchema.safeParse(msg);
    if (!parsed.success || (msg as { op?: string }).op !== "command") return;
    void this.sendCommand(accountId, parsed.data.botId, parsed.data.type, parsed.data.payload).catch(
      () => {},
    );
  }

  private toPhones(accountId: string, obj: unknown): void {
    const data = JSON.stringify(obj);
    for (const ws of this.phoneSockets.get(accountId) || []) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private clearPending(requestId: string): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    const n = (this.pendingByAccount.get(p.accountId) || 1) - 1;
    if (n <= 0) this.pendingByAccount.delete(p.accountId);
    else this.pendingByAccount.set(p.accountId, n);
  }

  isOnline(botId: string): boolean {
    const ws = this.botSockets.get(botId);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Forward a command to a bot the account owns and await its result.
   * Rejects if the bot is offline, not owned, the payload is oversized, the
   * account has too many in-flight commands, or the bot doesn't answer in time.
   */
  async sendCommand(
    accountId: string,
    botId: string,
    type: string,
    payload: unknown,
  ): Promise<{ ok: boolean; data: unknown; requestId: string }> {
    const bot = await this.store.getBot(botId);
    if (!bot || bot.accountId !== accountId) throw new Error("bot not found");
    const ws = this.botSockets.get(botId);
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("bot offline");

    if ((this.pendingByAccount.get(accountId) || 0) >= MAX_PENDING_PER_ACCOUNT) {
      throw new Error("too many pending commands");
    }
    const frame = JSON.stringify({ op: "command", requestId: "", type, payload });
    if (Buffer.byteLength(frame, "utf8") > MAX_COMMAND_PAYLOAD_BYTES) {
      throw new Error("command payload too large");
    }

    const requestId = randomId("req_");
    this.pendingByAccount.set(accountId, (this.pendingByAccount.get(accountId) || 0) + 1);
    try {
      const result = await new Promise<{ ok: boolean; data: unknown }>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.clearPending(requestId);
          reject(new Error("bot did not respond in time"));
        }, COMMAND_TIMEOUT_MS);
        this.pending.set(requestId, {
          accountId,
          timer,
          resolve: (v) => resolve(v as { ok: boolean; data: unknown }),
        });
        ws.send(JSON.stringify({ op: "command", requestId, type, payload }));
      });
      return { ...result, requestId };
    } catch (err) {
      this.clearPending(requestId);
      throw err;
    }
  }
}

// ── REST registry ─────────────────────────────────────────────────────────────
export function botsRouter(store: Store, hub: RelayHub): Router {
  const r = Router();
  r.use(requireAuth(store));
  r.use(
    rateLimit({
      windowMs: 60_000,
      max: Number(process.env.NEURA_CLOUD_CMD_PER_MIN || 60),
      key: (req) => (req as AuthedRequest).account!.id,
      name: "bots",
    }),
  );

  r.post("/link", async (req: AuthedRequest, res: Response) => {
    const name = z.string().min(1).max(60).safeParse(req.body?.name);
    const linkToken = randomToken(32);
    const bot: Bot = {
      id: randomId("bot_"),
      accountId: req.account!.id,
      name: name.success ? name.data : "My Nobi bot",
      linkTokenHash: sha256(linkToken),
      createdAt: Date.now(),
      lastSeen: 0,
    };
    try {
      await store.createBot(bot);
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    // linkToken is returned exactly once; only its hash is stored.
    res.status(201).json({ botId: bot.id, linkToken, name: bot.name });
  });

  r.get("/", async (req: AuthedRequest, res: Response) => {
    const bots = await store.listBots(req.account!.id);
    res.json({
      bots: bots.map((b) => ({
        id: b.id,
        name: b.name,
        online: hub.isOnline(b.id),
        lastSeen: b.lastSeen || null,
      })),
    });
  });

  // Rotate a bot's link token (revokes the old one immediately).
  r.post("/:id/relink", async (req: AuthedRequest, res: Response) => {
    const bot = await store.getBot(String(req.params.id));
    if (!bot || bot.accountId !== req.account!.id) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    const linkToken = randomToken(32);
    await store.updateBot(bot.id, { linkTokenHash: sha256(linkToken) });
    res.json({ botId: bot.id, linkToken, name: bot.name });
  });

  // Delete/revoke a bot entirely.
  r.delete("/:id", async (req: AuthedRequest, res: Response) => {
    const removed = await store.deleteBot(String(req.params.id), req.account!.id);
    if (!removed) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    res.json({ ok: true });
  });

  r.post("/:id/command", async (req: AuthedRequest, res: Response) => {
    const type = z.string().min(1).max(60).safeParse(req.body?.type);
    if (!type.success) {
      res.status(400).json({ error: "command type required" });
      return;
    }
    try {
      const out = await hub.sendCommand(
        req.account!.id,
        String(req.params.id),
        type.data,
        req.body?.payload ?? null,
      );
      res.json({ ok: out.ok, requestId: out.requestId, result: out.data });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  });

  return r;
}
