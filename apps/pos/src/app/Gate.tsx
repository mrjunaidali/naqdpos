import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAppState, type AppState } from './appState.ts';

const HOME: Record<AppState, string> = {
  'signed-out': '/sign-in',
  setup: '/setup',
  ready: '/',
};

/** Renders `children` only in the given state; otherwise sends the user where they belong. */
export function Gate({ state, children }: { state: AppState; children: ReactNode }) {
  const current = useAppState();
  if (current === undefined) return null; // Dexie is still opening; avoids a flash of sign-in
  if (current !== state) return <Navigate to={HOME[current]} replace />;
  return children;
}
