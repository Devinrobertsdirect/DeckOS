import chalk from 'chalk';
import { ok, warn, info, fail } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';
import { apiGet, apiPost, isServerDown, printServerDownHint, printTable, statusDot, ApiError } from '../lib/api.mjs';

function handleApiError(err) {
  if (isServerDown(err)) {
    printServerDownHint();
    console.log('');
    process.exitCode = 1;
    return true;
  }
  return false;
}

/** atlas plugins — list installed/built-in plugins (GET /api/plugins) */
export async function pluginsListCmd() {
  console.log('');
  console.log(chalk.bold('  Atlas — Plugins\n'));
  printDivider();
  console.log('');

  let body;
  try {
    body = await apiGet('/api/plugins');
  } catch (err) {
    if (handleApiError(err)) return;
    throw err;
  }

  const plugins = body?.plugins ?? [];
  if (plugins.length === 0) {
    info('No plugins found.');
    console.log('');
    return;
  }

  printTable(
    ['', 'ID', 'Name', 'Version', 'Category', 'Status'],
    plugins.map((p) => [
      statusDot(p.enabled && p.status === 'active'),
      chalk.cyan(p.id),
      p.name,
      p.version,
      p.category,
      p.status === 'active' ? chalk.green(p.status) : p.status === 'error' ? chalk.red(p.status) : chalk.yellow(p.status),
    ]),
  );

  console.log('');
  info(`Browse more plugins with: ${chalk.cyan('atlas plugins store')}`);
  console.log('');
}

/** atlas plugins store — list the community store registry (GET /api/plugins/store/registry) */
export async function pluginsStoreCmd() {
  console.log('');
  console.log(chalk.bold('  Atlas — Plugin Store\n'));
  printDivider();
  console.log('');

  let body;
  try {
    body = await apiGet('/api/plugins/store/registry');
  } catch (err) {
    if (handleApiError(err)) return;
    if (err instanceof ApiError && err.status === 500) {
      warn('The plugin registry could not be loaded.');
      info('Set PLUGIN_REGISTRY_URL in .env or place a registry.json next to the server.');
      console.log('');
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const plugins = body?.plugins ?? [];
  if (plugins.length === 0) {
    info('The store registry is empty.');
    console.log('');
    return;
  }

  printTable(
    ['ID', 'Name', 'Version', 'Author', 'Category', 'Installed'],
    plugins.map((p) => [
      chalk.cyan(p.id),
      p.name,
      p.version,
      p.author,
      p.category,
      p.installed ? chalk.green('yes') : chalk.gray('no'),
    ]),
  );

  console.log('');
  info(`Registry v${body.version} — updated ${body.updatedAt}`);
  info(`Install a plugin with: ${chalk.cyan('atlas plugins install <id>')}`);
  console.log('');
}

/** atlas plugins install <id> — POST /api/plugins/store/install/:pluginId */
export async function pluginsInstallCmd(pluginId, opts = {}) {
  console.log('');
  let body;
  try {
    body = await apiPost(`/api/plugins/store/install/${encodeURIComponent(pluginId)}`, {
      force: !!opts.force,
    }, 30_000);
  } catch (err) {
    if (handleApiError(err)) return;
    if (err instanceof ApiError && err.status === 409) {
      warn(`Plugin ${chalk.cyan(pluginId)} is already installed.`);
      info(`Re-install with: ${chalk.cyan(`atlas plugins install ${pluginId} --force`)}`);
      console.log('');
      return;
    }
    if (err instanceof ApiError && err.status === 404) {
      fail(`Plugin '${pluginId}' was not found in the store registry. See: atlas plugins store`);
    }
    fail(err.message);
  }

  ok(`Installed ${chalk.cyan(body.pluginId)} v${body.version}`);
  if (body.runtimeLoaded) {
    ok('Plugin loaded into the sandboxed runtime.');
  } else if (body.warning) {
    warn(body.warning);
  }
  console.log('');
}
