# NaqdPOS

Offline-first point of sale (PWA) for small shops in Pakistan. Start with `CLAUDE.md` and `docs/`:
`docs/architecture.md` (source of truth), `docs/deployment.md` (hosting and settings),
`docs/backlog.md` and `docs/progress.md`.

## Run locally

Needs Node 24, pnpm and PostgreSQL on this PC (databases `naqdpos_dev` and `naqdpos_test`).
Copy `.env.example` to `.env` and fill it in.

```sh
pnpm install
pnpm db:create          # once: create the databases
pnpm db:up              # run migrations on the dev database
pnpm dev                # API on http://localhost:8787, apps on :5173 / :5174
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`.

## Open the app on a phone (same Wi-Fi)

```sh
pnpm dev:lan
```

This starts the API and the shop app together and prints an address like `https://192.168.1.20:5173`.

1. Put the phone on the same Wi-Fi as the PC and open the printed address.
2. The certificate is self-signed: accept the warning once (Advanced → Proceed).
3. Sign in with an email code; in development the API prints the code in this terminal.
4. If the phone cannot connect, allow the dev server through Windows Firewall on Private networks
   (admin PowerShell, once), and make sure the Wi-Fi is set to Private in Windows:

   ```powershell
   New-NetFirewallRule -DisplayName "NaqdPOS dev server (5173)" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
   ```

The phone talks only to the dev server; API calls go through its `/api` proxy to the API on this PC.
This is for development only: production builds are unchanged (details in `docs/deployment.md` §3).
