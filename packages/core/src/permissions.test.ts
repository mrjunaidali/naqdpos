import { describe, expect, it } from 'vitest';
import { canManageDevices, canManageShop, canManageStaff, canSeeSalaries } from './permissions.ts';
import { ROLES, type Role } from './tenancy.ts';

describe.each([
  ['canManageShop', canManageShop],
  ['canManageStaff', canManageStaff],
  ['canSeeSalaries', canSeeSalaries],
  ['canManageDevices', canManageDevices],
] as const)('%s', (_name, check) => {
  it.each(ROLES.map((role) => [role, role === 'owner'] as [Role, boolean]))(
    '%s → %s',
    (role, expected) => {
      expect(check(role)).toBe(expected);
    },
  );
});
