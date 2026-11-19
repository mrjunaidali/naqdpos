// Pakistani mobile numbers (owner mobile in onboarding, architecture §5). Stored and sent in
// E.164 form (+923001234567) so the same number always compares equal.

/** The canonical stored form: +92 3XX XXXXXXX. */
export const PK_MOBILE_PATTERN = /^\+923[0-9]{9}$/;

/**
 * Accepts what people type (0300 1234567, 03001234567, 923001234567, +92 300-1234567,
 * 0092 300 1234567) and returns +923001234567, or null if it is not a Pakistani mobile.
 */
export function normalizePkMobile(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, '');
  let national: string | undefined;
  if (/^03[0-9]{9}$/.test(compact)) national = compact.slice(1);
  else if (/^\+923[0-9]{9}$/.test(compact)) national = compact.slice(3);
  else if (/^923[0-9]{9}$/.test(compact)) national = compact.slice(2);
  else if (/^00923[0-9]{9}$/.test(compact)) national = compact.slice(4);
  return national === undefined ? null : `+92${national}`;
}

export function isPkMobile(value: string): boolean {
  return PK_MOBILE_PATTERN.test(value);
}

/** +923001234567 → 0300 1234567 (how people read it in Pakistan). */
export function formatPkMobile(e164: string): string {
  if (!isPkMobile(e164)) return e164;
  const national = `0${e164.slice(3)}`;
  return `${national.slice(0, 4)} ${national.slice(4)}`;
}
