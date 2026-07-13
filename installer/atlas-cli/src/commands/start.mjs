import chalk from 'chalk';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { log, ok, warn, info, fail, step, spinner } from '../lib/logger.mjs';
import { printBanner, printDivider } from '../lib/banner.mjs';
import {
  findRepoRoot, isInsideRepo, defaultInstallDir,
  dockerAvailable, dockerComposeAvailable,
  nodeVersion, pnpmVersion, gitVersion,
  majorVersion, GITHUB_REPO,
} from '../lib/detect.mjs';
import { ensureEnvFile, loadEnvFile } from '../lib/env.mjs';
import { sh, openBrowser } from '../lib/exec.mjs';
import { spawnDetached, saveProc, getState, isAlive } from '../lib/process.mjs';
import { doctorCmd } from './doctor.mjs';

const TOTAL_STEPS = 6;

export async function startCmd(opts = {}) {
  printBanner();

  const { docker: forceDocker, bare: forceBare, open: doOpen = true } = opts;

  // ── 1. Prerequisites ─────────────────────────────────────────────────────
  step(1, TOTAL_STEPS, 'Checking prerequisites...');
  const { ok: depsOk, docker, dockerCompose } = await doctorCmd({ silent: true });
  if (!depsOk) {
    console.log('');
    warn('Some required dependencies are missing. Running full check:');
    await doctorCmd({ silent: false });
    fail('Fix the issues above and try again.');
  }
  ok('Prerequisites met');

  // ── 2. Locate / clone repo ──────────────────────────────────────────────
  step(2, TOTAL_STEPS, 'Locating Deck OS...');
  let repoDir = findRepoRoot();

  if (!repoDir) {
    const installDir = defaultInstallDir();
    if (isInsideRepo(installDir)) {
      repoDir = installDir;
      ok(`Found existing install at ${chalk.cyan(repoDir)}`);
    } else {
      info(`Cloning Deck OS to ${chalk.cyan(installDir)}...`);
      const gitVer = gitVersion();
      if (!gitVer) fail('git is required to clone Deck OS. Install from https://git-scm.com');

      if (GITHUB_REPO.includes('your-username')) {
        console.log('');
        console.log(chalk.yellow('  ⚠  GitHub repository URL not configured.'));
        console.log('');
        console.log('  To fix this, publish the repo and set DECKOS_REPO in your environment:');
        console.log('');
        console.log(chalk.cyan('    export DECKOS_REPO=https://github.com/your-username/deck-os'));
        console.log(chalk.cyan('    npx deckos start'));
        console.log('');
        console.log('  Or clone manually and run from inside the repo:');
        console.log('');
        console.log(chalk.cyan('    git clone https://github.com/your-username/deck-os'));
        console.log(chalk.cyan('    cd deck-os && npx deckos start'));
        console.log('');
        process.exit(1);
      }

      mkdirSync(installDir, { recursive: true });
      const sp = spinner(`Cloning repository...`);
      try {
        sh(`git clone --depth 1 "${process.env.DECKOS_REPO || GITHUB_REPO}" "${installDir}"`, process.cwd());
        sp.stop(`Cloned to ${installDir}`);
        repoDir = installDir;
      } catch (e) {
        sp.fail('Clone failed');
        fail(e.message);
      }
    }
  } else {
    ok(`Using repo at ${chalk.cyan(repoDir)}`);
  }

  // ── 3. Check for already running ─────────────────────────────────────────
  const state = getState();
  const apiProc = state['api'];
  const webProc = state['web'];
  const bothRunning = apiProc && isAlive(apiProc.pid) && webProc && isAlive(webProc.pid);
  if (bothRunning) {
    console.log('');
    ok(chalk.bold('Deck OS is already running!'));
    printUrls(loadEnvFile(repoDir));
    if (doOpen) openBrowser('http://localhost:3000');
    return;
  }

  // ── 4. Environment ────────────────────────────────────────────────────────
  step(3, TOTAL_STEPS, 'Setting up environment...');
  await ensureEnvFile(repoDir);
  const env = loadEnvFile(repoDir);
  // Inject into process.env so all child processes (pnpm, drizzle-kit, etc.) can see them
  Object.assign(process.env, env);

  // ── 5. Install & migrate ─────────────────────────────────────────────────
  const useDocker = !forceBare && (forceDocker || (docker && dockerCompose));

  if (useDocker) {
    step(4, TOTAL_STEPS, 'Docker Compose — building & starting services...');
    info('First run may take a few minutes while images build.');
    console.log('');
    try {
      sh('docker compose up -d --build', repoDir);
    } catch (e) {
      fail(`Docker Compose failed: ${e.message}`);
    }

    step(5, TOTAL_STEPS, 'Waiting for services to be healthy...');
    await waitForHealth('http://localhost:8080/api/healthz', 60);

    step(6, TOTAL_STEPS, 'Done!');
    console.log('');
    printDivider();
    ok(chalk.bold.green('Deck OS is running via Docker!'));
    console.log('');
    console.log(`  ${chalk.cyan('Frontend')}  →  ${chalk.underline('http://localhost:3000')}`);
    console.log(`  ${chalk.cyan('API')}       →  ${chalk.underline('http://localhost:8080')}`);
    console.log(`  ${chalk.gray('Logs:')}       docker compose logs -f`);
    console.log(`  ${chalk.gray('Stop:')}       ${chalk.cyan('npx deckos stop')}`);
    console.log('');
    if (doOpen) openBrowser('http://localhost:3000');
    return;
  }

  // Bare-metal path
  step(4, TOTAL_STEPS, 'Installing dependencies...');
  {
    const sp = spinner('Running pnpm install...');
    try {
      sh('pnpm install --frozen-lockfile --ignore-scripts', repoDir);
      sp.stop('Dependencies installed');
    } catch {
      sp.fail('pnpm install --frozen-lockfile failed, retrying...');
      try {
        sh('pnpm install --ignore-scripts', repoDir);
        sp.stop('Dependencies installed');
      } catch (e) {
        fail(`Dependency install failed: ${e.message}`);
      }
    }
    // Rebuild native binaries that --ignore-scripts skipped (esbuild, etc.)
    try {
      sh('pnpm rebuild esbuild', repoDir);
    } catch { /* non-fatal — migration will surface the error if it matters */ }
  }

  step(5, TOTAL_STEPS, 'Running database migrations...');
  {
    const sp = spinner('Applying schema...');
    try {
      sh('pnpm --filter @workspace/db run push', repoDir, env);
      sp.stop('Database schema up to date');
    } catch (e) {
      sp.fail('Migration failed');
      console.log('');
      warn('Migration failed. Check DATABASE_URL in .env and ensure PostgreSQL is running.');
      warn(e.message);
      fail('Fix the database issue and re-run: npx deckos start');
    }
  }

  step(6, TOTAL_STEPS, 'Starting services...');
  const apiPort = env.PORT || '8080';
  const webPort = '3000';

  const apiPid = spawnDetached('pnpm', ['--filter', '@workspace/api-server', 'run', 'dev'], {
    cwd: repoDir,
    env: { ...process.env, ...env, PORT: apiPort, NODE_ENV: env.NODE_ENV || 'production' },
  });

  const webPid = spawnDetached('pnpm', ['--filter', '@workspace/deck-os', 'run', 'dev'], {
    cwd: repoDir,
    env: { ...process.env, ...env, PORT: webPort, BASE_PATH: env.BASE_PATH || '/', NODE_ENV: env.NODE_ENV || 'development' },
  });

  saveProc('api', apiPid, repoDir);
  saveProc('web', webPid, repoDir);

  await sleep(3000);

  const apiReady = await waitForHealth(`http://localhost:${apiPort}/api/healthz`, 30);

  console.log('');
  printDivider();
  console.log('');
  if (apiReady) {
    ok(chalk.bold.green('Deck OS is running!'));
  } else {
    warn('Services started but health check timed out.');
    info('The API may still be building. Check logs or try again in a moment.');
  }
  console.log('');
  console.log(`  ${chalk.cyan('Frontend')}  →  ${chalk.underline(`http://localhost:${webPort}`)}`);
  console.log(`  ${chalk.cyan('API')}       →  ${chalk.underline(`http://localhost:${apiPort}`)}`);
  console.log(`  ${chalk.gray('Stop:')}       ${chalk.cyan('npx deckos stop')}`);
  console.log(`  ${chalk.gray('Logs:')}       ${chalk.cyan('npx deckos logs')}`);
  console.log('');

  if (doOpen) {
    await sleep(1500);
    openBrowser(`http://localhost:${webPort}`);
  }
}

async function waitForHealth(url, timeoutSec = 30) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* keep polling */ }
    await sleep(1500);
  }
  return false;
}

function printUrls(env) {
  const apiPort = env.PORT || '8080';
  console.log('');
  console.log(`  ${chalk.cyan('Frontend')}  →  ${chalk.underline('http://localhost:3000')}`);
  console.log(`  ${chalk.cyan('API')}       →  ${chalk.underline(`http://localhost:${apiPort}`)}`);
  console.log('');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
