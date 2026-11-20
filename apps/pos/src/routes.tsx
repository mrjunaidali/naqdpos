import type { RouteObject } from 'react-router';
import { Gate } from './app/Gate.tsx';
import { HomePage } from './app/HomePage.tsx';
import { NotFoundPage } from './app/NotFoundPage.tsx';
import { RootLayout } from './app/RootLayout.tsx';
import { GoogleCallbackPage } from './features/auth/GoogleCallbackPage.tsx';
import { SignInGate } from './features/auth/SignInGate.tsx';
import { CatalogueLayout } from './features/catalogue/CatalogueLayout.tsx';
import { CategoriesPage } from './features/catalogue/CategoriesPage.tsx';
import { PresetPickerPage } from './features/catalogue/PresetPickerPage.tsx';
import { ProductFormPage } from './features/catalogue/ProductFormPage.tsx';
import { ProductListPage } from './features/catalogue/ProductListPage.tsx';
import { TodaysRatesPage } from './features/catalogue/TodaysRatesPage.tsx';
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
      {
        // Owner screens (manage_products): one owner check per visit (OwnerPinGate).
        path: 'products',
        element: (
          <Gate state="ready">
            <CatalogueLayout />
          </Gate>
        ),
        children: [
          { index: true, element: <ProductListPage /> },
          { path: 'new', element: <ProductFormPage /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'presets', element: <PresetPickerPage /> },
          { path: 'rates', element: <TodaysRatesPage /> },
          { path: ':productId', element: <ProductFormPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
