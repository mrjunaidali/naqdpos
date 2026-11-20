// App versions (architecture §4): the app sends its version in X-App-Version; the API compares it
// with MIN_APP_VERSION. Plain `major.minor.patch` numbers, no pre-release tags.

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function isAppVersion(value: string): boolean {
  return VERSION.test(value);
}

/** Negative if a < b, 0 if equal, positive if a > b. Throws on a malformed version. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = VERSION.exec(v);
    if (!m) throw new Error(`Not a version: ${v}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const diff = x[i]! - y[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when `version` is missing, malformed or older than `min`. */
export function isOlderThan(version: string | null | undefined, min: string): boolean {
  if (!version || !isAppVersion(version)) return true;
  return compareVersions(version, min) < 0;
}
