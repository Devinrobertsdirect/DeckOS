import os from "os";
import { logger } from "./logger.js";
import type { DeviceManager, DeviceCommand } from "./device-manager.js";

function randomFloat(min: number, max: number, decimals = 1): number {
  return (
    Math.round((Math.random() * (max - min) + min) * Math.pow(10, decimals)) /
    Math.pow(10, decimals)
  );
}

export class SimTempSensor {
  private interval: NodeJS.Timeout | null = null;
  private temperature = randomFloat(20, 30);
  private humidity = randomFloat(40, 70);
  private readonly deviceId = "sim-temp-sensor";

  constructor(private deviceManager: DeviceManager) {}

  start(intervalMs = 5000): void {
    this.deviceManager.register({
      id: this.deviceId,
      name: "Sim Temperature Sensor",
      category: "sensor",
      type: "sensor",
      protocol: "simulated",
      capabilities: ["temperature", "humidity", "alert"],
      location: "Simulation Bay",
    });

    this.deviceManager.registerCommandHandler(this.deviceId, (cmd: DeviceCommand) => {
      if (cmd.action === "reset") {
        this.temperature = randomFloat(20, 30);
        this.humidity = randomFloat(40, 70);
        logger.info({ deviceId: this.deviceId }, "SimTempSensor: reset");
      }
      if (cmd.action === "setTemperature" && cmd.parameters?.["value"] !== undefined) {
        this.temperature = Number(cmd.parameters["value"]);
      }
    });

    this.deviceManager.updateState(this.deviceId, { status: "online" });

    this.interval = setInterval(() => {
      this.temperature += randomFloat(-0.5, 0.5, 2);
      this.temperature = Math.max(15, Math.min(40, this.temperature));
      this.humidity += randomFloat(-1, 1, 1);
      this.humidity = Math.max(20, Math.min(95, this.humidity));

      const now = new Date().toISOString();
      this.deviceManager.updateState(this.deviceId, {
        status: "online",
        readings: [
          { sensor: "temperature", value: Math.round(this.temperature * 10) / 10, unit: "°C", timestamp: now },
          { sensor: "humidity", value: Math.round(this.humidity * 10) / 10, unit: "%", timestamp: now },
          { sensor: "heat_index", value: randomFloat(18, 38), unit: "°C", timestamp: now },
        ],
      });
    }, intervalMs);

    logger.info({ deviceId: this.deviceId, intervalMs }, "SimTempSensor: started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.deviceManager.setOffline(this.deviceId);
    logger.info({ deviceId: this.deviceId }, "SimTempSensor: stopped");
  }
}

export class SimRelayActuator {
  private interval: NodeJS.Timeout | null = null;
  private channels: boolean[] = [false, false, false, false];
  private powerDraw = 0;
  private readonly deviceId = "sim-relay-actuator";

  constructor(private deviceManager: DeviceManager) {}

