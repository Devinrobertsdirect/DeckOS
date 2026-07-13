import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { readdir, access } from "fs/promises";
import { Worker } from "worker_threads";
import type { EventBus, BusEvent, PluginBusEvent, EventType, EventHandler } from "@workspace/event-bus";
import { isValidPlugin } from "@workspace/event-bus";
import type { Plugin, PluginContext } from "@workspace/event-bus";
import { logger } from "./logger.js";
import type { PluginMemory } from "@workspace/event-bus";
import type { InferOptions, InferResult } from "@workspace/event-bus";

type PluginEntry = {
  plugin: Plugin;
  enabled: boolean;
  status: "active" | "inactive" | "error" | "loading";
  errorMessage?: string;
  lastActivity?: Date;
};

type PluginRoute = { routeId: string; method: string; pattern: string };

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>();
  private workerMap = new Map<string, Worker>();
  private pluginRoutes = new Map<string, PluginRoute[]>();
  private bus: EventBus;
  private memory: PluginMemory | undefined;
  private inferFn: ((opts: InferOptions) => Promise<InferResult>) | undefined;

  constructor(bus: EventBus, opts?: { memory?: PluginMemory; infer?: (opts: InferOptions) => Promise<InferResult> }) {
    this.bus = bus;
    this.memory = opts?.memory;
    this.inferFn = opts?.infer;
  }

  async loadPluginsDir(): Promise<void> {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const candidateDirs = [
      path.resolve(__dirname, "plugins"),
      path.resolve(__dirname, "..", "plugins"),
      path.resolve(process.cwd(), "dist", "plugins"),
    ];

    let pluginsDir: string | undefined;
    for (const candidate of candidateDirs) {
      try {
        await access(candidate);
        pluginsDir = candidate;
        break;
      } catch {
        // try next
      }
    }

    if (!pluginsDir) {
      logger.warn({ candidateDirs }, "No plugins directory found — skipping plugin load");
      return;
    }

    logger.info({ pluginsDir }, "PluginRegistry: using plugins directory");

    let files: string[];
    try {
      files = await readdir(pluginsDir);
    } catch {
      logger.warn({ pluginsDir }, "Plugins directory not found or unreadable — skipping plugin load");
      return;
    }

    const pluginFiles = files.filter(
      (f) => (f.endsWith(".js") || f.endsWith(".mjs")) && !f.startsWith("_"),
    );

    for (const file of pluginFiles) {
      const fullPath = path.resolve(pluginsDir, file);
      await this.loadPlugin(fullPath);
    }
  }

  async loadPlugin(filePath: string): Promise<void> {
    let mod: unknown;
    try {
      mod = await import(filePath);
    } catch (err) {
      logger.error({ err, filePath }, "PluginRegistry: failed to import plugin file");
      return;
    }

    const exported = (mod as Record<string, unknown>)["default"] ?? mod;
    let instance: unknown;

    if (typeof exported === "function") {
      try {
        instance = new (exported as new () => unknown)();
      } catch (err) {
        logger.error({ err, filePath }, "PluginRegistry: failed to instantiate plugin");
        return;
      }
    } else {
      instance = exported;
    }

    if (!isValidPlugin(instance)) {
      logger.error(
        { filePath },
        "PluginRegistry: plugin does not implement required interface (init, on_event, execute, shutdown)",
      );
      return;
    }

    const plugin = instance;
    const entry: PluginEntry = { plugin, enabled: true, status: "loading" };
    this.plugins.set(plugin.id, entry);

    const context = this.buildContext(plugin);
    try {
      await plugin.init(context);
      entry.status = "active";
      entry.lastActivity = new Date();
      logger.info({ pluginId: plugin.id, name: plugin.name }, "PluginRegistry: plugin loaded successfully");
      this.bus.emit({
        source: "plugin-registry",
        target: null,
        type: "plugin.loaded",
        payload: { pluginId: plugin.id, name: plugin.name, version: plugin.version },
      });
    } catch (err) {
      entry.status = "error";
      entry.errorMessage = String(err);
      logger.error({ err, pluginId: plugin.id }, "PluginRegistry: plugin init failed");
      this.bus.emit({
        source: "plugin-registry",
        target: null,
        type: "plugin.error",
        payload: { pluginId: plugin.id, error: String(err) },
      });
    }
  }

  async loadCommunityPlugin(filePath: string, pluginId: string): Promise<boolean> {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const candidateWorkerPaths = [
      path.resolve(__dirname, "community-plugin-worker.mjs"),
      path.resolve(__dirname, "..", "community-plugin-worker.mjs"),
      path.resolve(process.cwd(), "dist", "community-plugin-worker.mjs"),
    ];

    let workerPath: string | undefined;
    for (const candidate of candidateWorkerPaths) {
      try {
        await access(candidate);
        workerPath = candidate;
        break;
      } catch {
        // try next
      }
    }

    if (!workerPath) {
      logger.error(
        { pluginId, candidateWorkerPaths },
        "PluginRegistry: community-plugin-worker.mjs not found — refusing to load community plugin without sandbox isolation",
      );
      return false;
    }

    logger.info({ pluginId, workerPath }, "PluginRegistry: spawning community plugin in worker sandbox");

    const worker = new Worker(workerPath, { workerData: { filePath } });

    const subscribedTypes = new Set<string>();
    const pendingExecutions = new Map<
      string,
      { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();

    return new Promise<boolean>((resolve) => {
      const initTimeout = setTimeout(() => {
        logger.error({ pluginId }, "PluginRegistry: community plugin worker init timeout");
        void worker.terminate();
        resolve(false);
      }, 30_000);

      let proxyPlugin: Plugin | null = null;
      let busSubscriptionId: string | null = null;

      const handleMessage = async (msg: Record<string, unknown>): Promise<void> => {
        switch (msg["type"]) {
          case "subscribe": {
            subscribedTypes.add(msg["eventType"] as string);
            break;
          }

          case "ready": {
            clearTimeout(initTimeout);

            const pluginIdFromWorker = msg["pluginId"] as string;
            if (pluginIdFromWorker !== pluginId) {
              logger.error(
                { expectedPluginId: pluginId, actualPluginId: pluginIdFromWorker },
                "PluginRegistry: community plugin identity mismatch — rejected to prevent ID spoofing",
              );
              void worker.terminate();
              resolve(false);
              break;
            }

            const name = msg["name"] as string;
            const version = msg["version"] as string;
            const description = msg["description"] as string;
            const category = msg["category"] as string;

            const self = this;

            const proxy = {
              id: pluginIdFromWorker,
              name,
              version,
              description,
              category,
              async init(_ctx: PluginContext): Promise<void> {
                // Already initialised in the worker — nothing to do
              },
              async on_event(_event: BusEvent): Promise<void> {
                // Events are forwarded via the bus subscription below
              },
              async execute(payload: unknown): Promise<unknown> {
                const execId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                return new Promise<unknown>((res, rej) => {
                  const timer = setTimeout(() => {
                    if (pendingExecutions.has(execId)) {
                      pendingExecutions.delete(execId);
                      rej(new Error("Community plugin execute timeout"));
                    }
                  }, 10_000);
                  pendingExecutions.set(execId, { resolve: res, reject: rej, timer });
                  worker.postMessage({ type: "execute", id: execId, payload });
                });
              },
              async shutdown(): Promise<void> {
                if (busSubscriptionId) {
                  self.bus.unsubscribe(busSubscriptionId);
                  busSubscriptionId = null;
                }
                worker.postMessage({ type: "shutdown" });
                await new Promise((r) => setTimeout(r, 1_500));
                await worker.terminate().catch(() => {});
              },
            } as unknown as Plugin;

            proxyPlugin = proxy;

            const entry: PluginEntry = {
              plugin: proxy,
              enabled: true,
              status: "active",
              lastActivity: new Date(),
            };
            this.plugins.set(pluginIdFromWorker, entry);
            this.workerMap.set(pluginIdFromWorker, worker);

            busSubscriptionId = this.bus.subscribe("*", (event: BusEvent) => {
              const pEntry = this.plugins.get(pluginIdFromWorker);
              if (!pEntry || !pEntry.enabled) return;
              if (subscribedTypes.has("*") || subscribedTypes.has(event.type)) {
                worker.postMessage({ type: "dispatch_event", event });
              }
            });

            logger.info(
              { pluginId: pluginIdFromWorker, name, version },
              "PluginRegistry: community plugin loaded in worker sandbox",
            );
            this.bus.emit({
              source: "plugin-registry",
              target: null,
              type: "plugin.loaded",
              payload: { pluginId: pluginIdFromWorker, name, version, sandboxed: true },
            });

            resolve(true);
            break;
          }

          case "emit": {
            const entry = proxyPlugin ? this.plugins.get(proxyPlugin.id) : null;
            if (entry) entry.lastActivity = new Date();
            try {
              this.bus.emitPlugin(msg["event"] as Omit<PluginBusEvent, "id" | "timestamp" | "version">);
            } catch (err) {
              logger.warn({ err, pluginId }, "PluginRegistry: sandboxed plugin emit rejected");
            }
            break;
          }

          case "log": {
            const level = (msg["level"] as string) === "error"
              ? "error"
              : (msg["level"] as string) === "warn"
              ? "warn"
              : "info";
            logger[level]({ pluginId }, `[community:${pluginId}] ${msg["msg"] as string}`);
            break;
          }

          case "route_register": {
            const route: PluginRoute = {
              routeId: msg["routeId"] as string,
              method: msg["method"] as string,
              pattern: msg["pattern"] as string,
            };
            const existing = this.pluginRoutes.get(pluginId) ?? [];
            if (!existing.find((r) => r.routeId === route.routeId)) existing.push(route);
            this.pluginRoutes.set(pluginId, existing);
            logger.info({ pluginId, method: route.method, pattern: route.pattern }, "PluginRegistry: community plugin registered HTTP sub-route");
            break;
          }

          case "execute_result": {
            const pending = pendingExecutions.get(msg["id"] as string);
            if (pending) {
              pendingExecutions.delete(msg["id"] as string);
              clearTimeout(pending.timer);
              pending.resolve(msg["result"]);
            }
            break;
          }

          case "rpc_request": {
            const rpcId = msg["id"] as string;
            const method = msg["method"] as string;
            const args = msg["args"];
            try {
              let result: unknown;
              if (method === "infer" && this.inferFn) {
                result = await this.inferFn(args as InferOptions);
              } else if (method === "memory.store" && this.memory) {
                result = await this.memory.store(args as Parameters<PluginMemory["store"]>[0]);
              } else if (method === "memory.search" && this.memory) {
                const a = args as { keyword: string; limit?: number };
                result = await this.memory.search(a.keyword, a.limit);
              } else if (method === "memory.getRecent" && this.memory) {
                const a = args as { limit?: number };
                result = await this.memory.getRecent(a.limit);
              } else if (method === "memory.getById" && this.memory) {
                const a = args as { id: string };
                result = await this.memory.getById(a.id);
              } else if (method === "memory.expire" && this.memory) {
                result = await this.memory.expire();
              } else {
                throw new Error(`Unknown RPC method or service unavailable: ${method}`);
              }
              worker.postMessage({ type: "rpc_response", id: rpcId, result });
            } catch (err) {
              worker.postMessage({ type: "rpc_response", id: rpcId, error: String(err) });
            }
            break;
          }

          case "load_error": {
            clearTimeout(initTimeout);
            logger.error(
              { pluginId, error: msg["error"] },
              "PluginRegistry: community plugin failed to load in worker",
            );
            this.bus.emit({
              source: "plugin-registry",
              target: null,
              type: "plugin.error",
              payload: { pluginId, error: msg["error"] },
            });
            void worker.terminate();
            resolve(false);
            break;
          }

          case "error": {
            logger.error({ pluginId, error: msg["error"] }, "PluginRegistry: community plugin runtime error");
            if (proxyPlugin) {
              const entry = this.plugins.get(proxyPlugin.id);
              if (entry) {
                entry.status = "error";
                entry.errorMessage = msg["error"] as string;
              }
            }
            break;
          }

          default:
            break;
        }
      };

      worker.on("message", (msg: Record<string, unknown>) => {
        void handleMessage(msg);
      });

      worker.on("error", (err) => {
        clearTimeout(initTimeout);
        logger.error({ err, pluginId }, "PluginRegistry: community plugin worker thread error");
        void worker.terminate();
        resolve(false);
      });

      worker.on("exit", (code) => {
        if (code !== 0 && proxyPlugin) {
          const entry = this.plugins.get(proxyPlugin.id);
          if (entry) {
            entry.status = "error";
            entry.errorMessage = `Worker exited with code ${code}`;
          }
          logger.warn({ pluginId: proxyPlugin.id, code }, "PluginRegistry: community plugin worker exited");
        }
        this.workerMap.delete(pluginId);
      });
    });
  }

  private buildContext(plugin: Plugin): PluginContext {
    return {
      emit: (event) => {
        this.plugins.get(plugin.id)!.lastActivity = new Date();
        this.bus.emit(event);
      },
      subscribe: (type: EventType | string, handler: EventHandler): string => {
        const wrappedHandler: EventHandler = async (event: BusEvent) => {
          const entry = this.plugins.get(plugin.id);
          if (!entry || !entry.enabled) return;
          try {
            await handler(event);
            entry.lastActivity = new Date();
          } catch (err) {
            entry.status = "error";
            entry.errorMessage = String(err);
            logger.error({ err, pluginId: plugin.id, eventType: event.type }, "Plugin on_event error");
          }
        };
        return this.bus.subscribe(type, wrappedHandler);
      },
      logger: {
        info: (msg, data) => logger.info({ pluginId: plugin.id, data }, msg),
        warn: (msg, data) => logger.warn({ pluginId: plugin.id, data }, msg),
        error: (msg, data) => logger.error({ pluginId: plugin.id, data }, msg),
      },
      memory: this.memory,
      infer: this.inferFn,
    };
  }

  async shutdownAll(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      try {
        await entry.plugin.shutdown();
        logger.info({ pluginId: id }, "PluginRegistry: plugin shutdown");
        this.bus.emit({
          source: "plugin-registry",
          target: null,
          type: "plugin.unloaded",
          payload: { pluginId: id },
        });
      } catch (err) {
        logger.error({ err, pluginId: id }, "PluginRegistry: plugin shutdown error");
      }
    }
    this.plugins.clear();
    for (const [id, worker] of this.workerMap) {
      try {
        await worker.terminate();
      } catch {
        // ignore
      }
      this.workerMap.delete(id);
    }
  }

  getPlugin(id: string): PluginEntry | undefined {
    return this.plugins.get(id);
  }

  listPlugins(): PluginEntry[] {
    return Array.from(this.plugins.values());
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.plugins.get(id);
    if (!entry) return false;
    entry.enabled = enabled;
    entry.status = enabled ? "active" : "inactive";
    this.bus.emit({
      source: "plugin-registry",
      target: null,
      type: "plugin.status_changed",
      payload: { pluginId: id, enabled },
    });
    return true;
  }

  getPluginRoutes(pluginId: string): PluginRoute[] {
    return this.pluginRoutes.get(pluginId) ?? [];
  }

  async dispatchPluginRoute(
    pluginId: string,
    routeId: string,
    request: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const worker = this.workerMap.get(pluginId);
    if (!worker) throw new Error(`No running worker for community plugin '${pluginId}'`);

    const requestId = randomUUID();
    const TIMEOUT_MS = 30_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.off("message", onMsg);
        reject(new Error(`Route dispatch timeout after ${TIMEOUT_MS}ms — plugin '${pluginId}', routeId '${routeId}'`));
      }, TIMEOUT_MS);

      const onMsg = (msg: Record<string, unknown>) => {
        if (msg["type"] === "route_response" && msg["requestId"] === requestId) {
          clearTimeout(timer);
          worker.off("message", onMsg);
          resolve({ status: (msg["status"] as number) ?? 200, body: msg["body"] });
        }
      };
      worker.on("message", onMsg);
      worker.postMessage({ type: "route_dispatch", routeId, requestId, request });
    });
  }

  async unloadPlugin(id: string): Promise<boolean> {
    const entry = this.plugins.get(id);
    if (!entry) return false;
    try {
      await entry.plugin.shutdown();
    } catch (err) {
      logger.error({ err, pluginId: id }, "PluginRegistry: shutdown error during unload");
    }
    this.plugins.delete(id);
    this.pluginRoutes.delete(id);

    const worker = this.workerMap.get(id);
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ignore
      }
      this.workerMap.delete(id);
    }

    this.bus.emit({
      source: "plugin-registry",
      target: null,
      type: "plugin.unloaded",
      payload: { pluginId: id },
    });
    logger.info({ pluginId: id }, "PluginRegistry: plugin unloaded");
    return true;
  }
}
