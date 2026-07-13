import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline';
import { ok, warn, info } from './logger.mjs';

export function loadEnvFile(repoDir) {
  const envPath = join(repoDir, '.env');
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val  = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export async function ensureEnvFile(repoDir) {
  const envPath    = join(repoDir, '.env');
  const examplePath = join(repoDir, '.env.example');

  if (existsSync(envPath)) {
    ok('.env already exists');
    return;
  }

  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    ok('Created .env from .env.example');
  } else {
    const defaultEnv = [
      '# Deck OS environment configuration',
      `DATABASE_URL=postgresql://deckos:deckos@localhost:5432/deckos`,
      `SESSION_SECRET=${randomHex(32)}`,
      `PORT=8080`,
      `NODE_ENV=production`,
    ].join('\n') + '\n';
    writeFileSync(envPath, defaultEnv);
    ok('Created default .env');
  }

  warn('Review .env at: ' + envPath);
  warn('Set DATABASE_URL if your Postgres credentials differ from the defaults.');
  await prompt('  Press ENTER to continue (or Ctrl+C to edit .env first): ');
}

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => { rl.close(); resolve(); });
  });
}

function randomHex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
