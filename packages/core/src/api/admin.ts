// Admin portal API (US010, US011; architecture §5). Shared by apps/api routes and apps/admin.
import { z } from 'zod';
import { PRODUCT_UNITS } from '../catalogue.ts';
import { PK_MOBILE_PATTERN } from '../phone.ts';
import { SHOP_TYPES } from '../tenancy.ts';

export const AdminSessionState = z.enum([
  'ok',
  'no_session',
  'admin_required',
  'session_expired',
  'two_factor_setup',
  'two_factor_required',
]);
export type AdminSessionState = z.infer<typeof AdminSessionState>;

export const AdminMeResponse = z.object({
  email: z.string(),
  state: AdminSessionState,
});
export type AdminMeResponse = z.infer<typeof AdminMeResponse>;

export const AdminEnrollResponse = z.object({
  /** otpauth:// link for the authenticator app (QR code). */
  totp_uri: z.string(),
  /** The same secret for typing in by hand. */
  secret: z.string(),
  backup_codes: z.array(z.string()),
});
export type AdminEnrollResponse = z.infer<typeof AdminEnrollResponse>;

export const AdminVerifyRequest = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/) }),
  z.object({ backup_code: z.string().min(4).max(64) }),
]);
export type AdminVerifyRequest = z.infer<typeof AdminVerifyRequest>;

/** After the first code, Better Auth replaces the session: the portal keeps `token`. */
export const AdminVerifyResponse = z.object({ success: z.boolean(), token: z.string().optional() });
export type AdminVerifyResponse = z.infer<typeof AdminVerifyResponse>;

export const AdminShopFilters = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  type: z.enum(SHOP_TYPES).optional(),
  city: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AdminShopFilters = z.input<typeof AdminShopFilters>;

export const AdminShopListRow = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  city: z.string().nullable(),
  status: z.string(),
  phone: z.string().nullable(),
  owner_email: z.string().nullable(),
  created_at: z.string(),
  devices: z.number().int(),
  last_sync_at: z.string().nullable(),
  last_sale_date: z.string().nullable(),
  sales_7d: z.number().int(),
});
export type AdminShopListRow = z.infer<typeof AdminShopListRow>;

export const AdminShopListResponse = z.object({
  rows: z.array(AdminShopListRow),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
});
export type AdminShopListResponse = z.infer<typeof AdminShopListResponse>;

export const AdminShopDetail = z.object({
  shop: z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.string(),
    city: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    status: z.string(),
    suspended_at: z.string().nullable(),
    timezone: z.string(),
    created_at: z.string(),
    owner_email: z.string().nullable(),
  }),
  devices: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      mode: z.string(),
      last_sync_at: z.string().nullable(),
      retired: z.boolean(),
    }),
  ),
  staff: z.array(
    z.object({ id: z.uuid(), name: z.string(), role: z.string(), active: z.boolean() }),
  ),
  conflicts: z.array(
    z.object({
      id: z.string(),
      table_name: z.string(),
      row_id: z.string(),
      incoming_updated_at: z.string().nullable(),
      server_updated_at: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  audit: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      entity: z.string(),
      entity_id: z.string().nullable(),
      acting_as_admin: z.boolean(),
      payload: z.unknown(),
      at: z.string(),
      actor_email: z.string().nullable(),
    }),
  ),
});
export type AdminShopDetail = z.infer<typeof AdminShopDetail>;

export const SetShopStatusRequest = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(1).max(500),
});
export type SetShopStatusRequest = z.infer<typeof SetShopStatusRequest>;

export const SetShopStatusResponse = z.object({ id: z.uuid(), status: z.string() });

// --- US012: shops and invites ---

export const AdminCreateShopRequest = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(SHOP_TYPES),
  city: z.string().trim().max(60).optional(),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(20).optional(),
  owner_name: z.string().trim().min(1).max(60),
  /** E.164 Pakistani mobile (normalised in the form with phone.ts). */
  owner_mobile: z.string().regex(PK_MOBILE_PATTERN),
  owner_email: z.email().transform((e) => e.trim().toLowerCase()),
});
export type AdminCreateShopRequest = z.input<typeof AdminCreateShopRequest>;

export const AdminCreateShopResponse = z.object({
  shop_id: z.uuid(),
  owner_staff_id: z.uuid(),
  invite_id: z.uuid(),
});

export const AdminInviteRequest = z.object({ email: z.email() });

export const AdminInvite = z.object({
  id: z.uuid(),
  email: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
});
export type AdminInvite = z.infer<typeof AdminInvite>;

// --- US013: acting as a shop ---

export const AdminCatalogueProduct = z.object({
  id: z.uuid(),
  name: z.string(),
  name_ur: z.string().nullable(),
  unit: z.enum(PRODUCT_UNITS),
  category_id: z.uuid().nullable(),
  sale_price_paisa: z.number().int(),
  cost_price_paisa: z.number().int().nullable(),
  icon: z.string().nullable(),
  search_terms: z.array(z.string()),
  hidden: z.boolean(),
});
export type AdminCatalogueProduct = z.infer<typeof AdminCatalogueProduct>;

export const AdminCatalogue = z.object({
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      name_ur: z.string().nullable(),
      sort: z.number().int(),
    }),
  ),
  products: z.array(AdminCatalogueProduct),
  invites: z.array(AdminInvite),
  staff: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      phone: z.string().nullable(),
      role: z.enum(['owner', 'cashier', 'rider']),
      active: z.boolean(),
      has_pin: z.boolean(),
    }),
  ),
});
export type AdminCatalogue = z.infer<typeof AdminCatalogue>;

export const AdminProductInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  name_ur: z.string().trim().max(100).nullable().optional(),
  unit: z.enum(PRODUCT_UNITS),
  category_id: z.uuid().nullable().optional(),
  sale_price_paisa: z.number().int().min(0),
  cost_price_paisa: z.number().int().min(0).optional(),
  icon: z.string().max(16).nullable().optional(),
  search_terms: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type AdminProductInput = z.input<typeof AdminProductInput>;

export const AdminCategoryInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(60),
  name_ur: z.string().trim().max(60).nullable().optional(),
  sort: z.number().int().optional(),
});
export type AdminCategoryInput = z.input<typeof AdminCategoryInput>;

export const AdminStaffInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(20).nullable().optional(),
  /** Owners are added only through invites. */
  role: z.enum(['cashier', 'rider']),
  active: z.boolean().default(true),
  /** Hashed in the admin's browser; cashiers only; "set by admin" in the audit log. */
  pin_hash: z
    .string()
    .regex(/^pbkdf2-sha256\$/)
    .optional(),
});
export type AdminStaffInput = z.input<typeof AdminStaffInput>;

export const AdminImportRequest = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        name_ur: z.string().max(100).nullable(),
        unit: z.enum(PRODUCT_UNITS),
        category: z.string().max(60).nullable(),
        category_ur: z.string().max(60).nullable().optional(),
        sale_price_paisa: z.number().int().min(0),
        cost_price_paisa: z.number().int().min(0).optional(),
        search_terms: z.array(z.string().max(40)).max(20),
        icon: z.string().max(16).nullable().optional(),
      }),
    )
    .min(1)
    .max(2000),
  on_existing: z.enum(['skip', 'update']),
});
export type AdminImportRequest = z.input<typeof AdminImportRequest>;

export const AdminImportResponse = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});
export type AdminImportResponse = z.infer<typeof AdminImportResponse>;

export const IdResponse = z.object({ id: z.uuid() });
