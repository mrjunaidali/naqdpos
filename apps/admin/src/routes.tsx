import type { RouteObject } from 'react-router';
import { ActLayout } from './act/ActLayout.tsx';
import { CategoriesPage } from './act/CategoriesPage.tsx';
import { ImportPage } from './act/ImportPage.tsx';
import { ProducePage } from './act/ProducePage.tsx';
import { ProductsPage } from './act/ProductsPage.tsx';
import { StaffPage } from './act/StaffPage.tsx';
import { AdminLayout } from './app/AdminLayout.tsx';
import { GoogleCallbackPage } from './app/GoogleCallbackPage.tsx';
import { NewShopPage } from './app/NewShopPage.tsx';
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
      { path: 'shops/new', element: <NewShopPage /> },
      { path: 'shops/:id', element: <ShopDetailPage /> },
      {
        // US013: every screen in here shows the "Acting as <shop>" banner.
        path: 'shops/:id/act',
        element: <ActLayout />,
        children: [
          { index: true, element: <ProductsPage /> },
          { path: 'produce', element: <ProducePage /> },
          { path: 'import', element: <ImportPage /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'staff', element: <StaffPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <p className="p-6">Page not found</p> },
];
