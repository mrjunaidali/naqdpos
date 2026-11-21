import { describe, expect, it } from 'vitest';
import { customerId, uuidv5 } from './uuid5.ts';

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const SHOP_A = '019a9b8e-0000-7000-8000-00000000000b';
const SHOP_B = '019a9b8e-0000-7000-8000-00000000000c';

describe('uuidv5', () => {
  it('matches known vectors', async () => {
    // RFC 9562 appendix A.4
    expect(await uuidv5(DNS, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, 'python.org')
    expect(await uuidv5(DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('sets version 5 and the RFC variant', async () => {
    const id = await uuidv5(SHOP_A, '+923001234567');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refuses a namespace that is not a UUID', async () => {
    await expect(uuidv5('shop-1', 'x')).rejects.toThrow(TypeError);
  });
});

describe('customerId', () => {
  it('the same mobile, typed any way, gives the same id (two devices offline agree)', async () => {
    const onDevice1 = await customerId(SHOP_A, '0300 1234567');
    const onDevice2 = await customerId(SHOP_A, '+92 300-1234567');
    expect(onDevice1).not.toBeNull();
    expect(onDevice1).toBe(onDevice2);
    expect(onDevice1).toBe(await uuidv5(SHOP_A, '+923001234567'));
  });

  it('differs per shop and per number; null for a non-mobile', async () => {
    expect(await customerId(SHOP_A, '03001234567')).not.toBe(
      await customerId(SHOP_B, '03001234567'),
    );
    expect(await customerId(SHOP_A, '03001234567')).not.toBe(
      await customerId(SHOP_A, '03001234568'),
    );
    expect(await customerId(SHOP_A, '042 1234567')).toBeNull();
  });
});
