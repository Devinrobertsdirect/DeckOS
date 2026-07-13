import chalk from 'chalk';

// Blueprint palette — steel-blue accent (#4A7FB5). chalk downsamples
// automatically on terminals without truecolor support.
const steel = typeof chalk.hex === 'function' ? chalk.hex('#4A7FB5') : chalk.cyan;

export function printBanner() {
  console.log('');
  console.log(steel.bold('   █████╗ ████████╗██╗      █████╗ ███████╗'));
  console.log(steel.bold('  ██╔══██╗╚══██╔══╝██║     ██╔══██╗██╔════╝'));
  console.log(steel.bold('  ███████║   ██║   ██║     ███████║███████╗'));
  console.log(steel.bold('  ██╔══██║   ██║   ██║     ██╔══██║╚════██║'));
  console.log(steel.bold('  ██║  ██║   ██║   ███████╗██║  ██║███████║'));
  console.log(steel.bold('  ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝'));
  console.log('');
  console.log(chalk.bold('  DeckOS Atlas') + chalk.gray(' — A Jarvis brain for humans, machines, and robots'));
  console.log(chalk.gray('  local-first · cloud optional'));
  console.log('');
}

export function printDivider() {
  console.log(chalk.gray('  ' + '─'.repeat(58)));
}
