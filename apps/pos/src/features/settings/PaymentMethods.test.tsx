import type { PaymentMethodRow } from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { shopPaymentMethods } from './paymentMethods.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const NOW = '2026-11-21T10:00:00.000Z';
const method = (code: string, label: string, sort: number): PaymentMethodRow => ({
  id: `019a9b8e-0000-7000-8000-00000000f00${sort}`,
  shop_id: SHOP_ID,
  code,
  label,
  active: true,
  sort,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  device_id: null,
  server_seq: 30 + sort,
});

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedReady('owner');
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await db.payment_methods.bulkPut([
    method('cash', 'Cash', 1),
    method('jazzcash', 'JazzCash', 2),
    method('easypaisa', 'Easypaisa', 3),
    method('bank', 'Bank transfer', 4),
  ]);
});

describe('Settings → Payment methods (US035)', () => {
  it('is linked in Settings for owners', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('link', { name: 'Payment methods' })).toBeInTheDocument();
  });

  it('asks a cashier for the owner PIN', async () => {
    await writeCurrentStaffId(CASHIER);
    renderAt('/settings/payment-methods');
    expect(await screen.findByRole('heading', { name: 'Owner PIN needed' })).toBeInTheDocument();
  });

  it('keeps cash on, switches another method off through the outbox', async () => {
    renderAt('/settings/payment-methods');
    expect(await screen.findByRole('button', { name: 'Switch Cash on or off' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Switch Bank transfer on or off' }));
    await waitFor(async () =>
      expect((await shopPaymentMethods()).find((m) => m.code === 'bank')?.active).toBe(false),
    );
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ table: 'payment_methods', actor_staff_id: STAFF_ID });
  });

  it('adds a custom method and reorders', async () => {
    renderAt('/settings/payment-methods');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'SadaPay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add method' }));
    await waitFor(async () => expect((await shopPaymentMethods()).at(-1)?.label).toBe('SadaPay'));
    const added = (await shopPaymentMethods()).at(-1)!;
    expect(added.code).toMatch(/^custom_[0-9a-f]{8}$/);
    expect(added.sort).toBe(5);

    fireEvent.click(await screen.findByRole('button', { name: 'Move SadaPay up' }));
    await waitFor(async () =>
      expect((await shopPaymentMethods()).map((m) => m.label)).toEqual([
        'Cash',
        'JazzCash',
        'Easypaisa',
        'SadaPay',
        'Bank transfer',
      ]),
    );
  });
});
