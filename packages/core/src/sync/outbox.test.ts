import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BASELINE_SERVER_UNITS,
  issueField,
  issuesMessage,
  isPullProblem,
  PULL_OP,
  pulledRowKey,
  pullProblemId,
  syncRecordName,
  toRetryEntry,
  unitServerLacks,
} from './outbox.ts';
import { SyncPullResponse, SyncPushResponse } from './schemas.ts';

describe('unitServerLacks (deploy-order safeguard, bug 2026-11-25)', () => {
  const product = (unit: unknown) => ({ table: 'products', row: { id: 'p', unit } });
  const line = (unit: unknown) => ({ table: 'sale_lines', row: { id: 'l', unit_snapshot: unit } });

  it('holds an ml product and an ml sale line for a server that does not list its units', () => {
    expect(unitServerLacks(product('ml'), null)).toBe('ml');
    expect(unitServerLacks(line('ml'), null)).toBe('ml');
  });

  it('sends every baseline unit to an older server', () => {
    for (const unit of BASELINE_SERVER_UNITS) {
      expect(unitServerLacks(product(unit), null)).toBeNull();
      expect(unitServerLacks(line(unit), null)).toBeNull();
    }
  });

  it('sends ml once the server lists it', () => {
    const units = [...BASELINE_SERVER_UNITS, 'ml'];
    expect(unitServerLacks(product('ml'), units)).toBeNull();
    expect(unitServerLacks(line('ml'), units)).toBeNull();
    expect(unitServerLacks(product('ton'), units)).toBe('ton');
  });

  it('never holds tables without a unit, or rows without a unit string', () => {
    expect(unitServerLacks({ table: 'customers', row: { unit: 'ml' } }, null)).toBeNull();
    expect(unitServerLacks(product(undefined), null)).toBeNull();
  });
});

describe('toRetryEntry', () => {
  it('turns a rejected entry back into a pending outbox entry with the same id', () => {
    const rejected = {
      id: 'e1',
      table: 'products',
      op: 'upsert' as const,
      row: { id: 'p', unit: 'ml' },
      row_key: 'products:p',
      created_at: '2026-11-25T18:34:00.000Z',
      attempts: 3,
      actor_staff_id: 's1',
      code: 'invalid',
      message: 'unit: Invalid option',
      field: 'unit',
      rejected_at: '2026-11-25T18:34:05.000Z',
    };
    expect(toRetryEntry(rejected)).toEqual({
      id: 'e1',
      table: 'products',
      op: 'upsert',
      row: { id: 'p', unit: 'ml' },
      row_key: 'products:p',
      created_at: '2026-11-25T18:34:00.000Z',
      attempts: 0,
      actor_staff_id: 's1',
    });
  });

  it('works for entries stored before `field` existed', () => {
    const entry = toRetryEntry({
      id: 'e2',
      attempts: 1,
      code: 'x',
      message: null,
      rejected_at: '',
    });
    expect(entry).toEqual({ id: 'e2', attempts: 0 });
  });
});

describe('syncRecordName', () => {
  it('names products, line items, customers and receipts', () => {
    expect(syncRecordName('products', { name: 'Rose water' })).toBe('Rose water');
    expect(syncRecordName('sale_lines', { name_snapshot: 'Rose water' })).toBe('Rose water');
    expect(syncRecordName('customers', { name: '', mobile: '03001234567' })).toBe('03001234567');
    expect(syncRecordName('sales', { receipt_no: 'A1-12' })).toBe('A1-12');
    expect(syncRecordName('payments', { amount_paisa: 100 })).toBeNull();
  });
});

describe('issueField', () => {
  it('is the top-level column of the first issue', () => {
    const result = z.object({ unit: z.enum(['kg']), name: z.string() }).safeParse({ unit: 'ml' });
    expect(result.success).toBe(false);
    if (!result.success) expect(issueField(result.error.issues)).toBe('unit');
    expect(issueField([{ path: [] }])).toBeNull();
  });
});

describe('sync response schemas stay backward compatible', () => {
  it('a push error parses with or without field', () => {
    const old = { accepted: [], conflicts: [], errors: [{ id: 'a', code: 'invalid' }] };
    expect(SyncPushResponse.parse(old).errors[0]).toEqual({ id: 'a', code: 'invalid' });
    const next = { ...old, errors: [{ id: 'a', code: 'invalid', field: 'unit' }] };
    expect(SyncPushResponse.parse(next).errors[0]?.field).toBe('unit');
  });

  it('a pull page parses with or without units', () => {
    const page = { rows: [], next_seq: 0, has_more: false };
    expect(SyncPullResponse.parse(page).units).toBeUndefined();
    expect(SyncPullResponse.parse({ ...page, units: ['kg', 'ml'] }).units).toEqual(['kg', 'ml']);
  });
});

describe('pull problems (pulled rows that fail their schema)', () => {
  it('one record per row, kept apart from push rejections', () => {
    expect(pulledRowKey('sales', 'id', { id: 'abc' })).toBe('sales:abc');
    expect(pulledRowKey('sales', 'id', { id: 7 })).toBe('sales:?');
    expect(pullProblemId('sales:abc')).toBe('pull:sales:abc');
    expect(isPullProblem({ op: PULL_OP })).toBe(true);
    expect(isPullProblem({ op: 'upsert' })).toBe(false);
  });

  it('names the failed columns in the message', () => {
    const result = z.object({ unit: z.enum(['kg']), name: z.string() }).safeParse({ unit: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuesMessage(result.error.issues)).toMatch(/^unit: .+; name: .+$/);
      expect(issueField(result.error.issues)).toBe('unit');
    }
  });
});
