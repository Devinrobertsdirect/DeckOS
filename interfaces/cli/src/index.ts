#!/usr/bin/env node
import readline from "node:readline";
import WebSocket from "ws";
import chalk from "chalk";

const DEFAULT_PORT = process.env["PORT"] ?? "3000";
const WS_URL =
  process.env["WS_URL"] ??
  `ws://localhost:${DEFAULT_PORT}/api/ws`;

const isDaemon = process.argv.includes("--daemon");
const args = process.argv.slice(2).filter((a) => a !== "--daemon");

function timestamp(): string {
  return chalk.gray(new Date().toLocaleTimeString());
}

function colorForType(type: string): (text: string) => string {
  if (type.startsWith("system.")) return chalk.blueBright;
  if (type.startsWith("ai.")) return chalk.cyanBright;
  if (type.startsWith("device.")) return chalk.yellowBright;
  if (type.startsWith("plugin.")) return chalk.greenBright;
  if (type.startsWith("memory.")) return chalk.magentaBright;
  if (type.startsWith("client.")) return chalk.gray;
  if (type.startsWith("ws.")) return chalk.gray;
  if (type === "history.replay") return chalk.gray;
  return chalk.white;
}

function formatEvent(event: Record<string, unknown>): string {
  const type = String(event["type"] ?? "unknown");
  const source = String(event["source"] ?? "");
  const colorFn = colorForType(type);
  const ts = timestamp();
  const sourceStr = source ? chalk.dim(` [${source}]`) : "";
  const payload = event["payload"];
  const payloadStr =
    payload != null
      ? chalk.dim(" " + JSON.stringify(payload).slice(0, 120))
      : "";
  return `${ts} ${colorFn(type)}${sourceStr}${payloadStr}`;
}

function sendCommand(ws: WebSocket, type: string, payload: unknown, target?: string): void {
  const msg: Record<string, unknown> = { type, payload };
  if (target != null) msg["target"] = target;
  ws.send(JSON.stringify(msg));
}

function parseCliCommand(
  ws: WebSocket,
  line: string,
  rl?: readline.Interface,
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";

  switch (cmd) {
    case "exit":
    case "quit":
      console.log(chalk.gray("Disconnecting..."));
      ws.close();
      rl?.close();
      process.exit(0);
      break;

    case "status":
      sendCommand(ws, "system.monitor.request", { query: "status" });
      console.log(chalk.gray("→ status request sent"));
      break;

    case "infer": {
      const prompt = parts.slice(1).join(" ");
      if (!prompt) {
        console.log(chalk.red("Usage: infer <prompt>"));
        break;
      }
      sendCommand(ws, "ai.chat.request", { prompt });
      console.log(chalk.gray(`→ inference request sent: "${prompt}"`));
      break;
    }

    case "mode": {
      const mode = parts[1];
      if (!mode) {
        console.log(chalk.red("Usage: mode <mode>"));
        break;
      }
      sendCommand(ws, "system.config_changed", { key: "mode", value: mode });
      console.log(chalk.gray(`→ mode change sent: "${mode}"`));
      break;
    }

    case "devices":
      if (parts[1] === "list") {
        sendCommand(ws, "device.list.request", {});
        console.log(chalk.gray("→ device list request sent"));
      } else {
        console.log(chalk.red("Usage: devices list"));
      }
      break;

    case "memory":
      if (parts[1] === "search") {
        const query = parts.slice(2).join(" ");
        if (!query) {
          console.log(chalk.red("Usage: memory search <query>"));
          break;
        }
        sendCommand(ws, "memory.search.request", { query });
        console.log(chalk.gray(`→ memory search sent: "${query}"`));
      } else {
        console.log(chalk.red("Usage: memory search <query>"));
      }
      break;

    case "plugins":
      if (parts[1] === "list") {
        sendCommand(ws, "plugin.list.request", {});
        console.log(chalk.gray("→ plugin list request sent"));
      } else {
        console.log(chalk.red("Usage: plugins list"));
      }
      break;

    case "monitor":
      console.log(chalk.gray("Streaming live events... (Ctrl+C to stop)"));
      break;

    case "help":
      printHelp();
      break;

    default:
      console.log(chalk.red(`Unknown command: "${cmd}". Type 'help' for available commands.`));
  }

  return true;
}

