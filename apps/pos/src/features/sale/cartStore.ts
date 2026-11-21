// The current cart (US029): Zustand for the UI, persisted to Dexie meta `cart_current` (never
// synced) on every change, so a reload or a crash keeps the cart. Lines are built by core
// (makeLine / makeAmountLine); this store only keeps them. The update banners read itemCount:
// the app never offers a reload while the cart has items (architecture §6, §7).
// The bill discount and an owner's approval (US032) are kept with the cart.
import {
  cartTotals,
  normalizeCartLine,
  type CartLine,
  type Discount,
  type DiscountApproval,
} from '@naqdpos/core';
import { create } from 'zustand';
import { db } from '../../db/schema.ts';

export const CART_KEY = 'cart_current';

interface StoredCart {
  lines?: CartLine[];
  bill_discount?: Discount | null;
  approval?: DiscountApproval | null;
}

interface CartState {
  lines: CartLine[];
  /** Bill discount (Rs or whole %), set on the pay screen. */
  billDiscount: Discount | null;
  /** An owner's PIN approval for a give-away above the cashier limit. */
  approval: DiscountApproval | null;
  /** True once the stored cart was loaded. */
  ready: boolean;
  hydrate: () => Promise<void>;
  /** Adds a line, or replaces the line with the same id. */
  put: (line: CartLine) => void;
  remove: (id: string) => void;
  setBillDiscount: (discount: Discount | null) => void;
  setApproval: (approval: DiscountApproval | null) => void;
  clear: () => void;
}

// Writes run one after another, so an older snapshot never overwrites a newer one.
let writing: Promise<unknown> = Promise.resolve();
function persist(state: Pick<CartState, 'lines' | 'billDiscount' | 'approval'>) {
  const value: StoredCart = {
    lines: state.lines,
    bill_discount: state.billDiscount,
    approval: state.approval,
  };
  writing = writing.then(() => db.meta.put({ key: CART_KEY, value })).catch(() => {});
}

/** Resolves once every queued cart write has reached Dexie (tests; before a payment later). */
export function cartSaved(): Promise<unknown> {
  return writing;
}

export const useCartStore = create<CartState>((set, get) => ({
  lines: [],
  billDiscount: null,
  approval: null,
  ready: false,
  hydrate: async () => {
    if (get().ready) return;
    const stored = (await db.meta.get(CART_KEY))?.value as StoredCart | undefined;
    // Anything added before loading finished stays, after the stored lines; a line that was
    // already persisted is not counted twice.
    set((state) => {
      const saved = (stored?.lines ?? []).map(normalizeCartLine);
      const ids = new Set(saved.map((l) => l.id));
      return {
        lines: [...saved, ...state.lines.filter((l) => !ids.has(l.id))],
        billDiscount: state.billDiscount ?? stored?.bill_discount ?? null,
        approval: state.approval ?? stored?.approval ?? null,
        ready: true,
      };
    });
  },
  put: (line) => {
    const lines = get().lines.some((l) => l.id === line.id)
      ? get().lines.map((l) => (l.id === line.id ? line : l))
      : [...get().lines, line];
    set({ lines });
    persist(get());
  },
  remove: (id) => {
    const lines = get().lines.filter((l) => l.id !== id);
    set({ lines });
    persist(get());
  },
  setBillDiscount: (billDiscount) => {
    set({ billDiscount });
    persist(get());
  },
  setApproval: (approval) => {
    set({ approval });
    persist(get());
  },
  clear: () => {
    set({ lines: [], billDiscount: null, approval: null });
    persist(get());
  },
}));

export const useCartIsEmpty = () => useCartStore((state) => state.lines.length === 0);
export const useCartTotals = () => cartTotals(useCartStore((state) => state.lines));
/** The cart line of a product (one line per product), if any. */
export const useProductLine = (productId: string) =>
  useCartStore((state) => state.lines.find((l) => l.product_id === productId));
