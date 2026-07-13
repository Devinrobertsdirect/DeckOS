import chalk from 'chalk';
import { warn, info } from './logger.mjs';

export const API_BASE = process.env.ATLAS_API_URL || 'http://localhost:8080';

export class ApiError extends Error {
  constructor(message, { status = null, body = null, cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.cause = cause;
  }
}

async function request(method, path, body, timeoutMs = 8000) {
  const url = `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ApiError(`Could not reach the Atlas API at ${API_BASE}`, { cause: err });
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const msg = data?.error || `${method} ${path} failed (HTTP ${res.status})`;
    throw new ApiError(msg, { status: res.status, body: data });
  }
  return data;
}

export const apiGet  = (path, timeoutMs) => request('GET', path, undefined, timeoutMs);
export const apiPost = (path, body = {}, timeoutMs) => request('POST', path, body, timeoutMs);

/** True when the error means "server unreachable" (vs. an HTTP error). */
export function isServerDown(err) {
  return err instanceof ApiError && err.status === null;
}

export function printServerDownHint() {
  warn(`The Atlas API is not responding at ${chalk.cyan(API_BASE)}.`);
  info(`Start it with: ${chalk.cyan('atlas start')}   (then re-run this command)`);
  info(`Or check service health with: ${chalk.cyan('atlas status')}`);
}

function cellText(value) {
  if (value === null || value === undefined) return '—';
  return String(value);
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const visibleLength = (s) => s.replace(ANSI_RE, '').length;
const padCell = (s, width) => s + ' '.repeat(Math.max(0, width - visibleLength(s)));

/**
 * Print a simple aligned table.
 * @param {string[]} headers
 * @param {Array<Array<string|number|null>>} rows — cells may contain chalk colors
 */
export function printTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(cellText(r[i])))),
  );
  const line = (cells, style = (x) => x) =>
    console.log('  ' + cells.map((c, i) => padCell(style(cellText(c)), widths[i])).join('   '));

  line(headers, (h) => chalk.bold(h));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('───'));
  for (const row of rows) line(row);
}

export function statusDot(good) {
  return good ? chalk.green('●') : chalk.red('○');
}
