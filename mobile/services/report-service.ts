/**
 * Report a bug (beta, GUR-242): the tester's side.
 *
 *   POST /reports  { category, expected, screen?, trace_id?, session_id?, client?, context? }
 *                  -> { id, reference, status: "saved" }
 *
 * The server saves the report and answers at once; filing to Linear and the
 * triage run after the response. Beta only, decided on the server: 403 for
 * any other account, so hiding the entry point is a UI hint, not the security.
 * The call goes through authedFetch, the single 401 -> login path.
 *
 * Every report carries the session's context (GUR-277): the screen and its
 * step, the ids on it, the trail of screens and the failed calls, from
 * services/report-context.ts. Home's card, the turn flag and the Report button
 * all send it without asking for it.
 */
import { Platform } from 'react-native';
import { API_BASE_URL } from '../constants/config';
import { authedFetch } from '../utils/authed-fetch';
import { ReportContext, getReportContext } from './report-context';

// ─── Categories ──────────────────────────────────────────────────────────

export type ReportCategory = 'wrong_answer' | 'slow' | 'broken_ui' | 'missing' | 'other';

/** In the order the sheet shows them. The labels are the sheet's chips (frame 12:27). */
export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_answer', label: 'Wrong answer' },
  { value: 'slow', label: 'Slow' },
  { value: 'broken_ui', label: 'Looks broken' },
  { value: 'missing', label: 'Something missing' },
  { value: 'other', label: 'Other' },
];

export function reportCategoryLabel(category: string | null | undefined): string {
  return REPORT_CATEGORIES.find((c) => c.value === category)?.label ?? 'Other';
}

/** The server's limit on "What did you expect?" (ReportRequest.expected). */
export const EXPECTED_MAX_CHARS = 2000;

// ─── Errors ──────────────────────────────────────────────────────────────

export type ReportErrorKind =
  | 'session' // signed out (authedFetch already started the login redirect)
  | 'forbidden' // 403: not a beta account
  | 'invalid' // 422: the server rejected the body
  | 'not_deployed' // 404: the backend does not have the route yet
  | 'http' // any other non-2xx
  | 'network' // fetch itself failed
  | 'bad_response'; // 2xx but not the expected JSON: the report was saved, only the receipt is unreadable

export class ReportApiError extends Error {
  readonly kind: ReportErrorKind;
  readonly status: number | null;

  constructor(kind: ReportErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ReportApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Matches by name, like the app does for SessionExpiredError, so it survives transpiled `instanceof`. */
export function isReportApiError(e: unknown): e is ReportApiError {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'ReportApiError';
}

export function toReportError(e: unknown): ReportApiError {
  if (isReportApiError(e)) return e;
  return new ReportApiError('network', 'Network error');
}

// ─── POST /reports ───────────────────────────────────────────────────────

export interface ReportPayload {
  category: ReportCategory;
  /** What the user expected, in their words. Required and non-empty. */
  expected: string;
  /**
   * Where the report came from: "home", or "guru/<mode>" for a turn (e.g. "guru/catch-up"), "guru" if the mode is
   * unknown, or the screen of a Report button: "catchup", "divein", "recap" or "article".
   */
  screen?: string | null;
  /** The agent turn the report is about (the `trace_id` of its done or error event). */
  trace_id?: string | null;
  session_id?: string | null;
  /** Defaults to the platform: web, ios or android. */
  client?: string | null;
}

export interface ReportReceipt {
  id: string;
  /** The short id a tester can quote: the first 8 hex characters of the report id. */
  reference: string;
  status: 'saved';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server types trace_id and session_id as UUIDs, so anything else would turn the whole report into a 422. */
function uuidOrUndefined(value: string | null | undefined): string | undefined {
  return value && UUID_RE.test(value) ? value : undefined;
}

/** The session's context at the moment of sending. A fault in the collector never costs the report itself. */
function contextNow(): ReportContext | undefined {
  try {
    return getReportContext();
  } catch {
    return undefined;
  }
}

export async function sendReport(payload: ReportPayload): Promise<ReportReceipt> {
  const body = {
    category: payload.category,
    expected: payload.expected.trim(),
    screen: payload.screen || undefined,
    trace_id: uuidOrUndefined(payload.trace_id),
    session_id: uuidOrUndefined(payload.session_id),
    client: payload.client || Platform.OS,
    context: contextNow(),
  };

  let res: Response;
  try {
    res = await authedFetch(`${API_BASE_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // authedFetch throws SessionExpiredError after starting the login redirect.
    if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'SessionExpiredError') {
      throw new ReportApiError('session', 'Signed out', 401);
    }
    throw new ReportApiError('network', 'Network error');
  }

  if (res.status === 403) throw new ReportApiError('forbidden', 'Beta only', 403);
  if (res.status === 422) throw new ReportApiError('invalid', 'The server did not accept the report', 422);
  if (res.status === 404) throw new ReportApiError('not_deployed', 'Not deployed yet', 404);
  if (!res.ok) throw new ReportApiError('http', `Request failed (HTTP ${res.status})`, res.status);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ReportApiError('bad_response', 'Unexpected response', res.status);
  }
  const receipt = data as Partial<ReportReceipt> | null;
  if (!receipt || typeof receipt.id !== 'string' || typeof receipt.reference !== 'string') {
    throw new ReportApiError('bad_response', 'Unexpected response', res.status);
  }
  return { id: receipt.id, reference: receipt.reference, status: 'saved' };
}
