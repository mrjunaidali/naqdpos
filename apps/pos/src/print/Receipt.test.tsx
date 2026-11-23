import { FRESH_PRODUCE, makeLine, type CartLine } from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/schema.ts';
import { writeCurrentStaffId } from '../staff/currentStaff.ts';
import { resetApiMock } from '../test/apiMock.ts';
import { resetDb, seedPin, seedReady, SHOP_ID, STAFF_ID, staffRow } from '../test/fixtures.ts';
import { renderAt } from '../test/render.tsx';
import { createFromPresets } from '../features/catalogue/catalogueRepo.ts';
import { findOrAddCustomer } from '../features/khata/khataRepo.ts';
import { useCartStore } from '../features/sale/cartStore.ts';
import { completeSale } from '../features/sale/completeSale.ts';
import { saveShopProfile } from '../features/settings/shopProfile.ts';
import { bluetoothSupported, PRINTER_KEY, printBytes, PrinterError } from './bluetooth.ts';
import { shareReceipt } from './share.ts';

vi.mock('../api/index.ts', () => import('../test/apiMock.ts'));
vi.mock('../sync/index.ts', () => ({
  syncEngine: { syncNow: vi.fn(() => Promise.resolve('synced')) },
}));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function seedShop(mode: 'owner' | 'shop' = 'owner') {
  await seedReady(mode);
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await seedPin(STAFF_ID, '4821');
  await createFromPresets(
    [{ preset: FRESH_PRODUCE.find((p) => p.key === 'tomato')!, rate: 16500 }],
    STAFF_ID,
  );
  await db.outbox.clear();
}

/** A sale of 1.3 kg tomatoes (Rs 215), optionally on a customer's khata. */
async function sale(withCustomer = false) {
  const p = (await db.products.toArray())[0]!;
  useCartStore.getState().put(
    makeLine(
      {
        product_id: p.id,
        name: p.name,
        name_ur: p.name_ur,
        unit: p.unit,
        icon: null,
        unit_price_paisa: p.sale_price_paisa,
      },
      1300,
    ) as CartLine,
  );
  if (withCustomer) {
    const c = await findOrAddCustomer('0300 1234567', 'Sara', STAFF_ID);
    useCartStore.getState().setCustomer(c.id);
    return completeSale([], { khataPaisa: 21500 });
  }
  return completeSale([{ method_code: 'cash', amount_paisa: 21500, reference: null }]);
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  setOnline(true);
  useCartStore.setState({
    lines: [],
    billDiscount: null,
    approval: null,
    customerId: null,
    ready: true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'bluetooth');
});

