// Admin portal API (US010, US011; architecture §5). Shared by apps/api routes and apps/admin.
import { z } from 'zod';
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
