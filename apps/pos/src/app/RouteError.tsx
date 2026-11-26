import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { DbUnavailableError } from '../db/retry.ts';

function errorText(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Friendly error screen for a route (bug 2026-11-25: iPhones showed React Router's raw
 * "Unexpected Application Error!" page). The unsynced data is on disk either way, so the screen
 * says so and offers "Try again" (re-renders the route: a new location resets the boundary) and
 * "Reload app". `fullPage`: the app-wide one, which replaces the layout and header.
 */
export function RouteError({
  fullPage = false,
  area,
}: {
  fullPage?: boolean;
  /** A screen-specific message (e.g. Day Close); otherwise the generic one. */
  area?: 'closing';
}) {
  const { t } = useTranslation();
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();
  const reloadNeeded = error instanceof DbUnavailableError;

  const tryAgain = () =>
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: { retry: Date.now() },
    });

  return (
    <section
      role="alert"
      data-testid="route-error"
      className={`mx-auto max-w-md space-y-4 ${fullPage ? 'min-h-dvh px-4 pt-[calc(env(safe-area-inset-top)+2rem)]' : ''}`}
    >
      <h1 className="text-2xl font-bold">{t('routeError.title')}</h1>
      <p>
        {reloadNeeded
          ? t('routeError.reloadNeeded')
          : area === 'closing'
            ? t('routeError.closingBody')
            : t('routeError.body')}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {!reloadNeeded && (
          <button
            type="button"
            onClick={tryAgain}
            className="min-h-12 flex-1 rounded-md bg-primary px-4 font-semibold text-primary-fg"
          >
            {t('routeError.tryAgain')}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`min-h-12 flex-1 rounded-md px-4 font-semibold ${
            reloadNeeded ? 'bg-primary text-primary-fg' : 'border border-border text-text'
          }`}
        >
          {t('routeError.reload')}
        </button>
      </div>
      <details className="text-sm text-muted">
        <summary className="min-h-11 cursor-pointer py-2">{t('routeError.details')}</summary>
        <p dir="ltr" className="break-words text-start">
          {errorText(error)}
        </p>
      </details>
    </section>
  );
}
