import { ApiError } from '../api/index.ts';

/** i18n key for a failed API call, so every screen words the same failure the same way. */
export function errorMessageKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'errors.generic';
  if (error.status === 0) return 'errors.offline';
  if (error.status === 429 || error.code === 'TOO_MANY_ATTEMPTS') return 'errors.tooManyAttempts';
  if (error.code === 'INVALID_OTP') return 'signIn.wrongCode';
  if (error.code === 'OTP_EXPIRED') return 'signIn.codeExpired';
  return 'errors.generic';
}
