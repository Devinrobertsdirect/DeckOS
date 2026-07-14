import type { LineTransport } from "../hal/index.js";

interface SPPort {
  write: (s: string) => void;
  close: (cb?: () => void) => void;
  on: (e: string, cb: (a?: unknown) => void) => void;
  pipe: (p: unknown) => { on: (e: string, cb: (a: unknown) => void) => void };
}
interface SPModule {
  SerialPort: new (o: { path: string; baudRate: number }) => SPPort;
  ReadlineParser: new (o: { delimiter: string }) => unknown;
}

/**
 * SerialPortTransport — a LineTransport backed by a real USB serial link (an
 * Arduino/ESP32 running the Atlas firmware). `serialport` is imported via a
 * NON-LITERAL specifier so esbuild never tries to bundle the native module; it's
 * an optional runtime dependency (degrades to the sim body if absent).
 *
 * Opening the port toggles DTR, which resets the board — so on connect the body
 * reboots and immediately "drops its records" (READY + RECORD). That's the sync.
 */
export class SerialPortTransport implements LineTransport {
  private path: string;
  private baud: number;
  private port: SPPort | null = null;
  private lineCbs: ((line: string) => void)[] = [];
  private statusCbs: ((up: boolean) => void)[] = [];

  constructor(path: string, baud = 115200) {
    this.path = path;
    this.baud = baud;
  }

  async open(): Promise<void> {
    const spec = "serialport";
    const sp = (await import(spec)) as unknown as SPModule;
    this.port = new sp.SerialPort({ path: this.path, baudRate: this.baud });
    if (!this.port) throw new Error("serialport failed to open");
    const parser = this.port.pipe(new sp.ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line: unknown) => {
      const l = String(line).trim();
      if (l) for (const cb of this.lineCbs) cb(l);
    });
    this.port.on("close", () => { for (const cb of this.statusCbs) cb(false); });
    this.port.on("error", () => { for (const cb of this.statusCbs) cb(false); });
    await new Promise<void>((resolve, reject) => {
      this.port!.on("open", () => { for (const cb of this.statusCbs) cb(true); resolve(); });
      this.port!.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
      setTimeout(resolve, 2500); // never hang the brain on a flaky link
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      try { this.port ? this.port.close(() => resolve()) : resolve(); } catch { resolve(); }
    });
    this.port = null;
  }

  writeLine(line: string): void {
    try { this.port?.write(line + "\n"); } catch { /* link hiccup */ }
  }
  onLine(cb: (line: string) => void): void { this.lineCbs.push(cb); }
  onStatus(cb: (up: boolean) => void): void { this.statusCbs.push(cb); }
}

/** List candidate board serial ports (USB, not Bluetooth). Empty if serialport absent. */
export async function listBoardPorts(): Promise<{ path: string; label: string }[]> {
  try {
    const spec = "serialport";
    const sp = (await import(spec)) as unknown as { SerialPort: { list: () => Promise<Array<Record<string, string | undefined>>> } };
    const ports = await sp.SerialPort.list();
    return ports
      .filter((p) => p["vendorId"] || /USB|CH340|CP210|FTDI|arduino|wch|usbserial|usbmodem/i.test(`${p["pnpId"] ?? ""} ${p["manufacturer"] ?? ""} ${p["path"] ?? ""}`))
      .map((p) => ({ path: String(p["path"]), label: `${p["manufacturer"] ?? "serial"} ${p["path"]}` }));
  } catch {
    return [];
  }
}
