// `pnpm admin:grant <email>` / `pnpm admin:revoke <email>` (architecture §5): the ONLY way to make
// someone a system admin. Runs on the server or the dev PC with DATABASE_ADMIN_URL (the owner
// role), never through an API route. Both are audit-logged by admin_grant() / admin_revoke().
// The person must have signed in once (so their user row exists).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const ROOT = resolve(import.meta.dirname, '../..');
const ENV_FILE = join(ROOT, '.env');

export type AdminAction = 'grant' | 'revoke';

/** Grants or revokes with an open client (also used by the DB tests). */
export async function setPlatformAdmin(
  client: Pick<pg.Client, 'query'>,
  action: AdminAction,
  email: string,
): Promise<string> {
  const fn = action === 'grant' ? 'admin_grant' : 'admin_revoke';
  const { rows } = await client.query<{ id: string }>(`select public.${fn}($1) as id`, [email]);
  return rows[0]!.id;
}

/** The admin connection: DATABASE_ADMIN_URL, defaulting to the dev database on a dev PC. */
function connectionString(): string {
  const raw = process.env.DATABASE_ADMIN_URL;
  if (!raw) throw new Error('DATABASE_ADMIN_URL is not set');
  const url = new URL(raw);
  if (url.pathname === '/' || url.pathname === '/postgres') {
    url.pathname = `/${process.env.NAQDPOS_ADMIN_DB ?? 'naqdpos_dev'}`;
  }
  return url.toString();
}

async function main() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const [action, email] = process.argv.slice(2);
  if ((action !== 'grant' && action !== 'revoke') || !email) {
    console.error('usage: pnpm admin:grant <email> | pnpm admin:revoke <email>');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    await setPlatformAdmin(client, action, email);
    console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} system admin: ${email}`);
  } catch (error) {
    console.error(`admin:${action}: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('admin.ts')
) {
  void main();
}
