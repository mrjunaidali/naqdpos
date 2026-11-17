// Internal helpers for fixed-point integers (paisa = 2 decimals, milli = 3 decimals).
// Parsing works on strings and rounding uses BigInt, so floats never touch money or quantity.

export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${String(value)}`);
  }
}

const DECIMAL_RE = /^([+-])?(\d+)?(?:\.(\d*))?$/;

/**
 * Parse a decimal string ("12", "12.5", "-0.25", ".5") into an integer scaled by 10^decimals.
 * Throws if the string has more fractional digits than `decimals` (no silent rounding of input).
 */
export function parseFixed(input: string, decimals: number, label: string): number {
  const trimmed = input.trim().replace(/,/g, '');
  const match = DECIMAL_RE.exec(trimmed);
  const whole = match?.[2] ?? '';
  const frac = match?.[3] ?? '';
  if (!match || (whole === '' && frac === '')) {
    throw new RangeError(`${label}: not a number: "${input}"`);
  }
  if (frac.length > decimals) {
    throw new RangeError(`${label}: at most ${decimals} decimal places allowed: "${input}"`);
  }
  const digits = (whole === '' ? '0' : whole) + frac.padEnd(decimals, '0');
  const sign = match[1] === '-' ? -1n : 1n;
  const scaled = sign * BigInt(digits);
  const result = Number(scaled);
  assertSafeInteger(result, label);
  return result === 0 ? 0 : result; // normalise -0
}

/** Format an integer scaled by 10^decimals as a plain decimal string ("-12.50"). */
export function formatFixed(value: number, decimals: number, label: string): string {
  assertSafeInteger(value, label);
  const negative = value < 0;
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${frac}` : ''}`;
}

/** (a * b) / divisor, rounded half away from zero, computed exactly with BigInt. */
export function mulDivRound(a: number, b: number, divisor: number): number {
  const product = BigInt(a) * BigInt(b);
  const d = BigInt(divisor);
  const negative = product < 0n !== d < 0n;
  const absProduct = product < 0n ? -product : product;
  const absD = d < 0n ? -d : d;
  let quotient = absProduct / absD;
  if ((absProduct % absD) * 2n >= absD) quotient += 1n;
  const result = Number(negative ? -quotient : quotient);
  return result === 0 ? 0 : result;
}
