/**
 * Tiny web-safe localStorage cache with timestamps.
 *
 * Used for stale-while-revalidate: consumers render cached data instantly,
 * then refresh from the network in the background. Every API request to the
 * backend pays a ~300ms network floor, so serving last-known-good data first
 * makes navigation feel instant without changing the backend.
 *
 * Two namespaces:
 *  - USER ("guru:ucache:")  — user-scoped data (profile, metrics, feeds).
 *    Cleared on logout so a different account never sees stale data.
 *  - CONFIG ("guru:cfg:")   — global config (/config/industries etc.).
 *    Survives logout; config changes rarely.
 *
 * On native (no window.localStorage) all functions are safe no-ops — the
 * module-level in-memory caches in the services still apply there.
 */

const USER_PREFIX = 'guru:ucache:';
const CONFIG_PREFIX = 'guru:cfg:';

export interface CachedEntry<T> {
  data: T;
  timestamp: number;
}

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Storage access can throw (e.g. privacy mode)
  }
  return null;
}

export function userCacheKey(name: string): string {
  return USER_PREFIX + name;
}

export function configCacheKey(name: string): string {
  return CONFIG_PREFIX + name;
}

export function readCache<T>(key: string): CachedEntry<T> | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.timestamp !== 'number' || !('data' in parsed)) {
      return null;
    }
    return parsed as CachedEntry<T>;
  } catch {
    return null;
  }
}

export function writeCache(key: string, data: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // Quota exceeded or serialization failure — caching is best-effort
  }
}

export function removeCache(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // best-effort
  }
}

/** Remove every user-scoped cache entry (called on logout). */
export function clearUserCaches(): void {
  const store = storage();
  if (!store) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(USER_PREFIX)) toRemove.push(key);
    }
    toRemove.forEach((key) => store.removeItem(key));
  } catch {
    // best-effort
  }
}
