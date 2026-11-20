// UUIDv7 ids made on the device (CLAUDE.md rule 2): 48-bit Unix milliseconds, then 74 bits.
// Monotonic (RFC 9562 §6.2, method 1): within one millisecond, or when the clock steps back, the
// next id reuses the last millisecond and adds one to a 12-bit counter in rand_a. So ids sort in
// creation order, which the outbox relies on (a sale is pushed before its lines).

let lastMs = -1;
let counter = 0;

const COUNTER_MAX = 0xfff;

/** Tests only: forget the last id, as after a restart. */
export function resetUuidv7State(): void {
  lastMs = -1;
  counter = 0;
}

export function uuidv7(
  now: number = Date.now(),
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): string {
  let ms = now;
  if (ms > lastMs) {
    // A new millisecond: start the counter at a random value in its lower half, so there is room
    // for many more ids in the same millisecond.
    counter = (((random[0] ?? 0) & 0x07) << 8) | (random[1] ?? 0);
  } else {
    ms = lastMs;
    counter += 1;
    if (counter > COUNTER_MAX) {
      // Counter used up: borrow the next millisecond (still increasing).
      ms = lastMs + 1;
      counter = 0;
    }
  }
  lastMs = ms;

  const bytes = new Uint8Array(16);
  let rest = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  bytes[6] = 0x70 | (counter >> 8); // version 7 + counter high 4 bits
  bytes[7] = counter & 0xff; // counter low 8 bits
  bytes.set(random.subarray(2, 10), 8); // rand_b
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
