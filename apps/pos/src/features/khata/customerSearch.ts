import type { CustomerRow } from '@naqdpos/core';

/** Search by mobile digits or name. */
export function matchCustomers(customers: readonly CustomerRow[], query: string): CustomerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...customers];
  const digits = q.replace(/\D/g, '');
  // "0300…" and "+92300…" find the same number.
  const national = digits.startsWith('92') ? digits.slice(2) : digits.replace(/^0/, '');
  return customers.filter(
    (c) =>
      (c.name ?? '').toLowerCase().includes(q) ||
      (national.length >= 3 && c.mobile.slice(3).includes(national)),
  );
}
