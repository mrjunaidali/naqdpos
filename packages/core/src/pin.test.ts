import { describe, expect, it } from 'vitest';
import { hashPin, isValidPin, PIN_ITERATIONS, verifyPin } from './pin.ts';

// Fewer iterations keep the tests fast; the default is checked separately.
const fast = { iterations: 1000 };

describe('isValidPin', () => {
  it('accepts exactly 4 ASCII digits', () => {
    expect(isValidPin('0123')).toBe(true);
    for (const bad of ['', '123', '12345', '12a4', ' 1234', '١٢٣٤']) {
      expect(isValidPin(bad), bad).toBe(false);
    }
  });
});

describe('hashPin / verifyPin', () => {
  it('verifies the right PIN and rejects a wrong one', async () => {
    const stored = await hashPin('4821', fast);
    await expect(verifyPin('4821', stored)).resolves.toBe(true);
    await expect(verifyPin('4822', stored)).resolves.toBe(false);
  });

  it('uses the documented format and the default iteration count', async () => {
    const stored = await hashPin('4821');
    const [scheme, iterations, salt, hash] = stored.split('$');
    expect(scheme).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBe(PIN_ITERATIONS);
    expect(atob(salt!)).toHaveLength(16);
    expect(atob(hash!)).toHaveLength(32);
    expect(stored).not.toContain('4821');
  });

  it('salts every hash, so the same PIN gives different hashes', async () => {
    expect(await hashPin('1111', fast)).not.toBe(await hashPin('1111', fast));
  });

  it('is deterministic for a given salt (matches across devices)', async () => {
    const salt = new Uint8Array(16).fill(7);
    expect(await hashPin('2580', { ...fast, salt })).toBe(await hashPin('2580', { ...fast, salt }));
  });

  it('refuses invalid PINs and malformed hashes', async () => {
    await expect(hashPin('12', fast)).rejects.toThrow();
    const stored = await hashPin('4821', fast);
    await expect(verifyPin('48', stored)).resolves.toBe(false);
    await expect(verifyPin('4821', 'plain-4821')).resolves.toBe(false);
    await expect(verifyPin('4821', stored.replace('pbkdf2-sha256', 'md5'))).resolves.toBe(false);
  });
});
