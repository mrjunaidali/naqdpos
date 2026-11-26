import { describe, expect, it } from 'vitest';
import { staffInitials } from './staffInitials.ts';

describe('staffInitials (header chip below sm)', () => {
  it('takes the first letter of up to two words', () => {
    expect(staffInitials('Mian Sami')).toBe('MS');
    expect(staffInitials('  ali  ')).toBe('A');
    expect(staffInitials('Muhammad Ali Khan')).toBe('MA');
    expect(staffInitials('بلال احمد')).toBe('با');
  });
});
