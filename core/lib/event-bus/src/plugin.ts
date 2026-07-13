import type { BusEvent, EventHandler, EventType } from "./types.js";

export type PluginLogger = {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
};

export type MemoryEntry = {
  id: string;
  type: "short_term" | "long_term";
  content: string;
  keywords: string[];
  source: string;
  createdAt: Date;
  expiresAt: Date | null;
};

export type MemoryStoreOptions = {
  type: "short_term" | "long_term";
  content: string;
  keywords?: string[];
  source: string;
  ttlSeconds?: number;
};

export type PluginMemory = {
  store: (opts: MemoryStoreOptions) => Promise<MemoryEntry>;
  search: (keyword: string, limit?: number) => Promise<MemoryEntry[]>;
  getRecent: (limit?: number) => Promise<MemoryEntry[]>;
  getById: (id: string) => Promise<MemoryEntry | null>;
  expire: () => Promise<number>;
};

export type InferOptions = {
  prompt: string;
  mode: "fast" | "deep" | "none";
  context?: Array<{ role: string; content: string }>;
  useCache?: boolean;
};

export type InferResult = {
  response: string;
  modelUsed: string;
  latencyMs: number;
  fromCache: boolean;
};

export type PluginContext = {
  emit: (event: Omit<BusEvent, "id" | "timestamp" | "version">) => void;
  subscribe: (type: EventType | string, handler: EventHandler) => string;
  logger: PluginLogger;
  memory?: PluginMemory;
  infer?: (opts: InferOptions) => Promise<InferResult>;
};

export abstract class Plugin {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly category: string;

  abstract init(context: PluginContext): Promise<void>;
  abstract on_event(event: BusEvent): Promise<void>;
  abstract execute(payload: unknown): Promise<unknown>;
  abstract shutdown(): Promise<void>;
}

export function isValidPlugin(obj: unknown): obj is Plugin {
  if (!obj || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p["id"] === "string" &&
    typeof p["name"] === "string" &&
    typeof p["version"] === "string" &&
    typeof p["description"] === "string" &&
    typeof p["category"] === "string" &&
    typeof p["init"] === "function" &&
    typeof p["on_event"] === "function" &&
    typeof p["execute"] === "function" &&
    typeof p["shutdown"] === "function"
  );
}
