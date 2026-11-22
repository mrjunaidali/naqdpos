import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/index.ts';
import { setToken } from '../api/session.ts';

/** Google returns here through the API with a single-use token; trade it for the session. */
export function GoogleCallbackPage() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const [failed, setFailed] = useState(token === null);
  useEffect(() => {
    if (!token) return;
    void api
      .exchangeOneTimeToken(token)
      .then((r) => {
        setToken(r.token);
        void navigate('/', { replace: true });
      })
      .catch(() => setFailed(true));
  }, [navigate, token]);
  return (
    <p className="p-6 text-muted">{failed ? 'Google sign-in failed. Try again.' : 'Signing in…'}</p>
  );
}