describe('shop profile (US014)', () => {
  it('asks a cashier for the owner PIN', async () => {
    await seedShop('shop');
    await writeCurrentStaffId(CASHIER);
    renderAt('/settings/shop');
    expect(await screen.findByRole('heading', { name: 'Owner PIN needed' })).toBeInTheDocument();
  });

  it('the owner saves the profile through the outbox; a long footer is refused', async () => {
    await seedShop();
    const { router } = renderAt('/settings/shop');
    fireEvent.change(await screen.findByLabelText('Receipt footer'), {
      target: { value: 'x'.repeat(201) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Too long.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Receipt footer'), {
      target: { value: 'Thank you!\nShukriya' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Urdu' }));
    fireEvent.click(screen.getByRole('button', { name: '80 mm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(await db.shops.get(SHOP_ID)).toMatchObject({
      receipt_footer: 'Thank you!\nShukriya',
      receipt_language: 'ur',
      paper_width_mm: 80,
    });
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({
      table: 'shops',
      actor_staff_id: STAFF_ID,
    });
  });
});

describe('receipt screen (US036)', () => {
  it('previews in the shop language: Urdu is right-to-left', async () => {
    await seedShop();
    const shop = (await db.shops.get(SHOP_ID))!;
    await saveShopProfile(
      {
        name: shop.name,
        address: null,
        city: null,
        phone: null,
        receipt_footer: 'Shukriya',
        receipt_language: 'ur',
        paper_width_mm: 80,
        cashier_expense_limit_paisa: 200_000,
      },
      STAFF_ID,
    );
    const { sale: s } = await sale();
    renderAt(`/receipt/${s.id}`);
    const total = await screen.findByText('کل');
    const receipt = total.closest('.receipt')!;
    expect(receipt.getAttribute('dir')).toBe('rtl');
    expect(receipt.getAttribute('data-paper')).toBe('80');
    expect(screen.getByText('215 روپے', { selector: '.receipt-strong span' })).toBeInTheDocument();
    expect(screen.getByText('Shukriya')).toBeInTheDocument();
  });

  it('shows the shop logo from the device copy, offline (US014)', async () => {
    await seedShop();
    const key = `logos/${SHOP_ID}/logo-019a9b8e-1111-7000-8000-000000000001.webp`;
    await db.shops.update(SHOP_ID, { logo_path: key });
    await db.meta.put({
      key: 'shop_logo',
      value: { key, type: 'image/webp', bytes: new Uint8Array([1, 2, 3]).buffer },
    });
    const createObjectURL = vi.fn(() => 'blob:logo');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    setOnline(false);
    const { sale: s } = await sale();
    renderAt(`/receipt/${s.id}`);
    const logo = await waitFor(() => {
      const img = document.querySelector('.receipt .receipt-logo');
      expect(img).not.toBeNull();
      return img!;
    });
    expect(logo.getAttribute('src')).toBe('blob:logo');
    // The paper starts with the logo, then the shop name.
    expect(logo.parentElement!.firstElementChild).toBe(logo);
    vi.unstubAllGlobals();
  });

  it('WhatsApp goes to the attached customer, offline too', async () => {
    await seedShop();
    const { sale: s } = await sale(true);
    setOnline(false);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderAt(`/receipt/${s.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Share on WhatsApp' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    const url = String(open.mock.calls[0]![0]);
    expect(url.startsWith('https://wa.me/923001234567?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]!);
    expect(text).toContain('*Total: Rs 215*');
    expect(text).toContain('On khata: Rs 215');
    expect(text).toContain('*Khata balance: Rs 215*');
  });

  it('without a customer: copies the receipt when sharing is not available', async () => {
    await seedShop();
    const { sale: s } = await sale();
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    renderAt(`/receipt/${s.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Share on WhatsApp' }));
    expect(await screen.findByText('Receipt copied')).toBeInTheDocument();
    expect(writeText.mock.calls[0]![0]).toContain('*Total: Rs 215*');
  });

  it('"No receipt" finishes; "Receipt" opens the receipt', async () => {
    await seedShop();
    const { sale: s } = await sale();
    const { router } = renderAt(`/sale/done/${s.id}`);
    expect(await screen.findByRole('link', { name: 'Receipt' })).toHaveAttribute(
      'href',
      `/receipt/${s.id}`,
    );
    fireEvent.click(screen.getByRole('link', { name: 'No receipt' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sale'));
  });

  it('reprints from Today’s sales', async () => {
    await seedShop();
    const { sale: s } = await sale();
    const { router } = renderAt(`/sales/${s.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Receipt' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/receipt/${s.id}`));
    expect(await screen.findByText(s.receipt_no)).toBeInTheDocument();
  });

  it('a cashier cannot open another person’s receipt', async () => {
    await seedShop('shop');
    const { sale: s } = await sale(); // sold by the owner
    await writeCurrentStaffId(CASHIER);
    renderAt(`/receipt/${s.id}`);
    expect(await screen.findByText('Receipt not found.')).toBeInTheDocument();
  });

  it('the Bluetooth button only shows where Web Bluetooth exists', async () => {
    await seedShop();
    const { sale: s } = await sale();
    renderAt(`/receipt/${s.id}`);
    await screen.findByRole('button', { name: 'Print' });
    expect(screen.queryByRole('button', { name: 'Bluetooth printer' })).toBeNull();
    expect(bluetoothSupported()).toBe(false);
  });
});

describe('sharing fallbacks', () => {
  it('customer → wa.me; else share sheet; else clipboard; else failed', async () => {
    const open = vi.fn();
    expect(await shareReceipt('hi', '+923001234567', { open })).toBe('whatsapp');
    expect(open).toHaveBeenCalledWith('https://wa.me/923001234567?text=hi');
    const share = vi.fn(() => Promise.resolve());
    expect(await shareReceipt('hi', null, { open, share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'hi' });
    const copy = vi.fn(() => Promise.resolve());
    const broken = vi.fn(() => Promise.reject(new Error('no')));
    expect(await shareReceipt('hi', null, { open, share: broken, copy })).toBe('copied');
    expect(await shareReceipt('hi', null, { open })).toBe('failed');
  });
});

describe('Bluetooth printing', () => {
  function fakePrinter() {
    const written: number[] = [];
    const characteristic = {
      uuid: 'c',
      properties: { write: true, writeWithoutResponse: false },
      writeValue: vi.fn((v: ArrayBufferView) => {
        written.push(...new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        return Promise.resolve();
      }),
    };
    const server = {
      connected: true,
      connect: () => Promise.resolve(server),
      disconnect: vi.fn(),
      getPrimaryServices: () =>
        Promise.resolve([
          { uuid: 's', getCharacteristics: () => Promise.resolve([characteristic]) },
        ]),
    };
    const device = { id: 'printer-1', name: 'MPT-II', gatt: server };
    const bluetooth = {
      getAvailability: () => Promise.resolve(true),
      requestDevice: vi.fn(() => Promise.resolve(device)),
      getDevices: vi.fn(() => Promise.resolve([device])),
    };
    return {
      written,
      characteristic,
      server,
      bluetooth,
      nav: { bluetooth } as unknown as Navigator,
    };
  }

  it('sends the bytes in chunks and remembers the printer', async () => {
    await seedReady();
    const p = fakePrinter();
    const bytes = Uint8Array.from({ length: 400 }, (_, i) => i & 0xff);
    await printBytes(bytes, p.nav);
    expect(p.characteristic.writeValue).toHaveBeenCalledTimes(3); // 180 + 180 + 40
    expect(p.written).toEqual([...bytes]);
    expect(p.server.disconnect).toHaveBeenCalled();
    expect((await db.meta.get(PRINTER_KEY))?.value).toEqual({ id: 'printer-1', name: 'MPT-II' });

    // Next time the remembered printer is used without the chooser.
    await printBytes(Uint8Array.from([1]), p.nav);
    expect(p.bluetooth.requestDevice).toHaveBeenCalledTimes(1);
  });

  it('clear errors: Bluetooth off, printer not found', async () => {
    await seedReady();
    const off = fakePrinter();
    off.bluetooth.getAvailability = () => Promise.resolve(false);
    await expect(printBytes(Uint8Array.from([1]), off.nav)).rejects.toEqual(
      new PrinterError('bluetooth_off'),
    );
    const none = fakePrinter();
    none.bluetooth.requestDevice.mockRejectedValueOnce(
      new DOMException('cancelled', 'NotFoundError'),
    );
    await expect(printBytes(Uint8Array.from([1]), none.nav)).rejects.toEqual(
      new PrinterError('not_found'),
    );
  });
});
