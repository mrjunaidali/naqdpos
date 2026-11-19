import { describe, expect, it } from 'vitest';
import { formatPkMobile, isPkMobile, normalizePkMobile } from './phone.ts';

describe('normalizePkMobile', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['0300 1234567', '+923001234567'],
    ['0300-123-4567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['+92-321-7654321', '+923217654321'],
    ['923451234567', '+923451234567'],
    ['0092 300 1234567', '+923001234567'],
    ['  (0333) 1234567 ', '+923331234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePkMobile(input)).toBe(expected);
  });

  it.each([
    '',
    '0300123456', // too short
    '030012345678', // too long
    '02134567890', // Karachi landline
    '+9221345678901',
    '+443001234567', // not Pakistan
    '0300123456a',
    '3001234567', // missing leading 0
  ])('rejects %j', (input) => {
    expect(normalizePkMobile(input)).toBeNull();
  });
});

describe('isPkMobile / formatPkMobile', () => {
  it('accepts only the stored E.164 form', () => {
    expect(isPkMobile('+923001234567')).toBe(true);
    expect(isPkMobile('03001234567')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatPkMobile('+923001234567')).toBe('0300 1234567');
    expect(formatPkMobile('not a number')).toBe('not a number');
  });
});
