import type { ResetOwnerPinRequest } from '@naqdpos/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { readCurrentStaffId, writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { attemptPin, PIN_LOCK_KEY, readPinLock } from './pinAttempt.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const mocked = vi.mocked(api);
const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  setOnline(true);
  await seedReady('shop'); // owner Ali (STAFF_ID) is linked to the signed-in user
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER, '1234');
  mocked.sendPinResetCode.mockResolvedValue({ sent: true });
  mocked.resetOwnerPin.mockImplementation((staffId: string, input: ResetOwnerPinRequest) =>
    Promise.resolve({
      staff_id: staffId,
      shop_id: SHOP_ID,
      pin_hash: input.pin_hash,
      device_id: null,
      created_at: '2026-11-21T10:00:00.000Z',
      updated_at: '2026-11-21T12:00:00.000Z',
      deleted_at: null,
      server_seq: 99,
    }),
  );
});
afterEach(() => setOnline(true));

const typeInto = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function openOwnerGate() {
  renderAt('/staff');
  await screen.findByRole('heading', { name: 'Owner PIN needed' });
}

describe('Forgot PIN? (owner, email code)', () => {
  it('is offered on the owner keypad for the owner linked to this account', async () => {
    await openOwnerGate();
    expect(await screen.findByRole('button', { name: 'Forgot PIN?' })).toBeInTheDocument();
  });

  it('is not offered for a cashier, or for an owner row not linked to this account', async () => {
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: /Switch staff/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Bilal/ }));
    await screen.findByText('PIN for Bilal');
    expect(screen.queryByRole('button', { name: 'Forgot PIN?' })).toBeNull();

    await db.staff.update(STAFF_ID, { membership_user_id: null });
    fireEvent.click(screen.getByRole('button', { name: 'Someone else' }));
    fireEvent.click(
      await within(screen.getByRole('dialog')).findByRole('button', { name: /^Ali/ }),
    );
    await screen.findByText('PIN for Ali');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Forgot PIN?' })).toBeNull());
  });

  it('says to connect when offline', async () => {
    await openOwnerGate();
    setOnline(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot PIN?' }));
    expect(
      await screen.findByText('Connect to the internet to reset your PIN'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });

  it('full flow: code, new PIN, lock cleared, owner switched in, new PIN works offline', async () => {
    await writeCurrentStaffId(CASHIER);
    await db.meta.put({
      key: PIN_LOCK_KEY,
      value: { failures: 0, lockedUntil: Date.now() + 300_000, lockouts: 2 },
    });
    await openOwnerGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot PIN?' }));
    expect(
      await screen.findByText(/We will email a 6-digit code to ali@shop\.pk/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByText('We sent a 6-digit code to ali@shop.pk.');
    expect(mocked.sendPinResetCode).toHaveBeenCalledWith(STAFF_ID);

    typeInto('6-digit code', '123456');
    typeInto('New 4-digit PIN', '2468');
    typeInto('Enter the PIN again', '2468');
    fireEvent.click(screen.getByRole('button', { name: 'Save new PIN' }));

    // The owner screen opens.
    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeInTheDocument();
    const [staffId, sent] = mocked.resetOwnerPin.mock.calls[0]!;
    expect(staffId).toBe(STAFF_ID);
    expect(sent.code).toBe('123456');
    expect(sent.pin_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(JSON.stringify(sent)).not.toContain('2468');

    expect(await db.staff_pins.get(STAFF_ID)).toMatchObject({ server_seq: 99 });
    expect(await readPinLock()).toEqual({ failures: 0, lockedUntil: null, lockouts: 0 });
    expect(await readCurrentStaffId()).toBe(STAFF_ID);
    expect(await db.outbox.count()).toBe(0); // not a sync write

    setOnline(false);
    await expect(attemptPin(STAFF_ID, '2468')).resolves.toEqual({ status: 'ok' });
    await expect(attemptPin(STAFF_ID, '4821')).resolves.toMatchObject({ status: 'wrong' });
  });

  it.each([
    ['invalid_code', 400, 'That code is not right. Check the email and try again.'],
    ['code_expired', 400, 'That code has expired. Ask for a new one.'],
    ['too_many_attempts', 429, 'Too many wrong codes. Ask for a new code.'],
  ])('shows %s from the server and keeps the old PIN', async (code, status, message) => {
    mocked.resetOwnerPin.mockRejectedValueOnce(new ApiError(status, code));
    await openOwnerGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot PIN?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('6-digit code');
    typeInto('6-digit code', '000000');
    typeInto('New 4-digit PIN', '2468');
    typeInto('Enter the PIN again', '2468');
    fireEvent.click(screen.getByRole('button', { name: 'Save new PIN' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    await expect(attemptPin(STAFF_ID, '4821')).resolves.toEqual({ status: 'ok' });
  });

  it.each([
    ['code_cooldown', 'A code was just sent. Wait a minute before asking for another.'],
    ['code_daily_cap', 'Too many codes today. Try again tomorrow.'],
  ])('explains the %s limit', async (code, message) => {
    mocked.sendPinResetCode.mockRejectedValueOnce(new ApiError(429, code));
    await openOwnerGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot PIN?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('is offered even when this device has no PIN for anyone yet', async () => {
    await db.staff_pins.clear();
    await openOwnerGate();
    expect(await screen.findByText(/Nobody can switch in yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot PIN?' }));
    await waitFor(() => expect(screen.getByText('New PIN for Ali')).toBeInTheDocument());
  });
});
