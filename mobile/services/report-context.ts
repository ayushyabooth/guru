/**
 * The session's context for Report a bug (GUR-277): what the app knows at the
 * moment a tester reports, so the team sees how they got there.
 *
 *   screen        where the report comes from: home, catchup, divein, recap, guru, article or other
 *   step          that screen's own step, e.g. Recap's "stage-3"
 *   on_screen     the ids on that screen: article_id, recap_journey_id, trace_id
 *   trail         the last 10 screens, newest first: { screen, step?, at }
 *   failed_calls  the last 5 API calls that failed, newest first: { method, path, status, at }
 *
 * A tiny external store, like setTabBarHidden in app/(tabs)/_layout.tsx: the
 * root layout records each screen from the route, a screen sets its own step
 * and ids, authedFetch records the calls that fail, and sendReport reads it all
 * through getReportContext(). Nothing here keeps a request body, a header, a
 * query string or anything the user typed.
 *
 * Every value stays inside the server's limits (GUR-278). The server drops a
 * context that breaks one, and the report then arrives without it.
 */
import { API_BASE_URL } from '../constants/config';

// ─── Types ───────────────────────────────────────────────────────────────

export type ReportScreen = 'home' | 'catchup' | 'divein' | 'recap' | 'guru' | 'article' | 'other';

export interface ReportTrailItem {
  screen: ReportScreen;
  step?: string;
  /** ISO time, UTC. */
  at: string;
}

export interface ReportFailedCall {
  /** GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS. */
  method: string;
  /** The API path: no host, no query string, no fragment. */
  path: string;
  /** The HTTP status, or 0 when the call got no answer. */
  status: number;
  /** ISO time, UTC. */
  at: string;
}

/** The ids on screen. The server adds the article's title itself: the app never sends it. */
export interface ReportOnScreen {
  article_id?: string;
  recap_journey_id?: string;
  trace_id?: string;
}

/** `context` on POST /reports. */
export interface ReportContext {
  screen: ReportScreen;
  step?: string;
  on_screen?: ReportOnScreen;
  trail: ReportTrailItem[];
  failed_calls: ReportFailedCall[];
}

// ─── The server's limits (GUR-278) ───────────────────────────────────────

export const TRAIL_MAX = 10;
export const FAILED_CALLS_MAX = 5;
const STEP_MAX_CHARS = 64;
const PATH_MAX_CHARS = 200;
/** At most 64 characters, letters, digits and _ . : - only. */
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ID_KEYS = ['article_id', 'recap_journey_id', 'trace_id'] as const;

// ─── State ───────────────────────────────────────────────────────────────

/** The screen the user is on, as the root layout last saw it. */
let current: ReportScreen | null = null;
/**
 * Each screen's own step and ids, keyed by the screen that set them. Keyed,
 * not one slot: the route reaches the root layout after the new screen's first
 * effects have run, so a screen can set its step before it is current.
 */
const own = new Map<ReportScreen, { step?: string; ids: ReportOnScreen }>();
let trail: ReportTrailItem[] = [];
let failedCalls: ReportFailedCall[] = [];

// ─── Screens ─────────────────────────────────────────────────────────────

/** "/catchup" -> catchup, "/article/<id>" -> article, "/" (Home) -> home, anything else -> other. */
export function reportScreenFromPath(pathname: string | null | undefined): ReportScreen {
  const first = String(pathname || '').split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? '';
  switch (first) {
    case '':
      return 'home';
    case 'catchup':
    case 'divein':
    case 'recap':
    case 'guru':
    case 'article':
      return first;
    default:
      return 'other';
  }
}

/**
 * The root layout calls this on every route change. A new screen goes to the
 * top of the trail, and every other screen's step and ids end with the visit.
 */
export function recordReportScreen(screen: ReportScreen): void {
  if (screen === current) return;
  current = screen;
  for (const key of Array.from(own.keys())) {
    if (key !== screen) own.delete(key);
  }
  pushTrail(screen, own.get(screen)?.step);
}

/**
 * A screen's step, e.g. setReportStep('recap', 'stage-3'). Call it while the
 * screen is focused (useFocusEffect), and again when the step changes. Null
 * clears it. A new step on the current screen is a new trail entry.
 */
export function setReportStep(screen: ReportScreen, step: string | null | undefined): void {
  const clean = typeof step === 'string' ? step.trim().slice(0, STEP_MAX_CHARS) || undefined : undefined;
  const state = stateFor(screen);
  if (state.step === clean) return;
  state.step = clean;
  // Not current yet: recordReportScreen adds the step with the screen.
  if (!clean || screen !== current) return;
  const newest = trail[0];
  if (newest && newest.screen === screen && !newest.step) {
    // The visit's entry, recorded before the screen had said its step.
    trail[0] = { ...newest, step: clean };
    return;
  }
  pushTrail(screen, clean);
}

