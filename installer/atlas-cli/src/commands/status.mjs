import chalk from 'chalk';
import { ok, warn, info } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';
import { getState, isAlive } from '../lib/process.mjs';
import { findRepoRoot, dockerAvailable } from '../lib/detect.mjs';
import { execSync } from 'node:child_process';

async function checkHttp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? res.status : null;
  } catch {
    return null;
  }
}

export async function statusCmd() {
  console.log('');
  console.log(chalk.bold('  Deck OS — Service Status\n'));
  printDivider();
  console.log('');

  const repoDir = findRepoRoot();
  const state   = getState();

  // Docker Compose status
  if (dockerAvailable() && repoDir) {
    try {
      const res = execSync('docker compose ps --format json', {
        cwd: repoDir,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      if (res) {
        const containers = res.split('\n').flatMap(line => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
        if (containers.length > 0) {
          info(chalk.bold('Docker Compose containers:'));
          for (const c of containers) {
            const running = c.State === 'running';
            const icon = running ? chalk.green('●') : chalk.red('○');
            console.log(`    ${icon} ${chalk.cyan(c.Service || c.Name)} — ${c.State}`);
          }
          console.log('');
        }
      }
    } catch { /* docker not in use */ }
  }

  // Process state
  const procs = Object.entries(state);
  if (procs.length > 0) {
    info(chalk.bold('Background processes:'));
    for (const [key, proc] of procs) {
      const alive = isAlive(proc.pid);
      const icon  = alive ? chalk.green('●') : chalk.red('○');
      const since = proc.startedAt ? new Date(proc.startedAt).toLocaleTimeString() : '?';
      console.log(`    ${icon} ${chalk.cyan(key)} — PID ${proc.pid} — started ${since} — ${alive ? chalk.green('running') : chalk.red('stopped')}`);
    }
    console.log('');
  }

  // HTTP health checks
  info(chalk.bold('Health checks:'));
  const [apiStatus, webStatus] = await Promise.all([
    checkHttp('http://localhost:8080/api/healthz'),
    checkHttp('http://localhost:3000'),
  ]);

  const apiIcon = apiStatus ? chalk.green('●') : chalk.red('○');
  const webIcon = webStatus ? chalk.green('●') : chalk.red('○');
  console.log(`    ${apiIcon} API server    http://localhost:8080  — ${apiStatus ? chalk.green('online (' + apiStatus + ')') : chalk.red('offline')}`);
  console.log(`    ${webIcon} Frontend      http://localhost:3000  — ${webStatus ? chalk.green('online (' + webStatus + ')') : chalk.red('offline')}`);
  console.log('');
  printDivider();
  console.log('');
}
