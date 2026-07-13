import chalk from 'chalk';
import { info } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';
import { apiGet, isServerDown, printServerDownHint, printTable, statusDot } from '../lib/api.mjs';

export async function devicesCmd() {
  console.log('');
  console.log(chalk.bold('  Atlas — Devices\n'));
  printDivider();
  console.log('');

  let body;
  try {
    body = await apiGet('/api/devices');
  } catch (err) {
    if (isServerDown(err)) {
      printServerDownHint();
      console.log('');
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const devices = body?.devices ?? [];
  if (devices.length === 0) {
    info('No devices registered yet.');
    info(`Connect a robot with: ${chalk.cyan('atlas robot-connect')}`);
    console.log('');
    return;
  }

  printTable(
    ['', 'ID', 'Name', 'Type', 'Status'],
    devices.map((d) => [
      statusDot(d.status === 'online'),
      chalk.cyan(d.id),
      d.name,
      d.type,
      d.status === 'online' ? chalk.green(d.status) : d.status === 'error' ? chalk.red(d.status) : chalk.yellow(d.status),
    ]),
  );

  console.log('');
  const online = devices.filter((d) => d.status === 'online').length;
  info(`${devices.length} device(s) — ${online} online`);
  console.log('');
}
