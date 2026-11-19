import { describe, expect, it, vi } from 'vitest';
import { addOneTimeTokenToRedirect } from './auth.ts';

const ORIGINS = ['https://pos.naqd.pk', 'http://localhost:5173'];

function redirect(location: string, sessionToken?: string): Response {
  const headers = new Headers({ location });
  headers.append('set-cookie', 'better-auth.session_token=signed; Path=/; HttpOnly');
  if (sessionToken) headers.set('set-auth-token', sessionToken);
  return new Response(null, { status: 302, headers });
}

describe('addOneTimeTokenToRedirect (Google sign-in hand-off)', () => {
  it('adds a one-time token as a URL fragment and hides the session token', async () => {
    const mint = vi.fn(() => Promise.resolve('ott/123'));
    const res = await addOneTimeTokenToRedirect(
      redirect('https://pos.naqd.pk/auth/callback', 'session.sig'),
      ORIGINS,
      mint,
    );
    expect(mint).toHaveBeenCalledWith('session.sig');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://pos.naqd.pk/auth/callback#ott=ott%2F123');
    expect(res.headers.get('set-auth-token')).toBeNull();
    // The token never goes in the query string, which static hosts log.
    expect(new URL(res.headers.get('location')!).search).toBe('');
  });

  it('never mints a token for a redirect to an origin that is not ours', async () => {
    const mint = vi.fn(() => Promise.resolve('ott'));
    const res = await addOneTimeTokenToRedirect(
      redirect('https://evil.test/steal', 'session.sig'),
      ORIGINS,
      mint,
    );
    expect(mint).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://evil.test/steal');
    expect(res.headers.get('set-auth-token')).toBeNull();
  });

  it('leaves error redirects (no new session) untouched', async () => {
    const mint = vi.fn(() => Promise.resolve('ott'));
    const original = redirect('https://pos.naqd.pk/sign-in?error=access_denied');
    const res = await addOneTimeTokenToRedirect(original, ORIGINS, mint);
    expect(res).toBe(original);
    expect(mint).not.toHaveBeenCalled();
  });

  it('leaves non-redirect responses untouched', async () => {
    const original = new Response('{}', {
      status: 200,
      headers: { 'set-auth-token': 'session.sig' },
    });
    expect(await addOneTimeTokenToRedirect(original, ORIGINS, () => Promise.resolve('x'))).toBe(
      original,
    );
  });
});
