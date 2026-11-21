// The cashier give-away limit (US032; architecture §5). The rule lives in core (giveAway,
// withinLimit, approvalCovers); this reads the seller's role and the shop's limit from Dexie.
import {
  approvalCovers,
  DEFAULT_CASHIER_MAX_DISCOUNT_PCT,
  giveAway,
  withinLimit,
  type CartLine,
  type Discount,
  type DiscountApproval,
  type Role,
} from '@naqdpos/core';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { readCurrentStaffId } from '../../staff/currentStaff.ts';

export interface SellerLimit {
  role: Role | null;
  limitPct: number;
}

/**
 * The seller now (read from Dexie at the moment of Charge / discount / complete, so a fast tap
 * never sees a half-loaded role): the switched-in staff member's role and the shop's limit.
 */
export async function currentSeller(): Promise<SellerLimit> {
  const device = await getStoredDevice();
  const staffId = await readCurrentStaffId();
  const staff = staffId ? await db.staff.get(staffId) : undefined;
  const shop = device ? await db.shops.get(device.shop_id) : undefined;
  return {
    role: staff?.active && staff.deleted_at === null ? staff.role : null,
    limitPct: shop?.cashier_max_discount_pct ?? DEFAULT_CASHIER_MAX_DISCOUNT_PCT,
  };
}

/**
 * Whether this bill needs an owner's PIN: the seller is over the limit and no approval covers
 * the give-away. Returns the give-away to record with the approval.
 */
export function ownerApprovalNeeded(
  lines: readonly CartLine[],
  billDiscount: Discount | null,
  approval: DiscountApproval | null,
  seller: SellerLimit,
): { needed: boolean; give_away_paisa: number } {
  const amounts = giveAway(lines, billDiscount);
  const needed =
    !withinLimit(seller.role, amounts, seller.limitPct) &&
    !approvalCovers(approval, amounts.give_away_paisa);
  return { needed, give_away_paisa: amounts.give_away_paisa };
}
