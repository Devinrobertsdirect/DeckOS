/**
 * DeckOS CLI — `npx deckos <command>`
 *
 * Commands:
 *   start   — install (if needed), then launch API + frontend
 *   stop    — gracefully stop running services
 *   status  — show what is running
 *   update  — git pull + reinstall deps + run migrations
 *   doctor  — check all prerequisites
 *
 * Zero npm dependencies — uses only Node.js built-ins so it
 * runs immediately via npx without a slow install phase.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Config ───────────────────────────────────────────────────────────────────

const REPO_URL = "https://github.com/Devinrobertsdirect/DeckOS.git";
const INSTALL_DIR = path.join(os.homedir(), ".deckos", "repo");
const STATE_FILE = path.join(os.homedir(), ".deckos", "state.json");
const DECKOS_DIR = path.join(os.homedir(), ".deckos");

const API_PORT = "8080";
const WEB_PORT = "3000";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function ok(msg: string) {
  process.stdout.write(`${c.green}[ OK ]${c.reset} ${msg}\n`);
}
function info(msg: string) {
  process.stdout.write(`${c.cyan}[INFO]${c.reset} ${msg}\n`);
}
function warn(msg: string) {
  process.stdout.write(`${c.yellow}[WARN]${c.reset} ${msg}\n`);
}
function fail(msg: string) {
  process.stderr.write(`${c.red}[FAIL]${c.reset} ${msg}\n`);
}
function step(msg: string) {
  process.stdout.write(`\n${c.bold}──${c.reset} ${c.bold}${msg}${c.reset}\n`);
}
function logo() {
  process.stdout.write(
    `\n${c.green}${c.bold}DeckOS${c.reset}${c.green}_${c.reset}  Your AI. Your hardware. Your rules.\n${c.dim}──────────────────────────────────────${c.reset}\n\n`,
  );
}

// ── State file ───────────────────────────────────────────────────────────────

interface ServiceState {
  pid: number;
  port: string;
  repoDir: string;
  startedAt: string;
}

interface State {
  api?: ServiceState;
  web?: ServiceState;
}

function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

function writeState(state: State) {
  fs.mkdirSync(DECKOS_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Prerequisite checks ──────────────────────────────────────────────────────

interface CheckResult {
  ok: boolean;
  message: string;
}

function checkNode(): CheckResult {
  const raw = process.version.slice(1); // strip leading 'v'
  const major = parseInt(raw.split(".")[0] ?? "0", 10);
  if (major < 20) {
    return {
      ok: false,
      message: `Node.js 20+ required — found v${raw}. Download: https://nodejs.org`,
    };
  }
  return { ok: true, message: `Node.js v${raw}` };
}

function checkCommand(cmd: string, label: string, installHint: string): CheckResult {
  try {
    const out = execSync(`${cmd} --version 2>&1`, { encoding: "utf8" }).trim();
    return { ok: true, message: `${label} ${out.split("\n")[0]}` };
  } catch {
    return { ok: false, message: `${label} not found. ${installHint}` };
  }
}

function checkGit(): CheckResult {
  return checkCommand("git", "git", "Install git: https://git-scm.com");
}

function checkPnpm(): CheckResult {
  return checkCommand("pnpm", "pnpm", 'Install via: npm install -g pnpm  or  corepack enable pnpm');
}

function checkDocker(): CheckResult {
  return checkCommand("docker", "Docker", "Optional — install from https://docs.docker.com/get-docker/");
}

// ── Setup helpers ────────────────────────────────────────────────────────────

function ensurePnpm() {
  try {
    execSync("pnpm --version", { stdio: "ignore" });
  } catch {
    info("pnpm not found — installing via corepack...");
    execSync("corepack enable pnpm", { stdio: "inherit" });
  }
}

function cloneOrUpdate(repoDir: string, mode: "clone" | "pull") {
  if (mode === "clone") {
    step(`Cloning DeckOS into ${repoDir}`);
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    execSync(`git clone ${REPO_URL} "${repoDir}"`, { stdio: "inherit" });
  } else {
    step("Pulling latest changes");
    execSync("git pull", { cwd: repoDir, stdio: "inherit" });
  }
}

function installDeps(repoDir: string) {
  step("Installing dependencies");
  execSync("pnpm install", { cwd: repoDir, stdio: "inherit" });
}

function copyEnv(repoDir: string) {
  const envFile = path.join(repoDir, ".env");
  const exampleFile = path.join(repoDir, ".env.example");
  if (!fs.existsSync(envFile)) {
    if (fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, envFile);
      ok("Created .env from .env.example");
      warn("Edit ~/.deckos/repo/.env to add your API keys before starting.");
    } else {
      warn(".env.example not found — you may need to create .env manually.");
    }
  }
}

function runMigrations(repoDir: string) {
  step("Running database migrations");
  try {
    execSync("pnpm --filter @workspace/db run push", {
      cwd: repoDir,
      stdio: "inherit",
    });
  } catch {
    warn("DB migration skipped (no database configured — add DATABASE_URL to .env).");
  }
}

// ── Process management ───────────────────────────────────────────────────────

function spawnService(
  label: string,
  repoDir: string,
  filter: string,
  env: Record<string, string>,
): ChildProcess {
  const merged = { ...process.env, ...env };
  const child = spawn(
    "pnpm",
    ["--filter", filter, "run", "start"],
    {
      cwd: repoDir,
      env: merged,
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  ok(`${label} started (pid ${child.pid})`);
  return child;
}

function openBrowser(url: string) {
  const plat = process.platform;
  try {
    if (plat === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
    else if (plat === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
  } catch {
    // Non-fatal — browser just won't auto-open
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdDoctor() {
  logo();
  step("Checking prerequisites");

  const checks = [
    { label: "Node.js", result: checkNode() },
    { label: "git", result: checkGit() },
    { label: "pnpm", result: checkPnpm() },
    { label: "Docker (optional)", result: checkDocker() },
  ];

  let allOk = true;
  for (const { label, result } of checks) {
    if (result.ok) {
      ok(`${label}: ${result.message}`);
    } else {
      const isOptional = label.includes("optional");
      if (isOptional) {
        warn(`${label}: ${result.message}`);
      } else {
        fail(`${label}: ${result.message}`);
        allOk = false;
      }
    }
  }

  process.stdout.write("\n");
  if (allOk) {
    ok("All required prerequisites met. Ready to run DeckOS.");
  } else {
    fail("Some prerequisites are missing. Install them and retry.");
    process.exit(1);
  }
}

async function cmdStatus() {
  logo();
  step("Service status");

  const state = readState();

  const services: Array<{ name: string; key: keyof State }> = [
    { name: "API server  ", key: "api" },
    { name: "Frontend   ", key: "web" },
  ];

  for (const svc of services) {
    const entry = state[svc.key];
    if (!entry) {
      process.stdout.write(`  ${svc.name}  ${c.dim}NOT STARTED${c.reset}\n`);
    } else if (isRunning(entry.pid)) {
      process.stdout.write(
        `  ${svc.name}  ${c.green}RUNNING${c.reset}  pid ${entry.pid}  port ${entry.port}  http://localhost:${entry.port}\n`,
      );
    } else {
      process.stdout.write(
        `  ${svc.name}  ${c.red}STOPPED${c.reset}  (stale pid ${entry.pid})\n`,
      );
    }
  }

  process.stdout.write("\n");
}

async function cmdStop() {
  logo();
  step("Stopping DeckOS services");

  const state = readState();
  let stopped = 0;

  for (const key of ["api", "web"] as const) {
    const entry = state[key];
    if (!entry) continue;
    if (isRunning(entry.pid)) {
      try {
        process.kill(entry.pid, "SIGTERM");
        ok(`Stopped ${key} (pid ${entry.pid})`);
        stopped++;
      } catch {
        warn(`Could not signal pid ${entry.pid} — may already be gone.`);
      }
    } else {
      info(`${key} was not running (pid ${entry.pid}).`);
    }
  }

  writeState({});

  if (stopped === 0) {
    info("No services were running.");
  } else {
    ok("DeckOS stopped.");
  }
}

async function cmdUpdate(args: string[]) {
  logo();

  const repoDir = fs.existsSync(INSTALL_DIR) ? INSTALL_DIR : process.cwd();
  const noPull = args.includes("--no-pull");

  if (!noPull) {
    cloneOrUpdate(repoDir, "pull");
  }

  installDeps(repoDir);
  runMigrations(repoDir);

  ok("Update complete. Restart with: npx deckos start");
}

async function cmdStart(args: string[]) {
  logo();

  // ── 1. Check prereqs ──
  const nodeCheck = checkNode();
  if (!nodeCheck.ok) { fail(nodeCheck.message); process.exit(1); }
  const gitCheck = checkGit();
  if (!gitCheck.ok) { fail(gitCheck.message); process.exit(1); }
  ensurePnpm();

  // ── 2. Determine repo dir ──
  // If we're already inside the DeckOS repo (e.g. a developer), use cwd.
  // Otherwise use the shared install location.
  const isInsideRepo = fs.existsSync(path.join(process.cwd(), "pnpm-workspace.yaml"));
  const repoDir = isInsideRepo ? process.cwd() : INSTALL_DIR;

  // ── 3. Clone if not present ──
  if (!isInsideRepo && !fs.existsSync(repoDir)) {
    cloneOrUpdate(repoDir, "clone");
    copyEnv(repoDir);
    installDeps(repoDir);
    runMigrations(repoDir);
  }

  // ── 4. Stop any stale services ──
  const prevState = readState();
  for (const key of ["api", "web"] as const) {
    const entry = prevState[key];
    if (entry && isRunning(entry.pid)) {
      process.kill(entry.pid, "SIGTERM");
      info(`Stopped previous ${key} (pid ${entry.pid})`);
    }
  }

  // ── 5. Build artifacts first ──
  step("Building API server");
  execSync("pnpm --filter @workspace/api-server run build", {
    cwd: repoDir,
    stdio: "inherit",
  });

  step("Building frontend");
  execSync(`PORT=${WEB_PORT} BASE_PATH=/ pnpm --filter @workspace/devdeck-blog run build`, {
    cwd: repoDir,
    stdio: "inherit",
  });

  // ── 6. Spawn services ──
  step("Starting services");

  const apiChild = spawnService("API server", repoDir, "@workspace/api-server", {
    PORT: API_PORT,
    NODE_ENV: "production",
  });

  // Serve the frontend build with a simple static server via vite preview
  const webEnv: Record<string, string> = {
    PORT: WEB_PORT,
    BASE_PATH: "/",
    NODE_ENV: "production",
  };
  const webChild = spawn(
    "pnpm",
    ["--filter", "@workspace/devdeck-blog", "run", "serve"],
    { cwd: repoDir, env: { ...process.env, ...webEnv }, detached: true, stdio: "ignore" },
  );
  webChild.unref();
  ok(`Frontend started (pid ${webChild.pid})`);

  // ── 7. Persist PIDs ──
  writeState({
    api: {
      pid: apiChild.pid!,
      port: API_PORT,
      repoDir,
      startedAt: new Date().toISOString(),
    },
    web: {
      pid: webChild.pid!,
      port: WEB_PORT,
      repoDir,
      startedAt: new Date().toISOString(),
    },
  });

  // ── 8. Done ──
  process.stdout.write("\n");
  ok(`${c.bold}DeckOS is running!${c.reset}`);
  process.stdout.write(
    `\n  ${c.cyan}Dashboard ${c.reset}→  http://localhost:${WEB_PORT}\n` +
    `  ${c.dim}API       →  http://localhost:${API_PORT}/api/healthz${c.reset}\n\n` +
    `  ${c.dim}Stop with: npx deckos stop${c.reset}\n\n`,
  );

  if (!args.includes("--no-open")) {
    openBrowser(`http://localhost:${WEB_PORT}`);
  }
}

function printHelp() {
  logo();
  process.stdout.write(
    `${c.bold}Usage:${c.reset}  npx deckos <command> [flags]\n\n` +
    `${c.bold}Commands:${c.reset}\n` +
    `  ${c.green}start${c.reset}           Install (if needed) and launch DeckOS\n` +
    `  ${c.cyan}stop${c.reset}            Stop all running services\n` +
    `  ${c.cyan}status${c.reset}          Show what is running\n` +
    `  ${c.cyan}update${c.reset}          Pull latest code, reinstall deps, migrate DB\n` +
    `  ${c.cyan}doctor${c.reset}          Check prerequisites\n\n` +
    `${c.bold}Flags:${c.reset}\n` +
    `  --no-open       Don't open the browser after start\n` +
    `  --no-pull       (update) Skip git pull\n\n` +
    `${c.bold}Examples:${c.reset}\n` +
    `  npx deckos start\n` +
    `  npx deckos start --no-open\n` +
    `  npx deckos update\n` +
    `  npx deckos stop\n\n`,
  );
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

const [, , command = "help", ...rest] = process.argv;

switch (command) {
  case "start":
    await cmdStart(rest);
    break;
  case "stop":
    await cmdStop();
    break;
  case "status":
    await cmdStatus();
    break;
  case "update":
    await cmdUpdate(rest);
    break;
  case "doctor":
    await cmdDoctor();
    break;
  default:
    printHelp();
    break;
}
