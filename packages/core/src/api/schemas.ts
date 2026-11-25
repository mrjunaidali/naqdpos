// Request and response shapes shared by the API (route validation, OpenAPI docs) and the apps'
// typed client. One definition, so both sides cannot drift apart (CLAUDE.md, Portability 3).
import { z } from 'zod';
import {
  isProductIcon,
  MAX_SEARCH_TERM_LENGTH,
  MAX_SEARCH_TERMS,
  type CategoryRow,
  type PriceHistoryRow,
  type ProductCostHistoryRow,
  type ProductCostRow,
  type ProductRow,
} from '../catalogue.ts';
import { MAX_FOC_QTY_MILLI, type FocRule } from '../discount.ts';
import {
  KHATA_TYPES,
  MAX_KHATA_NOTE_LENGTH,
  type CustomerRow,
  type KhataEntryRow,
} from '../khata.ts';
import {
  MAX_CATEGORY_NAME,
  MAX_EXPENSE_NOTE,
  MAX_EXPENSE_PAYEE,
  type ExpenseCategoryRow,
  type ExpenseRow,
} from '../expenses.ts';
import type { DayCloseRow } from '../closing.ts';
import { PK_MOBILE_PATTERN } from '../phone.ts';
import { RECEIPT_LANGUAGES } from '../tenancy.ts';
import { MAX_STOCK_NOTE_LENGTH, STOCK_REASONS, type StockMovementRow } from '../stock.ts';
import {
  PAYMENT_KINDS,
  type PaymentMethodRow,
  type PaymentRow,
  type SaleLineRow,
  type SaleRow,
} from '../sale.ts';
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
export const ConfigResponse = z.object({
  google: z.boolean(),
  /** Object storage is configured: the shop logo can be set (US014). */
  files: z.boolean().default(false),
});
export type ConfigResponse = z.infer<typeof ConfigResponse>;

// --- Rows as the API returns them (bigint columns converted to numbers) ---

const iso = z.string();

/** products.foc_rule (US033): exactly these two keys; the SQL check foc_rule_ok() agrees. */
export const FocRuleSchema = z.strictObject({
  min_bill_paisa: z.number().int().min(0),
  qty_milli: z.number().int().min(1).max(MAX_FOC_QTY_MILLI),
}) satisfies z.ZodType<FocRule>;
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
  cashier_max_discount_pct: z.number().int().min(0).max(100),
  receipt_language: z.enum(RECEIPT_LANGUAGES),
  paper_width_mm: z.union([z.literal(58), z.literal(80)]),
  suspended_at: iso.nullable().optional(),
  city: z.string().max(60).nullable().optional(),
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

/** POST /staff/{id}/pin-code answers this once the PIN reset code is on its way. */
export const PinResetCodeResponse = z.object({ sent: z.literal(true) });

/** POST /staff/{id}/pin: the emailed 6-digit code and the new PIN's hash (never the PIN). */
export const ResetOwnerPinRequest = z.object({
  code: z.string().regex(/^[0-9]{6}$/),
  pin_hash: pinHash,
});
export type ResetOwnerPinRequest = z.infer<typeof ResetOwnerPinRequest>;

/** POST /staff/{id}/first-pin: the invited owner's own first PIN (hashed on the device). */
export const FirstPinRequest = z.object({ pin_hash: pinHash });

/** POST /devices/{id}/mode: owner switches a device between owner phone and shop counter. */
export const SetDeviceModeRequest = z.object({ mode: z.enum(['owner', 'shop']) });
export type SetDeviceModeRequest = z.infer<typeof SetDeviceModeRequest>;

