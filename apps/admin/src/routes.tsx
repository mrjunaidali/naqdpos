import type { RouteObject } from 'react-router';
import { AdminLayout } from './app/AdminLayout.tsx';
import { GoogleCallbackPage } from './app/GoogleCallbackPage.tsx';
import { ShopDetailPage } from './app/ShopDetailPage.tsx';
import { ShopsPage } from './app/ShopsPage.tsx';

// Admin portal is English-only for the platform owner; online only (architecture §5).
export const routes: RouteObject[] = [
  { path: '/auth/callback', element: <GoogleCallbackPage /> },
  {
    path: '/',
    element: <AdminLayout />,
    children: [
      { index: true, element: <ShopsPage /> },
      { path: 'shops/:id', element: <ShopDetailPage /> },
    ],
  },
  { path: '*', element: <p className="p-6">Page not found</p> },
];
