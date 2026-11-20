import { describe, expect, it } from 'vitest';
import { canSwitchIn, keepsAnActiveOwner, validateStaffForm } from './staff.ts';

const valid = {
  name: ' Bilal ',
  phone: '0300 1234567',
  role: 'cashier',
  pin: '4821',
  pinConfirm: '4821',
};

describe('validateStaffForm', () => {
  it('normalises a valid new staff member', () => {
    expect(validateStaffForm(valid, true)).toEqual({
      errors: {},
      value: { name: 'Bilal', phone: '+923001234567', role: 'cashier', pin: '4821' },
    });
  });

  it('allows no phone', () => {
    expect(validateStaffForm({ ...valid, phone: ' ' }, true).value?.phone).toBeNull();
  });

  it('reports each bad field', () => {
    const { errors, value } = validateStaffForm(
      { name: '', phone: '12345', role: 'boss', pin: '12a4', pinConfirm: '' },
      true,
    );
    expect(value).toBeUndefined();
    expect(errors).toEqual({
      name: 'required',
      phone: 'invalid_mobile',
      role: 'invalid_role',
      pin: 'invalid_pin',
    });
  });

  it('needs a PIN for a new staff member, and the confirmation to match', () => {
    expect(validateStaffForm({ ...valid, pin: '', pinConfirm: '' }, true).errors).toEqual({
      pin: 'required',
    });
    expect(validateStaffForm({ ...valid, pinConfirm: '4812' }, true).errors).toEqual({
      pinConfirm: 'pin_mismatch',
    });
  });

  it('keeps the current PIN when editing with a blank PIN', () => {
    const result = validateStaffForm({ ...valid, pin: '', pinConfirm: '' }, false);
    expect(result.errors).toEqual({});
    expect(result.value?.pin).toBeNull();
  });

  it('checks a PIN typed while editing', () => {
    expect(validateStaffForm({ ...valid, pin: '99', pinConfirm: '99' }, false).errors).toEqual({
      pin: 'invalid_pin',
    });
  });
});

describe('keepsAnActiveOwner', () => {
  const owner = { id: 'o', role: 'owner' as const, active: true, deleted_at: null };
  const owner2 = { id: 'o2', role: 'owner' as const, active: true, deleted_at: null };
  const cashier = { id: 'c', role: 'cashier' as const, active: true, deleted_at: null };

  it('refuses deactivating or demoting the last active owner', () => {
    expect(keepsAnActiveOwner([owner, cashier], { id: 'o', role: 'owner', active: false })).toBe(
      false,
    );
    expect(keepsAnActiveOwner([owner, cashier], { id: 'o', role: 'cashier', active: true })).toBe(
      false,
    );
  });

  it('allows it while another active owner remains', () => {
    expect(keepsAnActiveOwner([owner, owner2], { id: 'o', role: 'owner', active: false })).toBe(
      true,
    );
  });

  it('ignores inactive owners and allows other changes', () => {
    const old = { ...owner2, active: false };
    expect(keepsAnActiveOwner([owner, old], { id: 'o', role: 'cashier', active: true })).toBe(
      false,
    );
    expect(keepsAnActiveOwner([owner, cashier], { id: 'c', role: 'rider', active: false })).toBe(
      true,
    );
    expect(keepsAnActiveOwner([owner], { id: 'new', role: 'cashier', active: true })).toBe(true);
  });
});

describe('canSwitchIn', () => {
  it('only active, not deleted staff with a PIN', () => {
    expect(canSwitchIn({ active: true, deleted_at: null }, true)).toBe(true);
    expect(canSwitchIn({ active: false, deleted_at: null }, true)).toBe(false);
    expect(canSwitchIn({ active: true, deleted_at: '2026-11-20' }, true)).toBe(false);
    expect(canSwitchIn({ active: true, deleted_at: null }, false)).toBe(false);
  });
});
