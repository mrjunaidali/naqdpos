// The admin's session token lives in sessionStorage: closing the tab signs out (architecture §5).
// The server also ends admin sessions 12 hours after sign-in.
const KEY = 'naqdpos_admin_token';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private mode without storage: the admin signs in again.
  }
}
