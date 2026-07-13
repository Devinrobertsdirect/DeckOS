#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';

import { startCmd }  from '../src/commands/start.mjs';
import { stopCmd }   from '../src/commands/stop.mjs';
import { statusCmd } from '../src/commands/status.mjs';
import { doctorCmd } from '../src/commands/doctor.mjs';
import { updateCmd } from '../src/commands/update.mjs';
import { printBanner } from '../src/lib/banner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('deckos')
  .description('JARVIS Command Center — AI-powered local dashboard')
  .version(pkg.version, '-v, --version');

// ── start ──────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start Deck OS (setup on first run)')
  .option('--docker', 'Force Docker Compose mode')
  .option('--bare',   'Force bare-metal mode (no Docker)')
  .option('--no-open','Do not open browser automatically')
  .action(async (opts) => {
    await startCmd({ docker: opts.docker, bare: opts.bare, open: opts.open });
  });

// ── stop ───────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop all Deck OS services')
  .option('--docker', 'Force Docker Compose stop')
  .action(async (opts) => {
    await stopCmd({ docker: opts.docker });
  });

// ── status ─────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show service health and process status')
  .action(async () => {
    await statusCmd();
  });

// ── doctor ─────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check prerequisites and system compatibility')
  .action(async () => {
    await doctorCmd({ silent: false });
  });

// ── update ─────────────────────────────────────────────────────────────────
program
  .command('update')
  .description('Pull latest changes, reinstall deps, run migrations')
  .action(async () => {
    await updateCmd();
  });

// ── Default: show banner + help ────────────────────────────────────────────
if (process.argv.length === 2) {
  printBanner();
  program.help();
}

program.parseAsync(process.argv).catch(err => {
  console.error('\n  Error:', err.message);
  process.exit(1);
});
