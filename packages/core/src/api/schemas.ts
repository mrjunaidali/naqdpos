// Request and response shapes shared by the API (route validation, OpenAPI docs) and the apps'
// typed client. One definition, so both sides cannot drift apart (CLAUDE.md, Portability 3).
import { z } from 'zod';
import { SHOP_TYPES } from '../tenancy.ts';

const name = z.string().trim().min(1).max(100);
/** Digits with an optional leading +; stored as typed (normalisation is a later story). */
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/);

export const HealthResponse = z.object({ ok: z.boolean(), db: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponse>;

/** POST /shops: onboarding. Ids are UUIDv7 made on the device (CLAUDE.md rule 2). */
export const CreateShopRequest = z.object({
  shop_id: z.uuid(),
  name,
  type: z.enum(SHOP_TYPES),
  shop_phone: phone,
  address: z.string().trim().min(1).max(300).optional(),
  owner_staff_id: z.uuid(),
  owner_name: name,
  owner_phone: phone,
  device_id: z.uuid().optional(),
});
export type CreateShopRequest = z.infer<typeof CreateShopRequest>;

export const CreateShopResponse = z.object({ id: z.uuid() });
export type CreateShopResponse = z.infer<typeof CreateShopResponse>;

export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'conflict',
  'not_found',
  'internal',
] as const;
export const ErrorResponse = z.object({
  error: z.enum(API_ERROR_CODES),
  message: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
