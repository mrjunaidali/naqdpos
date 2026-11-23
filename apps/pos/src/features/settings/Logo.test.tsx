// Shop logo (US014): shrunk on the device, uploaded with a pre-signed URL, saved through the
// outbox, kept on every device for offline use, shown by <BrandMark /> and on receipts.
import { LOGO_MAX_BYTES, type LogoContentType } from '@naqdpos/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/index.ts';
import { db } from '../../db/schema.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { resetDb, seedReady, SHOP_ID } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';
import { LOGO_META_KEY, LogoNotUsable, shrinkLogo, type ImageTools } from './logo.ts';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));
const syncNow = vi.hoisted(() => vi.fn(() => Promise.resolve('synced')));
vi.mock('../../sync/index.ts', () => ({ syncEngine: { syncNow } }));

const mocked = vi.mocked(api);
const KEY = `logos/${SHOP_ID}/logo-019a9b8e-1111-7000-8000-000000000001.webp`;

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

/** Fake encoder: size grows with pixels and quality; `webp: false` = a browser without WebP. */
function tools(
  width: number,
  height: number,
  options: { webp?: boolean; bytesPerPixel?: number } = {},
) {
  const calls: { w: number; h: number; type: string; quality: number }[] = [];
  const t: ImageTools = {
    decode: () => Promise.resolve({ width, height, source: {} as CanvasImageSource }),
    encode: (_s, w, h, type, quality) => {
      calls.push({ w, h, type, quality });
      const actual: LogoContentType =
        type === 'image/webp' && options.webp === false ? 'image/png' : type;
      const perPixel = (options.bytesPerPixel ?? 2) * (actual === 'image/png' ? 2 : quality);
      return Promise.resolve(
        new Blob([new Uint8Array(Math.round(w * h * perPixel))], { type: actual }),
      );
    },
  };
  return { t, calls };
}

describe('shrinkLogo', () => {
  it('a big photo becomes WebP at most 256 px on the long side and under 100 KB', async () => {
    const { t, calls } = tools(3000, 2000, { bytesPerPixel: 3 });
    const { blob, contentType } = await shrinkLogo(new Blob(['x']), t);
    expect(contentType).toBe('image/webp');
    expect(blob.size).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect(calls[0]).toMatchObject({ w: 256, h: 171 });
    // Quality went down until it fit.
    expect(calls.at(-1)!.quality).toBeLessThan(0.9);
  });

  it('a small logo keeps its size', async () => {
    const { t, calls } = tools(120, 80);
    await shrinkLogo(new Blob(['x']), t);
    expect(calls[0]).toMatchObject({ w: 120, h: 80 });
  });

  it('without a WebP encoder: PNG, made smaller until it fits', async () => {
    const { t, calls } = tools(1000, 1000, { webp: false, bytesPerPixel: 1 });
    const { blob, contentType } = await shrinkLogo(new Blob(['x']), t);
    expect(contentType).toBe('image/png');
    expect(blob.size).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect(calls.filter((c) => c.type === 'image/png').map((c) => c.w)).toEqual([256, 192]);
  });

  it('refuses a file that is not a picture, or one that never fits', async () => {
    const broken: ImageTools = { ...tools(1, 1).t, decode: () => Promise.reject(new Error('bad')) };
    await expect(shrinkLogo(new Blob(['x']), broken)).rejects.toEqual(
      new LogoNotUsable('unsupported'),
    );
    const huge = tools(4000, 4000, { bytesPerPixel: 50 }).t;
    await expect(shrinkLogo(new Blob(['x']), huge)).rejects.toEqual(new LogoNotUsable('too_big'));
  });
});

describe('logo in the app', () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    resetApiMock();
    await resetDb();
    await seedReady('owner');
    setOnline(true);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    let n = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => `blob:logo-${++n}`),
        revokeObjectURL: vi.fn(),
      }),
    );
    // jsdom has no image decoding or canvas encoding.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 600, height: 300 })),
    );
    HTMLCanvasElement.prototype.toBlob = function (callback, type) {
      callback(new Blob([new Uint8Array(2000)], { type: type ?? 'image/png' }));
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setOnline(true);
  });

  it('is hidden when the server has no file storage (local dev)', async () => {
    renderAt('/settings/shop');
    expect(await screen.findByRole('heading', { name: 'Shop' })).toBeInTheDocument();
    await waitFor(() => expect(mocked.config).toHaveBeenCalled());
    expect(screen.queryByText('Logo')).not.toBeInTheDocument();
  });

  it('owner uploads: pre-signed PUT, key saved through the outbox, shown at once, old one cleaned up', async () => {
    mocked.config.mockResolvedValue({ google: false, files: true });
    mocked.fileUploadUrl.mockResolvedValue({
      key: KEY,
      url: 'https://files.test/put',
      expires_in: 300,
    });
    mocked.cleanUpLogos.mockResolvedValue({ deleted: 1 });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    renderAt('/settings/shop');
    expect(await screen.findByText('Logo')).toBeInTheDocument();

    const file = new File([new Uint8Array(500_000)], 'logo.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose picture'), { target: { files: [file] } });

    expect(await screen.findByText('Logo saved')).toBeInTheDocument();
    expect(mocked.fileUploadUrl).toHaveBeenCalledWith({
      shop_id: SHOP_ID,
      kind: 'logo',
      content_type: 'image/webp',
    });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://files.test/put');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'content-type': 'image/webp' });
    expect((init.body as Blob).size).toBeLessThanOrEqual(LOGO_MAX_BYTES);

    expect((await db.shops.get(SHOP_ID))?.logo_path).toBe(KEY);
    const entry = (await db.outbox.toArray()).find((e) => e.table === 'shops');
    expect(entry?.row).toMatchObject({ id: SHOP_ID, logo_path: KEY });
    expect((await db.meta.get(LOGO_META_KEY))?.value).toMatchObject({ key: KEY });
    // Header mark shows the logo straight away (from the device copy).
    expect(await screen.findByTestId('shop-logo')).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    );
    await waitFor(() => expect(mocked.cleanUpLogos).toHaveBeenCalledWith(SHOP_ID));
    expect(syncNow).toHaveBeenCalled();
  });

  it('an unusable file shows a message and changes nothing', async () => {
    mocked.config.mockResolvedValue({ google: false, files: true });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('not an image'))),
    );
    renderAt('/settings/shop');
    const input = await screen.findByLabelText('Choose picture');
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt')] } });
    expect(await screen.findByText(/not a picture the device can open/)).toBeInTheDocument();
    expect(mocked.fileUploadUrl).not.toHaveBeenCalled();
    expect((await db.shops.get(SHOP_ID))?.logo_path).toBeNull();
  });

  it('another device: downloads the new logo once, then shows it offline', async () => {
    await db.shops.update(SHOP_ID, { logo_path: KEY });
    mocked.fileDownloadUrl.mockResolvedValue({ url: 'https://files.test/get', expires_in: 600 });
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      }),
    );
    const first = renderAt('/');
    expect(await screen.findByTestId('shop-logo')).toBeInTheDocument();
    expect(mocked.fileDownloadUrl).toHaveBeenCalledWith(KEY);
    expect(fetchMock).toHaveBeenCalledWith('https://files.test/get');
    first.unmount();

    setOnline(false);
    mocked.fileDownloadUrl.mockClear();
    renderAt('/');
    expect(await screen.findByTestId('shop-logo')).toBeInTheDocument();
    expect(mocked.fileDownloadUrl).not.toHaveBeenCalled();
  });
});
