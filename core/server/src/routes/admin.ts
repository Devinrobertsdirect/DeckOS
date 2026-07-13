import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { execSync, spawn } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import os from "os";
import { db } from "@workspace/db";
import {
  memoryEntriesTable,
  chatMessagesTable,
  voiceIdentityTable,
  userCognitiveModelTable,
  ucmSettingsTable,
  goalsTable,
  goalPlansTable,
  feedbackSignalsTable,
  behaviorProfileTable,
  predictionsTable,
  briefingsTable,
  notificationsTable,
  appConfigTable,
  aiPersonaTable,
} from "@workspace/db";
import { invalidateConfigCache } from "../lib/app-config.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const ADMIN_SECRET: string | undefined = process.env.ADMIN_SECRET;

function detectEnvironment(): "docker" | "bare-metal" {
  try {
    if (fs.existsSync("/.dockerenv")) return "docker";
    const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) return "docker";
  } catch {}
  return "bare-metal";
}

const RUNTIME_ENV = detectEnvironment();

type LogEntry = { line: string; stderr?: boolean };
type JobResult = { success: boolean; version?: string; error?: string; code?: number | null };
type Job = { status: "running" | "done"; log: LogEntry[]; result: JobResult | null };

let currentJob: Job | null = null;
const jobEmitter = new EventEmitter();
jobEmitter.setMaxListeners(50);

function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_SECRET) {
    res.status(503).json({
      error: "ADMIN_SECRET is not configured. Add it to your .env file (bare-metal) or docker-compose.yml environment section, then restart the server.",
      notConfigured: true,
    });
    return;
  }
  const provided = (req.headers["x-admin-token"] as string | undefined)
    ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!provided || provided !== ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid admin secret. Set ADMIN_SECRET in your .env / docker-compose.yml and enter the same value here." });
    return;
  }
  next();
}

function getVersion(): string {
  try {
    const v = execSync("git describe --tags --always 2>/dev/null", { encoding: "utf8" }).trim();
    if (!v) throw new Error("empty");
    return v.startsWith("v") ? v : `v${v}`;
  } catch {
    try {
      const pkgPath = path.resolve(process.cwd(), "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
      const v = pkg.version ?? "unknown";
      return v.startsWith("v") ? v : `v${v}`;
    } catch {
      return "unknown";
    }
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, "");
}

type ScriptSpec = { cmd: string; args: string[] };

function findUpdateScript(flags: string[]): ScriptSpec | null {
  const isWindows = os.platform() === "win32";
  const candidateDirs = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "../../../../"),
    path.resolve(__dirname, "../../../../../"),
  ];
  for (const dir of candidateDirs) {
    if (isWindows) {
      const ps1 = path.join(dir, "update.ps1");
      if (fs.existsSync(ps1)) {
        return { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, ...flags] };
      }
    }
    const sh = path.join(dir, "update.sh");
    if (fs.existsSync(sh)) {
      return { cmd: "bash", args: [sh, ...flags] };
    }
  }
  return null;
}

router.get("/admin/version", (_req, res) => {
  res.json({ version: getVersion(), adminConfigured: !!ADMIN_SECRET, environment: RUNTIME_ENV });
});

