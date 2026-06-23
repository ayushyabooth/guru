import { getAuthToken, redirectToLogin } from './auth';

/**
 * Thrown when an authenticated request can't be made or is rejected because the
 * session is dead. By the time this throws, the global expiry redirect has
 * already been triggered (idempotent) — callers just need to stop. (GUR-240 D)
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * The single canonical fetch for authenticated endpoints. One source of truth
 * for attaching the bearer token and the 401 → login path:
 *  - no valid token (dead session) → getAuthToken() already fired the redirect;
 *    we throw SessionExpiredError.
 *  - server returns 401 (token rejected even though not clock-expired) → fire the
 *    redirect and throw SessionExpiredError.
 * Non-auth, non-2xx responses are returned as-is so callers keep their own
 * error messages.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  if (!token) {
    throw new SessionExpiredError();
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    void redirectToLogin();
    throw new SessionExpiredError('Unauthorized');
  }
  return res;
}
