// UUIDv5 (RFC 9562 §5.5): SHA-1 of namespace bytes + name (UTF-8), version 5, RFC variant.
// WebCrypto only (browsers and Node), no dependency. Used for customer ids (architecture §3):
// the same shop + mobile always gives the same id, on every device.
import { normalizePkMobile } from './phone.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidBytes(uuid: string): Uint8Array {
  if (!UUID_PATTERN.test(uuid)) throw new TypeError('namespace must be a UUID');
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function uuidv5(namespace: string, name: string): Promise<string> {
  const ns = uuidBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', input));
  const bytes = hash.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  return formatUuid(bytes);
}

/**
 * A customer's id: UUIDv5(namespace = shop id, name = E.164 mobile). Any typed form of the same
 * number gives the same id. null when the mobile is not a Pakistani mobile.
 */
export async function customerId(shopId: string, mobile: string): Promise<string | null> {
  const e164 = normalizePkMobile(mobile);
  return e164 ? uuidv5(shopId, e164) : null;
}
