import type { AdminCatalogue, ShopType } from '@naqdpos/core';
import { createContext, useContext } from 'react';

export interface ActContextValue {
  shop: { id: string; name: string; type: ShopType };
  catalogue: AdminCatalogue;
  /** Reloads the catalogue after a write. */
  reload: () => Promise<void>;
}

export const ActContext = createContext<ActContextValue | null>(null);

export function useAct(): ActContextValue {
  const value = useContext(ActContext);
  if (!value) throw new Error('useAct outside ActLayout');
  return value;
}

/** Rs 120.50 from paisa (display only). */
export const rupees = (paisa: number) =>
  `Rs ${(paisa / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
