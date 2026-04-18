/**
 * fetchWithTimeout — 8-second timeout + one automatic retry for cold Railway starts.
 *
 * - Wraps every fetch() with an AbortController-based 8s deadline.
 * - On timeout or network error (not 4xx/5xx), waits 2s and retries once.
 * - On second failure, throws so the UI can surface a "Server warming up" state.
 * - 4xx/5xx HTTP responses are returned as-is; callers handle HTTP error codes.
 */

const TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 2_000;

export class NetworkTimeoutError extends Error {
  constructor(url: string) {
    super(`Request timed out after ${TIMEOUT_MS / 1000}s (${url})`);
    this.name = 'NetworkTimeoutError';
  }
}

/** Returns true for network-level / timeout failures, false for HTTP errors. */
export function isNetworkOrTimeoutError(error: unknown): boolean {
  if (error instanceof NetworkTimeoutError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      error.name === 'AbortError' ||
      msg.includes('network request failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('timed out') ||
      msg.includes('timeout')
    );
  }
  return false;
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function doFetch(
  url: string,
  options?: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new NetworkTimeoutError(url);
    }
    throw err;
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Drop-in replacement for fetch() with an 8s timeout and one retry on
 * network / timeout errors. Signature matches the standard fetch() API.
 */
export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  try {
    return await doFetch(url, options, timeoutMs);
  } catch (firstErr) {
    if (isNetworkOrTimeoutError(firstErr)) {
      await delay(RETRY_DELAY_MS);
      // Second failure propagates to the caller
      return await doFetch(url, options, timeoutMs);
    }
    throw firstErr;
  }
}
