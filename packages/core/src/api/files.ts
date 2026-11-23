// /files/* (architecture §9): short-lived pre-signed URLs; the device talks to storage directly.
import { z } from 'zod';
import { LOGO_CONTENT_TYPES } from '../files.ts';

export const UploadUrlRequest = z.object({
  shop_id: z.uuid(),
  kind: z.literal('logo'),
  content_type: z.enum(LOGO_CONTENT_TYPES),
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequest>;

export const UploadUrlResponse = z.object({
  key: z.string(),
  /** PUT the file here with exactly this Content-Type, within `expires_in` seconds. */
  url: z.url(),
  expires_in: z.number().int(),
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponse>;

export const DownloadUrlRequest = z.object({ key: z.string().max(200) });
export const DownloadUrlResponse = z.object({ url: z.url(), expires_in: z.number().int() });

export const LogoCleanupRequest = z.object({ shop_id: z.uuid() });
export const LogoCleanupResponse = z.object({ deleted: z.number().int() });
