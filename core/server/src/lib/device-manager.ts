import { randomUUID } from "crypto";
import { EventBus } from "@workspace/event-bus";
import { logger } from "./logger.js";
import { db, deviceReadingsTable } from "@workspace/db";

export type DeviceCategory = "sensor" | "actuator" | "hybrid";
export type DeviceProtocol = "mqtt" | "websocket" | "simulated";
export type DeviceConnectionStatus = "online" | "offline" | "error" | "standby";

export interface DeviceReading {
  sensor: string;
  value: number | string | boolean;
  unit: string | null;
  timestamp: string;
}

export interface DeviceState {
  status: DeviceConnectionStatus;
  readings: DeviceReading[];
  lastSeen: string | null;
  metadata: Record<string, unknown>;
}

export interface DeviceDescriptor {
  id: string;
  name: string;
  category: DeviceCategory;
  type: "sensor" | "actuator" | "display" | "network" | "simulated";
  protocol: DeviceProtocol;
  capabilities: string[];
  location: string | null;
}

export interface RegisteredDevice extends DeviceDescriptor {
  state: DeviceState;
  history: DeviceReading[][];
}

export interface DeviceCommand {
  action: string;
  parameters?: Record<string, unknown>;
}

export type CommandHandler = (command: DeviceCommand) => Promise<void> | void;

export class DeviceManager {
  private registry: Map<string, RegisteredDevice> = new Map();
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private maxHistoryPerDevice = 50;

  constructor(private bus: EventBus) {
    this.bus.subscribe("device.command.send", async (event) => {
      const p = event.payload as Record<string, unknown>;
      const deviceId = String(p?.deviceId ?? "");
      if (!deviceId) return;

      const handler = this.commandHandlers.get(deviceId);
      if (handler) {
        try {
          await handler({ action: String(p.action ?? ""), parameters: p.parameters as Record<string, unknown> | undefined });
          this.bus.emit({
            source: "device-manager",
            target: null,
            type: "device.command.ack",
            payload: { deviceId, action: p.action, success: true, commandId: randomUUID() },
          });
        } catch (err) {
          this.bus.emit({
            source: "device-manager",
            target: null,
            type: "device.error",
            payload: { deviceId, action: p.action, error: String(err) },
          });
        }
      }
    });
  }

  register(descriptor: DeviceDescriptor): RegisteredDevice {
    const existing = this.registry.get(descriptor.id);
    if (existing) return existing;

    const device: RegisteredDevice = {
      ...descriptor,
      state: {
        status: "offline",
        readings: [],
        lastSeen: null,
        metadata: {},
      },
      history: [],
    };
    this.registry.set(descriptor.id, device);

    this.bus.emit({
      source: "device-manager",
      target: null,
      type: "device.connected",
      payload: { deviceId: descriptor.id, name: descriptor.name, protocol: descriptor.protocol },
    });

    logger.info({ deviceId: descriptor.id, name: descriptor.name }, "DeviceManager: device registered");
    return device;
  }

  registerCommandHandler(deviceId: string, handler: CommandHandler): void {
    this.commandHandlers.set(deviceId, handler);
  }

  private recordTelemetry(deviceId: string, readings: DeviceReading[]): void {
    if (readings.length === 0) return;
    const rows = readings.map((r) => ({
      deviceId,
      sensor: r.sensor,
      value:  String(r.value),
      unit:   r.unit ?? null,
    }));
    db.insert(deviceReadingsTable).values(rows).catch((err) => {
      logger.warn({ err, deviceId }, "DeviceManager: failed to persist readings to DB");
    });
  }

  updateState(deviceId: string, partialState: Partial<DeviceState>): void {
    const device = this.registry.get(deviceId);
    if (!device) {
      logger.warn({ deviceId }, "DeviceManager: updateState called for unknown device");
      return;
    }

    const prevStatus = device.state.status;
    device.state = { ...device.state, ...partialState, lastSeen: new Date().toISOString() };

    if (partialState.readings && partialState.readings.length > 0) {
      device.history.push([...partialState.readings]);
      if (device.history.length > this.maxHistoryPerDevice) {
        device.history.shift();
      }
      this.recordTelemetry(deviceId, partialState.readings);
    }

    this.bus.emit({
      source: device.id,
      target: null,
      type: "device.state.changed",
      payload: {
        deviceId,
        prevStatus,
        newStatus: device.state.status,
        readings: device.state.readings,
        metadata: device.state.metadata,
      },
    });
  }

  sendCommand(deviceId: string, command: DeviceCommand): boolean {
    const device = this.registry.get(deviceId);
    if (!device) {
      logger.warn({ deviceId }, "DeviceManager: sendCommand for unknown device");
      return false;
    }

    this.bus.emit({
      source: "api",
      target: deviceId,
      type: "device.command.send",
      payload: { deviceId, action: command.action, parameters: command.parameters },
    });

    return true;
  }

  getDevice(deviceId: string): RegisteredDevice | undefined {
    return this.registry.get(deviceId);
  }

  listDevices(): RegisteredDevice[] {
    return Array.from(this.registry.values());
  }

  getHistory(deviceId: string): DeviceReading[][] {
    return this.registry.get(deviceId)?.history ?? [];
  }

  setOffline(deviceId: string): void {
    const device = this.registry.get(deviceId);
    if (!device) return;
    device.state.status = "offline";

    this.bus.emit({
      source: "device-manager",
      target: null,
      type: "device.disconnected",
      payload: { deviceId, name: device.name },
    });
  }
}

let _deviceManager: DeviceManager | null = null;

export function createDeviceManager(bus: EventBus): DeviceManager {
  _deviceManager = new DeviceManager(bus);
  return _deviceManager;
}

export function getDeviceManager(): DeviceManager {
  if (!_deviceManager) {
    throw new Error("DeviceManager not initialized — call createDeviceManager first");
  }
  return _deviceManager;
}
