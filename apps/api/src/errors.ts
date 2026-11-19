import type { ErrorResponse } from '@naqdpos/core';

/** The one error shape every route returns (ErrorResponse in packages/core). */
export function errorBody(error: ErrorResponse['error'], message?: string): ErrorResponse {
  return message === undefined ? { error } : { error, message };
}
