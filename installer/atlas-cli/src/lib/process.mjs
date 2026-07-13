import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const STATE_DIR  = join(homedir(), '.deckos');
const STATE_FILE = join(STATE_DIR, 'state.json');

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function saveProc(key, pid, repoDir) {
  const state = readState();
  state[key] = { pid, repoDir, startedAt: new Date().toISOString() };
  writeState(state);
}

export function removeProc(key) {
  const state = readState();
  delete state[key];
  writeState(state);
}

export function getState() {
  return readState();
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProc(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

const isWindows = process.platform === 'win32';

export function spawnDetached(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
    shell: isWindows,
    ...opts,
  });
  child.unref();
  return child.pid;
}

export function spawnAttached(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio: 'inherit',
    shell: isWindows,
    ...opts,
  });
}
