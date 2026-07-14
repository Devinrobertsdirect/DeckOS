import { readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';

/**
 * `atlas hardware` — detect the machine and tell the operator exactly how Atlas
 * will run here: which body backend (virtual sim, Raspberry Pi GPIO, or a
 * microcontroller over serial), the matching profile, and the next step. This is
 * the "set up, run, ready to go anywhere" self-check.
 */

function isRaspberryPi() {
  if (process.platform !== 'linux') return false;
  for (const p of ['/proc/device-tree/model', '/sys/firmware/devicetree/base/model']) {
    try { if (/raspberry pi/i.test(readFileSync(p, 'utf8'))) return true; } catch {}
  }
  try { if (/raspberry pi|bcm2/i.test(readFileSync('/proc/cpuinfo', 'utf8'))) return true; } catch {}
  return false;
}

function candidateSerialPorts() {
  const found = [];
  if (process.platform === 'win32') {
    // Best-effort without a native module: report the env hint if set.
    if (process.env.ATLAS_SERIAL) found.push(process.env.ATLAS_SERIAL);
    return found;
  }
  try {
    for (const name of readdirSync('/dev')) {
      if (/^(ttyUSB|ttyACM|tty\.usbserial|tty\.usbmodem|cu\.usb)/.test(name)) found.push('/dev/' + name);
    }
  } catch {}
  if (process.env.ATLAS_SERIAL && !found.includes(process.env.ATLAS_SERIAL)) found.push(process.env.ATLAS_SERIAL);
  return found;
}

function chooseBackend({ isPi, serialPorts }) {
  if (process.env.ATLAS_SERIAL || serialPorts.length) {
    return { backend: 'serial', profile: 'atlas-esp32 / atlas-nano', reason: 'a microcontroller body is (or can be) wired over serial' };
  }
  if (isPi) return { backend: 'pi', profile: 'atlas-mk-standard', reason: 'running on Raspberry Pi GPIO' };
  return { backend: 'sim', profile: 'desktop', reason: 'no body hardware detected — virtual body (full takeover assistant)' };
}

export async function hardwareCmd() {
  const isPi = isRaspberryPi();
  const serialPorts = candidateSerialPorts();
  const choice = chooseBackend({ isPi, serialPorts });

  const line = (k, v) => console.log('  ' + k.padEnd(16) + v);
  console.log('\n  ATLAS · HARDWARE\n');
  line('platform', `${process.platform} / ${process.arch}`);
  line('host', os.hostname());
  line('raspberry pi', isPi ? 'yes' : 'no');
  line('serial ports', serialPorts.length ? serialPorts.join(', ') : '(none seen)');
  console.log('');
  line('→ body', choice.backend.toUpperCase());
  line('  profile', choice.profile);
  line('  why', choice.reason);
  console.log('');

  if (choice.backend === 'serial') {
    console.log('  Next: flash the firmware, then point Atlas at the board:');
    console.log('    • ESP32  → robotics/firmware/atlas_esp32   (USB serial or WiFi)');
    console.log('    • Nano   → robotics/firmware/atlas_nano    (USB serial)');
    console.log('    • set ATLAS_SERIAL to the port above, then `atlas start`.');
  } else if (choice.backend === 'pi') {
    console.log('  Next: install GPIO support, then run the brain:');
    console.log('    • sudo apt install pigpio && sudo systemctl enable --now pigpiod');
    console.log('    • npm i pigpio (in core/server), then `atlas start`.');
  } else {
    console.log('  Next: `atlas start` — Atlas takes over as your desktop assistant.');
    console.log('  Add a body any time: wire an ESP32/Nano or run on a Pi and re-run this.');
  }
  console.log('');
}
