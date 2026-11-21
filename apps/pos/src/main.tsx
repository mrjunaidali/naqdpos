import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { UpdatePrompt } from './app/UpdatePrompt.tsx';
import './i18n/index.ts';
// Urdu font (architecture §6): precached with the app shell; used on screen, in print and on
// the Bluetooth receipt image. Its unicode-range covers Arabic script only.
import '@fontsource/noto-naskh-arabic/arabic-400.css';
import '@fontsource/noto-naskh-arabic/arabic-700.css';
import './index.css';
import { routes } from './routes.tsx';
import { useCartStore } from './features/sale/cartStore.ts';
import { reconcileReceiptCounter } from './features/sale/completeSale.ts';
import { syncEngine } from './sync/index.ts';

const router = createBrowserRouter(routes);

// Background sync (architecture §4). Runs beside the UI and never blocks it; it does nothing
// until this device is registered.
void syncEngine.start();
// Load the cart kept on the device (a reload or crash keeps it).
void useCartStore.getState().hydrate();
// Receipt numbers never repeat: bring the counter up to the sales already on the device.
void reconcileReceiptCounter();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
    <UpdatePrompt />
  </StrictMode>,
);
