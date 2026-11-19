// The only way the apps call the backend (CLAUDE.md, Portability 3). Every response is parsed
// with the shared schemas, so a server change that breaks the contract fails loudly here.
import type { z } from 'zod';
import { CreateShopRequest, CreateShopResponse, ErrorResponse, HealthResponse } from './schemas.ts';

/** The subset of `fetch` the client uses; apps pass the browser's fetch. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** Bearer session token, if signed in. */
  getToken?: () => string | null | Promise<string | null>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? `API error ${status} (${code})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await options.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await options.fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = ErrorResponse.safeParse(json);
      throw error.success
        ? new ApiError(response.status, error.data.error, error.data.message)
        : new ApiError(response.status, 'internal');
    }
    return schema.parse(json);
  }

  return {
    health: () => request('GET', '/health', HealthResponse),
    // async, so invalid input is a rejected promise like every other failure.
    createShop: async (input: CreateShopRequest) =>
      request('POST', '/shops', CreateShopResponse, CreateShopRequest.parse(input)),
  };
}
