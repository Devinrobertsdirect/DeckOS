import { EventBus } from "@workspace/event-bus";
import { logger } from "./logger.js";
import type { DeviceManager, DeviceReading } from "./device-manager.js";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export class MqttTransport {
  private client: import("mqtt").MqttClient | null = null;
  private reconnectAttempts = 0;
  private shuttingDown = false;
  private brokerUrl: string;
  private brokerUser: string | undefined;
  private brokerPass: string | undefined;

  constructor(
    private bus: EventBus,
    private deviceManager: DeviceManager,
  ) {
    this.brokerUrl  = MqttTransport.normalizeBrokerUrl(process.env["MQTT_BROKER_URL"] ?? "");
    this.brokerUser = process.env["MQTT_BROKER_USER"] || undefined;
    this.brokerPass = process.env["MQTT_BROKER_PASS"] || undefined;

    this.bus.subscribe("device.command.send", (event) => {
      const p = event.payload as Record<string, unknown>;
      if (p?.deviceId && this.client?.connected) {
        const deviceId = String(p.deviceId);
        const device = this.deviceManager.getDevice(deviceId);
        if (device && (device.protocol === "mqtt" || device.protocol === "simulated")) {
          const msg = JSON.stringify({ action: p.action, parameters: p.parameters });

          // Publish on both topic schemes for maximum hardware compatibility
          const standardTopic = `devices/${deviceId}/command`;
          const jarvisTopic = `jarvis/device/${deviceId}/command`;
          this.client.publish(standardTopic, msg, { qos: 1 });
          this.client.publish(jarvisTopic, msg, { qos: 1 });

          logger.debug({ deviceId, standardTopic, jarvisTopic }, "MqttTransport: published command");
        }
      }
    });
  }

  private static normalizeBrokerUrl(raw: string): string {
    if (!raw) return raw;
    if (/^[a-z]+:\/\//i.test(raw)) return raw;
    return `mqtts://${raw}`;
  }

  async start(): Promise<void> {
    if (!this.brokerUrl) {
      logger.info(
        "MqttTransport: MQTT_BROKER_URL secret not set — running in simulation-only mode. " +
        "Set MQTT_BROKER_URL in Replit Secrets to enable real hardware connectivity.",
      );
      return;
    }

    const scheme = this.brokerUrl.split("://")[0] ?? "mqtt";
    const hostPart = (this.brokerUrl.split("://")[1] ?? "").replace(/^[^@]+@/, "***@").split("/")[0];
    logger.info(
      {
        broker: `${scheme}://${hostPart}`,
        hasUser: !!this.brokerUser,
        hasPass: !!this.brokerPass,
      },
      "MqttTransport: MQTT_BROKER_URL secret found — connecting to broker",
    );
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      const mqtt = await import("mqtt");
      this.client = mqtt.connect(this.brokerUrl, {
        clientId: `jarvis-deck-os-${Date.now()}`,
        reconnectPeriod: 0,
        connectTimeout: 10_000,
        ...(this.brokerUser ? { username: this.brokerUser } : {}),
        ...(this.brokerPass ? { password: this.brokerPass } : {}),
      });

      this.client.on("connect", () => {
        this.reconnectAttempts = 0;
        // Log only the safe parts of the URL (scheme + host) — never log credentials
        const safeUrl = this.brokerUrl.replace(/\/\/[^@]+@/, "//***@");
        logger.info({ brokerUrl: safeUrl }, "MqttTransport: connected to MQTT broker");

        const subscriptions = [
          "jarvis/#",
          "devices/+/telemetry",
          "devices/+/status",
        ];

        for (const topic of subscriptions) {
          this.client!.subscribe(topic, { qos: 1 }, (err) => {
            if (err) {
              logger.error({ err, topic }, "MqttTransport: failed to subscribe");
            } else {
              logger.info({ topic }, "MqttTransport: subscribed");
            }
          });
        }

        this.bus.emit({
          source: "mqtt-transport",
          target: null,
          type: "device.connected",
          payload: { transport: "mqtt", brokerUrl: this.brokerUrl },
        });
      });

      this.client.on("message", (topic: string, payload: Buffer) => {
        this.handleIncomingMessage(topic, payload);
      });

      this.client.on("error", (err: Error & { code?: number }) => {
        const isAuthError = err.code === 5 || err.message?.includes("Not authorized") || err.message?.includes("Bad User Name");
        if (isAuthError) {
          logger.error(
            { err },
            "MqttTransport: authentication rejected — check MQTT_BROKER_USER and MQTT_BROKER_PASS secrets in Replit, then restart the server",
          );
          this.shuttingDown = true;
        } else {
          logger.error({ err }, "MqttTransport: MQTT error");
        }
        this.bus.emit({
          source: "mqtt-transport",
          target: null,
          type: "device.error",
          payload: { transport: "mqtt", error: err.message },
        });
      });

      this.client.on("close", () => {
        if (!this.shuttingDown) {
          logger.warn("MqttTransport: connection closed, scheduling reconnect");
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      logger.error({ err }, "MqttTransport: failed to connect");
      this.scheduleReconnect();
    }
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    const parts = topic.split("/");
    const rawText = payload.toString().trim();

    // ── Plain-text status shorthand ──────────────────────────────────────────
    // Some hardware publishes a bare string like "online", "offline", or
    // "connected" to devices/:id/status instead of a JSON object.
    if (parts[0] === "devices" && parts[2] === "status" && parts[1]) {
      const STATUS_MAP: Record<string, "online" | "offline" | "error" | "standby"> = {
        online: "online",
        connected: "online",
        up: "online",
        active: "online",
        offline: "offline",
        disconnected: "offline",
        down: "offline",
        inactive: "offline",
        error: "error",
        fault: "error",
        standby: "standby",
        idle: "standby",
        sleep: "standby",
      };
      const mapped = STATUS_MAP[rawText.toLowerCase()];
      if (mapped) {
        const deviceId = parts[1];
        this.ensureDevice(deviceId, {});
        this.deviceManager.updateState(deviceId, { status: mapped });
        return;
      }
    }

    // Parse JSON — keep this try/catch narrow so that only SyntaxErrors from
    // JSON.parse are suppressed. Real errors in message processing below will
    // still surface at their natural log level.
    // Non-JSON payloads (e.g. plain-text "online"/"offline" published by
    // third-party devices on the shared broker) are silently dropped here;
    // the plain-text status shorthand handler above already covers the
    // actionable cases on devices/+/status topics before we reach JSON.parse.
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      logger.debug({ topic }, "MqttTransport: ignoring non-JSON message");
      return;
    }

    // ── Standard topic scheme: devices/:id/telemetry ─────────────────────
    // Hardware publishes readings here. Payload may be:
    //   { sensor, value, unit } | { readings: [...] } | flat key/value map
    if (parts[0] === "devices" && parts[2] === "telemetry" && parts[1]) {
      const deviceId = parts[1];
      this.ensureDevice(deviceId, data);

      const readings = this.extractReadings(data);
      if (readings.length > 0) {
        this.deviceManager.updateState(deviceId, { status: "online", readings });
      }
      return;
    }

    // ── Standard topic scheme: devices/:id/status ────────────────────────
    // Hardware publishes its connection status here.
    // Payload: { status: "online"|"offline"|"error"|"standby", ... }
    if (parts[0] === "devices" && parts[2] === "status" && parts[1]) {
      const deviceId = parts[1];
      this.ensureDevice(deviceId, data);

      const rawStatus = typeof data["status"] === "string" ? data["status"] : "online";
      const status = (["online", "offline", "error", "standby"] as const).includes(
        rawStatus as "online" | "offline" | "error" | "standby"
      )
        ? (rawStatus as "online" | "offline" | "error" | "standby")
        : "online";

      this.deviceManager.updateState(deviceId, { status });
      return;
    }

    // ── Legacy / jarvis topic scheme: jarvis/device/:id/state ────────────
    if (parts[0] === "jarvis" && parts[1] === "device" && parts[2] && parts[3] === "state") {
      const deviceId = parts[2];
      this.ensureDevice(deviceId, data);

      const readings = Array.isArray(data["readings"]) ? data["readings"] as DeviceReading[] : [];
      this.deviceManager.updateState(deviceId, { status: "online", readings });
      return;
    }

    // ── System heartbeat ─────────────────────────────────────────────────
    if (parts[0] === "jarvis" && parts[1] === "system" && parts[2] === "broadcast") {
      this.bus.emit({
        source: "mqtt-transport",
        target: null,
        type: "system.heartbeat",
        payload: data,
      });
      return;
    }

    // ── Generic fallback ─────────────────────────────────────────────────
    this.bus.emit({
      source: "mqtt-transport",
      target: null,
      type: "device.reading",
      payload: { topic, data },
    });
  }

  /**
   * Ensure a device is registered. Auto-registers if unknown.
   */
  private ensureDevice(deviceId: string, data: Record<string, unknown>): void {
    if (!this.deviceManager.getDevice(deviceId)) {
      const autoName = (data["name"] as string | undefined) ?? `mqtt-device-${deviceId}`;
      const rawType = data["type"] as string | undefined;
      const autoType = (["sensor", "actuator", "display", "network", "simulated"].includes(rawType ?? "")
        ? rawType
        : "sensor") as "sensor" | "actuator" | "display" | "network" | "simulated";

      this.deviceManager.register({
        id: deviceId,
        name: autoName,
        category: autoType === "actuator" ? "actuator" : "sensor",
        type: autoType,
        protocol: "mqtt",
        capabilities: Array.isArray(data["capabilities"])
          ? (data["capabilities"] as string[])
          : [],
        location: (data["location"] as string | undefined) ?? null,
      });

      logger.info({ deviceId, autoName }, "MqttTransport: auto-registered new MQTT device");
    }
  }

  /**
   * Extract DeviceReading[] from various telemetry payload shapes:
   *   1. { readings: [ { sensor, value, unit, timestamp } ] }
   *   2. { sensor, value, unit }
   *   3. Flat map: { temperature: 22.5, humidity: 60 }
   */
  private extractReadings(data: Record<string, unknown>): DeviceReading[] {
    const now = new Date().toISOString();

    if (Array.isArray(data["readings"])) {
      return (data["readings"] as DeviceReading[]).map((r) => ({
        sensor: String(r.sensor ?? "unknown"),
        value: r.value ?? 0,
        unit: r.unit ?? null,
        timestamp: r.timestamp ?? now,
      }));
    }

    if (typeof data["sensor"] === "string") {
      return [
        {
          sensor: data["sensor"] as string,
          value: (data["value"] as number | string | boolean) ?? 0,
          unit: (data["unit"] as string | null) ?? null,
          timestamp: (data["timestamp"] as string | undefined) ?? now,
        },
      ];
    }

    const SKIP = new Set(["name", "type", "capabilities", "location", "timestamp", "status"]);
    const readings: DeviceReading[] = [];
    for (const [key, val] of Object.entries(data)) {
      if (SKIP.has(key)) continue;
      if (typeof val === "number" || typeof val === "string" || typeof val === "boolean") {
        readings.push({ sensor: key, value: val, unit: null, timestamp: now });
      }
    }
    return readings;
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    logger.info({ delay, attempt: this.reconnectAttempts }, "MqttTransport: reconnecting in ms");
    setTimeout(() => void this.connect(), delay);
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.client) {
      await new Promise<void>((resolve) => {
        this.client!.end(true, {}, () => resolve());
      });
      this.client = null;
    }
  }
}
