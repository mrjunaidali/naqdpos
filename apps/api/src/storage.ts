// Object storage through the S3 API (architecture §9; Cloudflare R2 now). Rows keep keys, never
// URLs; the API hands out short-lived pre-signed URLs and the device talks to storage directly.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StoredObject {
  key: string;
  lastModified: Date;
}

/** What the API and worker need from storage; tests use `memoryStore()`. */
export interface ObjectStore {
  /** PUT URL limited to this content type. */
  presignPut(key: string, contentType: string, seconds: number): Promise<string>;
  presignGet(key: string, seconds: number): Promise<string>;
  list(prefix: string): Promise<StoredObject[]>;
  delete(keys: string[]): Promise<void>;
  /** Uploads a local file (size known up front, so no multipart). */
  putFile(key: string, path: string): Promise<void>;
  get(key: string): Promise<Readable>;
}

export function s3Store(settings: S3Settings): ObjectStore {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // R2 and MinIO use path-style URLs (https://<endpoint>/<bucket>/<key>).
    forcePathStyle: true,
  });
  const Bucket = settings.bucket;
  return {
    presignPut: (key, contentType, seconds) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
        expiresIn: seconds,
        // The signature covers the content type: the upload must send exactly this one.
        signableHeaders: new Set(['content-type']),
      }),
    presignGet: (key, seconds) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: seconds }),
    async list(prefix) {
      const out: StoredObject[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? [])
          if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0) });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        if (batch.length === 0) continue;
        await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },
    async putFile(key, path) {
      const { size } = await stat(path);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: size,
          ContentType: 'application/octet-stream',
        }),
      );
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!result.Body) throw new Error(`empty object: ${key}`);
      return result.Body as Readable;
    },
  };
}
