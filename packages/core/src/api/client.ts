// The only way the apps call the backend (CLAUDE.md, Portability 3). Every response is parsed
// with the shared schemas, so a server change that breaks the contract fails loudly here.
import { z } from 'zod';
import {
  AdminCatalogue,
  AdminCategoryInput,
  AdminCreateShopRequest,
  AdminCreateShopResponse,
  AdminImportRequest,
  AdminImportResponse,
  AdminInviteRequest,
  AdminProductInput,
  AdminStaffInput,
  IdResponse,
  AdminEnrollResponse,
  AdminMeResponse,
  AdminShopDetail,
  AdminShopFilters,
  AdminShopListResponse,
  AdminVerifyRequest,
  AdminVerifyResponse,
  SetShopStatusRequest,
  SetShopStatusResponse,
} from './admin.ts';
import {
  AuthErrorResponse,
  ConfigResponse,
  CreateShopRequest,
  CreateShopResponse,
  DeviceRowSchema,
  ErrorResponse,
  HealthResponse,
  MeResponse,
  OneTimeTokenResponse,
  RegisterDeviceRequest,
  PinResetCodeResponse,
  ResetOwnerPinRequest,
  SendCodeRequest,
  SetDeviceModeRequest,
  SessionResponse,
  SignInResponse,
  SignInWithCodeRequest,
  SocialSignInResponse,
  StaffPinRowSchema,
} from './schemas.ts';
import {
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '../sync/schemas.ts';

/** The subset of `fetch` the client uses; apps pass the browser's fetch. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type MaybePromise<T> = T | Promise<T>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** Bearer session token, if signed in. */
  getToken?: () => MaybePromise<string | null>;
  /** This device's id once registered; sent as X-Device-Id (sets app.device_id on the server). */
  getDeviceId?: () => MaybePromise<string | null>;
  /** This build's version; sent as X-App-Version on every request (architecture §4). */
  appVersion?: string;
}

