import os from "os";
import { statfs } from "fs/promises";
import { Plugin } from "@workspace/event-bus";
import type { PluginContext, BusEvent } from "@workspace/event-bus";
import { db, userCognitiveModelTable } from "@workspace/db";

const DEFAULT_POLL_INTERVAL_MS  = 4_000;
const MEMORY_SNAPSHOT_INTERVAL  = 12;
const DEFAULT_CPU_ALERT_PCT     = 80;
const DEFAULT_MEM_ALERT_PCT     = 90;

type CpuSnapshot = { idle: number; total: number };

function getCpuSnapshot(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function calcCpuDelta(prev: CpuSnapshot, curr: CpuSnapshot): number {
  const idleDelta = curr.idle - prev.idle;
  const totalDelta = curr.total - prev.total;
  if (totalDelta === 0) return 0;
  return parseFloat((100 - (100 * idleDelta) / totalDelta).toFixed(2));
}

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const summary: Array<{
    name: string;
    addresses: Array<{ address: string; family: string }>;
  }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    const addresses = addrs.map((a) => ({ address: a.address, family: a.family }));
    summary.push({ name, addresses });
  }

  return {
    interfaces: summary,
    interfaceCount: summary.length,
  };
}

async function getDiskInfo(path = "/") {
  try {
    const stats = await statfs(path);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    return {
      path,
      total,
      free,
      used,
      percentage: parseFloat(((used / total) * 100).toFixed(2)),
    };
  } catch {
    return { path, total: 0, free: 0, used: 0, percentage: 0 };
  }
}

async function getMetrics(cpuUsage: number) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const [disk, network] = await Promise.all([getDiskInfo("/"), Promise.resolve(getNetworkInfo())]);

  return {
    cpu: {
      usage: cpuUsage,
      cores: os.cpus().length,
      model: os.cpus()[0]?.model ?? "unknown",
      loadAverage: os.loadavg(),
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage: parseFloat(((usedMem / totalMem) * 100).toFixed(2)),
    },
    disk,
    network,
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
  };
}

export default class SystemMonitorPlugin extends Plugin {
  readonly id = "system_monitor";
  readonly name = "System Monitor";
  readonly version = "1.2.0";
  readonly description = "Real-time CPU, memory, disk, and network monitoring";
  readonly category = "monitoring";

  private ctx!: PluginContext;
  private timer: NodeJS.Timeout | null = null;
  private pollCount = 0;
  private pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS;
  private prevCpuSnapshot: CpuSnapshot = getCpuSnapshot();
  private cpuThreshold = DEFAULT_CPU_ALERT_PCT;
  private memThreshold = DEFAULT_MEM_ALERT_PCT;
  private cpuAlerted = false;
  private memAlerted = false;

  async init(context: PluginContext): Promise<void> {
    this.ctx = context;

    const configuredInterval = parseInt(process.env["SYSTEM_MONITOR_INTERVAL_MS"] ?? "", 10);
    if (!isNaN(configuredInterval) && configuredInterval >= 1000) {
      this.pollIntervalMs = configuredInterval;
    }

    const cpuThr = parseFloat(process.env["CPU_ALERT_THRESHOLD"] ?? "");
    if (!isNaN(cpuThr) && cpuThr > 0 && cpuThr <= 100) this.cpuThreshold = cpuThr;
    const memThr = parseFloat(process.env["MEM_ALERT_THRESHOLD"] ?? "");
    if (!isNaN(memThr) && memThr > 0 && memThr <= 100) this.memThreshold = memThr;

    context.subscribe("system.monitor.request", async (event: BusEvent) => {
      if (event.type !== "system.monitor.request") return;
      const curr = getCpuSnapshot();
      const cpuUsage = calcCpuDelta(this.prevCpuSnapshot, curr);
      this.prevCpuSnapshot = curr;
      const metrics = await getMetrics(cpuUsage);
      context.emit({
        source: this.id,
        target: (event.payload as Record<string, unknown>)?.replyTo as string ?? event.source,
        type: "system.monitor.metrics",
        payload: metrics,
      });
    });

    this.timer = setInterval(async () => {
      this.pollCount++;
      const curr = getCpuSnapshot();
      const cpuUsage = calcCpuDelta(this.prevCpuSnapshot, curr);
      this.prevCpuSnapshot = curr;

      const metrics = await getMetrics(cpuUsage);

      context.emit({
        source: this.id,
        target: null,
        type: "system.monitor.metrics",
        payload: metrics,
      });

      const { cpu: liveCpuThr, mem: liveMemThr } = await this.readLiveThresholds();
      this.checkThresholds(metrics.cpu.usage, metrics.memory.percentage, context, liveCpuThr, liveMemThr);

      if (this.pollCount % MEMORY_SNAPSHOT_INTERVAL === 0 && context.memory) {
        const summary = `CPU: ${metrics.cpu.usage}% (load: ${metrics.cpu.loadAverage[0].toFixed(2)}), Memory: ${metrics.memory.percentage}% used (${Math.round(metrics.memory.used / 1024 / 1024)}MB / ${Math.round(metrics.memory.total / 1024 / 1024)}MB), Disk: ${metrics.disk.percentage}% used, Network: ${metrics.network.interfaceCount} interfaces, Uptime: ${Math.floor(metrics.uptime / 3600)}h`;
        await context.memory.store({
          type: "long_term",
          content: summary,
          keywords: ["cpu", "memory", "disk", "network", "metrics", "snapshot", "system"],
          source: this.id,
        }).catch(() => {});
      }
    }, this.pollIntervalMs);

    context.logger.info("System monitor started", {
      pollIntervalMs: this.pollIntervalMs,
      configurable: "SYSTEM_MONITOR_INTERVAL_MS env var (min: 1000ms)",
      cpuAlertThreshold: `${this.cpuThreshold}% (env: CPU_ALERT_THRESHOLD)`,
      memAlertThreshold: `${this.memThreshold}% (env: MEM_ALERT_THRESHOLD)`,
    });
  }

