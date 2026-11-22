import { useCallback, useState } from 'react';
import { Outlet } from 'react-router';
import { setToken } from '../api/session.ts';
import { AuthGate } from './AuthGate.tsx';
import { AdminContext } from './adminContext.ts';
import { Button } from './ui.tsx';

/** Signed-in admin shell: header with the admin's email and Sign out. */
export function AdminLayout() {
  // Remounting the gate after a 401 sends the admin back to sign-in.
  const [gateKey, setGateKey] = useState(0);
  const [message, setMessage] = useState<string>();
  const expired = useCallback(() => {
    setToken(null);
    setMessage('Your admin session ended. Sign in again.');
    setGateKey((k) => k + 1);
  }, []);
  return (
    <AuthGate key={gateKey} message={message}>
      {(email, signOut) => (
        <AdminContext.Provider value={{ email, signOut, expired }}>
          <div className="min-h-dvh">
            <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
              <span className="flex-1 text-lg font-bold">NaqdPOS Admin</span>
              <span className="text-sm text-muted">{email}</span>
              <Button variant="secondary" onClick={signOut}>
                Sign out
              </Button>
            </header>
            <main className="mx-auto max-w-6xl p-4">
              <Outlet />
            </main>
          </div>
        </AdminContext.Provider>
      )}
    </AuthGate>
  );
}