/** GET /me: who is signed in and which shops they belong to. */
export const MeResponse = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string() }),
  shops: z.array(
    z.object({
      role: z.enum(ROLES),
      shop: ShopRowSchema,
      /** The caller's own staff row in that shop (null if none yet). */
      staff: StaffRowSchema.nullable(),
      /** Whether that staff row has a PIN (an invited owner sets their first PIN). */
      has_pin: z.boolean().optional(),
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
  // Owner PIN reset (POST /staff/{id}/pin-code, /pin)
  'invalid_code',
  'code_expired',
  'too_many_attempts',
  'code_cooldown',
  'code_daily_cap',
  // Admin: a new owner invite after the owner has joined (US012)
  'owner_joined',
  // Files (architecture §9): storage not configured (local dev), or too many requests
  'files_disabled',
  'rate_limited',
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

/** Auth error code when the code email could not be sent (provider down or timed out). */
export const EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED';

// --- Catalogue rows (architecture §3, migration 20261121090000_catalogue) ---

const paisa = z.number().int().nonnegative();

export const CategoryRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  name: z.string().min(1).max(60),
  name_ur: z.string().max(60).nullable(),
  sort: z.number().int(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<CategoryRow>;

/**
 * A unit in a synced row: any short code, so a device on an older app still stores products and
 * sale lines with a unit added later (architecture §4) and shows the code as it is. Writes are
 * checked against PRODUCT_UNITS (forms, CSV, admin) and by the database's own check.
 */
const unitCode = z.string().min(1).max(16);

export const ProductRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  category_id: z.uuid().nullable(),
  name: z.string().min(1).max(100),
  name_ur: z.string().max(100).nullable(),
  unit: unitCode,
  sale_price_paisa: paisa,
  barcode: z.string().max(64).nullable(),
  track_stock: z.boolean(),
  min_qty_milli: z.number().int().nonnegative().nullable(),
  is_combo: z.boolean(),
  packaging_cost_paisa: paisa,
  foc_rule: FocRuleSchema.nullable(),
  search_terms: z.array(z.string().min(1).max(MAX_SEARCH_TERM_LENGTH)).max(MAX_SEARCH_TERMS),
  // Optional: rows and payloads from before US078 have no icon.
  icon: z.string().refine(isProductIcon, 'not an emoji icon').nullable().optional(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<ProductRow>;

export const ProductCostRowSchema = z.object({
  product_id: z.uuid(),
  shop_id: z.uuid(),
  cost_price_paisa: paisa,
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<ProductCostRow>;

export const PriceHistoryRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  product_id: z.uuid(),
  sale_price_paisa: paisa,
  effective_at: iso,
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<PriceHistoryRow>;

export const ProductCostHistoryRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  product_id: z.uuid(),
  cost_price_paisa: paisa,
  effective_at: iso,
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<ProductCostHistoryRow>;

// --- Sales ledgers and payment methods (migration 20261121210000_sales) ---

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PaymentMethodRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  code: z.string().regex(/^[a-z0-9_]{1,32}$/),
  label: z.string().min(1).max(40),
  active: z.boolean(),
  sort: z.number().int(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<PaymentMethodRow>;

/** customers (US038): the id is UUIDv5(shop_id, mobile); the mobile is E.164 and fixed. */
export const CustomerRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  mobile: z.string().regex(PK_MOBILE_PATTERN),
  name: z.string().trim().min(1).max(60).nullable(),
  address: z.string().max(200).nullable(),
  credit_limit_paisa: z.number().int().min(0).nullable(),
  whatsapp_opt_in: z.boolean(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<CustomerRow>;

export const KhataEntryRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  customer_id: z.uuid(),
  business_date: dateOnly,
  type: z.enum(KHATA_TYPES),
  amount_paisa: z
    .number()
    .int()
    .refine((n) => n !== 0, 'amount_paisa must not be 0'),
  sale_id: z.uuid().nullable(),
  payment_id: z.uuid().nullable(),
  note: z.string().max(MAX_KHATA_NOTE_LENGTH).nullable(),
  staff_id: z.uuid(),
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<KhataEntryRow>;

export const ExpenseCategoryRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  name: z.string().trim().min(1).max(MAX_CATEGORY_NAME),
  name_ur: z.string().trim().min(1).max(MAX_CATEGORY_NAME).nullable(),
  i18n_key: z
    .string()
    .regex(/^expense\.cat\.[a-z_]{1,32}$/)
    .nullable(),
  icon: z.string().max(16).nullable(),
  sort: z.number().int(),
  archived_at: iso.nullable(),
  device_id: z.uuid().nullable(),
  created_at: iso,
  updated_at: iso,
  deleted_at: iso.nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<ExpenseCategoryRow>;

export const ExpenseRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  business_date: dateOnly,
  category_id: z.uuid(),
  amount_paisa: z
    .number()
    .int()
    .refine((n) => n !== 0, 'amount_paisa must not be 0'),
  paid_method_code: z.string().regex(/^[a-z0-9_]{1,32}$/),
  note: z.string().max(MAX_EXPENSE_NOTE).nullable(),
  payee: z.string().max(MAX_EXPENSE_PAYEE).nullable(),
  payee_staff_id: z.uuid().nullable(),
  staff_id: z.uuid(),
  approved_by_staff_id: z.uuid().nullable(),
  reverses_expense_id: z.uuid().nullable(),
  reversal_reason: z.string().max(MAX_EXPENSE_NOTE).nullable(),
  recurring_expense_id: z.uuid().nullable(),
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<ExpenseRow>;

export const DayCloseRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  business_date: dateOnly,
  opening_cash_paisa: z.number().int().min(0),
  expected_cash_paisa: z.number().int(),
  counted_cash_paisa: z.number().int().min(0),
  difference_paisa: z.number().int(),
  owner_withdrawal_paisa: z.number().int().min(0),
  note: z.string().max(500).nullable(),
  closed_by_staff_id: z.uuid(),
  closed_at: iso,
  seen_through_seq: z.number().int().min(0),
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<DayCloseRow>;

export const SaleRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  receipt_no: z.string().regex(/^[A-Z][0-9]{1,3}-[0-9]{6,}$/),
  business_date: dateOnly,
  staff_id: z.uuid(),
  customer_id: z.uuid().nullable(),
  order_type: z.enum(['walk_in', 'delivery']),
  source: z.string().regex(/^[a-z_]{1,32}$/),
  subtotal_paisa: paisa,
  discount_paisa: paisa,
  rounding_paisa: z.number().int().min(-50).max(50),
  total_paisa: paisa,
  note: z.string().max(500).nullable(),
  discount_approved_by_staff_id: z.uuid().nullable(),
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<SaleRow>;

export const SaleLineRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  sale_id: z.uuid(),
  product_id: z.uuid().nullable(),
  name_snapshot: z.string().min(1).max(100),
  name_ur_snapshot: z.string().max(100).nullable(),
  unit_snapshot: unitCode,
  qty_milli: z.number().int().positive(),
  unit_price_paisa: paisa,
  discount_paisa: paisa,
  is_foc: z.boolean(),
  by_amount: z.boolean(),
  line_total_paisa: paisa,
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<SaleLineRow>;

export const PaymentRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  business_date: dateOnly,
  kind: z.enum(PAYMENT_KINDS),
  sale_id: z.uuid().nullable(),
  customer_id: z.uuid().nullable(),
  method_code: z.string().regex(/^[a-z0-9_]{1,32}$/),
  amount_paisa: z.number().int().positive(),
  reference: z.string().max(64).nullable(),
  staff_id: z.uuid(),
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<PaymentRow>;

export const StockMovementRowSchema = z.object({
  id: z.uuid(),
  shop_id: z.uuid(),
  product_id: z.uuid(),
  business_date: dateOnly,
  qty_milli: z
    .number()
    .int()
    .refine((n) => n !== 0, 'qty_milli must not be 0'),
  reason: z.enum(STOCK_REASONS),
  ref_id: z.uuid().nullable(),
  note: z.string().max(MAX_STOCK_NOTE_LENGTH).nullable(),
  staff_id: z.uuid(),
  created_at: iso,
  device_id: z.uuid().nullable(),
  server_seq: z.number().int().nullable(),
}) satisfies z.ZodType<StockMovementRow>;
