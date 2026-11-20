// Request and response shapes shared by the API (route validation, OpenAPI docs) and the apps'
// typed client. One definition, so both sides cannot drift apart (CLAUDE.md, Portability 3).
import { z } from 'zod';
import { PK_MOBILE_PATTERN } from '../phone.ts';
import {
  DEVICE_MODES,
  ROLES,
  SHOP_STATUSES,
  SHOP_TYPES,
  type DeviceRow,
  type ShopRow,
  type StaffRow,
  type StaffPinRow,
  type StaffSalaryRow,
} from '../tenancy.ts';

const name = z.string().trim().min(1).max(100);
/** Any phone: digits with an optional leading +. */
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/);
/** Pakistani mobile in the stored form +923XXXXXXXXX (normalise with normalizePkMobile first). */
export const PkMobile = z.string().regex(PK_MOBILE_PATTERN);
/** PIN hash from hashPin(); the API never sees the PIN itself. */
const pinHash = z.string().regex(/^pbkdf2-sha256\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);

export const HealthResponse = z.object({ ok: z.boolean(), db: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponse>;

/** GET /config: what the sign-in screen may offer. */
export const ConfigResponse = z.object({ google: z.boolean() });
export type ConfigResponse = z.infer<typeof ConfigResponse>;

// --- Rows as the API returns them (bigint columns converted to numbers) ---

const iso = z.string();
const nullableText = z.string().nullable();

export const ShopRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(SHOP_TYPES),
  address: nullableText,
  phone: nullableText,
  receipt_footer: nullableText,
  logo_path: nullableText,
  status: z.enum(SHOP_STATUSES),
  plan_id: nullableText,
  timezone: z.string(),
  cashier_expense_limit_paisa: z.number().int(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<ShopRow>;

export const StaffRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  name: z.string(),
  phone: nullableText,
  role: z.enum(ROLES),
  pin_hash: nullableText,
  membership_user_id: z.uuid().nullable(),
  active: z.boolean(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<StaffRow>;

export const DeviceRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  name: z.string(),
  code: z.string(),
  registered_by: z.uuid().nullable(),
  last_sync_at: iso.nullable(),
  last_seq_pulled: z.number().int(),
  // Default: responses from before devices.mode existed parse as the safe 'shop'.
  mode: z.enum(DEVICE_MODES).default('shop'),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<DeviceRow, unknown>;

export const StaffPinRowSchema = z.object({
  staff_id: z.uuid(),
  shop_id: z.uuid(),
  pin_hash: pinHash,
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<StaffPinRow>;

export const StaffSalaryRowSchema = z.object({
  staff_id: z.uuid(),
  shop_id: z.uuid(),
  monthly_salary_paisa: z.number().int().nonnegative(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<StaffSalaryRow>;

// --- Shops and devices ---

/** POST /shops: onboarding. Ids are UUIDv7 made on the device (CLAUDE.md rule 2). */
export const CreateShopRequest = z.object({
  shop_id: z.uuid(),
  name,
  type: z.enum(SHOP_TYPES),
  shop_phone: phone,
  address: z.string().trim().min(1).max(300).optional(),
  owner_staff_id: z.uuid(),
  owner_name: name,
  owner_phone: PkMobile,
  owner_pin_hash: pinHash,
  device_id: z.uuid().optional(),
});
export type CreateShopRequest = z.infer<typeof CreateShopRequest>;

export const CreateShopResponse = z.object({ id: z.uuid() });
export type CreateShopResponse = z.infer<typeof CreateShopResponse>;

/** POST /devices: owner registers this device; the server assigns the code (A1, A2, …). */
export const RegisterDeviceRequest = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  name: z.string().trim().min(1).max(50),
  /** Who uses the device. Older apps send nothing and get 'shop' (§4 compatibility). */
  mode: z.enum(DEVICE_MODES).default('shop'),
});
export type RegisterDeviceRequest = z.input<typeof RegisterDeviceRequest>;

/** GET /me: who is signed in and which shops they belong to. */
export const MeResponse = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string() }),
  shops: z.array(
    z.object({
      role: z.enum(ROLES),
      shop: ShopRowSchema,
      /** The caller's own staff row in that shop (null if none yet). */
      staff: StaffRowSchema.nullable(),
    }),
  ),
});
export type MeResponse = z.infer<typeof MeResponse>;

// --- Better Auth endpoints the apps use (/auth/*) ---

export const SendCodeRequest = z.object({ email: z.email() });
export const SignInWithCodeRequest = z.object({
  email: z.email(),
  otp: z.string().regex(/^[0-9]{6}$/),
});

const AuthUser = z.object({ id: z.uuid(), email: z.string() });

/** Sign-in with an email code returns the bearer token in the body. */
export const SignInResponse = z.object({ token: z.string().min(1), user: AuthUser });
export type SignInResponse = z.infer<typeof SignInResponse>;

/** One-time token exchange (Google sign-in redirect) returns the whole session. */
export const OneTimeTokenResponse = z.object({
  session: z.object({ token: z.string().min(1) }),
  user: AuthUser,
});

/** get-session: null when the token is unknown, expired or revoked. */
export const SessionResponse = z
  .object({ user: AuthUser, session: z.object({ expiresAt: z.string() }) })
  .nullable();
export type SessionResponse = z.infer<typeof SessionResponse>;

export const SocialSignInResponse = z.object({ url: z.url() });

// --- Errors ---

export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'conflict',
  'not_found',
  'upgrade_required',
  'internal',
] as const;
export const ErrorResponse = z.object({
  error: z.enum(API_ERROR_CODES),
  message: z.string().optional(),
  /** With 426 upgrade_required: the oldest app version the API accepts (§4). */
  min_version: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Better Auth's own error body, e.g. { code: 'INVALID_OTP', message: '…' }. */
export const AuthErrorResponse = z.object({ code: z.string().optional(), message: z.string() });
