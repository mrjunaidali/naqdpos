import { describe, expect, it } from 'vitest';
import { compareVersions, isAppVersion, isOlderThan } from './appVersion.ts';

describe('app versions', () => {
  it('compares numerically, part by part', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.1', '2.0.0')).toBeGreaterThan(0);
  });

  it('accepts only major.minor.patch', () => {
    expect(isAppVersion('0.0.0')).toBe(true);
    for (const bad of ['1.2', '1.2.3-beta', 'v1.2.3', '01.2.3', '']) {
      expect(isAppVersion(bad)).toBe(false);
    }
    expect(() => compareVersions('1.2', '1.2.0')).toThrow();
  });

  it('treats a missing or malformed version as older', () => {
    expect(isOlderThan(undefined, '1.0.0')).toBe(true);
    expect(isOlderThan('junk', '1.0.0')).toBe(true);
    expect(isOlderThan('0.9.9', '1.0.0')).toBe(true);
    expect(isOlderThan('1.0.0', '1.0.0')).toBe(false);
    expect(isOlderThan('1.0.1', '1.0.0')).toBe(false);
  });
});
