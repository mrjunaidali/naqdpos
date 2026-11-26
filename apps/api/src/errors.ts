import type { ErrorResponse } from '@naqdpos/core';

/** The one error shape every route returns (ErrorResponse in packages/core). */
export function errorBody(error: ErrorResponse['error'], message?: string): ErrorResponse {
  return message === undefined ? { error } : { error, message };
}

/**
 * The Postgres fields worth logging with an unexpected error (SQLSTATE, the failing object,
 * detail, hint, where), or undefined for other errors. Never the query's bound values.
 */
export function pgDetails(error: unknown): Record<string, string> | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const e = error as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of [
    'code',
    'routine',
    'schema',
    'table',
    'column',
    'constraint',
    'detail',
    'hint',
    'where',
  ]) {
    if (typeof e[key] === 'string') out[key] = e[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** SQLSTATE of a Postgres error (e.g. 23505 unique_violation), if it is one. */
export function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
