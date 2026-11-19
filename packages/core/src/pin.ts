// Staff PIN hashing (architecture §5): PBKDF2-SHA256 via WebCrypto, so it runs the same in the
// browser (offline PIN check) and in Node. Stored as pbkdf2-sha256$<iterations>$<salt>$<hash>.
//
// A 4-digit PIN has only 10,000 values, so anyone holding a hash can always find the PIN; the
// hash only keeps PINs out of plain text. Who can read pin_hash is the real control
// (docs/progress.md, Step 1 follow-up).

export const PIN_ITERATIONS = 100_000;
const SCHEME = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const HASH_BITS = 256;

export function isValidPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPin(
  pin: string,
  options: { iterations?: number; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<string> {
  if (!isValidPin(pin)) throw new Error('PIN must be exactly 4 digits');
  const iterations = options.iterations ?? PIN_ITERATIONS;
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, iterations);
  return `${SCHEME}$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** False for a wrong PIN and for a hash in an unknown format. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iterationsText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (scheme !== SCHEME || !Number.isInteger(iterations) || iterations < 1) return false;
  if (!saltText || !hashText || !isValidPin(pin)) return false;
  const expected = fromBase64(hashText);
  const actual = await derive(pin, fromBase64(saltText), iterations);
  if (actual.length !== expected.length) return false;
  // Compare every byte so timing does not reveal how much matched.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}
