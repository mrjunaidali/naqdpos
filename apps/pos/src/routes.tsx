import type { RouteObject } from 'react-router';
import { RootLayout } from './app/RootLayout.tsx';
import { HomePage } from './app/HomePage.tsx';
import { NotFoundPage } from './app/NotFoundPage.tsx';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
