import type { ErrorResponse } from '@naqdpos/core';

/** The one error shape every route returns (ErrorResponse in packages/core). */
export function errorBody(error: ErrorResponse['error'], message?: string): ErrorResponse {
  return message === undefined ? { error } : { error, message };
}

/** SQLSTATE of a Postgres error (e.g. 23505 unique_violation), if it is one. */
export function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