router.post("/admin/update", requireAdminSecret, (req, res) => {
  if (currentJob?.status === "running") {
    res.status(409).json({ error: "An update is already in progress. Connect to /api/admin/update/stream to watch it." });
    return;
  }

  const flags = RUNTIME_ENV === "docker" ? ["--docker", "--no-pull"] : ["--no-pull"];

  const spec = findUpdateScript(flags);
  if (!spec) {
    res.status(503).json({ error: "update.sh / update.ps1 not found — only available in a local installation." });
    return;
  }

  currentJob = { status: "running", log: [], result: null };
  jobEmitter.emit("reset");

  const child = spawn(spec.cmd, spec.args, {
    env: { ...process.env, TERM: "dumb" },
  });

  const pushLog = (entry: LogEntry) => {
    currentJob!.log.push(entry);
    jobEmitter.emit("log", entry);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of stripAnsi(chunk.toString()).split("\n")) {
      if (line.trim()) pushLog({ line });
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of stripAnsi(chunk.toString()).split("\n")) {
      if (line.trim()) pushLog({ line, stderr: true });
    }
  });

  child.on("close", (code) => {
    const version = getVersion();
    const result: JobResult = code === 0
      ? { success: true, version }
      : { success: false, code, version };
    currentJob!.status = "done";
    currentJob!.result = result;
    jobEmitter.emit("done", result);
  });

  child.on("error", (err) => {
    const result: JobResult = { success: false, error: err.message, version: getVersion() };
    currentJob!.status = "done";
    currentJob!.result = result;
    jobEmitter.emit("done", result);
  });

  res.status(202).json({ status: "started", streamUrl: "/api/admin/update/stream" });
});

router.get("/admin/update/stream", requireAdminSecret, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type: string, payload: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  if (!currentJob) {
    send("idle", { message: "No update in progress." });
    res.end();
    return;
  }

  send("start", { message: "Update in progress..." });
  for (const entry of currentJob.log) {
    send("log", entry as unknown as Record<string, unknown>);
  }

  if (currentJob.status === "done") {
    send("done", currentJob.result as unknown as Record<string, unknown>);
    res.end();
    return;
  }

  const onLog = (entry: LogEntry) => send("log", entry as unknown as Record<string, unknown>);
  const onDone = (result: JobResult) => {
    send("done", result as unknown as Record<string, unknown>);
    res.end();
  };

  jobEmitter.on("log", onLog);
  jobEmitter.once("done", onDone);

  req.on("close", () => {
    jobEmitter.off("log", onLog);
    jobEmitter.off("done", onDone);
  });
});

// ── POST /api/admin/reset-profile ─────────────────────────────────────────
// Purges all learned AI profile data: memories, chat history, persona,
// goals, behavior model, cognitive model, predictions, briefings.
// Does NOT touch: app_config, routines, devices, or secrets.

router.post("/admin/reset-profile", async (_req, res) => {
  try {
    await db.delete(memoryEntriesTable);
    await db.delete(chatMessagesTable);
    await db.delete(voiceIdentityTable);
    await db.delete(goalsTable);
    await db.delete(goalPlansTable);
    await db.delete(feedbackSignalsTable);
    await db.delete(behaviorProfileTable);
    await db.delete(predictionsTable);
    await db.delete(briefingsTable);
    await db.delete(notificationsTable);
    await db.delete(userCognitiveModelTable);
    await db.delete(ucmSettingsTable);
    await db.delete(aiPersonaTable);

    logger.info("ADMIN: Command profile purged — all AI memory, history, persona, goals cleared");
    res.json({
      ok: true,
      cleared: [
        "memory_entries",
        "chat_messages",
        "voice_identity",
        "ai_persona",
        "goals + goal_plans",
        "behavior_profile",
        "feedback_signals",
        "predictions",
        "briefings",
        "notifications",
        "user_cognitive_model",
        "ucm_settings",
      ],
      preserved: ["app_config (settings)", "routines", "devices", "secrets"],
    });
  } catch (err) {
    logger.error({ err }, "ADMIN: reset-profile failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/admin/reset-settings ────────────────────────────────────────
// Clears all app_config rows (model names, Ollama host, API URLs, etc.).
// API keys stored as env var secrets are NOT affected.
// Persona, memory, routines, and devices are NOT affected.

router.post("/admin/reset-settings", async (_req, res) => {
  try {
    await db.delete(appConfigTable);
    invalidateConfigCache();
    logger.info("ADMIN: App config reset to factory defaults");
    res.json({
      ok: true,
      cleared: ["app_config (model names, Ollama host, API URLs)"],
      preserved: ["secrets (env vars)", "memory", "persona", "routines", "devices"],
    });
  } catch (err) {
    logger.error({ err }, "ADMIN: reset-settings failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
