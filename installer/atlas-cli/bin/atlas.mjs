#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';

import { startCmd }  from '../src/commands/start.mjs';
import { stopCmd }   from '../src/commands/stop.mjs';
import { statusCmd } from '../src/commands/status.mjs';
import { doctorCmd } from '../src/commands/doctor.mjs';
import { updateCmd } from '../src/commands/update.mjs';
import { devicesCmd } from '../src/commands/devices.mjs';
import { pluginsListCmd, pluginsStoreCmd, pluginsInstallCmd } from '../src/commands/plugins.mjs';
import { brainCmd, brainInstallCmd } from '../src/commands/brain.mjs';
import { robotConnectCmd } from '../src/commands/robot-connect.mjs';
import { hardwareCmd } from '../src/commands/hardware.mjs';
import { flashCmd } from '../src/commands/flash.mjs';
import { piSetupCmd } from '../src/commands/pi-setup.mjs';
import { printBanner } from '../src/lib/banner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('atlas')
  .description('DeckOS Atlas — A Jarvis brain for humans, machines, and robots')
  .version(pkg.version, '-v, --version');

// ── install ────────────────────────────────────────────────────────────────
// First-run setup is built into `start` (clone → env → deps → migrations).
// `install` is an explicit alias so `atlas install` does what newcomers expect.
program
  .command('install')
  .description('Install & set up DeckOS Atlas (alias of start — setup runs on first launch)')
  .option('--docker', 'Force Docker Compose mode')
  .option('--bare',   'Force bare-metal mode (no Docker)')
  .option('--no-open','Do not open browser automatically')
  .action(async (opts) => {
    await startCmd({ docker: opts.docker, bare: opts.bare, open: opts.open });
  });

// ── start ──────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start DeckOS Atlas (setup on first run)')
  .option('--docker', 'Force Docker Compose mode')
  .option('--bare',   'Force bare-metal mode (no Docker)')
  .option('--no-open','Do not open browser automatically')
  .action(async (opts) => {
    await startCmd({ docker: opts.docker, bare: opts.bare, open: opts.open });
  });

// ── stop ───────────────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop all DeckOS Atlas services')
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

// ── devices ────────────────────────────────────────────────────────────────
program
  .command('devices')
  .description('List connected devices (id, name, type, status)')
  .action(async () => {
    await devicesCmd();
  });

// ── plugins ────────────────────────────────────────────────────────────────
const plugins = program
  .command('plugins')
  .description('Manage plugins (list · store · install)');

plugins
  .command('list', { isDefault: true })
  .description('List installed plugins (default)')
  .action(async () => {
    await pluginsListCmd();
  });

plugins
  .command('store')
  .description('Browse the community plugin store registry')
  .action(async () => {
    await pluginsStoreCmd();
  });

plugins
  .command('install <id>')
  .description('Install a plugin from the store')
  .option('--force', 'Re-install even if already installed')
  .action(async (id, opts) => {
    await pluginsInstallCmd(id, { force: opts.force });
  });

// ── brain ──────────────────────────────────────────────────────────────────
program
  .command('brain')
  .description('Show the AI Router tiers, or install a free local brain (--install)')
  .option('--install', 'Install a free local LLM (Ollama) so Atlas always talks, offline')
  .option('--model <name>', 'Model to install (default: llama3.2:1b)')
  .action(async (opts) => {
    if (opts.install) await brainInstallCmd(opts);
    else await brainCmd();
  });

// ── robot-connect ──────────────────────────────────────────────────────────
program
  .command('robot-connect [host]')
  .description('Ping a robot body (default: atlas.local) and print connection steps')
  .action(async (host) => {
    await robotConnectCmd(host || 'atlas.local');
  });

// ── hardware ─────────────────────────────────────────────────────────────────
program
  .command('hardware')
  .description('Detect this machine and show how Atlas will run (sim / Pi / serial body)')
  .action(async () => {
    await hardwareCmd();
  });

// ── flash ────────────────────────────────────────────────────────────────────
program
  .command('flash')
  .description('Flash the Atlas body firmware onto a connected Arduino/ESP32 (auto toolchain)')
  .option('--esp32', 'Flash the ESP32 firmware (default: Arduino Nano/Uno)')
  .option('--uno', 'Target an Arduino Uno')
  .option('--port <port>', 'Serial port to use (e.g. COM5, /dev/ttyUSB0)')
  .option('--old', 'Nano clones with the old bootloader (atmega328old)')
  .action(async (opts) => {
    await flashCmd(opts);
  });

// ── pi-setup ─────────────────────────────────────────────────────────────────
program
  .command('pi-setup')
  .description('Provision a Raspberry Pi as a self-contained Atlas brain (run on the Pi)')
  .option('--force', 'Run the provisioning even if this does not look like a Pi')
  .action(async (opts) => {
    await piSetupCmd(opts);
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
