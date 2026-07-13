import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { bus } from "./bus.js";
import { logger } from "./logger.js";
import type { BusEvent } from "@workspace/event-bus";
import { BusEventSchema } from "@workspace/event-bus";
import { db, systemEventsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { z } from "zod";

const MAX_QUEUE_SIZE = 500;
const SLOW_CLIENT_CLOSE_THRESHOLD = 1000;

type ClientState = {
  ws: WebSocket;
  queue: string[];
  flushing: boolean;
  live: boolean;
  preliveBuf: string[];
};

const clientStates = new Map<WebSocket, ClientState>();

const IncomingCommandSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  target: z.string().nullable().optional(),
});

async function getHistoryEvents(limit = 50): Promise<unknown[]> {
  try {
    const rows = await db
      .select()
      .from(systemEventsTable)
      .orderBy(desc(systemEventsTable.createdAt))
      .limit(limit);

    return rows
      .reverse()
      .map((row) => {
        const data = (row.data ?? {}) as Record<string, unknown>;
        return {
          id: data["eventId"] ?? String(row.id),
          version: data["version"] ?? "v1",
          type: row.message,
          source: row.source,
          target: data["target"] ?? null,
          payload: data["payload"] ?? null,
          timestamp: data["timestamp"] ?? row.createdAt.toISOString(),
        };
      });
  } catch (err) {
    logger.error({ err }, "ws-server: failed to load history events");
    return [];
  }
}

function enqueue(state: ClientState, json: string): void {
  if (state.ws.readyState !== WebSocket.OPEN) return;

  if (state.queue.length >= SLOW_CLIENT_CLOSE_THRESHOLD) {
    logger.warn("ws-server: slow client queue overflow, closing connection");
    state.ws.terminate();
    return;
  }

  if (state.queue.length >= MAX_QUEUE_SIZE) {
    state.queue.shift();
  }

  state.queue.push(json);
  scheduleFlush(state);
}

function scheduleFlush(state: ClientState): void {
  if (state.flushing) return;
  state.flushing = true;
  setImmediate(() => flushClientQueue(state));
}

function flushClientQueue(state: ClientState): void {
  state.flushing = false;
  if (state.ws.readyState !== WebSocket.OPEN) {
    state.queue.length = 0;
    return;
  }

  const batch = state.queue.splice(0, 50);
  for (const msg of batch) {
    state.ws.send(msg);
  }

  if (state.queue.length > 0) {
    scheduleFlush(state);
  }
}

function sendDirect(ws: WebSocket, data: unknown): void {
  const state = clientStates.get(ws);
  const json = JSON.stringify(data);
  if (state) {
    enqueue(state, json);
  } else if (ws.readyState === WebSocket.OPEN) {
    ws.send(json);
  }
}

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    logger.info({ ip }, "WS client connected");

    const state: ClientState = {
      ws,
      queue: [],
      flushing: false,
      live: false,
      preliveBuf: [],
    };
    clientStates.set(ws, state);

    bus.emit({
      source: "ws-server",
      target: null,
      type: "client.connected",
      payload: { ip, clientCount: clientStates.size },
    });

    sendDirect(ws, {
      type: "ws.connected",
      payload: { message: "DeckOS stream open", clientCount: clientStates.size },
      timestamp: new Date().toISOString(),
    });

    void (async () => {
      const events = await getHistoryEvents(50);
      sendDirect(ws, {
        type: "history.replay",
        payload: { events, count: events.length },
        timestamp: new Date().toISOString(),
      });

      for (const json of state.preliveBuf) {
        enqueue(state, json);
      }
      state.preliveBuf = [];
      state.live = true;
    })();

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendDirect(ws, {
          type: "ws.error",
          payload: { error: "Invalid JSON", raw: raw.toString().slice(0, 200) },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = IncomingCommandSchema.safeParse(parsed);
      if (!result.success) {
        sendDirect(ws, {
          type: "ws.error",
          payload: {
            error: "Malformed command: must have 'type' (string) and 'payload' fields",
            issues: result.error.issues,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const { type, payload, target } = result.data;

      const preCheck = BusEventSchema.safeParse({
        id: "00000000-0000-0000-0000-000000000000",
        version: "v1",
        source: "ws-client",
        target: target ?? null,
        type,
        payload,
        timestamp: new Date().toISOString(),
      });

      if (!preCheck.success) {
        sendDirect(ws, {
          type: "ws.error",
          payload: {
            error: `Unsupported event type: "${type}"`,
            issues: preCheck.error.issues,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      bus.emit({
        source: "ws-client",
        target: target ?? null,
        type: type as Parameters<typeof bus.emit>[0]["type"],
        payload,
      });
    });

    ws.on("close", () => {
      clientStates.delete(ws);
      logger.info({ ip }, "WS client disconnected");

      bus.emit({
        source: "ws-server",
        target: null,
        type: "client.disconnected",
        payload: { ip, clientCount: clientStates.size },
      });
    });

    ws.on("error", (err) => {
      logger.error({ err, ip }, "WS client error");
      clientStates.delete(ws);
    });
  });

  bus.subscribe("*", (event: BusEvent) => {
    broadcast(event);
  });

  logger.info("WebSocket server attached at /api/ws");
  return wss;
}

export function broadcast(data: unknown): void {
  const json = JSON.stringify(data);
  let sentLive = 0;
  let bufferedPrelive = 0;
  for (const [ws, state] of clientStates) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (state.live) {
      enqueue(state, json);
      sentLive++;
    } else {
      if (state.preliveBuf.length < MAX_QUEUE_SIZE) {
        state.preliveBuf.push(json);
        bufferedPrelive++;
      }
    }
  }
  if (sentLive > 0 || bufferedPrelive > 0) {
    logger.debug({ sentLive, bufferedPrelive, clientCount: clientStates.size }, "WS broadcast");
  }
}

export function getClientCount(): number {
  return clientStates.size;
}
