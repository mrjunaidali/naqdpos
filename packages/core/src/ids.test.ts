import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { uuidv7 } from './ids.ts';

describe('uuidv7', () => {
  it('makes valid version-7 UUIDs', () => {
    const id = uuidv7();
    expect(z.uuid({ version: 'v7' }).safeParse(id).success).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('puts the millisecond timestamp first, so ids sort by time', () => {
    const zeros = new Uint8Array(10);
    expect(uuidv7(0x0193_7e5a_0000, zeros)).toBe('01937e5a-0000-7000-8000-000000000000');
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});
