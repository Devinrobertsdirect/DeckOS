import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * atlas pi-setup — make the Raspberry Pi a self-contained Atlas robot brain.
 *
 * A Pi isn't "flashed" like an Arduino — it's the computer that RUNS Atlas. Run
 * this ON the Pi and it installs Node + pigpio, builds Atlas, enables GPIO, and
 * sets up an autostart service so it boots straight into the brain. Run it
 * anywhere else and it just prints the one-liner to run on the Pi.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'pi-setup.sh');
const RAW_URL = 'https://raw.githubusercontent.com/Devinrobertsdirect/DeckOS/atlas/installer/atlas-cli/scripts/pi-setup.sh';

function isRaspberryPi() {
  if (process.platform !== 'linux') return false;
  for (const p of ['/proc/device-tree/model', '/proc/cpuinfo']) {
    try { if (/raspberry pi|bcm2/i.test(readFileSync(p, 'utf8'))) return true; } catch {}
  }
  return false;
}

export async function piSetupCmd(opts = {}) {
  console.log('');
  console.log(chalk.bold('  Atlas — Raspberry Pi setup (the standalone robot brain)\n'));

  if (!isRaspberryPi() && !opts.force) {
    console.log('  A Pi runs Atlas; it isn\'t flashed like a Nano. Run this ON the Pi:\n');
    console.log('    ' + chalk.cyan(`curl -fsSL ${RAW_URL} -o /tmp/atlas-pi-setup.sh && bash /tmp/atlas-pi-setup.sh`));
    console.log('\n  or, from a copy of the repo on the Pi:');
    console.log('    ' + chalk.cyan('bash installer/atlas-cli/scripts/pi-setup.sh'));
    console.log('\n  It installs Node + pigpio, builds Atlas, and sets it to auto-start on boot.');
    console.log('  Then open ' + chalk.cyan('http://<pi>.local:8080') + ' and add a body with ' + chalk.cyan('atlas flash') + '.\n');
    return;
  }

  if (!existsSync(SCRIPT)) {
    console.log(chalk.red(`  Setup script not found at ${SCRIPT}.`));
    console.log('  Run the hosted one instead:  ' + chalk.cyan(`curl -fsSL ${RAW_URL} -o /tmp/atlas-pi-setup.sh && bash /tmp/atlas-pi-setup.sh`));
    process.exitCode = 1;
    return;
  }

  console.log('  Provisioning this Pi as an Atlas brain (installs deps + autostart)…\n');
  const r = spawnSync('bash', [SCRIPT], { stdio: 'inherit' });
  if (r.status !== 0) { console.log(chalk.red('\n  Setup failed — see the output above.')); process.exitCode = 1; }
}
