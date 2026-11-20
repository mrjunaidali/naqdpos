// `pnpm dev:lan`: test the POS app on a phone on the same Wi-Fi (development only).
// Starts the API (localhost:8787) and the POS dev server with HTTPS on all interfaces. The app
// calls the API through the dev server's /api proxy, so only port 5173 is reachable from the
// phone and the API itself stays on this PC.
//
// Windows Firewall: allow the dev server on Private networks once, from an admin PowerShell:
//   New-NetFirewallRule -DisplayName "NaqdPOS dev server (5173)" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
// Remove it later with:
//   Remove-NetFirewallRule -DisplayName "NaqdPOS dev server (5173)"
import { spawn, type ChildProcess } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const PORT = 5173;

/** Virtual adapters a phone cannot reach (WSL, Hyper-V, VMs, Docker). */
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|Loopback/i;

/** Private IPv4 addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x) of real network adapters. */
function lanAddresses(): { ip: string; name: string }[] {
  const found: { ip: string; name: string }[] = [];
  for (const [name, nets] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const net of nets ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const [a, b] = net.address.split('.').map(Number);
      const isPrivate = a === 10 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31);
      if (isPrivate) found.push({ ip: net.address, name });
    }
  }
  return found;
}

function start(name: string, command: string, env: NodeJS.ProcessEnv): ChildProcess {
  // One command string: pnpm is a .cmd shim on Windows, so it needs a shell.
  const child = spawn(command, { stdio: 'inherit', shell: true, env });
  child.on('exit', (code) => {
    console.log(`[dev:lan] ${name} stopped (${code ?? 'signal'})`);
    stopAll();
  });
  return child;
}

const children: ChildProcess[] = [];
function stopAll() {
  for (const child of children) if (!child.killed) child.kill();
  process.exit(0);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

children.push(start('API', 'pnpm --filter @naqdpos/api dev', process.env));
children.push(
  start('POS', 'pnpm --filter @naqdpos/pos dev', {
    ...process.env,
    NAQDPOS_LAN: '1',
    // Empty/"/api" = call the API through the dev server's own origin (apps/pos/src/api/baseUrl.ts).
    VITE_API_URL: '/api',
  }),
);

const addresses = lanAddresses();
console.log('');
console.log('[dev:lan] Open the POS app on your phone:');
if (addresses.length === 0) {
  console.log('  (no private Wi-Fi address found: is this PC on the Wi-Fi?)');
} else {
  for (const { ip, name } of addresses) console.log(`  https://${ip}:${PORT}   (${name})`);
}
console.log('  - The phone must be on the same Wi-Fi as this PC.');
console.log('  - The certificate is self-signed: accept the warning once (Advanced → Proceed).');
console.log('  - If the phone cannot connect, allow port 5173 in Windows Firewall on Private');
console.log('    networks (the PowerShell command is at the top of scripts/dev-lan.ts).');
console.log('  - Sign in with an email code; in development the code is printed by the API here.');
console.log('');
