import { logger } from "./logger.js";

class TraceState {
  private enabled: boolean;

  constructor() {
    this.enabled = (process.env.TRACE_MODE ?? "").toLowerCase() === "on";
    if (this.enabled) {
      logger.info("EventBus trace mode: ON (via TRACE_MODE env var)");
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    logger.info({ traceMode: value }, "EventBus trace mode toggled");
  }

  log(msg: string, data?: unknown): void {
    logger.trace({ data }, msg);
  }
}

export const traceState = new TraceState();
