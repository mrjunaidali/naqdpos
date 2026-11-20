import { describe, expect, it } from 'vitest';
import { apiBaseUrl } from './baseUrl.ts';

const PHONE = 'https://192.168.1.20:5173';

describe('apiBaseUrl', () => {
  it('dev server: empty or "/api" goes through the same-origin dev proxy', () => {
    expect(apiBaseUrl('', true, PHONE)).toBe('https://192.168.1.20:5173/api');
    expect(apiBaseUrl(undefined, true, PHONE)).toBe('https://192.168.1.20:5173/api');
    expect(apiBaseUrl('/api', true, PHONE)).toBe('https://192.168.1.20:5173/api');
    expect(apiBaseUrl(' /api ', true, 'https://localhost:5173')).toBe('https://localhost:5173/api');
  });

  it('dev server with a full VITE_API_URL keeps it (desktop dev as before)', () => {
    expect(apiBaseUrl('http://localhost:8787', true, PHONE)).toBe('http://localhost:8787');
  });

  it('production builds use VITE_API_URL exactly, never the proxy', () => {
    expect(apiBaseUrl('https://api.naqdpos.pk', false, PHONE)).toBe('https://api.naqdpos.pk');
    expect(apiBaseUrl('/api', false, PHONE)).toBe('/api');
    expect(apiBaseUrl('', false, PHONE)).toBe('');
  });
});
