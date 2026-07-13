import chalk from 'chalk';
import { ok, warn, info, fail } from '../lib/logger.mjs';
import { findRepoRoot } from '../lib/detect.mjs';
import { sh } from '../lib/exec.mjs';
import { getState, isAlive } from '../lib/process.mjs';
import { stopCmd } from './stop.mjs';

export async function updateCmd() {
  console.log('');
  const repoDir = findRepoRoot();
  if (!repoDir) {
    fail('Could not find Deck OS repo. Run from inside the repo or install with: npx deckos start');
  }

  // Check for running services
  const state = getState();
  const anyRunning = Object.values(state).some(p => p?.pid && isAlive(p.pid));
  if (anyRunning) {
    info('Stopping running services before update...');
    await stopCmd({});
  }

  info(`Updating from ${chalk.cyan(repoDir)}...`);

  try {
    sh('git pull --ff-only', repoDir);
    ok('Repository updated');
  } catch (e) {
    warn('git pull failed. You may have local changes. Skipping git pull.');
    warn(e.message);
  }

  info('Installing updated dependencies...');
  try {
    sh('pnpm install --frozen-lockfile', repoDir);
    ok('Dependencies updated');
  } catch {
    sh('pnpm install', repoDir);
    ok('Dependencies updated');
  }

  info('Running database migrations...');
  try {
    sh('pnpm --filter @workspace/db run push', repoDir);
    ok('Database schema up to date');
  } catch (e) {
    warn('Migration skipped (check DATABASE_URL if needed)');
  }

  console.log('');
  ok(chalk.bold('Update complete! Run: npx deckos start'));
  console.log('');
}
