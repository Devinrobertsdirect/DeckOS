import chalk from 'chalk';
import {
  nodeVersion, pnpmVersion, gitVersion,
  dockerAvailable, dockerComposeAvailable,
  pgAvailable, ollamaAvailable, ollamaRunning,
  majorVersion,
} from '../lib/detect.mjs';
import { ok, warn, fail, info } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';

export async function doctorCmd(opts = {}) {
  const silent = opts.silent ?? false;
  const issues = [];

  if (!silent) {
    console.log(chalk.bold('\n  System Check\n'));
    printDivider();
    console.log('');
  }

  const check = (label, value, req, hint) => {
    if (value) {
      if (!silent) ok(`${label}: ${chalk.green(value)}`);
      return true;
    } else {
      const msg = `${label} not found. ${hint || ''}`;
      if (req) {
        if (!silent) fail(msg);
        issues.push({ label, msg, required: true });
      } else {
        if (!silent) warn(`${label}: not found (optional). ${hint || ''}`);
        issues.push({ label, msg, required: false });
      }
      return false;
    }
  };

  const nodeVer  = nodeVersion();
  const nodeMajor = majorVersion(nodeVer);
  if (nodeVer) {
    if (nodeMajor < 20) {
      if (!silent) warn(`Node.js v${nodeVer} found but v20+ required. Upgrade: https://nodejs.org`);
      issues.push({ label: 'Node.js', msg: 'Requires v20+', required: true });
    } else {
      if (!silent) ok(`Node.js: ${chalk.green('v' + nodeVer)}`);
    }
  } else {
    if (!silent) warn('Node.js: not found. Install from https://nodejs.org');
    issues.push({ label: 'Node.js', msg: 'Not found', required: true });
  }

  check('pnpm', pnpmVersion(), true, 'Install: npm install -g pnpm');
  check('git',  gitVersion(),  true, 'Install: https://git-scm.com');

  const docker = dockerAvailable();
  const dockerCompose = docker && dockerComposeAvailable();
  if (!silent) console.log('');

  if (docker) {
    if (!silent) ok(`Docker: ${chalk.green('running')}`);
    if (dockerCompose) {
      if (!silent) ok(`Docker Compose: ${chalk.green('available')}`);
    } else {
      if (!silent) warn('Docker Compose: not found (needed for Docker mode)');
    }
  } else {
    if (!silent) warn('Docker: not available (optional — use bare-metal mode instead)');
    const pg = pgAvailable();
    if (pg) {
      if (!silent) ok(`PostgreSQL client: ${chalk.green('found')}`);
    } else {
      if (!silent) warn('PostgreSQL: not found. Install: https://www.postgresql.org/download/');
      issues.push({ label: 'PostgreSQL', msg: 'Required for bare-metal mode', required: false });
    }
  }

  if (!silent) console.log('');

  const ollama = ollamaAvailable();
  if (ollama) {
    const running = ollamaRunning();
    if (!silent) ok(`Ollama: ${chalk.green('installed')}${running ? '' : chalk.yellow(' (not running — start with: ollama serve)')}`);
    if (!running && !silent) info('Pull models: ollama pull gemma4 && ollama pull phi3');
  } else {
    if (!silent) warn('Ollama: not found (optional — Deck OS runs in rule-engine fallback mode)');
    if (!silent) info('Install from: https://ollama.com');
  }

  if (!silent) {
    console.log('');
    printDivider();
    const required = issues.filter(i => i.required);
    if (required.length === 0) {
      console.log(`\n  ${chalk.green.bold('✓ All required dependencies met.')}\n`);
    } else {
      console.log(`\n  ${chalk.red.bold(`✗ ${required.length} required issue(s) found.`)}\n`);
      for (const issue of required) {
        console.log(`    ${chalk.red('•')} ${issue.msg}`);
      }
      console.log('');
    }
  }

  return {
    ok: issues.filter(i => i.required).length === 0,
    docker,
    dockerCompose,
    issues,
  };
}
