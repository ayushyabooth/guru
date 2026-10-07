/**
 * useAdminAccess: may this account see admin UI (the Perf panel) and beta UI?
 *
 * Asks the server once per session (GET /me/access) and caches the answer in
 * memory. Fails closed: any error, 401, 403 or 404 (the backend may not have
 * the endpoint yet) means isAdmin=false, and isAdmin is true only when the
 * server literally answered `is_admin: true`.
 *
 * This is a UI hint only. Every admin endpoint checks admin again on the server.
 */
import { useEffect, useState } from 'react';
import { getAuthToken } from '../utils/auth';
import { getMeAccess, isAdminApiError } from '../services/admin-service';

export interface AdminAccess {
  isAdmin: boolean;
  isBeta: boolean;
}

export interface AdminAccessState extends AdminAccess {
  /** True until the first answer for this account arrives. Render no admin UI while loading. */
  loading: boolean;
}

const NO_ACCESS: AdminAccess = { isAdmin: false, isBeta: false };

// Session cache, keyed by account so a different sign-in on the same device
// (logout does not reload the JS runtime on native) never inherits the answer.
let cached: { key: string; access: AdminAccess } | null = null;
let inflight: { key: string; promise: Promise<AdminAccess> } | null = null;

/**
 * Cache key for the signed-in account: the JWT subject (stable across token
 * refreshes), falling back to the token itself. Decoded without verification;
 * it only scopes the cache and is never trusted for access.
 */
function accountKey(token: string): string {
  try {
    const part = token.split('.')[1];
    if (part) {
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(atob(padded));
      const sub = payload?.sub;
      if (typeof sub === 'string' || typeof sub === 'number') return `sub:${sub}`;
    }
  } catch {
    // not a JWT we can read: fall through
  }
  return `token:${token}`;
}

async function resolveAccess(): Promise<AdminAccess> {
  let token: string | null = null;
  try {
    token = await getAuthToken();
  } catch {
    return NO_ACCESS;
  }
  if (!token) return NO_ACCESS;

  const key = accountKey(token);
  if (cached && cached.key === key) return cached.access;
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = getMeAccess()
    .then((body): AdminAccess => {
      const access = { isAdmin: body?.is_admin === true, isBeta: body?.is_beta === true };
      cached = { key, access };
      return access;
    })
    .catch((e: unknown): AdminAccess => {
      // 403 / 404 are definitive for this session. A 401, a network error or a
      // 5xx is not cached, so the next mount asks again.
      if (isAdminApiError(e) && (e.kind === 'forbidden' || e.kind === 'not_deployed')) {
        cached = { key, access: NO_ACCESS };
      }
      return NO_ACCESS;
    });

  inflight = { key, promise };
  promise.finally(() => {
    if (inflight && inflight.promise === promise) inflight = null;
  });
  return promise;
}

/** Drop the cached answer (e.g. after sign-out). The next mount asks the server again. */
export function clearAdminAccessCache(): void {
  cached = null;
  inflight = null;
}

export function useAdminAccess(): AdminAccessState {
  const [state, setState] = useState<AdminAccessState>({ ...NO_ACCESS, loading: true });

  useEffect(() => {
    let alive = true;
    resolveAccess().then((access) => {
      if (alive) setState({ ...access, loading: false });
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export default useAdminAccess;
