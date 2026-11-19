import { verifyPin, type CreateShopRequest } from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { deviceRow, me, resetDb, seedSession, shopRow, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));

const mocked = vi.mocked(api);

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedSession();
});

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function openOnboarding() {
  mocked.me.mockResolvedValueOnce(me());
  renderAt('/setup');
  await screen.findByRole('heading', { name: 'Set up your shop' });
}

function fillValidForm() {
  typeInto('Shop name', ' Ali Fruit ');
  typeInto('Your name', 'Ali');
  typeInto('Your mobile number', '0300 1234567');
  typeInto('Your 4-digit PIN', '4821');
  typeInto('Enter the PIN again', '4821');
}

/** The server echoes the ids the device made. */
function serverAccepts() {
  mocked.createShop.mockImplementation((input: CreateShopRequest) =>
    Promise.resolve({ id: input.shop_id }),
  );
  mocked.registerDevice.mockImplementation((input) =>
    Promise.resolve(deviceRow({ id: input.id, shop_id: input.shop_id, name: input.name })),
  );
  mocked.me.mockImplementation(() => {
    const call = mocked.createShop.mock.calls.at(-1)?.[0];
    return Promise.resolve(
      me([
        {
          role: 'owner',
          shop: shopRow({ id: call!.shop_id, name: call!.name }),
          staff: staffRow({ id: call!.owner_staff_id, shop_id: call!.shop_id }),
        },
      ]),
    );
  });
}

describe('onboarding form', () => {
  it('defaults to fruit & vegetables and offers every shop type', async () => {
    await openOnboarding();
    const select = screen.getByLabelText('Shop type');
    expect(select).toHaveValue('fruit_veg');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Fruit & vegetables',
      'Grocery',
      'Meat',
      'General store',
    ]);
  });

  it('checks every field before calling the server', async () => {
    await openOnboarding();
    typeInto('Name for this device', '');
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findAllByText('This is required.')).toHaveLength(3);
    expect(
      screen.getByText('Enter a Pakistani mobile number, e.g. 0300 1234567.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The PIN must be exactly 4 digits.')).toBeInTheDocument();
    expect(mocked.createShop).not.toHaveBeenCalled();
  });

  it.each([
    ['02134567890', 'Enter a Pakistani mobile number'],
    ['0300 12345', 'Enter a Pakistani mobile number'],
  ])('rejects the mobile %s', async (mobile, message) => {
    await openOnboarding();
    fillValidForm();
    typeInto('Your mobile number', mobile);
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(mocked.createShop).not.toHaveBeenCalled();
  });

  it('rejects a PIN that is not 4 digits, and PINs that do not match', async () => {
    await openOnboarding();
    fillValidForm();
    typeInto('Your 4-digit PIN', '12a4');
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findByText('The PIN must be exactly 4 digits.')).toBeInTheDocument();

    typeInto('Your 4-digit PIN', '4821');
    typeInto('Enter the PIN again', '4812');
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findByText('The two PINs do not match.')).toBeInTheDocument();
    expect(mocked.createShop).not.toHaveBeenCalled();
  });

  it('creates the shop, registers the device, saves everything and opens home', async () => {
    serverAccepts();
    await openOnboarding();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(await screen.findByText('This device: A1')).toBeInTheDocument();

    const sent = mocked.createShop.mock.calls[0]![0];
    expect(sent).toMatchObject({
      name: 'Ali Fruit',
      type: 'fruit_veg',
      owner_name: 'Ali',
      owner_phone: '+923001234567', // normalised
      shop_phone: '+923001234567', // same number on the shop
    });
    expect(sent.owner_pin_hash).not.toContain('4821');
    await expect(verifyPin('4821', sent.owner_pin_hash)).resolves.toBe(true);
    expect(sent.device_id).toBe(mocked.registerDevice.mock.calls[0]![0].id);
    expect(mocked.registerDevice.mock.calls[0]![0]).toMatchObject({
      shop_id: sent.shop_id,
      name: 'Owner phone',
    });

    // Dexie now holds the shop, the owner's staff row and this device.
    expect(await db.shops.get(sent.shop_id)).toMatchObject({ name: 'Ali Fruit' });
    expect(await db.staff.get(sent.owner_staff_id)).toMatchObject({ role: 'owner' });
    expect(await getStoredDevice()).toEqual({
      id: sent.device_id,
      code: 'A1',
      shop_id: sent.shop_id,
      staff_id: sent.owner_staff_id,
    });
  });

  it('shows the error and retries with the same ids after a dropped connection', async () => {
    serverAccepts();
    mocked.registerDevice.mockRejectedValueOnce(new ApiError(0, 'network'));
    await openOnboarding();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No internet connection');
    expect(await getStoredDevice()).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    const [first, second] = mocked.createShop.mock.calls.map((c) => c[0]);
    expect(second?.shop_id).toBe(first?.shop_id);
    expect(second?.owner_staff_id).toBe(first?.owner_staff_id);
    expect(second?.device_id).toBe(first?.device_id);
  });

  it('keeps number fields left-to-right with a numeric keyboard (also in Urdu)', async () => {
    await openOnboarding();
    expect(screen.getByLabelText('Your mobile number')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('Your 4-digit PIN')).toHaveAttribute('inputmode', 'numeric');
  });
});

describe('setup for an owner who already has a shop', () => {
  it('registers this device instead of creating another shop', async () => {
    const existing = me([{ role: 'owner', shop: shopRow(), staff: staffRow() }]);
    mocked.me.mockResolvedValue(existing);
    mocked.registerDevice.mockImplementation((input) =>
      Promise.resolve(deviceRow({ id: input.id, code: 'A2', name: input.name })),
    );
    renderAt('/setup');

    expect(await screen.findByRole('heading', { name: 'Add this device' })).toBeInTheDocument();
    expect(screen.getByText(/You are signed in to Ali Fruit/)).toBeInTheDocument();
    typeInto('Name for this device', 'Counter PC');
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    expect(await screen.findByText('This device: A2')).toBeInTheDocument();
    expect(mocked.createShop).not.toHaveBeenCalled();
    expect(mocked.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: shopRow().id, name: 'Counter PC' }),
    );
  });

  it('tells a cashier that only the owner can set up a device', async () => {
    mocked.me.mockResolvedValue(
      me([{ role: 'cashier', shop: shopRow(), staff: staffRow({ role: 'cashier' }) }]),
    );
    renderAt('/setup');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the shop owner');
    expect(mocked.registerDevice).not.toHaveBeenCalled();
  });

  it('offers a retry when the shop list cannot be loaded', async () => {
    mocked.me.mockRejectedValueOnce(new ApiError(0, 'network'));
    mocked.me.mockResolvedValueOnce(me());
    renderAt('/setup');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Set up your shop' })).toBeInTheDocument(),
    );
  });
});
