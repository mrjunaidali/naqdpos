import { PIN_LOCK_STEPS_MS } from '@naqdpos/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { CURRENT_STAFF_KEY, useCurrentStaffStore } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedPin, seedReady, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { attemptPin, PIN_LOCK_KEY, readPinLock } from './pinAttempt.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
vi.mock('../../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const RETIRED = '019a9b8e-0000-7000-8000-0000000000c3';

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedReady('shop');
  await db.staff.bulkPut([
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
    staffRow({
      id: RETIRED,
      name: 'Old Hand',
      role: 'cashier',
      active: false,
      membership_user_id: null,
    }),
  ]);
  await seedPin(STAFF_ID, '4821');
  await seedPin(CASHIER, '1234');
  await seedPin(RETIRED, '7777');
});

async function typePin(pin: string) {
  for (const digit of pin) fireEvent.click(await screen.findByRole('button', { name: digit }));
}

/** Like closing and reopening the app: new render, store loads again from Dexie. */
function reload(path = '/') {
  cleanup();
  useCurrentStaffStore.setState({ staffId: null, ready: false });
  return renderAt(path);
}

async function openSwitch() {
  fireEvent.click(await screen.findByRole('button', { name: /Switch staff/ }));
  return screen.findByRole('dialog', { name: 'Switch staff' });
}

describe('PIN switch from the header (US016)', () => {
  it('switches with the right PIN, offline, and keeps the current staff after a reload', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: /Working now: Ali/ })).toHaveTextContent(
      'Ali · A1',
    );
    await openSwitch();
    // Deactivated staff are not offered.
    expect(screen.queryByRole('button', { name: /Old Hand/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Bilal/ }));
    await typePin('1234');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: /Working now: Bilal/ })).toHaveTextContent(
      'Bilal · A1',
    );
    expect((await db.meta.get(CURRENT_STAFF_KEY))?.value).toMatchObject({ staff_id: CASHIER });

    reload();
    expect(await screen.findByRole('button', { name: /Working now: Bilal/ })).toBeInTheDocument();
  });

  it('says how many tries are left after a wrong PIN', async () => {
    renderAt('/');
    await openSwitch();
    fireEvent.click(await screen.findByRole('button', { name: /Bilal/ }));
    await typePin('9999');
    expect(await screen.findByText('Wrong PIN. 4 tries left.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Working now: Ali/ })).toBeInTheDocument();
  });

  it('locks for a minute after 5 wrong PINs, and a reload does not unlock it', async () => {
    renderAt('/');
    await openSwitch();
    fireEvent.click(await screen.findByRole('button', { name: /Bilal/ }));
    for (const left of [4, 3, 2, 1]) {
      await typePin('0000');
      expect(
        await screen.findByText(
          left === 1 ? 'Wrong PIN. 1 try left.' : `Wrong PIN. ${left} tries left.`,
        ),
      ).toBeInTheDocument();
    }
    await typePin('0000');
    expect(
      await screen.findByText(/Too many wrong PINs\. Try again in \d+ s\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();

    reload();
    await openSwitch();
    fireEvent.click(await screen.findByRole('button', { name: /Bilal/ }));
    expect(await screen.findByText(/Too many wrong PINs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    // Even the right PIN is refused while locked.
    await expect(attemptPin(CASHIER, '1234')).resolves.toMatchObject({ status: 'locked' });
  });

  it('escalates: 1 minute, then 5 minutes, then 15 minutes; a correct PIN resets it', async () => {
    let now = 1_800_000_000_000;
    const clock = { now: () => now };
    const lockOnce = async () => {
      for (let i = 0; i < 5; i++) await attemptPin(CASHIER, '0000', clock);
      const result = await attemptPin(CASHIER, '1234', clock);
      expect(result.status).toBe('locked');
      return (result as { until: number }).until - now;
    };
    const lengths: number[] = [];
    for (let i = 0; i < 4; i++) {
      lengths.push(await lockOnce());
      now += lengths.at(-1)!; // wait out the lock
    }
    expect(lengths).toEqual([...PIN_LOCK_STEPS_MS, 900_000]);

    expect(await attemptPin(CASHIER, '1234', clock)).toEqual({ status: 'ok' });
    expect((await db.meta.get(PIN_LOCK_KEY))?.value).toEqual({
      failures: 0,
      lockedUntil: null,
      lockouts: 0,
    });
    expect(await lockOnce()).toBe(60_000);
  });

  it('keeps a 5-minute lock across a reload and shows it in minutes', async () => {
    await db.meta.put({
      key: PIN_LOCK_KEY,
      value: { failures: 0, lockedUntil: Date.now() + 300_000, lockouts: 2 },
    });
    reload();
    await openSwitch();
    fireEvent.click(await screen.findByRole('button', { name: /Bilal/ }));
    expect(await screen.findByText('Too many wrong PINs. Try again in 5 min.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    await expect(attemptPin(CASHIER, '1234')).resolves.toMatchObject({ status: 'locked' });
  });

  it('loads a lock state saved before lockout levels existed', async () => {
    await db.meta.put({ key: PIN_LOCK_KEY, value: { failures: 4, lockedUntil: null } });
    expect(await readPinLock()).toEqual({ failures: 4, lockedUntil: null, lockouts: 0 });
    await expect(attemptPin(CASHIER, '0000')).resolves.toMatchObject({ status: 'locked' });
    expect((await readPinLock()).lockouts).toBe(1);
  });

  it('refuses deactivated staff even with the right PIN, without counting a try', async () => {
    await expect(attemptPin(RETIRED, '7777')).resolves.toEqual({ status: 'not_allowed' });
    expect((await readPinLock()).failures).toBe(0);
  });

  it('asks who is working when the current staff member is deactivated', async () => {
    renderAt('/');
    await screen.findByRole('button', { name: /Working now: Ali/ });
    await db.staff.update(STAFF_ID, { active: false });
    expect(await screen.findByRole('dialog', { name: 'Who is working?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
