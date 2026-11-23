import { createContext, useCallback, useContext } from 'react';
import { ApiError } from '../api/index.ts';

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

/**
 * Turns a failed admin call into a message; a 401 ends the session instead (back to sign-in).
 * `messages` maps API error codes to text shown to the admin.
 */
export function useFailure() {
  const { expired } = useAdmin();
  return useCallback(
    (e: unknown, fallback: string, messages: Record<string, string> = {}) => {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          expired();
          return undefined;
        }
        if (e.code && messages[e.code]) return messages[e.code];
      }
      return fallback;
    },
    [expired],
  );
}
