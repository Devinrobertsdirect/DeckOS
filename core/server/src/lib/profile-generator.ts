export interface DeviceProfileSuggestion {
  displayName:  string;
  icon:         string;
  description:  string;
  eventSchema:  Record<string, unknown>;
  controlStubs: ControlStub[];
}

export interface ControlStub {
  action:      string;
  label:       string;
  description: string;
  params:      Record<string, unknown>;
  example?:    string;
}

function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

export function generateDeviceProfile(device: {
  id:           string;
  name:         string;
  type:         string;
  category:     string;
  protocol:     string;
  capabilities: string[];
}): DeviceProfileSuggestion {
  const sid = shortId(device.id);

  // ── Mobile browser (phone-as-tracker) ────────────────────────────────────
  if (device.protocol === "websocket" || device.type === "mobile_browser") {
    return {
      displayName: `MOBILE-${sid}`,
      icon: "smartphone",
      description: "Mobile browser providing GPS location, battery, and network telemetry in real-time via WebSocket.",
      eventSchema: {
        event: "device.reading",
        sensorType: "multi",
        values: {
          gps:         { lat: "float (degrees)", lon: "float (degrees)", accuracy: "float (meters)" },
          battery:     { level: "float (0–1)", charging: "boolean" },
          network:     { type: "string (4G/wifi/etc)", downlink: "float (Mbps)" },
          orientation: { alpha: "float", beta: "float", gamma: "float" },
        },
      },
      controlStubs: [
        { action: "ping",   label: "PING",   description: "Verify device is responsive",           params: {} },
        { action: "report", label: "REPORT", description: "Request an immediate sensor snapshot",   params: {} },
      ],
    };
  }

  // ── MQTT device ───────────────────────────────────────────────────────────
  if (device.protocol === "mqtt") {
    return {
      displayName: `MQTT-${sid}`,
      icon: "radio",
      description: "MQTT-connected IoT device. Publish readings to the broker and receive commands via subscribe.",
      eventSchema: {
        event: "device.reading",
        values: {
          readings: [{ name: "string", value: "number", unit: "string" }],
        },
        topics: {
          telemetry: `devices/${device.id}/telemetry`,
          commands:  `devices/${device.id}/commands`,
        },
      },
      controlStubs: [
        { action: "ping",    label: "PING",    description: "Check MQTT connectivity",         params: {} },
        { action: "reboot",  label: "REBOOT",  description: "Trigger a device restart",        params: {} },
        { action: "config",  label: "CONFIG",  description: "Push new configuration payload",  params: { interval_ms: "number" }, example: '{"interval_ms":5000}' },
      ],
    };
  }

  // ── Sensor ────────────────────────────────────────────────────────────────
  if (device.category === "sensor" || device.type === "sensor") {
    const hasTemp = device.capabilities.includes("temperature");
    const hasHum  = device.capabilities.includes("humidity");
    const hasLux  = device.capabilities.includes("light");
    const hasMotion = device.capabilities.includes("motion");

    const values: Record<string, unknown> = {};
    if (hasTemp)   values.temperature = "float (°C)";
    if (hasHum)    values.humidity    = "float (% RH)";
    if (hasLux)    values.lux         = "float (lux)";
    if (hasMotion) values.motion      = "boolean";
    if (!Object.keys(values).length) values.value = "number";

    return {
      displayName: `SENSOR-${sid}`,
      icon: "thermometer",
      description: `Sensor device reporting: ${device.capabilities.join(", ") || "generic readings"}.`,
      eventSchema: { event: "device.reading", values },
      controlStubs: [
        { action: "read",   label: "READ",   description: "Request an immediate reading",         params: {} },
        { action: "reset",  label: "RESET",  description: "Reset sensor to factory calibration",  params: {} },
        { action: "config", label: "CONFIG", description: "Update sampling interval",              params: { interval_ms: "number" } },
      ],
    };
  }

  // ── Actuator ──────────────────────────────────────────────────────────────
  if (device.category === "actuator" || device.type === "actuator") {
    const hasToggle  = device.capabilities.includes("toggle");
    const hasDimmer  = device.capabilities.includes("dimmable");
    const hasMotor   = device.capabilities.includes("motor");

    const stubs: ControlStub[] = [
      { action: "on",  label: "ON",  description: "Activate device",  params: {} },
      { action: "off", label: "OFF", description: "Deactivate device", params: {} },
    ];
    if (hasToggle) stubs.push({ action: "toggle", label: "TOGGLE", description: "Flip current state", params: {} });
    if (hasDimmer) stubs.push({ action: "dim",    label: "DIM",    description: "Set brightness level (0–100)", params: { level: "number" } });
    if (hasMotor)  stubs.push(
      { action: "move",   label: "MOVE",   description: "Move by distance",  params: { distance_cm: "number" }, example: '{"distance_cm":100}' },
      { action: "rotate", label: "ROTATE", description: "Rotate by degrees", params: { degrees: "number" }     },
    );

    return {
      displayName: `ACTUATOR-${sid}`,
      icon: "zap",
      description: `Actuator device with capabilities: ${device.capabilities.join(", ") || "on/off control"}.`,
      eventSchema: { event: "device.state.changed", values: { status: "on|off|standby", level: "number (0–100)" } },
      controlStubs: stubs,
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  return {
    displayName: `DEVICE-${sid}`,
    icon: "cpu",
    description: `Newly discovered ${device.type} device via ${device.protocol}.`,
    eventSchema: {
      event: "device.reading",
      values: { data: "any" },
    },
    controlStubs: [
      { action: "ping",  label: "PING",  description: "Check device is alive",   params: {} },
      { action: "reset", label: "RESET", description: "Restart the device",      params: {} },
      { action: "read",  label: "READ",  description: "Request current reading", params: {} },
    ],
  };
}
