/**
 * Reads `#ott=…` (put there by the API after Google sign-in) and removes it from the address
 * straight away, so the token is not kept in history, bookmarks or a shared link. It is
 * single-use and short-lived on the server as well.
 */
export function takeOneTimeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('ott');
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
  return token;
}