  private async readLiveThresholds(): Promise<{ cpu: number; mem: number }> {
    try {
      const rows = await db.select().from(userCognitiveModelTable).limit(1);
      const prefs = (rows[0]?.preferences ?? {}) as Record<string, unknown>;
      const cpu = typeof prefs["cpuAlertThreshold"] === "number" ? prefs["cpuAlertThreshold"] : this.cpuThreshold;
      const mem = typeof prefs["memAlertThreshold"] === "number" ? prefs["memAlertThreshold"] : this.memThreshold;
      return { cpu, mem };
    } catch {
      return { cpu: this.cpuThreshold, mem: this.memThreshold };
    }
  }

  private checkThresholds(cpu: number, mem: number, context: PluginContext, cpuThr: number, memThr: number): void {
    if (cpu > cpuThr && !this.cpuAlerted) {
      this.cpuAlerted = true;
      context.emit({
        source: this.id,
        target: null,
        type: "system.resource.alert",
        payload: {
          resource: "cpu",
          value: cpu,
          threshold: cpuThr,
          message: `CPU usage at ${cpu.toFixed(1)}% — exceeds ${cpuThr}% threshold`,
        },
      });
    } else if (cpu <= cpuThr && this.cpuAlerted) {
      this.cpuAlerted = false;
      context.emit({
        source: this.id,
        target: null,
        type: "system.resource.clear",
        payload: { resource: "cpu", value: cpu, threshold: cpuThr },
      });
    }

    if (mem > memThr && !this.memAlerted) {
      this.memAlerted = true;
      context.emit({
        source: this.id,
        target: null,
        type: "system.resource.alert",
        payload: {
          resource: "memory",
          value: mem,
          threshold: memThr,
          message: `Memory usage at ${mem.toFixed(1)}% — exceeds ${memThr}% threshold`,
        },
      });
    } else if (mem <= memThr && this.memAlerted) {
      this.memAlerted = false;
      context.emit({
        source: this.id,
        target: null,
        type: "system.resource.clear",
        payload: { resource: "memory", value: mem, threshold: memThr },
      });
    }
  }

  async on_event(_event: BusEvent): Promise<void> {
    // Requests handled via context.subscribe() in init(); no duplicate handling here.
  }

  async execute(payload: unknown): Promise<unknown> {
    const p = payload as Record<string, unknown> | null;
    const command = p?.command as string | undefined;

    const curr = getCpuSnapshot();
    const cpuUsage = calcCpuDelta(this.prevCpuSnapshot, curr);
    this.prevCpuSnapshot = curr;
    const metrics = await getMetrics(cpuUsage);

    if (command === "stats" || !command) {
      return metrics;
    }
    if (command === "disk") {
      return metrics.disk;
    }
    if (command === "network") {
      return metrics.network;
    }

    return metrics;
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ctx?.logger.info("System monitor stopped");
  }
}
