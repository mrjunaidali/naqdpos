// Client IP for rate limits and logs (staging 27 Nov 2026: Better Auth "could not determine a
// client IP", so every client shared one sign-in bucket). Railway puts the IP in x-real-ip.
import { describe, expect, it } from 'vitest';
import { clientIp, maskIp } from './clientIp.ts';

describe('clientIp', () => {
  const h = (headers: Record<string, string>) => new Headers(headers);

  it('reads one address from the configured header only', () => {
    expect(clientIp(h({ 'x-real-ip': '203.0.113.7' }), 'x-real-ip')).toBe('203.0.113.7');
    expect(clientIp(h({ 'x-real-ip': ' 2001:DB8::1 ' }), 'x-real-ip')).toBe('2001:db8::1');
    expect(clientIp(h({ 'x-real-ip': '::ffff:203.0.113.7' }), 'x-real-ip')).toBe('203.0.113.7');
  });

  it('never reads X-Forwarded-For, a list, junk, or anything when no header is set', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7' }), 'x-real-ip')).toBeNull();
    expect(clientIp(h({ 'x-real-ip': '1.2.3.4, 203.0.113.7' }), 'x-real-ip')).toBeNull();
    expect(clientIp(h({ 'x-real-ip': 'localhost' }), 'x-real-ip')).toBeNull();
    expect(clientIp(h({ 'x-real-ip': '203.0.113.7' }), undefined)).toBeNull();
  });
});

describe('maskIp', () => {
  it('IPv4: the last octet becomes x', () => {
    expect(maskIp('203.0.113.7')).toBe('203.0.113.x');
  });
  it('IPv6: only the first three groups stay', () => {
    expect(maskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:x:x:x:x:x');
    expect(maskIp('2001:db8::1')).toBe('2001:db8:0:x:x:x:x:x');
    expect(maskIp('2001:0db8:0001::1')).toBe('2001:db8:1:x:x:x:x:x');
  });
  it('anything else is just x', () => {
    expect(maskIp('nonsense')).toBe('x');
  });
});
