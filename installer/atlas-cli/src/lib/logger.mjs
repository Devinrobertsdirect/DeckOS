import chalk from 'chalk';

const prefix = chalk.bold.cyan('[deck-os]');

export const log   = (...args) => console.log(`  ${prefix}`, ...args);
export const ok    = (...args) => console.log(`  ${chalk.green('✓')}`, ...args);
export const warn  = (...args) => console.log(`  ${chalk.yellow('⚠')}`, ...args);
export const info  = (...args) => console.log(`  ${chalk.blue('ℹ')}`, ...args);
export const fail  = (...args) => { console.error(`  ${chalk.red('✗ ERROR:')}`, ...args); process.exit(1); };
export const step  = (n, total, msg) => console.log(`  ${chalk.bold.white(`[${n}/${total}]`)} ${msg}`);

export function spinner(msg) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(frames[i++ % frames.length])} ${msg}`);
  }, 80);
  return {
    stop(doneMsg) {
      clearInterval(id);
      process.stdout.write(`\r  ${chalk.green('✓')} ${doneMsg || msg}\n`);
    },
    fail(errMsg) {
      clearInterval(id);
      process.stdout.write(`\r  ${chalk.red('✗')} ${errMsg || msg}\n`);
    }
  };
}
