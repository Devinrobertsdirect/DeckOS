import chalk from 'chalk';
import { info } from '../lib/logger.mjs';
import { printDivider } from '../lib/banner.mjs';
import { apiGet, isServerDown, printServerDownHint, printTable, statusDot } from '../lib/api.mjs';

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
