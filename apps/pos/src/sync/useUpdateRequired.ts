import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema.ts';
import { readSyncState } from './state.ts';

/** True while the API refuses this app version (426, architecture §4). */
export function useUpdateRequired(): boolean {
  return useLiveQuery(async () => (await readSyncState(db)).updateRequired !== null) ?? false;
}
