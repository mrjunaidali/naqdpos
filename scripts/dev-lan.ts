// `pnpm dev:lan`: test the POS app and the admin portal on a phone on the same Wi-Fi
// (development only). Starts the API (localhost:8787) and both dev servers with HTTPS on all
// interfaces: POS on 5173, admin on 5174 (fixed ports, strictPort). Each app calls the API through
// its own dev server's /api proxy, so only 5173 and 5174 are reachable from the phone and the API
// itself stays on this PC.
//
// Windows Firewall: allow both dev servers on Private networks once, from an admin PowerShell:
//   New-NetFirewallRule -DisplayName "NaqdPOS dev servers (5173, 5174)" -Direction Inbound -Protocol TCP -LocalPort 5173,5174 -Action Allow -Profile Private
// Remove it later with:
//   Remove-NetFirewallRule -DisplayName "NaqdPOS dev servers (5173, 5174)"
// (An older rule for 5173 only, "NaqdPOS dev server (5173)", can stay or be removed the same way.)
import { spawn, type ChildProcess } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const POS_PORT = 5173;
const ADMIN_PORT = 5174;

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

const addresses = lanAddresses();
// The invite text in the admin portal links to the POS app; on a LAN test that is the phone URL.
// A VITE_POS_URL set in the shell wins (Vite gives process env priority over the .env file).
const posUrl =
  process.env.VITE_POS_URL ||
  (addresses[0] ? `https://${addresses[0].ip}:${POS_PORT}` : `https://localhost:${POS_PORT}`);

// Empty/"/api" = call the API through the dev server's own origin
// (packages/core/src/api/baseUrl.ts).
const lanEnv = { ...process.env, NAQDPOS_LAN: '1', VITE_API_URL: '/api' };

children.push(start('API', 'pnpm --filter @naqdpos/api dev', process.env));
children.push(start('POS', 'pnpm --filter @naqdpos/pos dev', lanEnv));
children.push(
  start('Admin', 'pnpm --filter @naqdpos/admin dev', { ...lanEnv, VITE_POS_URL: posUrl }),
);

console.log('');
if (addresses.length === 0) {
  console.log('[dev:lan] No private Wi-Fi address found: is this PC on the Wi-Fi?');
} else {
  console.log('[dev:lan] Open on your phone:');
  for (const { ip, name } of addresses) {
    console.log(`  POS app:       https://${ip}:${POS_PORT}   (${name})`);
    console.log(`  Admin portal:  https://${ip}:${ADMIN_PORT}   (${name})`);
  }
}
console.log(`  - Invite messages from the admin portal link to ${posUrl}`);
console.log('  - The phone must be on the same Wi-Fi as this PC.');
console.log('  - The certificates are self-signed: accept the warning once per port');
console.log('    (Advanced → Proceed).');
console.log('  - If the phone cannot connect, allow ports 5173 and 5174 in Windows Firewall on');
console.log('    Private networks (the PowerShell command is at the top of scripts/dev-lan.ts).');
console.log('  - Sign in with an email code; in development the code is printed by the API here.');
console.log('');
