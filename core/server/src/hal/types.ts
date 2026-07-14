/**
 * The Hardware Abstraction Layer (HAL) types.
 *
 * Atlas is one brain that can inhabit many bodies. Everything the brain needs
 * from a body — move, sense, show a face, stop — is expressed through the
 * `AtlasBody` interface. A body is a virtual sim (desktop/dev), a microcontroller
 * over serial/WiFi (ESP32 / Nano / custom), or the Pi's own GPIO. Swap the body
 * behind this interface and nothing else in Atlas changes. ("Swap any part
 * behind the HAL." — ATL-HW-001.)
 */

export type BodyBackend = "sim" | "serial" | "pi";

export interface Odometry {
  x: number;   // metres
  y: number;   // metres
  th: number;  // heading, radians
}

export interface BodyState {
  connected: boolean;
  board: string;            // "sim" | "esp32" | "nano" | "pi" | "custom"
  caps: string[];           // ["drive","enc","tof","imu","batt","face"]
  odom: Odometry;
  encoders: { l: number; r: number };
  battery: { mv?: number; pct?: number };
  dock: boolean;
  estop: boolean;
  tof: number[];            // forward distances, mm (nearest-first)
  yaw?: number;             // heading, degrees (from IMU)
  /** The body's persistent logbook, dropped off on connect (wake count + lifetime). */
  record?: { boot: number; lifeSec: number; sessMs: number };
  updatedAt: number;        // epoch ms of last telemetry
}

export type BodyEvent = "ready" | "telemetry" | "event" | "disconnect";

export interface AtlasBody {
  /** Which backend this is — "sim" | "serial" | "pi". */
  readonly kind: BodyBackend;
  /** Connect / spin up. Resolves once the body is ready (or a sim is running). */
  start(): Promise<void>;
  /** Disconnect and release resources. */
  stop(): Promise<void>;

  /** Differential drive with normalized wheel speeds, each in [-1, 1]. */
  drive(l: number, r: number): void;
  /** Convenience: body-frame velocity (m/s forward, rad/s yaw) → wheel speeds. */
  driveVelocity(linearMps: number, angularRps: number): void;
  /** Stop the wheels immediately (does not trip the e-stop). */
  halt(): void;

  /** Show a face state on the body's display (mirrors the on-screen face). */
  setFace(state: string, color?: string): void;
  /** Software e-stop: true cuts motion until cleared. */
  setEstop(on: boolean): void;

  /** Latest known body state (telemetry-driven; always safe to read). */
  getState(): BodyState;

  /** Subscribe to a body event. Returns an unsubscribe function. */
  on(event: BodyEvent, cb: (payload: unknown) => void): () => void;
}

// ── Hardware profile — selects and parameterizes a body ──────────────────────
export interface DriveGeometry {
  wheelBaseM: number;     // distance between wheels, metres
  wheelRadiusM: number;   // wheel radius, metres
  maxSpeedMps: number;    // top linear speed of one wheel, m/s
  invertL?: boolean;
  invertR?: boolean;
}

export interface SerialTransportConfig {
  /** Serial device path (e.g. "COM5", "/dev/ttyUSB0"), or a ws:// URL for WiFi. */
  path?: string;
  baud?: number;
}

export interface HardwareProfile {
  id: string;
  name: string;
  /** Which HAL backend drives this body. */
  backend: BodyBackend;
  /** Human note about the physical target. */
  target?: string;
  drive?: DriveGeometry;
  serial?: SerialTransportConfig;
  /** Free-form firmware/config hints mirrored to the board via CFG. */
  config?: Record<string, string>;
}

/**
 * A byte-stream transport for the serial-bridge body. Kept abstract so the HAL
 * has NO hard dependency on `serialport` or a WebSocket lib — the runtime/CLI
 * injects a concrete transport (USB serial, WiFi WebSocket, BLE, MQTT).
 */
export interface LineTransport {
  /** Open the link. */
  open(): Promise<void>;
  /** Close the link. */
  close(): Promise<void>;
  /** Write one line (implementation appends the newline). */
  writeLine(line: string): void;
  /** Register a handler for each inbound line. */
  onLine(cb: (line: string) => void): void;
  /** Connection state change. */
  onStatus(cb: (up: boolean) => void): void;
}
