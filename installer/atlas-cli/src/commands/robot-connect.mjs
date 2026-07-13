import chalk from 'chalk';
import { ok, warn, info } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';
import { API_BASE } from '../lib/api.mjs';

const ROBOT_PORT = 8000;

async function ping(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON is fine for a health ping */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  }
}

/**
 * atlas robot-connect [host] — best-effort handshake with a robot body.
 * Pings http://<host>:8000/health and prints next steps.
 */
export async function robotConnectCmd(host = 'atlas.local') {
  console.log('');
  console.log(chalk.bold('  Atlas — Robot Connect\n'));
  printDivider();
  console.log('');

  const healthUrl = `http://${host}:${ROBOT_PORT}/health`;
  const wsUrl     = `ws://${host}:${ROBOT_PORT}/ws`;

  info(`Looking for a robot at ${chalk.cyan(host)}...`);
  const result = await ping(healthUrl);

  if (!result) {
    console.log('');
    warn(`No robot answered at ${chalk.cyan(healthUrl)}.`);
    console.log('');
    console.log('  Things to check:');
    console.log(`    ${chalk.gray('•')} Is the robot powered on and on the same network?`);
    console.log(`    ${chalk.gray('•')} Does ${chalk.cyan(host)} resolve? Try an IP address instead:`);
    console.log(`        ${chalk.cyan('atlas robot-connect 192.168.1.42')}`);
    console.log(`    ${chalk.gray('•')} Is the robot bridge listening on port ${ROBOT_PORT}?`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  ok(`Robot found at ${chalk.cyan(host)} — health endpoint responded (HTTP ${result.status}).`);
  if (result.body && typeof result.body === 'object') {
    const name = result.body.name || result.body.id || null;
    const version = result.body.version || null;
    if (name)    info(`Robot identifies as: ${chalk.cyan(name)}${version ? chalk.gray(` (v${version})`) : ''}`);
  }
  info(`WebSocket telemetry hint: ${chalk.cyan(wsUrl)}`);

  console.log('');
  console.log(chalk.bold('  Next steps'));
  console.log('');
  console.log(`    1. Make sure the Atlas server is running: ${chalk.cyan('atlas start')}`);
  console.log(`    2. The Atlas device manager discovers devices over MQTT/WebSocket —`);
  console.log(`       point the robot bridge at your Atlas server:`);
  console.log(`         ${chalk.cyan(`ATLAS_API=${API_BASE}`)}   (on the robot)`);
  console.log(`    3. Give the robot a friendly profile (name/location) via the API:`);
  console.log(`         ${chalk.cyan(`POST ${API_BASE}/api/devices/profile/<deviceId>`)}`);
  console.log(`    4. Verify it appears in the device list: ${chalk.cyan('atlas devices')}`);
  console.log(`       ...or open the dashboard Devices page at ${chalk.underline('http://localhost:3000')}`);
  console.log('');
  info('Note: there is no automatic registration endpoint yet — the robot announces');
  info('itself to the device manager, or you can add it manually as shown above.');
  console.log('');
}