/**
 * The ids on a screen, e.g. setReportIds('article', { article_id }). Each call
 * replaces that screen's ids; null clears them. An id outside the server's
 * format is left out.
 */
export function setReportIds(
  screen: ReportScreen,
  ids: { article_id?: string | null; recap_journey_id?: string | null; trace_id?: string | null } | null,
): void {
  const clean: ReportOnScreen = {};
  for (const key of ID_KEYS) {
    const value = ids?.[key];
    if (typeof value === 'string' && ID_RE.test(value)) clean[key] = value;
  }
  stateFor(screen).ids = clean;
}

function stateFor(screen: ReportScreen) {
  let state = own.get(screen);
  if (!state) {
    state = { ids: {} };
    own.set(screen, state);
  }
  return state;
}

function pushTrail(screen: ReportScreen, step: string | undefined): void {
  const newest = trail[0];
  if (newest && newest.screen === screen && newest.step === step) return; // the same screen and step again
  const item: ReportTrailItem = step ? { screen, step, at: nowIso() } : { screen, at: nowIso() };
  trail = [item, ...trail].slice(0, TRAIL_MAX);
}

// ─── Failed calls ────────────────────────────────────────────────────────

/**
 * authedFetch calls this for any answer outside 2xx, and with status 0 when
 * the call got no answer. Only the method, the path and the status are kept.
 * Never throws: the list must not get in the way of the request.
 */
export function recordFailedCall(method: string | null | undefined, url: string, status: number): void {
  try {
    const verb = String(method || 'GET').toUpperCase();
    if (!METHODS.has(verb)) return;
    const code = Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0;
    const call: ReportFailedCall = { method: verb, path: apiPath(url), status: code, at: nowIso() };
    failedCalls = [call, ...failedCalls].slice(0, FAILED_CALLS_MAX);
  } catch {
    // A list that could not take one more entry is not worth a failed request.
  }
}

/**
 * The path a failed call shows: "<API_BASE_URL>/recap/journey/current?x=1"
 * -> "/recap/journey/current". The query string and fragment go first, then
 * the API base (or any other host). Spaces, control characters and anything
 * outside printable ASCII are percent-encoded, and the result is cut to 200
 * characters.
 */
export function apiPath(url: string): string {
  let path = String(url || '').split('#')[0].split('?')[0];
  const base = API_BASE_URL.replace(/\/+$/, '');
  if (base && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length);
  } else {
    path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  }
  path = path.replace(/[^\x21-\x7e]/g, encodeChar);
  if (!path.startsWith('/')) path = `/${path}`;
  return path.slice(0, PATH_MAX_CHARS);
}

function encodeChar(c: string): string {
  try {
    return encodeURIComponent(c);
  } catch {
    return ''; // a lone surrogate cannot be encoded: drop it
  }
}

// ─── Reading it ──────────────────────────────────────────────────────────

/** The `context` every report sends: only the contract's fields, copies of the lists. */
export function getReportContext(): ReportContext {
  const screen = current ?? 'other';
  const state = own.get(screen);
  const context: ReportContext = {
    screen,
    trail: trail.map((item) => ({ ...item })),
    failed_calls: failedCalls.map((call) => ({ ...call })),
  };
  if (state?.step) context.step = state.step;
  if (state && Object.keys(state.ids).length > 0) context.on_screen = { ...state.ids };
  return context;
}

/** Tests only: start from nothing. */
export function resetReportContext(): void {
  current = null;
  own.clear();
  trail = [];
  failedCalls = [];
}

function nowIso(): string {
  return new Date(Date.now()).toISOString();
}

// ─── Labels (the admin's Session context card) ───────────────────────────

const SCREEN_LABEL: Record<ReportScreen, string> = {
  home: 'Home',
  catchup: 'Catch up',
  divein: 'Dive in',
  recap: 'Recap',
  guru: 'Guru',
  article: 'Reader',
  other: 'Other',
};

/** "recap" and "stage-3" -> "Recap · stage 3"; "catchup" -> "Catch up". An unknown screen or step reads as sent. */
export function reportScreenLabel(screen: string | null | undefined, step?: string | null): string {
  const name = (screen && (SCREEN_LABEL as Record<string, string>)[screen]) || screen || 'Unknown screen';
  const stepText = step ? step.replace(/[-_]+/g, ' ').trim() : '';
  return stepText ? `${name} · ${stepText}` : name;
}

/** A report's own `screen` field, which may carry a mode: "guru/catch-up" -> "Guru · catch up", "recap" -> "Recap". */
export function sentFromLabel(screen: string | null | undefined): string | null {
  if (!screen) return null;
  const slash = screen.indexOf('/');
  return slash < 0 ? reportScreenLabel(screen) : reportScreenLabel(screen.slice(0, slash), screen.slice(slash + 1));
}
