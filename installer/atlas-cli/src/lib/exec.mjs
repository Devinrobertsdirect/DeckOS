import { spawnSync, execSync } from 'node:child_process';

export function sh(cmd, cwd, env) {
  const result = spawnSync(cmd, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, ...(env || {}) },
  });
  if (result.error) {
    throw new Error(`Could not run command: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd}`);
  }
}

export function openBrowser(url) {
  const p = process.platform;
  const cmd = p === 'darwin' ? `open "${url}"`
            : p === 'win32'  ? `start "" "${url}"`
            : `xdg-open "${url}" 2>/dev/null || true`;
  try { execSync(cmd, { stdio: 'ignore', shell: true }); } catch { /* best effort */ }
}
