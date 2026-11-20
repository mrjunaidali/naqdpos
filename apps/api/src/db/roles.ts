import type { Role } from '@naqdpos/core';
import { sql } from 'kysely';
import type { Tx } from './index.ts';

/** The caller's role in a shop (RLS: members see their own memberships), or null. */
export async function shopRole(tx: Tx, shopId: string): Promise<Role | null> {
  const { rows } = await sql<{ role: Role }>`
    select role from memberships
    where shop_id = ${shopId} and user_id = current_user_id() and deleted_at is null`.execute(tx);
  return rows[0]?.role ?? null;
}