/** status 0 + code 'network' = the request never reached the server (offline, DNS, CORS). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** 426 upgrade_required only: the oldest app version the API accepts. */
  readonly minVersion: string | undefined;

  constructor(status: number, code: string, message?: string, minVersion?: string) {
    super(message ?? `API error ${status} (${code})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.minVersion = minVersion;
  }
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const SuccessResponse = z.object({ success: z.boolean() });

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
    const deviceId = await options.getDeviceId?.();
    if (deviceId) headers['x-device-id'] = deviceId;
    if (options.appVersion) headers['x-app-version'] = options.appVersion;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'network', 'Could not reach the server');
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const ours = ErrorResponse.safeParse(json);
      if (ours.success)
        throw new ApiError(
          response.status,
          ours.data.error,
          ours.data.message,
          ours.data.min_version,
        );
      const auth = AuthErrorResponse.safeParse(json);
      if (auth.success)
        throw new ApiError(response.status, auth.data.code ?? 'auth_error', auth.data.message);
      throw new ApiError(response.status, 'internal');
    }
    return schema.parse(json);
  }

  // Methods are async so invalid input is a rejected promise like every other failure.
  return {
    health: () => request('GET', '/health', HealthResponse),
    config: () => request('GET', '/config', ConfigResponse),

    /** Emails a 6-digit sign-in code (architecture §5: typed code, not a magic link). */
    sendSignInCode: async (email: string) =>
      request('POST', '/auth/email-otp/send-verification-otp', SuccessResponse, {
        ...SendCodeRequest.parse({ email }),
        type: 'sign-in',
      }),
    signInWithCode: async (email: string, otp: string) =>
      request('POST', '/auth/sign-in/email-otp', SignInResponse, {
        ...SignInWithCodeRequest.parse({ email, otp }),
      }),
    /** URL of Google's consent page. Google returns through the API to `callbackURL`. */
    googleSignInUrl: async (callbackURL: string, errorCallbackURL: string) =>
      (
        await request('POST', '/auth/sign-in/social', SocialSignInResponse, {
          provider: 'google',
          callbackURL,
          errorCallbackURL,
          disableRedirect: true,
        })
      ).url,
    /** Trades the single-use token from the Google redirect for the bearer session token. */
    exchangeOneTimeToken: async (token: string) => {
      const result = await request('POST', '/auth/one-time-token/verify', OneTimeTokenResponse, {
        token,
      });
      return { token: result.session.token, user: result.user };
    },
    getSession: () => request('GET', '/auth/get-session', SessionResponse),
    signOut: () => request('POST', '/auth/sign-out', SuccessResponse, {}),

    me: () => request('GET', '/me', MeResponse),
    createShop: async (input: CreateShopRequest) =>
      request('POST', '/shops', CreateShopResponse, CreateShopRequest.parse(input)),
    registerDevice: async (input: RegisterDeviceRequest) =>
      request('POST', '/devices', DeviceRowSchema, RegisterDeviceRequest.parse(input)),
    /** Emails a PIN reset code to the signed-in owner (their own staff row only). */
    sendPinResetCode: async (staffId: string) =>
      request(
        'POST',
        '/staff/' + encodeURIComponent(staffId) + '/pin-code',
        PinResetCodeResponse,
        {},
      ),
    /** Checks the emailed code and saves the new PIN; returns the staff_pins row. */
    resetOwnerPin: async (staffId: string, input: ResetOwnerPinRequest) =>
      request(
        'POST',
        '/staff/' + encodeURIComponent(staffId) + '/pin',
        StaffPinRowSchema,
        ResetOwnerPinRequest.parse(input),
      ),
    /** Owner phone ↔ shop counter (owner only, audit-logged). */
    setDeviceMode: async (deviceId: string, mode: SetDeviceModeRequest['mode']) =>
      request(
        'POST',
        `/devices/${encodeURIComponent(deviceId)}/mode`,
        DeviceRowSchema,
        SetDeviceModeRequest.parse({ mode }),
      ),

    // --- Admin portal (US010, US011): 2FA on every session, 12-hour sessions ---
    adminMe: () => request('GET', '/admin/me', AdminMeResponse),
    adminEnrollTwoFactor: () => request('POST', '/admin/2fa/enroll', AdminEnrollResponse, {}),
    adminVerifyTwoFactor: async (input: AdminVerifyRequest) =>
      request('POST', '/admin/2fa/verify', AdminVerifyResponse, AdminVerifyRequest.parse(input)),
    adminListShops: async (filters: AdminShopFilters) => {
      const f = AdminShopFilters.parse(filters);
      const params = new URLSearchParams({ page: String(f.page) });
      for (const key of ['q', 'status', 'type', 'city'] as const) {
        const value = f[key]?.trim();
        if (value) params.set(key, value);
      }
      return request('GET', `/admin/shops?${params.toString()}`, AdminShopListResponse);
    },
    adminGetShop: async (shopId: string) =>
      request('GET', `/admin/shops/${encodeURIComponent(shopId)}`, AdminShopDetail),
    adminSetShopStatus: async (shopId: string, input: SetShopStatusRequest) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/status`,
        SetShopStatusResponse,
        SetShopStatusRequest.parse(input),
      ),

    adminCreateShop: async (input: AdminCreateShopRequest) =>
      request('POST', '/admin/shops', AdminCreateShopResponse, AdminCreateShopRequest.parse(input)),
    adminCatalogue: async (shopId: string) =>
      request('GET', `/admin/shops/${encodeURIComponent(shopId)}/catalogue`, AdminCatalogue),
    adminCreateInvite: async (shopId: string, email: string) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/invites`,
        IdResponse,
        AdminInviteRequest.parse({ email }),
      ),
    adminRevokeInvite: async (inviteId: string) =>
      request('POST', `/admin/invites/${encodeURIComponent(inviteId)}/revoke`, SuccessResponse, {}),
    adminSaveProduct: async (shopId: string, input: AdminProductInput) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/products`,
        IdResponse,
        AdminProductInput.parse(input),
      ),
    adminHideProduct: async (shopId: string, productId: string, hidden: boolean) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}/hide`,
        SuccessResponse,
        { hidden },
      ),
    adminImportProducts: async (shopId: string, input: AdminImportRequest) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/products/import`,
        AdminImportResponse,
        AdminImportRequest.parse(input),
      ),
    adminSaveCategory: async (shopId: string, input: AdminCategoryInput) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/categories`,
        IdResponse,
        AdminCategoryInput.parse(input),
      ),
    adminSaveStaff: async (shopId: string, input: AdminStaffInput) =>
      request(
        'POST',
        `/admin/shops/${encodeURIComponent(shopId)}/staff`,
        IdResponse,
        AdminStaffInput.parse(input),
      ),
    /** The invited owner's own first PIN (hashed on the device). */
    setFirstPin: async (staffId: string, pinHash: string) =>
      request('POST', `/staff/${encodeURIComponent(staffId)}/first-pin`, SuccessResponse, {
        pin_hash: pinHash,
      }),

    /** Sends up to 200 outbox entries (architecture §4). */
    syncPush: async (input: SyncPushRequest) =>
      request('POST', '/sync/push', SyncPushResponse, SyncPushRequest.parse(input)),
    /** One page of rows newer than `since_seq`. */
    syncPull: async (input: SyncPullQuery) => {
      const query = SyncPullQuery.parse(input);
      const params = new URLSearchParams({
        device_id: query.device_id,
        since_seq: String(query.since_seq),
        limit: String(query.limit),
      });
      return request('GET', `/sync/pull?${params.toString()}`, SyncPullResponse);
    },
  };
}
