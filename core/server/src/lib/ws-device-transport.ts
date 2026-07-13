import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { EventBus } from "@workspace/event-bus";
import { logger } from "./logger.js";
import type { DeviceManager, DeviceReading } from "./device-manager.js";

interface DeviceWsMessage {
  type: "register" | "state" | "reading" | "ack";
  deviceId?: string;
  name?: string;
  deviceType?: "sensor" | "actuator" | "display" | "network" | "simulated";
  capabilities?: string[];
  location?: string;
  readings?: DeviceReading[];
  status?: string;
  payload?: Record<string, unknown>;
}

export class WsDeviceTransport {
  private wss: WebSocketServer;
  private deviceSockets: Map<string, WebSocket> = new Map();

  constructor(
    port: number,
    private bus: EventBus,
    private deviceManager: DeviceManager,
  ) {
    this.wss = new WebSocketServer({ port, path: "/devices/ws" });
    this.setup();
    logger.info({ port, path: "/devices/ws" }, "WsDeviceTransport: WebSocket device server listening");
  }

  private setup(): void {
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const remote = req.socket.remoteAddress ?? "unknown";
      logger.info({ remote }, "WsDeviceTransport: device connected");

      let registeredDeviceId: string | null = null;

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as DeviceWsMessage;

          if (msg.type === "register" && msg.deviceId) {
            registeredDeviceId = msg.deviceId;
            this.deviceSockets.set(msg.deviceId, ws);
            logger.info({ deviceId: msg.deviceId }, "WsDeviceTransport: device registered via WS");

            let device = this.deviceManager.getDevice(msg.deviceId);
            if (!device) {
              const autoType = msg.deviceType ?? "sensor";
              device = this.deviceManager.register({
                id: msg.deviceId,
                name: msg.name ?? `ws-device-${msg.deviceId}`,
                category: autoType === "actuator" ? "actuator" : "sensor",
                type: autoType,
                protocol: "websocket",
                capabilities: msg.capabilities ?? [],
                location: msg.location ?? null,
              });
              logger.info({ deviceId: msg.deviceId }, "WsDeviceTransport: auto-registered new WS device");
            }

            this.deviceManager.updateState(msg.deviceId, { status: "online" });

            this.bus.emit({
              source: `ws-device:${msg.deviceId}`,
              target: null,
              type: "device.connected",
              payload: { deviceId: msg.deviceId, transport: "websocket", remote },
            });

            ws.send(JSON.stringify({ type: "ack", deviceId: msg.deviceId, status: "registered" }));
            return;
          }

          if ((msg.type === "state" || msg.type === "reading") && registeredDeviceId) {
            const readings = msg.readings ?? [];
            this.deviceManager.updateState(registeredDeviceId, {
              status: "online",
              readings,
            });

            if (msg.type === "reading") {
              this.bus.emit({
                source: `ws-device:${registeredDeviceId}`,
                target: null,
                type: "device.reading",
                payload: { deviceId: registeredDeviceId, readings },
              });
            }
          }
        } catch (err) {
          logger.warn({ err }, "WsDeviceTransport: failed to parse message");
        }
      });

      ws.on("close", () => {
        if (registeredDeviceId) {
          logger.info({ deviceId: registeredDeviceId }, "WsDeviceTransport: device disconnected");
          this.deviceSockets.delete(registeredDeviceId);
          this.deviceManager.setOffline(registeredDeviceId);
        }
      });

      ws.on("error", (err: Error) => {
        logger.error({ err, deviceId: registeredDeviceId }, "WsDeviceTransport: WS error");
      });
    });

    this.bus.subscribe("device.command.send", (event) => {
      const p = event.payload as Record<string, unknown>;
      const deviceId = String(p?.deviceId ?? "");
      const ws = this.deviceSockets.get(deviceId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "command", action: p.action, parameters: p.parameters }));
        logger.debug({ deviceId }, "WsDeviceTransport: forwarded command to device WS");
      }
    });
  }

  stop(): void {
    this.wss.close();
    logger.info("WsDeviceTransport: WebSocket device server stopped");
  }
}
