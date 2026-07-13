import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export const IS_WINDOWS = platform() === 'win32';
export const IS_MAC     = platform() === 'darwin';
export const IS_LINUX   = platform() === 'linux';

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
  } catch {
    return null;
  }
}

export function nodeVersion() {
  const v = run('node --version');
  return v ? v.replace('v', '') : null;
}

export function pnpmVersion() {
  return run('pnpm --version');
}

export function gitVersion() {
  return run('git --version');
}

export function dockerAvailable() {
  if (!run('docker --version')) return false;
  const info = spawnSync('docker', ['info'], { encoding: 'utf8', stdio: 'pipe', timeout: 4000 });
  return info.status === 0;
}

export function dockerComposeAvailable() {
  return !!run('docker compose version') || !!run('docker-compose --version');
}

export function pgAvailable() {
  return !!run('pg_isready --version') || !!run('psql --version');
}

export function ollamaAvailable() {
  return !!run('ollama --version');
}

export function ollamaRunning() {
  const result = run('curl -s --max-time 2 http://localhost:11434/api/tags');
  return !!result;
}

export function isInsideRepo(dir) {
  return existsSync(join(dir, 'pnpm-workspace.yaml')) &&
         existsSync(join(dir, 'core', 'server')) &&
         existsSync(join(dir, 'interfaces', 'desktop'));
}

export function findRepoRoot() {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (isInsideRepo(cur)) return cur;
    const parent = join(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export function defaultInstallDir() {
  if (IS_WINDOWS) return join(process.env.LOCALAPPDATA || homedir(), 'DeckOS-Atlas');
  if (IS_MAC)     return join(homedir(), 'Library', 'Application Support', 'DeckOS-Atlas');
  return join(homedir(), '.local', 'share', 'deckos-atlas');
}

export function majorVersion(versionStr) {
  if (!versionStr) return 0;
  return parseInt(versionStr.split('.')[0], 10);
}

export const GITHUB_REPO = 'https://github.com/Devinrobertsdirect/DeckOS-Atlas';
