import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { ok, warn, info } from '../lib/logger.mjs';
import { getState, isAlive, killProc, removeProc } from '../lib/process.mjs';
import { sh } from '../lib/exec.mjs';
import { findRepoRoot } from '../lib/detect.mjs';

export async function stopCmd(opts = {}) {
  const { docker: dockerMode } = opts;
  console.log('');

  // Try Docker first if flag set or if docker-compose.yml exists in repo
  const repoDir = findRepoRoot();
  if (dockerMode || repoDir) {
    try {
      const res = execSync('docker compose ps --quiet', { cwd: repoDir || process.cwd(), encoding: 'utf8', stdio: 'pipe' }).trim();
      if (res) {
        info('Stopping Docker Compose services...');
        sh('docker compose down', repoDir || process.cwd());
        ok('Docker services stopped');
        return;
      }
    } catch { /* not using docker */ }
  }

  const state = getState();
  let stopped = 0;

  for (const [key, proc] of Object.entries(state)) {
    if (!proc?.pid) continue;
    if (isAlive(proc.pid)) {
      killProc(proc.pid);
      ok(`Stopped ${chalk.cyan(key)} (PID ${proc.pid})`);
      stopped++;
    } else {
      info(`${chalk.cyan(key)} was already stopped`);
    }
    removeProc(key);
  }

  if (stopped === 0 && Object.keys(state).length === 0) {
    warn('No running Deck OS processes found.');
    info('If services are still running, stop them manually or use: docker compose down');
  } else {
    console.log('');
    ok(chalk.bold('Deck OS stopped.'));
  }
  console.log('');
}