function printHelp(): void {
  console.log(chalk.bold("\nDeckOS CLI — Available Commands:"));
  console.log(chalk.cyan("  status") + "                  — Request system status");
  console.log(chalk.cyan("  infer <prompt>") + "          — Send an inference request to the AI");
  console.log(chalk.cyan("  mode <mode>") + "             — Change the system mode");
  console.log(chalk.cyan("  devices list") + "            — List connected devices");
  console.log(chalk.cyan("  memory search <query>") + "   — Search memory entries");
  console.log(chalk.cyan("  plugins list") + "            — List loaded plugins");
  console.log(chalk.cyan("  monitor") + "                 — Stream live events");
  console.log(chalk.cyan("  help") + "                    — Show this help");
  console.log(chalk.cyan("  exit") + "                    — Disconnect and exit");
  console.log();
}

function printBanner(): void {
  console.log(chalk.bold.cyan("\n╔══════════════════════════════╗"));
  console.log(chalk.bold.cyan("║") + chalk.bold.white("      DeckOS CLI Interface    ") + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════╝"));
  console.log(chalk.gray(`  Connected to: ${WS_URL}`));
  console.log(chalk.gray("  Type 'help' for commands, 'exit' to quit\n"));
}

function connect(): void {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    if (!isDaemon) {
      printBanner();
    } else {
      process.stderr.write(`[deck-cli] Connected to ${WS_URL} (daemon mode)\n`);
    }

    if (!isDaemon) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.bold.cyan("deck> "),
        terminal: true,
      });

      rl.prompt();

      rl.on("line", (line) => {
        parseCliCommand(ws, line, rl);
        rl.prompt();
      });

      rl.on("close", () => {
        ws.close();
        process.exit(0);
      });

      if (args.length > 0) {
        const cmdLine = args.join(" ");
        setTimeout(() => {
          parseCliCommand(ws, cmdLine, rl);
          rl.prompt();
        }, 300);
      }
    }
  });

  ws.on("message", (raw) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      if (isDaemon) {
        process.stdout.write(raw.toString() + "\n");
      } else {
        console.log(chalk.red("[parse error]"), raw.toString().slice(0, 100));
      }
      return;
    }

    const type = String(event["type"] ?? "");

    if (isDaemon) {
      process.stdout.write(JSON.stringify(event) + "\n");
      return;
    }

    if (type === "ws.connected") {
      console.log(chalk.gray("  Stream open — live events will appear here"));
      return;
    }

    if (type === "history.replay") {
      const payload = event["payload"] as Record<string, unknown> | undefined;
      const events = Array.isArray(payload?.["events"]) ? payload["events"] as Record<string, unknown>[] : [];
      const count = Number(payload?.["count"] ?? events.length);
      if (count > 0) {
        console.log(chalk.gray(`\n  ── Replaying last ${count} events ──`));
        for (const e of events) {
          console.log("  " + formatEvent(e));
        }
        console.log(chalk.gray("  ── Live stream follows ──\n"));
      }
      return;
    }

    if (type === "ws.error") {
      const payload = event["payload"] as Record<string, unknown> | undefined;
      console.log(chalk.red(`[ws.error] ${String(payload?.["error"] ?? "")}`));
      return;
    }

    console.log(formatEvent(event));
  });

  ws.on("error", (err) => {
    if (isDaemon) {
      process.stderr.write(`[deck-cli] Connection error: ${String(err.message)}\n`);
    } else {
      console.error(chalk.red(`\n[error] ${err.message}`));
    }
  });

  ws.on("close", (code, reason) => {
    const msg = `[deck-cli] Disconnected (code=${code}${reason.length ? `, reason=${reason}` : ""})`;
    if (isDaemon) {
      process.stderr.write(msg + "\n");
    } else {
      console.log(chalk.gray(`\n${msg}`));
    }
    setTimeout(() => {
      if (!isDaemon) {
        console.log(chalk.gray("Reconnecting in 3s..."));
      }
      connect();
    }, 3000);
  });
}

connect();
