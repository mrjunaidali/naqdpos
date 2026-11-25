import { verifyPin, type CreateShopRequest } from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import {
  deviceRow,
  me,
  resetDb,
  seedReady,
  seedSession,
  shopRow,
  staffRow,
} from '../../test/fixtures.ts';
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
    Promise.resolve(
      deviceRow({
        id: input.id,
        shop_id: input.shop_id,
        name: input.name,
        mode: input.mode ?? 'shop',
      }),
    ),
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

    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument();
    // Setup navigates home twice (Gate redirect + onDone), so check inside waitFor.
    await waitFor(() => expect(screen.getByText('This device: A1')).toBeInTheDocument(), {
      timeout: 5000, // slow when every package's tests run at once
    });

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
      name: 'Shop counter',
      mode: 'shop',
    });

    // Dexie now holds the shop, the owner's staff row and this device.
    expect(await db.shops.get(sent.shop_id)).toMatchObject({ name: 'Ali Fruit' });
    expect(await db.staff.get(sent.owner_staff_id)).toMatchObject({ role: 'owner' });
    expect(await getStoredDevice()).toEqual({
      id: sent.device_id,
      code: 'A1',
      shop_id: sent.shop_id,
      mode: 'shop',
      staff_id: sent.owner_staff_id,
    });
  });

  it('asks who uses the device, defaulting to the shop counter; owner mode renames it', async () => {
    serverAccepts();
    await openOnboarding();
    expect(screen.getByRole('group', { name: 'Who uses this device?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Shop counter/ })).toBeChecked();
    expect(screen.getByLabelText('Name for this device')).toHaveValue('Shop counter');

    fireEvent.click(screen.getByRole('radio', { name: /My own phone/ }));
    expect(screen.getByLabelText('Name for this device')).toHaveValue('Owner phone');
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument();
    expect(mocked.registerDevice.mock.calls[0]![0]).toMatchObject({
      mode: 'owner',
      name: 'Owner phone',
    });
    expect(await getStoredDevice()).toMatchObject({ mode: 'owner' });
  });

  it('keeps a typed device name when the mode changes', async () => {
    await openOnboarding();
    typeInto('Name for this device', 'Till 1');
    fireEvent.click(screen.getByRole('radio', { name: /My own phone/ }));
    expect(screen.getByLabelText('Name for this device')).toHaveValue('Till 1');
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
    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument();
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
      Promise.resolve(
        deviceRow({ id: input.id, code: 'A2', name: input.name, mode: input.mode ?? 'shop' }),
      ),
    );
    renderAt('/setup');

    expect(await screen.findByRole('heading', { name: 'Add this device' })).toBeInTheDocument();
    expect(screen.getByText(/You are signed in to Ali Fruit/)).toBeInTheDocument();
    typeInto('Name for this device', 'Counter PC');
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    // Setup navigates home twice (Gate redirect + onDone), so check inside waitFor.
    await waitFor(() => expect(screen.getByText('This device: A2')).toBeInTheDocument());
    expect(mocked.createShop).not.toHaveBeenCalled();
    expect(mocked.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: shopRow().id, name: 'Counter PC', mode: 'shop' }),
    );
  });

  it("registers the owner's own phone in owner mode when chosen", async () => {
    mocked.me.mockResolvedValue(me([{ role: 'owner', shop: shopRow(), staff: staffRow() }]));
    mocked.registerDevice.mockImplementation((input) =>
      Promise.resolve(
        deviceRow({ id: input.id, code: 'A2', name: input.name, mode: input.mode ?? 'shop' }),
      ),
    );
    renderAt('/setup');
    await screen.findByRole('heading', { name: 'Add this device' });
    expect(screen.getByRole('radio', { name: /Shop counter/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /My own phone/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    // Setup navigates home twice (Gate redirect + onDone), so check inside waitFor.
    await waitFor(() => expect(screen.getByText('This device: A2')).toBeInTheDocument());
    expect(mocked.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Owner phone', mode: 'owner' }),
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

describe('invited owner (US012)', () => {
  const registers = () =>
    mocked.registerDevice.mockImplementation((input) =>
      Promise.resolve(
        deviceRow({
          id: input.id,
          code: 'B1',
          name: input.name,
          mode: input.mode ?? 'shop',
          shop_id: input.shop_id,
        }),
      ),
    );

  it('without a PIN: adds the device, then sets the first PIN (hashed here) and saves it', async () => {
    mocked.me.mockResolvedValue(
      me([
        { role: 'owner', shop: shopRow({ type: 'grocery' }), staff: staffRow(), has_pin: false },
      ]),
    );
    mocked.setFirstPin.mockResolvedValue({ success: true });
    registers();
    renderAt('/setup');
    await screen.findByRole('heading', { name: 'Add this device' });
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    expect(await screen.findByRole('heading', { name: 'Set your PIN' })).toBeInTheDocument();
    expect(mocked.registerDevice).not.toHaveBeenCalled();

    typeInto('Your 4-digit PIN', '1234');
    typeInto('Enter the PIN again', '9999');
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN and continue' }));
    expect(await screen.findByText('The two PINs do not match.')).toBeInTheDocument();
    expect(mocked.setFirstPin).not.toHaveBeenCalled();

    typeInto('Enter the PIN again', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN and continue' }));
    await waitFor(() => expect(mocked.registerDevice).toHaveBeenCalled());
    const [staffId, hash] = mocked.setFirstPin.mock.calls[0]!;
    expect(staffId).toBe(staffRow().id);
    expect(await verifyPin('1234', hash)).toBe(true);
    await waitFor(async () => expect(await db.staff_pins.get(staffRow().id)).toBeDefined());
  });

  it('an owner of several shops chooses the shop for this device', async () => {
    const second = shopRow({ id: '01900000-0000-7000-8000-0000000000b2', name: 'Second Fruit' });
    mocked.me.mockResolvedValue(
      me([
        { role: 'owner', shop: shopRow(), staff: staffRow(), has_pin: true },
        {
          role: 'owner',
          shop: second,
          staff: staffRow({ id: '01900000-0000-7000-8000-0000000000c2', shop_id: second.id }),
          has_pin: true,
        },
      ]),
    );
    registers();
    renderAt('/setup');
    expect(
      await screen.findByRole('heading', { name: 'Which shop is this device for?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Second Fruit' }));
    expect(screen.getByText(/You are signed in to Second Fruit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    await waitFor(() =>
      expect(mocked.registerDevice).toHaveBeenCalledWith(
        expect.objectContaining({ shop_id: second.id }),
      ),
    );
    expect((await getStoredDevice())?.shop_id).toBe(second.id);
  });

  it('a device already set up for the first shop stays on it after a second shop is added', async () => {
    await resetDb();
    await seedReady('owner');
    const second = shopRow({ id: '01900000-0000-7000-8000-0000000000b2', name: 'Second Fruit' });
    mocked.me.mockResolvedValue(
      me([
        { role: 'owner', shop: shopRow(), staff: staffRow(), has_pin: true },
        {
          role: 'owner',
          shop: second,
          staff: staffRow({ id: '01900000-0000-7000-8000-0000000000c2', shop_id: second.id }),
          has_pin: true,
        },
      ]),
    );
    const { router } = renderAt('/');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'Which shop is this device for?' })).toBeNull();
    expect(router.state.location.pathname).toBe('/');
    expect((await getStoredDevice())?.shop_id).toBe(shopRow().id);
    expect(mocked.registerDevice).not.toHaveBeenCalled();
  });
});

describe('after onboarding (US072)', () => {
  async function onboard(shopType: string) {
    serverAccepts();
    mocked.me.mockResolvedValueOnce(me());
    const { router } = renderAt('/setup');
    await screen.findByRole('heading', { name: 'Set up your shop' });
    fireEvent.change(screen.getByLabelText('Shop type'), { target: { value: shopType } });
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    return router;
  }

  it('a fruit & veg shop goes on to pick products from the ready-made list', async () => {
    const router = await onboard('fruit_veg');
    // Default mode is Shop counter, so the owner screen asks for the PIN just set (decision 5).
    await screen.findByRole('heading', { name: 'Owner PIN needed' });
    for (const digit of '4821') fireEvent.click(await screen.findByRole('button', { name: digit }));
    expect(await screen.findByRole('heading', { name: 'Pick your products' })).toBeInTheDocument();
    // Stays there (the setup gate's own redirect must not win).
    await new Promise((r) => setTimeout(r, 300));
    expect(router.state.location.pathname).toBe('/products/presets');
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
  });

  it.each(['grocery', 'meat', 'general'])(
    '%s (no ready-made list) goes straight home',
    async (type) => {
      const router = await onboard(type);
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
        ).toBeInTheDocument(),
      );
      expect(await db.meta.get('after_setup')).toBeUndefined();
    },
  );
});
