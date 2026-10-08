import { getAuthToken, redirectToLogin } from './auth';
import { recordFailedCall } from '../services/report-context';

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
 *
 * Every answer outside 2xx, and every call that gets no answer (status 0), also
 * goes on Report a bug's list of failed calls (GUR-277): the method, the path
 * without its query string, and the status. Never the body or a header.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  if (!token) {
    throw new SessionExpiredError();
  }
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    recordFailedCall(init.method, url, 0);
    throw e;
  }
  if (!res.ok) recordFailedCall(init.method, url, res.status);
  if (res.status === 401) {
    void redirectToLogin();
    throw new SessionExpiredError('Unauthorized');
  }
  return res;
}
