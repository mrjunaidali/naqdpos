// Short, non-blocking messages (architecture §7: "Synced 37 records", the reminder toast).
import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  show: (text: string, ms?: number) => void;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text, ms = 5000) => {
    const id = next++;
    set({ toasts: [...get().toasts, { id, text }] });
    if (ms > 0) setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const showToast = (text: string, ms?: number) => useToastStore.getState().show(text, ms);
