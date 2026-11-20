// UI-only cart state (Zustand, CLAUDE.md). For now only what the reload banners need: the app
// never offers a reload while the cart has items (architecture §6, §7). The sale story fills it.
import { create } from 'zustand';

interface CartState {
  itemCount: number;
  setItemCount: (count: number) => void;
}

export const useCartStore = create<CartState>((set) => ({
  itemCount: 0,
  setItemCount: (itemCount) => set({ itemCount }),
}));

export const useCartIsEmpty = () => useCartStore((state) => state.itemCount === 0);
