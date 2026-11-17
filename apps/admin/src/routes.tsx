import type { RouteObject } from 'react-router';
import { HomePage } from './app/HomePage.tsx';

// Admin portal is English-only for the platform owner; no i18n until there's a need.
export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '*', element: <p className="p-6">Page not found</p> },
];
