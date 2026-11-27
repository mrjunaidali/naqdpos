// The client's IP, from the one header the host's edge proxy sets (CLIENT_IP_HEADER; Railway:
// x-real-ip). Rules match Better Auth's for the same setting: the header must hold exactly one
// valid address, else there is no IP. X-Forwarded-For is never read (a client can fake it).
import { isIP } from 'node:net';

/** "::ffff:1.2.3.4" (IPv4 seen over IPv6) is the IPv4 address. */
function unmapIPv4(ip: string): string {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return match ? match[1]! : ip;
}

/** The client IP from `header`, or null when the header is unset, missing, a list or invalid. */
export function clientIp(headers: Headers, header: string | undefined): string | null {
  if (!header) return null;
  const value = headers.get(header)?.trim();
  if (!value || value.includes(',')) return null;
  const ip = unmapIPv4(value);
  return isIP(ip) ? ip.toLowerCase() : null;
}

/** The 8 groups of an IPv6 address ("2001:db8::1" → 2001, db8, 0, 0, 0, 0, 0, 1). */
function ipv6Groups(ip: string): string[] {
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => g.replace(/^0+(?=.)/, ''));
}

/**
 * For logs (personal data): IPv4 without its last octet ("203.0.113.x"), IPv6 with only its first
 * three groups ("2001:db8:85a3:x:x:x:x:x").
 */
export function maskIp(ip: string): string {
  if (isIP(ip) === 4) return ip.replace(/\.\d+$/, '.x');
  if (isIP(ip) === 6) return [...ipv6Groups(ip).slice(0, 3), 'x', 'x', 'x', 'x', 'x'].join(':');
  return 'x';
}
