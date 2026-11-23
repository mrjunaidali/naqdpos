// In-memory ObjectStore for tests (no S3 needed).
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ObjectStore, StoredObject } from '../storage.ts';

export interface MemoryStore extends ObjectStore {
  objects: Map<string, { body: Buffer; lastModified: Date }>;
}

export function memoryStore(now: () => Date = () => new Date()): MemoryStore {
  const objects = new Map<string, { body: Buffer; lastModified: Date }>();
  return {
    objects,
    presignPut: (key, contentType, seconds) =>
      Promise.resolve(
        `https://files.test/${key}?put&type=${encodeURIComponent(contentType)}&ttl=${seconds}`,
      ),
    presignGet: (key, seconds) => Promise.resolve(`https://files.test/${key}?get&ttl=${seconds}`),
    list: (prefix) =>
      Promise.resolve(
        [...objects]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, o]): StoredObject => ({ key, lastModified: o.lastModified })),
      ),
    delete(keys) {
      for (const key of keys) objects.delete(key);
      return Promise.resolve();
    },
    async putFile(key, path) {
      objects.set(key, { body: await readFile(path), lastModified: now() });
    },
    get(key) {
      const o = objects.get(key);
      if (!o) return Promise.reject(new Error(`no such key: ${key}`));
      return Promise.resolve(Readable.from([o.body]));
    },
  };
}
