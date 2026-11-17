import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { i18n } from './i18n/index.ts';
import { routes } from './routes.tsx';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('routes', () => {
  afterEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });

  it('renders the home page at /', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('renders the not-found page for unknown paths', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('switches the UI to Urdu (rtl) from the header button', async () => {
    renderAt('/');
    const button = await screen.findByRole('button', { name: 'Change language' });
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { name: 'خوش آمدید' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
