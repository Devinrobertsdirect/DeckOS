import { workerData, parentPort, isMainThread } from "worker_threads";

if (isMainThread) {
  throw new Error("community-plugin-worker must run inside a Worker thread");
}

interface WorkerInit {
  filePath: string;
}

const { filePath } = workerData as WorkerInit;

const subscriptions = new Map<string, Array<(event: unknown) => Promise<void> | void>>();
const pendingRpc = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

type PluginRouteRequest = { body: unknown; query: unknown; params: unknown; headers: unknown };
type PluginRouteResponse = { status?: number; body?: unknown };
const routeHandlers = new Map<string, (req: PluginRouteRequest) => Promise<PluginRouteResponse>>();

let rpcSeq = 0;
function nextRpcId(): string {
  return `rpc_${++rpcSeq}`;
}

function makeRpcCall(method: string, args: unknown): Promise<unknown> {
  const id = nextRpcId();
  const promise = new Promise<unknown>((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
    setTimeout(() => {
      if (pendingRpc.has(id)) {
        pendingRpc.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 30_000);
  });
  parentPort!.postMessage({ type: "rpc_request", id, method, args });
  return promise;
}

const sandboxContext = {
  emit: (event: unknown) => {
    parentPort!.postMessage({ type: "emit", event });
  },
  subscribe: (eventType: string, handler: (event: unknown) => Promise<void> | void): string => {
    if (!subscriptions.has(eventType)) {
      subscriptions.set(eventType, []);
      parentPort!.postMessage({ type: "subscribe", eventType });
    }
    subscriptions.get(eventType)!.push(handler);
    return `wsub_${eventType}_${Date.now()}`;
  },
  logger: {
    info: (msg: string, data?: unknown) => parentPort!.postMessage({ type: "log", level: "info", msg, data }),
    warn: (msg: string, data?: unknown) => parentPort!.postMessage({ type: "log", level: "warn", msg, data }),
    error: (msg: string, data?: unknown) => parentPort!.postMessage({ type: "log", level: "error", msg, data }),
  },
  infer: (opts: unknown): Promise<unknown> => makeRpcCall("infer", opts),
  memory: {
    store: (opts: unknown): Promise<unknown> => makeRpcCall("memory.store", opts),
    search: (keyword: string, limit?: number): Promise<unknown> => makeRpcCall("memory.search", { keyword, limit }),
    getRecent: (limit?: number): Promise<unknown> => makeRpcCall("memory.getRecent", { limit }),
    getById: (id: string): Promise<unknown> => makeRpcCall("memory.getById", { id }),
    expire: (): Promise<unknown> => makeRpcCall("memory.expire", {}),
  },
  http: {
    register(method: string, pattern: string, handler: (req: PluginRouteRequest) => Promise<PluginRouteResponse>) {
      const routeId = `${method.toUpperCase()}:${pattern}`;
      routeHandlers.set(routeId, handler);
      parentPort!.postMessage({ type: "route_register", routeId, method: method.toUpperCase(), pattern });
    },
  },
};

async function dispatchToSubscribers(event: Record<string, unknown>): Promise<void> {
  const eventType = event["type"] as string;
  const typeHandlers = subscriptions.get(eventType) ?? [];
  const wildcardHandlers = subscriptions.get("*") ?? [];
  const all = [...typeHandlers, ...wildcardHandlers];
  for (const handler of all) {
    try {
      await handler(event);
    } catch (err) {
      parentPort!.postMessage({ type: "error", error: `Handler error for ${eventType}: ${String(err)}` });
    }
  }
}

async function run(): Promise<void> {
  let mod: unknown;
  try {
    mod = await import(filePath);
  } catch (err) {
    parentPort!.postMessage({ type: "load_error", error: `Import failed: ${String(err)}` });
    return;
  }

  const exported = (mod as Record<string, unknown>)["default"] ?? mod;
  let instance: unknown;

  if (typeof exported === "function") {
    try {
      instance = new (exported as new () => unknown)();
    } catch (err) {
      parentPort!.postMessage({ type: "load_error", error: `Instantiation failed: ${String(err)}` });
      return;
    }
  } else {
    instance = exported;
  }

  const p = instance as Record<string, unknown>;
  const required = ["id", "name", "version", "description", "category", "init", "on_event", "execute", "shutdown"];
  for (const key of required) {
    if (!(key in p)) {
      parentPort!.postMessage({ type: "load_error", error: `Missing required plugin field: ${key}` });
      return;
    }
  }

  try {
    await (p["init"] as (ctx: unknown) => Promise<void>)(sandboxContext);
  } catch (err) {
    parentPort!.postMessage({ type: "load_error", error: `Plugin init() failed: ${String(err)}` });
    return;
  }

  parentPort!.postMessage({
    type: "ready",
    pluginId: p["id"],
    name: p["name"],
    version: p["version"],
    description: p["description"],
    category: p["category"],
  });

  parentPort!.on("message", async (msg: Record<string, unknown>) => {
    try {
      switch (msg["type"]) {
        case "dispatch_event": {
          await dispatchToSubscribers(msg["event"] as Record<string, unknown>);
          break;
        }
        case "execute": {
          const result = await (p["execute"] as (payload: unknown) => Promise<unknown>)(msg["payload"]);
          parentPort!.postMessage({ type: "execute_result", id: msg["id"], result });
          break;
        }
        case "shutdown": {
          try {
            await (p["shutdown"] as () => Promise<void>)();
          } catch {
            // ignore shutdown errors
          }
          parentPort!.postMessage({ type: "shutdown_done" });
          process.exit(0);
          break;
        }
        case "rpc_response": {
          const pending = pendingRpc.get(msg["id"] as string);
          if (pending) {
            pendingRpc.delete(msg["id"] as string);
            if (msg["error"]) {
              pending.reject(new Error(msg["error"] as string));
            } else {
              pending.resolve(msg["result"]);
            }
          }
          break;
        }
        case "route_dispatch": {
          const routeId = msg["routeId"] as string;
          const requestId = msg["requestId"] as string;
          const handler = routeHandlers.get(routeId);
          if (!handler) {
            parentPort!.postMessage({ type: "route_response", requestId, status: 404, body: { error: "Route handler not registered" } });
            break;
          }
          try {
            const result = await handler(msg["request"] as PluginRouteRequest);
            parentPort!.postMessage({ type: "route_response", requestId, status: result.status ?? 200, body: result.body ?? null });
          } catch (err) {
            parentPort!.postMessage({ type: "route_response", requestId, status: 500, body: { error: String(err) } });
          }
          break;
        }
      }
    } catch (err) {
      parentPort!.postMessage({ type: "error", error: String(err) });
    }
  });
}

run().catch((err) => {
  parentPort!.postMessage({ type: "load_error", error: String(err) });
});
