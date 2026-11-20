import { verifyPin } from '@naqdpos/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER_ID = '019a9b8e-0000-7000-8000-0000000000c2';

beforeEach(async () => {
  resetApiMock();
  await resetDb();
});

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function typePin(pin: string) {
  for (const digit of pin) fireEvent.click(await screen.findByRole('button', { name: digit }));
}

/** Owner device, owner switched in, plus a cashier. */
async function seedShop(mode: 'owner' | 'shop' = 'owner') {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER_ID, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER_ID, '1234');
}

describe('staff screens (US017)', () => {
  it('lets an owner on an owner device add a staff member through the outbox', async () => {
    await seedShop();
    renderAt('/staff');
    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Add staff' }));
    await screen.findByRole('heading', { name: 'Add staff' });

    typeInto('Name', 'Kashif');
    typeInto('Mobile number (optional)', '0321 7654321');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'rider' } });
    typeInto('4-digit PIN', '5555');
    typeInto('Enter the PIN again', '5555');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeInTheDocument();
    const added = (await db.staff.toArray()).find((s) => s.name === 'Kashif')!;
    expect(added).toMatchObject({
      shop_id: SHOP_ID,
      role: 'rider',
      phone: '+923217654321',
      active: true,
      pin_hash: null,
    });
    const entries = await db.outbox.toArray();
    expect(entries.map((e) => e.table).sort()).toEqual(['staff', 'staff_pins']);
    expect(entries.every((e) => e.actor_staff_id === STAFF_ID)).toBe(true);
    const pin = await db.staff_pins.get(added.id);
    await expect(verifyPin('5555', pin!.pin_hash)).resolves.toBe(true);
    expect(JSON.stringify(entries)).not.toContain('5555');
  });

  it('checks the form before saving', async () => {
    await seedShop();
    renderAt('/staff/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('This is required.')).toHaveLength(2);
    typeInto('Name', 'X');
    typeInto('Mobile number (optional)', '12345');
    typeInto('4-digit PIN', '1111');
    typeInto('Enter the PIN again', '2222');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Enter a Pakistani mobile number, e.g. 0300 1234567.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The two PINs do not match.')).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
  });

  it('edits without touching the PIN when it is left blank', async () => {
    await seedShop();
    renderAt(`/staff/${CASHIER_ID}`);
    await screen.findByRole('heading', { name: 'Edit staff' });
    expect(screen.getByLabelText('Name')).toHaveValue('Bilal');
    typeInto('Name', 'Bilal Khan');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Staff' });
    expect((await db.staff.get(CASHIER_ID))?.name).toBe('Bilal Khan');
    expect((await db.outbox.toArray()).map((e) => e.table)).toEqual(['staff']);
  });

  it('deactivates a cashier, but never the last active owner', async () => {
    await seedShop();
    renderAt(`/staff/${CASHIER_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await screen.findByRole('heading', { name: 'Staff' });
    expect((await db.staff.get(CASHIER_ID))?.active).toBe(false);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /Ali/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The shop needs at least one active owner.',
    );
    expect((await db.staff.get(STAFF_ID))?.active).toBe(true);
  });
});

describe('owner-only access (US018, decision 5)', () => {
  it('hides Staff in settings from a cashier and asks for the owner PIN on /staff', async () => {
    await seedShop();
    await writeCurrentStaffId(CASHIER_ID);
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull();

    cleanup();
    renderAt('/staff');
    await screen.findByRole('heading', { name: 'Owner PIN needed' });
    // Only owners are offered; the single owner is preselected.
    expect(await screen.findByText('PIN for Ali')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Staff' })).toBeNull();
  });

  it('shows Staff in settings to an owner', async () => {
    await seedShop();
    renderAt('/settings');
    expect(await screen.findByRole('link', { name: 'Staff' })).toBeInTheDocument();
  });

  it('asks for the owner PIN on a shop device even with the owner switched in', async () => {
    await seedShop('shop');
    renderAt('/staff');
    await screen.findByRole('heading', { name: 'Owner PIN needed' });
    await typePin('1111');
    expect(await screen.findByText('Wrong PIN. 4 tries left.')).toBeInTheDocument();
    await typePin('4821');
    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeInTheDocument();
  });

  it('refuses a cashier’s own PIN on the owner gate', async () => {
    await seedShop('shop');
    await db.staff.put(
      staffRow({
        id: '019a9b8e-0000-7000-8000-0000000000c9',
        name: 'Zara',
        role: 'owner',
        membership_user_id: null,
      }),
    );
    await seedPin('019a9b8e-0000-7000-8000-0000000000c9', '9999');
    renderAt('/staff');
    await screen.findByRole('heading', { name: 'Owner PIN needed' });
    // Two owners: a list of owners only, the cashier is not offered.
    expect(await screen.findByRole('button', { name: /Zara/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bilal/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Zara/ }));
    await typePin('9999');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Staff' })).toBeInTheDocument());
  });
});
