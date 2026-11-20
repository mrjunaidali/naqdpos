import { describe, expect, it } from 'vitest';
import { ACTION_NAMES, can, type Action } from './permissions.ts';
import { ROLES, type Role } from './tenancy.ts';

/** Who may do what today (US018). Anything not listed is refused. */
const EXPECTED: Record<Action, Role[]> = {
  manage_staff: ['owner'],
  manage_devices: ['owner'],
  see_salaries: ['owner'],
  see_cost_prices: ['owner'],
  see_reports: ['owner'],
  manage_shop_settings: ['owner'],
};

describe('can(role, action)', () => {
  it('covers every action we have', () => {
    expect([...ACTION_NAMES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  const cases = ACTION_NAMES.flatMap((action) =>
    ROLES.map((role) => [role, action, EXPECTED[action].includes(role)] as const),
  );
  it.each(cases)('%s / %s → %s', (role, action, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });

  it('refuses when nobody is switched in', () => {
    expect(can(null, 'manage_staff')).toBe(false);
    expect(can(undefined, 'see_reports')).toBe(false);
  });
});
