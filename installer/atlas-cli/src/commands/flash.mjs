import chalk from 'chalk';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

/**
 * atlas flash — the "auto make magic robot brain" feature.
 *
 * One command turns a blank Arduino/ESP32 into an Atlas body: it makes sure the
 * Arduino toolchain (arduino-cli) is present, installs the right core, finds the
 * board's port, compiles the firmware, and uploads it. Then the board speaks the
 * Atlas Wire Protocol and the brain can drive it.
 *
 *   atlas flash                 # auto-detect a Nano/Uno on a USB port and flash it
 *   atlas flash --esp32         # flash the ESP32 firmware instead
 *   atlas flash --port COM5     # force a port
 *   atlas flash --old           # Nano clones with the OLD bootloader
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// installer/atlas-cli/src/commands → repo root is four levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const FW_DIR = join(REPO_ROOT, 'robotics', 'firmware');
const TOOLS_DIR = join(process.env.ATLAS_DATA_DIR || join(homedir(), '.atlas'), 'tools');

const BOARDS = {
  nano:  { fqbn: 'arduino:avr:nano',   fqbnOld: 'arduino:avr:nano:cpu=atmega328old', core: 'arduino:avr', sketch: 'atlas_nano',  extraUrls: null },
  uno:   { fqbn: 'arduino:avr:uno',    fqbnOld: 'arduino:avr:uno',                   core: 'arduino:avr', sketch: 'atlas_nano',  extraUrls: null },
  esp32: { fqbn: 'esp32:esp32:esp32',  fqbnOld: 'esp32:esp32:esp32',                 core: 'esp32:esp32', sketch: 'atlas_esp32', extraUrls: 'https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json' },
};

function cliName() { return process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli'; }

/** Locate arduino-cli on PATH or in our tools dir; download it if missing. */
async function ensureArduinoCli() {
  // On PATH?
  try { execSync(`${cliName()} version`, { stdio: 'ignore' }); return cliName(); } catch { /* keep looking */ }
  const local = join(TOOLS_DIR, cliName());
  if (existsSync(local)) return local;

  console.log('  Fetching the Arduino toolchain (one-time)…');
  mkdirSync(TOOLS_DIR, { recursive: true });
  const plat = process.platform;
  const arch = process.arch;
  const file =
    plat === 'win32' ? 'arduino-cli_latest_Windows_64bit.zip'
    : plat === 'darwin' ? (arch === 'arm64' ? 'arduino-cli_latest_macOS_ARM64.tar.gz' : 'arduino-cli_latest_macOS_64bit.tar.gz')
    : (arch === 'arm64' ? 'arduino-cli_latest_Linux_ARM64.tar.gz' : 'arduino-cli_latest_Linux_64bit.tar.gz');
  const url = `https://downloads.arduino.cc/arduino-cli/${file}`;
  const archive = join(TOOLS_DIR, file);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download arduino-cli (${res.status}). Install it from https://arduino.github.io/arduino-cli/`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  // tar (bsdtar on Win 10+, GNU tar on unix) handles both .zip and .tar.gz.
  const un = spawnSync('tar', ['-xf', archive, '-C', TOOLS_DIR], { stdio: 'inherit' });
  if (un.status !== 0 || !existsSync(local)) throw new Error('Failed to unpack arduino-cli. Install it manually from https://arduino.github.io/arduino-cli/');
  return local;
}

function run(acli, args, opts = {}) {
  return spawnSync(acli, args, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}

/** Pick the most likely board port: an explicit --port, else a USB serial port. */
function detectPort(acli, wanted) {
  if (wanted) return wanted;
  const r = run(acli, ['board', 'list'], { capture: true });
  const lines = (r.stdout || '').split('\n').slice(1);
  // Prefer a USB serial port; fall back to the first serial port that isn't a
  // Bluetooth modem (those show up as plain "Serial Port", not "(USB)").
  const usb = lines.find((l) => /\(USB\)/i.test(l));
  const pick = (usb || lines.find((l) => /serial/i.test(l)) || '').trim().split(/\s+/)[0];
  return pick || null;
}

export async function flashCmd(opts = {}) {
  const key = opts.esp32 ? 'esp32' : opts.uno ? 'uno' : 'nano';
  const board = BOARDS[key];
  console.log('');
  console.log(chalk.bold(`  Atlas — flashing a ${key.toUpperCase()} robot brain\n`));

  let acli;
  try { acli = await ensureArduinoCli(); }
  catch (err) { console.log(chalk.red(`  ${err.message}`)); process.exitCode = 1; return; }

  // Core (compiler + uploader) for this board family.
  run(acli, ['core', 'update-index', ...(board.extraUrls ? ['--additional-urls', board.extraUrls] : [])]);
  console.log(`  Ensuring the ${board.core} toolchain…`);
  run(acli, ['core', 'install', board.core, ...(board.extraUrls ? ['--additional-urls', board.extraUrls] : [])]);

  // Keep the sketch self-contained (Arduino copies the folder at build time).
  const sketchDir = join(FW_DIR, board.sketch);
  try { copyFileSync(join(FW_DIR, 'AtlasWireProtocol.h'), join(sketchDir, 'AtlasWireProtocol.h')); } catch { /* already there */ }

  const port = detectPort(acli, opts.port);
  if (!port) {
    console.log(chalk.yellow('  No board port found. Plug the board in and try again, or pass --port COM5.'));
    process.exitCode = 1; return;
  }
  const fqbn = opts.old ? board.fqbnOld : board.fqbn;
  console.log(`  Board on ${chalk.cyan(port)} · ${chalk.cyan(fqbn)}\n`);

  console.log('  Compiling firmware…');
  const c = run(acli, ['compile', '-b', fqbn, sketchDir]);
  if (c.status !== 0) { console.log(chalk.red('\n  Compile failed.')); process.exitCode = 1; return; }

  console.log('  Uploading to the board…');
  let u = run(acli, ['upload', '-p', port, '-b', fqbn, sketchDir]);
  if (u.status !== 0 && !opts.old && key !== 'esp32') {
    console.log(chalk.yellow('  Upload failed — retrying with the OLD bootloader (common on Nano clones)…'));
    u = run(acli, ['upload', '-p', port, '-b', board.fqbnOld, sketchDir]);
  }
  if (u.status !== 0) { console.log(chalk.red('\n  Upload failed. Try --old, or check the cable/port.')); process.exitCode = 1; return; }

  console.log(chalk.green(`\n  Done — your ${key} is now an Atlas body, speaking the Atlas Wire Protocol.`));
  console.log('  Connect the brain to it:');
  console.log(`    ${chalk.cyan(`export ATLAS_SERIAL=${port}`)}   (Windows: set ATLAS_SERIAL=${port})`);
  console.log(`    ${chalk.cyan('atlas start')}\n`);
}
