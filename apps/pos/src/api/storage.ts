// Direct transfers to object storage with pre-signed URLs from the API (architecture §9). Kept next
// to the API client: the only other place the app makes network calls.

export class StorageError extends Error {
  constructor(readonly status: number) {
    super(`storage request failed (${status})`);
    this.name = 'StorageError';
  }
}

/** PUT a file to a pre-signed URL; the Content-Type must be the one the URL was signed for. */
export async function putFile(url: string, body: Blob, contentType: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', body, headers: { 'content-type': contentType } });
  } catch {
    throw new StorageError(0);
  }
  if (!res.ok) throw new StorageError(res.status);
}

/** GET a file from a pre-signed URL. */
export async function getFile(url: string): Promise<{ bytes: ArrayBuffer; type: string }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new StorageError(0);
  }
  if (!res.ok) throw new StorageError(res.status);
  return { bytes: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'image/webp' };
}
