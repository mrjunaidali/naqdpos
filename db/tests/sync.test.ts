// sync_push / sync_pull (architecture §4) against naqdpos_test, as naqdpos_app with RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  app,
  asUser,
  createFixture,
  errorCode,
  type Fixture,
  type Query,
} from './helpers.ts';

let f: Fixture;
/** Shop A's owner phone (mode 'owner'); f.deviceA is the shop counter (default mode 'shop'). */
let ownerDeviceA: string;
let removedDeviceA: string;
let deviceB: string;

beforeAll(async () => {
  f = await createFixture();
  ownerDeviceA = randomUUID();
  removedDeviceA = randomUUID();
  deviceB = randomUUID();
  await admin.query(
    `insert into devices (id, shop_id, name, code, registered_by, mode) values
       ($1, $2, 'Owner phone', 'A2', $3, 'owner'),
       ($4, $2, 'Old phone', 'A3', $3, 'shop')`,
    [ownerDeviceA, f.shopA, f.ownerA, removedDeviceA],
  );
  await admin.query(`update devices set deleted_at = now() where id = $1`, [removedDeviceA]);
  await admin.query(
    `insert into devices (id, shop_id, name, code, registered_by, mode) values
       ($1, $2, 'B phone', 'A1', $3, 'owner')`,
    [deviceB, f.shopB, f.ownerB],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

interface PushResult {
  accepted: string[];
  conflicts: { id: string; table: string; row: Record<string, unknown> }[];
  errors: { id: string; code: string; message?: string }[];
}
interface PullResult {
  rows: { table: string; row: Record<string, unknown>; server_seq: number }[];
  next_seq: number;
  has_more: boolean;
}

interface Entry {
  id: string;
  table: string;
  op: 'insert' | 'upsert';
  row: Record<string, unknown>;
  /** Acting staff member; defaults to shop A's owner (see push). */
  actor_staff_id?: string | null;
}

async function push(q: Query, deviceId: string, entries: Entry[]): Promise<PushResult> {
  const { rows } = await q<{ r: PushResult }>('select sync_push($1, $2::jsonb) as r', [
    deviceId,
    JSON.stringify(
      entries.map((e) =>
        e.actor_staff_id === undefined ? { ...e, actor_staff_id: f.ownerStaffA } : e,
      ),
    ),
  ]);
  return rows[0]!.r;
}

async function pull(q: Query, deviceId: string, since: number, limit = 500): Promise<PullResult> {
  const { rows } = await q<{ r: PullResult }>('select sync_pull($1, $2, $3) as r', [
    deviceId,
    since,
    limit,
  ]);
  return rows[0]!.r;
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function staffEntry(row: Partial<Record<string, unknown>> = {}): Entry {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    table: 'staff',
    op: 'upsert',
    row: {
      id: randomUUID(),
      shop_id: f.shopA,
      name: 'New cashier',
      phone: null,
      role: 'cashier',
      active: true,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: f.deviceA,
      ...row,
    },
  };
}

describe('sync_push: mutable tables', () => {
  it('is idempotent: the same batch twice gives one row and no conflicts', async () => {
    await asUser(f.ownerA, async (q) => {
      const batch = [staffEntry(), staffEntry({ name: 'Second' })];
      const first = await push(q, f.deviceA, batch);
      expect(first).toEqual({ accepted: batch.map((e) => e.id), conflicts: [], errors: [] });
      const again = await push(q, f.deviceA, batch);
      expect(again).toEqual(first);

      const ids = batch.map((e) => e.row.id);
      const { rows } = await q('select id from staff where id = any($1)', [ids]);
      expect(rows).toHaveLength(2);
      const conflicts = await q('select 1 from sync_conflicts where row_id = any($1)', [ids]);
      expect(conflicts.rowCount).toBe(0);
    });
  });

  it('applies a newer edit (last write wins)', async () => {
    await asUser(f.ownerA, async (q) => {
      const created = staffEntry();
      await push(q, f.deviceA, [created]);
      const edit = staffEntry({ ...created.row, name: 'Renamed', updated_at: inMinutes(1) });
      const result = await push(q, f.deviceA, [edit]);
      expect(result.accepted).toEqual([edit.id]);
      const { rows } = await q<{ name: string }>('select name from staff where id = $1', [
        created.row.id,
      ]);
      expect(rows[0]?.name).toBe('Renamed');
    });
  });

  it('keeps the server row for an older edit, logs the conflict and returns the server row', async () => {
    await asUser(f.ownerA, async (q) => {
      const created = staffEntry({ name: 'Server name', updated_at: inMinutes(1) });
      await push(q, f.deviceA, [created]);
      const stale = staffEntry({
        ...created.row,
        name: 'Stale name',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
      const result = await push(q, ownerDeviceA, [stale]);

      expect(result.accepted).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({
        id: stale.id,
        table: 'staff',
        row: { id: created.row.id, name: 'Server name', shop_id: f.shopA },
      });
      expect(result.conflicts[0]?.row.server_seq).toEqual(expect.any(Number));

      const { rows } = await q<{ name: string }>('select name from staff where id = $1', [
        created.row.id,
      ]);
      expect(rows[0]?.name).toBe('Server name');
      const logged = await q<{ device_id: string; table_name: string }>(
        'select device_id, table_name from sync_conflicts where row_id = $1',
        [created.row.id],
      );
      expect(logged.rows).toEqual([{ device_id: ownerDeviceA, table_name: 'staff' }]);
    });
  });

  it('treats the same updated_at with different content as a conflict', async () => {
    await asUser(f.ownerA, async (q) => {
      const created = staffEntry();
      await push(q, f.deviceA, [created]);
      const other = staffEntry({ ...created.row, name: 'Other' });
      const result = await push(q, ownerDeviceA, [other]);
      expect(result.conflicts.map((c) => c.id)).toEqual([other.id]);
    });
  });

  it('rejects rows of another shop per entry and applies the rest of the batch', async () => {
    await asUser(f.ownerA, async (q) => {
      const good = staffEntry();
      const foreign = staffEntry({ shop_id: f.shopB });
      const result = await push(q, f.deviceA, [foreign, good]);
      expect(result.accepted).toEqual([good.id]);
      expect(result.errors).toEqual([{ id: foreign.id, code: 'other_shop' }]);
      const { rowCount } = await q('select 1 from staff where id = $1', [foreign.row.id]);
      expect(rowCount).toBe(0);
    });
  });

  it('rejects an edit to an existing row of another shop, even with this shop id', async () => {
    await asUser(f.ownerA, async (q) => {
      // ownerB's staff row is invisible to ownerA, so the insert collides on the primary key.
      const hijack = staffEntry({ id: f.ownerStaffB, updated_at: inMinutes(1) });
      const result = await push(q, f.deviceA, [hijack]);
      expect(result.errors.map((e) => e.code)).toEqual(['invalid']);
    });
  });

  it('rejects owner-only tables from a shop device and accepts them from an owner device', async () => {
    await asUser(f.ownerA, async (q) => {
      const now = new Date().toISOString();
      const salary = (): Entry => ({
        id: randomUUID(),
        table: 'staff_salaries',
        op: 'upsert',
        row: {
          staff_id: f.cashierStaffA,
          shop_id: f.shopA,
          monthly_salary_paisa: 4_000_000,
          created_at: now,
          updated_at: inMinutes(1),
          deleted_at: null,
          device_id: ownerDeviceA,
        },
      });
      const fromShop = salary();
      expect((await push(q, f.deviceA, [fromShop])).errors).toEqual([
        expect.objectContaining({ id: fromShop.id, code: 'forbidden' }),
      ]);
      const fromOwner = salary();
      expect((await push(q, ownerDeviceA, [fromOwner])).accepted).toEqual([fromOwner.id]);
      const { rows } = await q<{ monthly_salary_paisa: string }>(
        'select monthly_salary_paisa from staff_salaries where staff_id = $1',
        [f.cashierStaffA],
      );
      expect(rows[0]?.monthly_salary_paisa).toBe('4000000');
    });
  });

  it('lets RLS refuse what the role may not do (cashier adding staff)', async () => {
    await asUser(f.cashierA, async (q) => {
      const entry = staffEntry();
      const result = await push(q, f.deviceA, [entry]);
      expect(result.errors.map((e) => e.code)).toEqual(['forbidden']);
    });
  });

  it('updates shop settings for the owner but never the server-managed columns', async () => {
    await asUser(f.ownerA, async (q) => {
      const entry: Entry = {
        id: randomUUID(),
        table: 'shops',
        op: 'upsert',
        row: { id: f.shopA, name: 'Shop A renamed', status: 'suspended', updated_at: inMinutes(1) },
      };
      expect((await push(q, f.deviceA, [entry])).accepted).toEqual([entry.id]);
      const { rows } = await q<{ name: string; status: string }>(
        'select name, status from shops where id = $1',
        [f.shopA],
      );
      expect(rows[0]).toEqual({ name: 'Shop A renamed', status: 'active' });
    });
  });

  it('rejects timestamps more than 10 minutes in the future (clock_ahead)', async () => {
    await asUser(f.ownerA, async (q) => {
      const ahead = staffEntry({ updated_at: inMinutes(60) });
      const slightlyAhead = staffEntry({ updated_at: inMinutes(5) });
      const result = await push(q, f.deviceA, [ahead, slightlyAhead]);
      expect(result.errors).toEqual([{ id: ahead.id, code: 'clock_ahead' }]);
      expect(result.accepted).toEqual([slightlyAhead.id]);
    });
  });

  it('rejects unknown and pull-only tables', async () => {
    await asUser(f.ownerA, async (q) => {
      const unknown: Entry = { id: randomUUID(), table: 'secrets', op: 'insert', row: {} };
      const device: Entry = {
        id: randomUUID(),
        table: 'devices',
        op: 'upsert',
        row: { id: f.deviceA, shop_id: f.shopA, mode: 'owner' },
      };
      const result = await push(q, f.deviceA, [unknown, device]);
      expect(result.errors).toEqual([
        { id: unknown.id, code: 'unknown_table' },
        { id: device.id, code: 'not_pushable' },
      ]);
    });
  });
});

describe('sync_push / sync_pull: device checks', () => {
  it('refuses a device of another shop, a removed device and no user (42501)', async () => {
    await asUser(f.ownerB, async (q) => {
      expect(await errorCode(push(q, f.deviceA, []))).toBe('42501');
      expect(await errorCode(pull(q, f.deviceA, 0))).toBe('42501');
    });
    await asUser(f.ownerA, async (q) => {
      expect(await errorCode(push(q, removedDeviceA, []))).toBe('42501');
      expect(await errorCode(push(q, randomUUID(), []))).toBe('42501');
    });
    await asUser(null, async (q) => {
      expect(await errorCode(pull(q, f.deviceA, 0))).toBe('42501');
    });
  });

  it('records last_sync_at on push', async () => {
    await asUser(f.ownerA, async (q) => {
      await push(q, f.deviceA, []);
      const { rows } = await q<{ last_sync_at: Date | null }>(
        'select last_sync_at from devices where id = $1',
        [f.deviceA],
      );
      expect(rows[0]?.last_sync_at).toBeInstanceOf(Date);
    });
  });
});

/**
 * Runs `fn` as naqdpos_app after `setup` ran as the owner role, all in one rolled-back
 * transaction: lets a test register a throwaway ledger table and override is_day_closed.
 */
async function withSetup<T>(setup: string, userId: string, fn: (q: Query) => Promise<T>) {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query(setup);
    await client.query('set local role naqdpos_app');
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const q: Query = (text, values) => client.query(text, values);
    return await fn(q);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const LEDGER_SETUP = `
  create table public.test_ledger (
    id uuid primary key,
    shop_id uuid not null references public.shops (id),
    business_date date not null,
    amount_paisa bigint not null,
    created_at timestamptz not null,
    device_id uuid,
    server_seq bigint not null
  );
  alter table public.test_ledger enable row level security;
  grant select, insert on public.test_ledger to naqdpos_app;
  create policy test_ledger_select on public.test_ledger for select to naqdpos_app
    using (public.is_shop_member(shop_id));
  create policy test_ledger_insert on public.test_ledger for insert to naqdpos_app
    with check (public.is_shop_member(shop_id));
  create trigger set_server_seq before insert or update on public.test_ledger
    for each row execute function public.set_server_seq();
  insert into public.sync_tables (table_name, kind, pushable, push_columns)
  values ('test_ledger', 'append', true,
    array['id', 'shop_id', 'business_date', 'amount_paisa', 'created_at', 'device_id']);
  create or replace function public.is_day_closed(p_shop_id uuid, p_business_date date)
  returns boolean language sql stable as $fn$ select p_business_date = date '2026-11-19' $fn$;
`;

function ledgerEntry(row: Partial<Record<string, unknown>> = {}): Entry {
  return {
    id: randomUUID(),
    table: 'test_ledger',
    op: 'insert',
    row: {
      id: randomUUID(),
      shop_id: f.shopA,
      business_date: '2026-11-20',
      amount_paisa: 15_000,
      created_at: new Date().toISOString(),
      device_id: f.deviceA,
      ...row,
    },
  };
}

describe('sync_push: append-only tables (throwaway ledger table)', () => {
  it('inserts once; a retried entry is accepted without a duplicate', async () => {
    await withSetup(LEDGER_SETUP, f.ownerA, async (q) => {
      const entry = ledgerEntry();
      expect((await push(q, f.deviceA, [entry])).accepted).toEqual([entry.id]);
      expect((await push(q, f.deviceA, [entry])).accepted).toEqual([entry.id]);
      // A changed row with the same id never overwrites a ledger row.
      const changed = { ...entry, row: { ...entry.row, amount_paisa: 1 } };
      expect((await push(q, f.deviceA, [changed])).accepted).toEqual([entry.id]);
      const { rows } = await q<{ amount_paisa: string }>(
        'select amount_paisa from test_ledger where id = $1',
        [entry.row.id],
      );
      expect(rows).toEqual([{ amount_paisa: '15000' }]);
    });
  });

  it('rejects a closed business date (day_closed)', async () => {
    await withSetup(LEDGER_SETUP, f.ownerA, async (q) => {
      const closed = ledgerEntry({ business_date: '2026-11-19' });
      const open = ledgerEntry();
      const result = await push(q, f.deviceA, [closed, open]);
      expect(result.errors).toEqual([{ id: closed.id, code: 'day_closed' }]);
      expect(result.accepted).toEqual([open.id]);
    });
  });

  it('rejects created_at more than 10 minutes ahead (clock_ahead)', async () => {
    await withSetup(LEDGER_SETUP, f.ownerA, async (q) => {
      const ahead = ledgerEntry({ created_at: inMinutes(30) });
      expect((await push(q, f.deviceA, [ahead])).errors).toEqual([
        { id: ahead.id, code: 'clock_ahead' },
      ]);
    });
  });

  it('pulls registered ledger rows like any other table', async () => {
    await withSetup(LEDGER_SETUP, f.ownerA, async (q) => {
      const entry = ledgerEntry();
      await push(q, f.deviceA, [entry]);
      const { rows } = await pull(q, f.deviceA, 0);
      expect(rows.some((r) => r.table === 'test_ledger' && r.row.id === entry.row.id)).toBe(true);
    });
  });
});

async function pullAll(q: Query, deviceId: string, limit: number) {
  const pages: PullResult[] = [];
  let since = 0;
  for (;;) {
    const page = await pull(q, deviceId, since, limit);
    pages.push(page);
    since = page.next_seq;
    if (!page.has_more) break;
  }
  return { pages, rows: pages.flatMap((p) => p.rows), cursor: since };
}

describe('sync_pull', () => {
  it('pages by server_seq until empty and stores the cursor on the device', async () => {
    await asUser(f.ownerA, async (q) => {
      const { pages, rows, cursor } = await pullAll(q, ownerDeviceA, 2);
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages.slice(0, -1)) {
        expect(page.rows).toHaveLength(2);
        expect(page.has_more).toBe(true);
      }
      const seqs = rows.map((r) => r.server_seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length);

      // Nothing new: an empty page, and pulling did not make the device row "new" again.
      const after = await pull(q, ownerDeviceA, cursor);
      expect(after).toEqual({ rows: [], next_seq: cursor, has_more: false });

      const { rows: device } = await q<{ last_seq_pulled: string; last_sync_at: Date | null }>(
        'select last_seq_pulled, last_sync_at from devices where id = $1',
        [ownerDeviceA],
      );
      expect(Number(device[0]?.last_seq_pulled)).toBe(cursor);
      expect(device[0]?.last_sync_at).toBeInstanceOf(Date);
    });
  });

  it('gives an owner device salaries, but never a shop device', async () => {
    await asUser(f.ownerA, async (q) => {
      const owner = await pullAll(q, ownerDeviceA, 500);
      const shop = await pullAll(q, f.deviceA, 500);
      const tables = (rows: PullResult['rows']) => new Set(rows.map((r) => r.table));
      expect(tables(owner.rows)).toEqual(new Set(['shops', 'staff', 'staff_salaries', 'devices']));
      expect(tables(shop.rows)).toEqual(new Set(['shops', 'staff', 'devices']));
    });
  });

  it('never returns another shop’s rows', async () => {
    await asUser(f.ownerA, async (q) => {
      const { rows } = await pullAll(q, ownerDeviceA, 500);
      const shopIds = rows.map((r) => (r.table === 'shops' ? r.row.id : r.row.shop_id));
      expect(new Set(shopIds)).toEqual(new Set([f.shopA]));
    });
    await asUser(f.ownerB, async (q) => {
      const { rows } = await pullAll(q, deviceB, 500);
      expect(rows.some((r) => JSON.stringify(r.row).includes(f.shopA))).toBe(false);
    });
  });

  it('lets a cashier pull but never salaries (RLS), even on an owner device', async () => {
    await asUser(f.cashierA, async (q) => {
      const { rows } = await pullAll(q, ownerDeviceA, 500);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.table === 'staff_salaries')).toBe(false);
    });
  });
});

describe('devices.mode and server_seq', () => {
  const seq = async (q: Query, id: string) =>
    Number(
      (await q<{ server_seq: string }>('select server_seq from devices where id = $1', [id]))
        .rows[0]!.server_seq,
    );

  it('keeps server_seq for sync bookkeeping, bumps it for real changes', async () => {
    await asUser(f.ownerA, async (q) => {
      const before = await seq(q, f.deviceA);
      await q('select sync_mark_device($1, 5)', [f.deviceA]);
      expect(await seq(q, f.deviceA)).toBe(before);
      await q(`update devices set name = 'Counter 2' where id = $1`, [f.deviceA]);
      const renamed = await seq(q, f.deviceA);
      expect(renamed).toBeGreaterThan(before);
      await q('update devices set server_seq = 1 where id = $1', [f.deviceA]);
      expect(await seq(q, f.deviceA)).toBe(renamed);
    });
  });

  it('register_device stores the mode (default shop); only owners change it', async () => {
    await asUser(f.ownerA, async (q) => {
      const own = randomUUID();
      const counter = randomUUID();
      await q(`select register_device($1, $2, 'Mine', 'owner')`, [own, f.shopA]);
      await q(`select register_device($1, $2, 'Counter')`, [counter, f.shopA]);
      const { rows } = await q<{ id: string; mode: string }>(
        'select id, mode from devices where id = any($1) order by name',
        [[own, counter]],
      );
      expect(rows).toEqual([
        { id: counter, mode: 'shop' },
        { id: own, mode: 'owner' },
      ]);
      expect(
        await errorCode(q(`select register_device($1, $2, 'X', 'boss')`, [randomUUID(), f.shopA])),
      ).toBe('23514');
    });
    await asUser(f.cashierA, async (q) => {
      const { rowCount } = await q(`update devices set mode = 'owner' where id = $1`, [f.deviceA]);
      expect(rowCount).toBe(0);
    });
  });
});
