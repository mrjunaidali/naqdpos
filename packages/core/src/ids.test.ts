import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resetUuidv7State, uuidv7 } from './ids.ts';

beforeEach(() => resetUuidv7State());

describe('uuidv7', () => {
  it('makes valid version-7 UUIDs', () => {
    const id = uuidv7();
    expect(z.uuid({ version: 'v7' }).safeParse(id).success).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('puts the millisecond timestamp first, so ids sort by time', () => {
    const zeros = new Uint8Array(10);
    expect(uuidv7(0x0193_7e5a_0000, zeros)).toBe('01937e5a-0000-7000-8000-000000000000');
    expect(uuidv7(0x0193_7e5a_1000) < uuidv7(0x0193_7e5a_2000)).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it('is strictly increasing within one millisecond (10,000 ids)', () => {
    const ids = Array.from({ length: 10_000 }, () => uuidv7(1_800_000_000_000));
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!, String(i)).toBe(true);
    for (const id of ids.slice(0, 50))
      expect(z.uuid({ version: 'v7' }).safeParse(id).success).toBe(true);
  });

  it('keeps increasing when the clock steps back', () => {
    const later = uuidv7(1_800_000_005_000);
    const earlierClock = uuidv7(1_800_000_000_000);
    expect(earlierClock > later).toBe(true);
    expect(uuidv7(1_800_000_010_000) > earlierClock).toBe(true);
  });
});
