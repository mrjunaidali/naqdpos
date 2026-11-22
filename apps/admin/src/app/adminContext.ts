import { createContext, useContext } from 'react';

export interface AdminContextValue {
  email: string;
  signOut: () => void;
  /** A 401 from /admin/*: the session ended (12 hours, or signed out elsewhere). */
  expired: () => void;
}

export const AdminContext = createContext<AdminContextValue>({
  email: '',
  signOut: () => undefined,
  expired: () => undefined,
});

export const useAdmin = () => useContext(AdminContext);

export const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(iso))
    : '—';
