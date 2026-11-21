// Test helpers. Fixtures are written by the owner role (DATABASE_ADMIN_URL pointed at
// naqdpos_test); every check runs as naqdpos_app (TEST_DATABASE_URL), the role the API uses.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run pnpm db:create)`);
  return value;
}

function testAdminUrl(): string {
  const url = new URL(env('DATABASE_ADMIN_URL'));
  url.pathname = new URL(env('TEST_DATABASE_URL')).pathname;
  return url.toString();
}

export const admin = new pg.Pool({ connectionString: testAdminUrl(), max: 2 });
export const app = new pg.Pool({ connectionString: env('TEST_DATABASE_URL'), max: 2 });

export type Query = <R extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<pg.QueryResult<R>>;

/**
 * Runs `fn` as naqdpos_app in a transaction with app.user_id set, like the API does, then rolls
 * back so a test never changes the shared fixtures.
 */
export async function asUser<T>(userId: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [userId ?? '']);
    // Each statement in a savepoint, so an expected error does not abort the transaction.
    const q: Query = async <R extends pg.QueryResultRow>(text: string, values?: unknown[]) => {
      await client.query('savepoint s');
      try {
        const result = await client.query<R>(text, values);
        await client.query('release savepoint s');
        return result;
      } catch (error) {
        await client.query('rollback to savepoint s');
        throw error;
      }
    };
    return await fn(q);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

export interface Fixture {
  ownerA: string;
  cashierA: string;
  ownerB: string;
  outsider: string;
  shopA: string;
  shopB: string;
  ownerStaffA: string;
  cashierStaffA: string;
  ownerStaffB: string;
  deviceA: string;
}

/** Two shops: A (owner + cashier) and B (owner), plus a signed-in user with no shop. */
export async function createFixture(): Promise<Fixture> {
  const f: Fixture = {
    ownerA: randomUUID(),
    cashierA: randomUUID(),
    ownerB: randomUUID(),
    outsider: randomUUID(),
    shopA: randomUUID(),
    shopB: randomUUID(),
    ownerStaffA: randomUUID(),
    cashierStaffA: randomUUID(),
    ownerStaffB: randomUUID(),
    deviceA: randomUUID(),
  };
  const q = (text: string, values: unknown[]) => admin.query(text, values);

  for (const id of [f.ownerA, f.cashierA, f.ownerB, f.outsider]) {
    await q('insert into users (id, name, email) values ($1, $2, $3)', [
      id,
      'Test user',
      `${id}@example.test`,
    ]);
  }
  await q(`insert into shops (id, name, type) values ($1, 'Shop A', 'fruit_veg')`, [f.shopA]);
  await q(`insert into shops (id, name, type) values ($1, 'Shop B', 'grocery')`, [f.shopB]);
  await q(
    `insert into memberships (shop_id, user_id, role) values
       ($1, $2, 'owner'), ($1, $3, 'cashier'), ($4, $5, 'owner')`,
    [f.shopA, f.ownerA, f.cashierA, f.shopB, f.ownerB],
  );
  await q(
    `insert into staff (id, shop_id, name, role, membership_user_id) values
       ($1, $2, 'Owner A', 'owner', $3),
       ($4, $2, 'Cashier A', 'cashier', $5),
       ($6, $7, 'Owner B', 'owner', $8)`,
    [
      f.ownerStaffA,
      f.shopA,
      f.ownerA,
      f.cashierStaffA,
      f.cashierA,
      f.ownerStaffB,
      f.shopB,
      f.ownerB,
    ],
  );
  await q(
    `insert into staff_salaries (staff_id, shop_id, monthly_salary_paisa) values ($1, $2, 3000000)`,
    [f.cashierStaffA, f.shopA],
  );
  await q(
    `insert into devices (id, shop_id, name, code, registered_by) values ($1, $2, 'Counter', 'A1', $3)`,
    [f.deviceA, f.shopA, f.ownerA],
  );
  return f;
}

/** Postgres error code of a rejected promise (e.g. 42501 insufficient_privilege). */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
  throw new Error('expected the statement to fail');
}

export const TENANT_TABLES = [
  'shops',
  'memberships',
  'staff',
  'staff_salaries',
  'staff_pins',
  'devices',
  'categories',
  'products',
  'product_costs',
  'price_history',
  'product_cost_history',
  'payment_methods',
  'sales',
  'sale_lines',
  'payments',
  'stock_movements',
  'customers',
  'khata_entries',
  'expense_categories',
  'expenses',
  'day_closes',
] as const;
