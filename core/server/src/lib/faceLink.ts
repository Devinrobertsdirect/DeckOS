/**
 * faceLink.ts — the brain's link to a physical FACE node (a CrowPanel / CYD /
 * bare-panel ESP32 that renders Atlas's eyes on a round LCD).
 *
 * It's deliberately SEPARATE from the drive body (lib/body.ts): a full Atlas
 * robot runs a face node and a drive node on two independent AWP links, so the
 * FACE never fights the motors for a serial port. The brain forwards the current
 * emotion/FaceState here (setFace) and the panel mirrors the browser face; the
 * panel's touch + rotary knob come back as INPUT events the brain turns into
 * buddy actions (tap → wake, knob → volume, press → confirm).
 *
 * With no hardware it runs in "sim" mode — it just holds the last state in
 * memory (and the browser face is the real display), so the whole face pipeline
 * is testable off-robot. Point ATLAS_FACE_SERIAL at a port to drive a real panel.
 */
import { EventEmitter } from "node:events";
import { encodeCommand, decodeReport, AWP_VERSION, AWP_FACE_STATES, type InputMsg } from "../hal/protocol.js";
import type { LineTransport } from "../hal/types.js";
import { SerialPortTransport, listBoardPorts } from "./serialTransport.js";
import { discoverRoles } from "./boardRoles.js";

export interface FaceLinkState {
  state: string;
  color?: string;
  bright?: number;
  updatedAt: number;
  node: "serial" | "sim";
  connected: boolean;
  board?: string;
  port: string | null;
  lastInput: InputMsg | null;
}

export function isFaceState(s: string): boolean {
  return (AWP_FACE_STATES as readonly string[]).includes(s);
}

class FaceLink {
  private emitter = new EventEmitter();
  private transport: LineTransport | null = null;
  private connected = false;
  private board = "";
  private port: string | null = null;
  private cur: { state: string; color?: string; bright?: number; updatedAt: number } = {
    state: "idle", updatedAt: 0,
  };
  private lastInput: InputMsg | null = null;

  async start(): Promise<void> {
    const forced = process.env["ATLAS_FACE_SERIAL"]?.trim();
    if (forced) {
      try { await this.openSerial(forced); } catch { /* fall back to sim */ }
      return;
    }
    // Auto-detect a face node ONLY when 2+ boards are present, so we never steal
    // a lone drive board. Claim the port that announces role=face.
    try {
      const ports = (await listBoardPorts()).map((p) => p.path);
      if (ports.length >= 2) {
        const roles = await discoverRoles();
        const facePort = ports.find((p) => roles.get(p) === "face");
        if (facePort) { await this.openSerial(facePort); return; }
      }
    } catch { /* fall through to sim */ }
    // No face port → sim mode: hold state in memory (browser face is the display).
  }

  private async openSerial(port: string): Promise<void> {
    const t = new SerialPortTransport(port, 115200);
    t.onLine((line) => this.handleLine(line));
    t.onStatus((up) => { this.connected = up; if (!up) { this.board = ""; } });
    await t.open();
    this.transport = t;
    this.port = port;
    // Say hello, then push the current face so a freshly-connected panel
    // immediately matches whatever mood the brain is already in.
    this.send(encodeCommand({ t: "HELLO", v: AWP_VERSION, name: "NeuraBrain" }));
    this.pushFace();
  }

  private handleLine(line: string): void {
    const r = decodeReport(line);
    if (!r) return;
    if (r.t === "READY") {
      this.connected = true;
      this.board = r.board;
      this.emitter.emit("ready", r);
      this.pushFace();               // re-assert face after a board reset
    } else if (r.t === "INPUT") {
      this.lastInput = r;
      this.emitter.emit("input", r);
    }
  }

  private send(line: string): void {
    try { this.transport?.writeLine(line); } catch { /* link hiccup — watchdog re-asserts */ }
  }

  private pushFace(): void {
    this.send(encodeCommand({ t: "FACE", state: this.cur.state, color: this.cur.color, bright: this.cur.bright }));
  }

  /** Brain → face: set the expression (state), eye colour ("r,g,b"), glow (0..100). */
  setFace(state: string, color?: string, bright?: number): FaceLinkState {
    this.cur = { state, color, bright, updatedAt: Date.now() };
    this.pushFace();
    const snap = this.getState();
    this.emitter.emit("face", snap);
    return snap;
  }

  getState(): FaceLinkState {
    return {
      state: this.cur.state,
      color: this.cur.color,
      bright: this.cur.bright,
      updatedAt: this.cur.updatedAt,
      node: this.transport ? "serial" : "sim",
      connected: this.transport ? this.connected : true,   // sim is always "up"
      board: this.board || undefined,
      port: this.port,
      lastInput: this.lastInput,
    };
  }

  /** Subscribe to touch/knob input from the panel. Returns an unsubscribe fn. */
  onInput(cb: (i: InputMsg) => void): () => void {
    this.emitter.on("input", cb);
    return () => this.emitter.off("input", cb);
  }

  /**
   * Feed an input as if it came from the panel — used to unify the on-screen
   * face tap with a hardware tap, and to test the touch→action path off-robot.
   */
  injectInput(i: InputMsg): void {
    this.lastInput = i;
    this.emitter.emit("input", i);
  }
}

let face: FaceLink | null = null;
let starting: Promise<FaceLink> | null = null;

export async function getFace(): Promise<FaceLink> {
  if (face) return face;
  if (starting) return starting;
  starting = (async () => {
    const f = new FaceLink();
    await f.start();
    face = f;
    return f;
  })();
  return starting;
}

export function peekFace(): FaceLink | null {
  return face;
}
