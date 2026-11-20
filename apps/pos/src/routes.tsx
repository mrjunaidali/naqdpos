import type { RouteObject } from 'react-router';
import { Gate } from './app/Gate.tsx';
import { HomePage } from './app/HomePage.tsx';
import { NotFoundPage } from './app/NotFoundPage.tsx';
import { RootLayout } from './app/RootLayout.tsx';
import { GoogleCallbackPage } from './features/auth/GoogleCallbackPage.tsx';
import { SignInGate } from './features/auth/SignInGate.tsx';
import { SignInPage } from './features/auth/SignInPage.tsx';
import { SetupPage } from './features/onboarding/SetupPage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { StaffFormPage } from './features/staff/StaffFormPage.tsx';
import { StaffLayout } from './features/staff/StaffLayout.tsx';
import { StaffListPage } from './features/staff/StaffListPage.tsx';
import { SyncPage } from './features/sync/SyncPage.tsx';

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
          <SignInGate>
            <SignInPage />
          </SignInGate>
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
      {
        path: 'sync',
        element: (
          <Gate state="ready">
            <SyncPage />
          </Gate>
        ),
      },
      {
        path: 'settings',
        element: (
          <Gate state="ready">
            <SettingsPage />
          </Gate>
        ),
      },
      {
        // Owner screens: one owner check per visit (OwnerPinGate in StaffLayout).
        path: 'staff',
        element: (
          <Gate state="ready">
            <StaffLayout />
          </Gate>
        ),
        children: [
          { index: true, element: <StaffListPage /> },
          { path: 'new', element: <StaffFormPage /> },
          { path: ':staffId', element: <StaffFormPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
