import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAppState } from '../../app/appState.ts';
import { db } from '../../db/schema.ts';
import { readSyncState } from '../../sync/state.ts';

/**
 * Sign-in is open when signed out, and also on a set-up device whose session ended ("Sign in
 * again", auth_required): the device and its data stay while the user signs in.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const state = useAppState();
  const reauth = useLiveQuery(
    async () => (await readSyncState(db)).authProblem === 'auth_required',
  );
  if (state === undefined || reauth === undefined) return null;
  if (state === 'signed-out' || (state === 'ready' && reauth)) return children;
  return <Navigate to={state === 'setup' ? '/setup' : '/'} replace />;
}
