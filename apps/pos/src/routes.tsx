import type { RouteObject } from 'react-router';
import { Gate } from './app/Gate.tsx';
import { HomePage } from './app/HomePage.tsx';
import { NotFoundPage } from './app/NotFoundPage.tsx';
import { RootLayout } from './app/RootLayout.tsx';
import { GoogleCallbackPage } from './features/auth/GoogleCallbackPage.tsx';
import { SignInPage } from './features/auth/SignInPage.tsx';
import { SetupPage } from './features/onboarding/SetupPage.tsx';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: (
          <Gate state="ready">
            <HomePage />
          </Gate>
        ),
      },
      {
        path: 'sign-in',
        element: (
          <Gate state="signed-out">
            <SignInPage />
          </Gate>
        ),
      },
      // Not gated: it runs before a session exists and finishes by saving one.
      { path: 'auth/callback', element: <GoogleCallbackPage /> },
      {
        path: 'setup',
        element: (
          <Gate state="setup">
            <SetupPage />
          </Gate>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
