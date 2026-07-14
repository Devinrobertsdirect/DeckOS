import chalk from 'chalk';
import { execSync, spawnSync } from 'node:child_process';
import { info } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';
import { apiGet, isServerDown, printServerDownHint, printTable, statusDot } from '../lib/api.mjs';

/**
 * atlas brain --install — give Atlas a FREE local brain so it can always talk,
 * offline, with no API key. Installs a small Ollama model (default llama3.2:1b,
 * ~1.3 GB) and points Atlas at it. This is the "no matter what, he can talk"
 * guarantee, on top of the always-on rule engine.
 */
function hasOllama() {
  try { execSync('ollama --version', { stdio: 'ignore' }); return true; } catch { return false; }
}

export async function brainInstallCmd(opts = {}) {
  const model = opts.model || 'llama3.2:1b';
  console.log('');
  console.log(chalk.bold('  Atlas — install a free local brain\n'));
  printDivider();
  console.log('');

  if (!hasOllama()) {
    console.log('  Ollama (the free, local AI runtime) isn\'t installed yet.');
    if (process.platform === 'win32') {
      console.log(`  Install it: ${chalk.cyan('https://ollama.com/download')} (Windows installer),`);
      console.log(`  then re-run: ${chalk.cyan('atlas brain --install')}`);
    } else {
      console.log(`  Install it: ${chalk.cyan('curl -fsSL https://ollama.com/install.sh | sh')}`);
      console.log(`  then re-run: ${chalk.cyan('atlas brain --install')}`);
    }
    console.log('');
    process.exitCode = 1;
    return;
  }

  console.log(`  Pulling ${chalk.cyan(model)} — small, capable, and free. This is a one-time download.\n`);
  const pull = spawnSync('ollama', ['pull', model], { stdio: 'inherit' });
  if (pull.status !== 0) {
    console.log(chalk.red('\n  Model pull failed. Check your connection and try again.\n'));
    process.exitCode = 1;
    return;
  }

  // Point Atlas at the new model (best-effort — works even if the server is down;
  // config persists to ~/.atlas/config.json and is picked up on next start).
  try {
    await fetch('http://localhost:8080/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ REASONING_MODEL: model, FAST_MODEL: model }),
    });
    console.log(chalk.green(`\n  Done — ${model} is installed and set as Atlas's local brain.`));
    console.log('  It can now talk for free, fully offline. No API key needed.\n');
  } catch {
    console.log(chalk.green(`\n  Done — ${model} installed.`));
    console.log(`  Start Atlas (${chalk.cyan('atlas start')}) and it'll be detected automatically.\n`);
  }
}

/**
 * atlas brain — show the AI Router tier stack (GET /api/ai-router/status).
 *
 * Tiers:
 *   APEX      — cloud reasoning (Claude / OpenAI), available when an API key is configured
 *   CORTEX    — local Ollama reasoning model (chat, planning, summarization)
 *   REFLEX    — local Ollama fast model (classification, routing, quick commands)
 *   AUTOPILOT — deterministic rule engine (always available)
 */
export async function brainCmd() {
  console.log('');
  console.log(chalk.bold('  Atlas — Brain (AI Router)\n'));
  printDivider();
  console.log('');

  let s;
  try {
    s = await apiGet('/api/ai-router/status');
  } catch (err) {
    if (isServerDown(err)) {
      printServerDownHint();
      console.log('');
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const models = s.models ?? {};
  const tierStats = s.tierStats ?? {};

  const avail = (available) => (available ? chalk.green('available') : chalk.gray('offline'));

  printTable(
    ['', 'Tier', 'Engine', 'Model', 'Availability', 'Requests'],
    [
      [
        statusDot(!!s.cloudAvailable),
        chalk.bold('APEX'),
        'claude (cloud)',
        s.cloudAvailable ? 'claude (API key configured)' : '—',
        avail(!!s.cloudAvailable),
        '—',
      ],
      [
        statusDot(!!s.ollamaAvailable),
        chalk.bold('CORTEX'),
        'ollama',
        models.cortex ?? '—',
        avail(!!s.ollamaAvailable),
        String(tierStats.cortexRequests ?? 0),
      ],
      [
        statusDot(!!s.ollamaAvailable),
        chalk.bold('REFLEX'),
        'ollama',
        models.reflex ?? '—',
        avail(!!s.ollamaAvailable),
        String(tierStats.reflexRequests ?? 0),
      ],
      [
        statusDot(true),
        chalk.bold('AUTOPILOT'),
        'rule engine',
        models.autopilot ?? 'rule-engine-v1',
        chalk.green('always on'),
        String(tierStats.autopilotRequests ?? 0),
      ],
    ],
  );

  console.log('');
  info(`Mode: ${chalk.cyan(s.mode)}${s.fallbackMode ? chalk.yellow('  (fallback — no local or cloud AI detected)') : ''}`);
  info(`Active model: ${chalk.cyan(s.activeModel ?? 'rule engine')}`);
  info(`Total requests: ${chalk.cyan(String(s.totalRequests ?? 0))} — cache hit rate ${chalk.cyan(`${Math.round((s.cacheHitRate ?? 0) * 100)}%`)}`);

  if (Array.isArray(s.ollamaModels) && s.ollamaModels.length > 0) {
    info(`Ollama models detected: ${s.ollamaModels.map((m) => chalk.cyan(typeof m === 'string' ? m : m?.name ?? '?')).join(', ')}`);
  } else if (!s.ollamaAvailable) {
    info(`Local AI is offline. Install Ollama (https://ollama.com), then: ${chalk.cyan('ollama pull gemma4 && ollama pull phi3')}`);
  }
  console.log('');
}