  start(intervalMs = 3000): void {
    this.deviceManager.register({
      id: this.deviceId,
      name: "Sim Relay Actuator",
      category: "actuator",
      type: "actuator",
      protocol: "simulated",
      capabilities: ["on", "off", "toggle", "schedule"],
      location: "Control Panel",
    });

    this.deviceManager.registerCommandHandler(this.deviceId, (cmd: DeviceCommand) => {
      const ch = Number(cmd.parameters?.["channel"] ?? 0);
      if (cmd.action === "on" && ch >= 0 && ch < this.channels.length) {
        this.channels[ch] = true;
        logger.info({ deviceId: this.deviceId, channel: ch }, "SimRelayActuator: channel ON");
      } else if (cmd.action === "off" && ch >= 0 && ch < this.channels.length) {
        this.channels[ch] = false;
        logger.info({ deviceId: this.deviceId, channel: ch }, "SimRelayActuator: channel OFF");
      } else if (cmd.action === "toggle" && ch >= 0 && ch < this.channels.length) {
        this.channels[ch] = !this.channels[ch];
        logger.info({ deviceId: this.deviceId, channel: ch, state: this.channels[ch] }, "SimRelayActuator: channel TOGGLED");
      } else if (cmd.action === "all_off") {
        this.channels = [false, false, false, false];
      } else if (cmd.action === "all_on") {
        this.channels = [true, true, true, true];
      }
    });

    this.deviceManager.updateState(this.deviceId, { status: "online" });

    this.interval = setInterval(() => {
      const activeChannels = this.channels.filter(Boolean).length;
      this.powerDraw = activeChannels * randomFloat(20, 50);

      const now = new Date().toISOString();
      this.deviceManager.updateState(this.deviceId, {
        status: "online",
        readings: [
          { sensor: "channel_1", value: this.channels[0] ?? false, unit: null, timestamp: now },
          { sensor: "channel_2", value: this.channels[1] ?? false, unit: null, timestamp: now },
          { sensor: "channel_3", value: this.channels[2] ?? false, unit: null, timestamp: now },
          { sensor: "channel_4", value: this.channels[3] ?? false, unit: null, timestamp: now },
          { sensor: "power_draw", value: Math.round(this.powerDraw * 10) / 10, unit: "W", timestamp: now },
          { sensor: "active_channels", value: activeChannels, unit: null, timestamp: now },
        ],
      });
    }, intervalMs);

    logger.info({ deviceId: this.deviceId, intervalMs }, "SimRelayActuator: started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.deviceManager.setOffline(this.deviceId);
    logger.info({ deviceId: this.deviceId }, "SimRelayActuator: stopped");
  }
}

export class SimCpuSensor {
  private interval: NodeJS.Timeout | null = null;
  private readonly deviceId = "sim-cpu-sensor";

  constructor(private deviceManager: DeviceManager) {}

  start(intervalMs = 4000): void {
    this.deviceManager.register({
      id: this.deviceId,
      name: "Sim CPU Monitor",
      category: "sensor",
      type: "sensor",
      protocol: "simulated",
      capabilities: ["cpu_usage", "memory_usage", "load_average", "uptime"],
      location: "Host System",
    });

    this.deviceManager.registerCommandHandler(this.deviceId, (cmd: DeviceCommand) => {
      if (cmd.action === "ping") {
        logger.info({ deviceId: this.deviceId }, "SimCpuSensor: ping received");
      }
    });

    this.deviceManager.updateState(this.deviceId, { status: "online" });

    this.interval = setInterval(() => {
      const cpus = os.cpus();
      const cpuUsage =
        cpus.reduce((acc, cpu) => {
          const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
          const idle = cpu.times.idle;
          return acc + ((total - idle) / total) * 100;
        }, 0) / cpus.length;

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memUsagePct = (usedMem / totalMem) * 100;
      const load = os.loadavg();

      const now = new Date().toISOString();
      this.deviceManager.updateState(this.deviceId, {
        status: "online",
        readings: [
          { sensor: "cpu_usage_pct", value: Math.round(cpuUsage * 10) / 10, unit: "%", timestamp: now },
          { sensor: "cpu_cores", value: cpus.length, unit: null, timestamp: now },
          { sensor: "memory_used_mb", value: Math.round(usedMem / 1024 / 1024), unit: "MB", timestamp: now },
          { sensor: "memory_total_mb", value: Math.round(totalMem / 1024 / 1024), unit: "MB", timestamp: now },
          { sensor: "memory_usage_pct", value: Math.round(memUsagePct * 10) / 10, unit: "%", timestamp: now },
          { sensor: "load_avg_1m", value: Math.round((load[0] ?? 0) * 100) / 100, unit: null, timestamp: now },
          { sensor: "uptime_s", value: Math.floor(os.uptime()), unit: "s", timestamp: now },
        ],
      });
    }, intervalMs);

    logger.info({ deviceId: this.deviceId, intervalMs }, "SimCpuSensor: started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.deviceManager.setOffline(this.deviceId);
    logger.info({ deviceId: this.deviceId }, "SimCpuSensor: stopped");
  }
}

export function startSimulatedDevices(deviceManager: DeviceManager): () => void {
  const temp = new SimTempSensor(deviceManager);
  const relay = new SimRelayActuator(deviceManager);
  const cpu = new SimCpuSensor(deviceManager);

  temp.start(5000);
  relay.start(3000);
  cpu.start(4000);

  logger.info("SimulatedDevices: all three simulated devices started");

  return () => {
    temp.stop();
    relay.stop();
    cpu.stop();
  };
}
