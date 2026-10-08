/**
 * The metrics behind Home's rings and stats: what getMetrics asks the API for,
 * how it shapes the answer, and what getMetricsWithFallback shows when the API
 * fails. fetch is the mock from jest-setup.js and the auth token is mocked, so
 * no request leaves the test.
 *
 * The suite used to cover getMockMetrics, which generated random demo metrics.
 * The service no longer has it: when the API fails, the fallback is the last
 * good answer for that filter, then getDefaultMetrics(), which is all zeros.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';

jest.mock('../../utils/auth', () => ({
  getAuthToken: jest.fn(async () => 'test-token'),
  redirectToLogin: jest.fn(async () => undefined),
}));

type MetricServiceModule = typeof import('../../services/metric-service');
type AuthedFetchModule = typeof import('../../utils/authed-fetch');
type AuthModule = typeof import('../../utils/auth');

// jest-setup.js makes fetch a mock.
const fetchMock = jest.mocked(global.fetch);

/**
 * A fresh copy of the service and what it imports. The service and the profile
 * cache are module singletons that keep the last good answer, so each test
 * loads its own.
 */
function load() {
  let svc!: MetricServiceModule;
  let authed!: AuthedFetchModule;
  let auth!: AuthModule;
  jest.isolateModules(() => {
    svc = require('../../services/metric-service');
    authed = require('../../utils/authed-fetch');
    auth = require('../../utils/auth');
  });
  return { ...svc, SessionExpiredError: authed.SessionExpiredError, auth };
}

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: '', json: async () => body } as unknown as Response;
}

const METRICS = {
  today: { catchup_minutes: 15, divein_minutes: 20, recap_completed: false },
  week: [
    { catchup_minutes: 40, divein_minutes: 30, recap_completed: true },
    { catchup_minutes: 60, divein_minutes: 30, recap_completed: false },
  ],
  recap_journey_status: 'stage_2',
  recap_completed_today: false,
  recap_completed_this_week: true,
  current_streak: 4,
  articles_read: 12,
  articles_saved: 3,
  filters_explored: 2,
  top_topics: [{ name: 'Retail', count: 5 }],
  notes_this_week: 6,
  articles_read_today: 2,
  notes_today: 1,
  top_topics_today: [{ name: 'Retail', count: 1 }],
};

const PROFILE = {
  user_id: 'u-1',
  core_industry: 'Technology',
  specializations: ['AI & ML'],
  additional_interest_industries: ['Healthcare'],
  catchup_daily_goal_minutes: 30,
  divein_weekly_goal_minutes: 140,
  recap_weekly_goal_minutes: 60,
};

/** Answer GET /me/metrics and GET /me by URL, whatever order they are called in. */
function serve(metrics: unknown = METRICS, profile: unknown = PROFILE, metricsStatus = 200) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(`${API_BASE_URL}/me/metrics`)) return reply(metricsStatus, metrics);
    if (url === `${API_BASE_URL}/me`) return reply(200, profile);
    return reply(404, {});
  });
}

function callsTo(path: string): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(`${API_BASE_URL}${path}`));
}

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
});

describe('getMetrics', () => {
  it('shapes /me/metrics and /me into the rings, the stats and the profile', async () => {
    serve();
    const { metricService } = load();

    const result = await metricService.getMetrics();

    expect(result.metrics.catchup).toEqual({ dailyProgress: 15, dailyGoal: 30, weeklyTotal: 100 });
    // The daily dive-in goal is the weekly goal over 7 days: 140 / 7.
    expect(result.metrics.divein).toEqual({ dailyProgress: 20, dailyGoal: 20, weeklyProgress: 60, weeklyGoal: 140 });
    expect(result.metrics.recap).toEqual({
      status: 'in_progress',
      weeklyProgress: 60,
      weeklyGoal: 60,
      completedToday: false,
      completedThisWeek: true,
    });
    expect(result.metrics.streak).toBe(4);
    expect(result.metrics.stats).toEqual({
      articlesRead: 12,
      articlesSaved: 3,
      filtersExplored: 2,
      topTopics: [{ name: 'Retail', count: 5 }],
      notesThisWeek: 6,
      articlesReadToday: 2,
      notesToday: 1,
      topTopicsToday: [{ name: 'Retail', count: 1 }],
    });
    expect(result.profile).toEqual({
      coreIndustry: 'Technology',
      specializations: ['AI & ML'],
      additionalInterests: ['Healthcare'],
    });
  });

  it('sends the filter and the device timezone, with the bearer token', async () => {
    serve();
    const { metricService } = load();

    await metricService.getMetrics('core');

    const [url] = callsTo('/me/metrics');
    const params = new URL(url).searchParams;
    expect(params.get('filter')).toBe('core');
    expect(params.get('tz')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const init = fetchMock.mock.calls.find((c) => String(c[0]) === url)?.[1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it("leaves the filter out for 'all'", async () => {
    serve();
    const { metricService } = load();

    await metricService.getMetrics('all');

    expect(new URL(callsTo('/me/metrics')[0]).searchParams.has('filter')).toBe(false);
  });

  it('reuses a profile fetched in the last five minutes', async () => {
    serve();
    const { metricService } = load();

    await metricService.getMetrics();
    await metricService.getMetrics();

    expect(callsTo('/me/metrics')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === `${API_BASE_URL}/me`)).toHaveLength(1);
  });

  it.each<[string | null, boolean, string]>([
    ['completed', false, 'completed'],
    ['stage_1', false, 'in_progress'],
    ['commitment', false, 'in_progress'],
    [null, true, 'completed'],
    [null, false, 'not_started'],
  ])('reads recap status %p (done today: %p) as %p', async (journey, doneToday, expected) => {
    serve({ ...METRICS, recap_journey_status: journey, today: { ...METRICS.today, recap_completed: doneToday } });
    const { metricService } = load();

    const result = await metricService.getMetrics();

    expect(result.metrics.recap.status).toBe(expected);
  });

  it('never sets a daily dive-in goal under 15 minutes', async () => {
    // A weekly goal of 90 would be 13 minutes a day, under the goal editor's minimum.
    serve(METRICS, { ...PROFILE, divein_weekly_goal_minutes: 90 });
    const { metricService } = load();

    const result = await metricService.getMetrics();

    expect(result.metrics.divein.dailyGoal).toBe(15);
  });

  it("falls back to the day's and the week's data when the API sends no recap flags", async () => {
    const olderApi: Record<string, unknown> = { ...METRICS, today: { ...METRICS.today, recap_completed: true } };
    delete olderApi.recap_completed_today;
    delete olderApi.recap_completed_this_week;
    serve(olderApi);
    const { metricService } = load();

    const { recap } = (await metricService.getMetrics()).metrics;

    expect(recap.completedToday).toBe(true);
    expect(recap.completedThisWeek).toBe(true);
  });

  it('uses default goals and Consumer when the profile has none', async () => {
    serve({}, { user_id: 'u-1' });
    const { metricService } = load();

    const result = await metricService.getMetrics();

    expect(result.metrics.catchup).toEqual({ dailyProgress: 0, dailyGoal: 30, weeklyTotal: 0 });
    expect(result.metrics.divein.weeklyGoal).toBe(120);
    expect(result.metrics.recap.weeklyGoal).toBe(60);
    expect(result.profile).toEqual({ coreIndustry: 'Consumer', specializations: [], additionalInterests: [] });
  });

  it("throws the server's detail when /me/metrics fails", async () => {
    serve({ detail: 'Metrics are down' }, PROFILE, 503);
    const { metricService } = load();

    await expect(metricService.getMetrics()).rejects.toThrow('Metrics are down');
  });

  it('throws the status when the failure has no detail', async () => {
    serve({}, PROFILE, 500);
    const { metricService } = load();

    await expect(metricService.getMetrics()).rejects.toThrow('HTTP 500: Failed to fetch metrics');
  });
});

describe('getMetricsWithFallback', () => {
  it('returns the static defaults when the API fails and nothing is cached', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const { metricService } = load();

    const result = await metricService.getMetricsWithFallback();

    expect(result.metrics.catchup).toEqual({ dailyProgress: 0, dailyGoal: 30, weeklyTotal: 0 });
    expect(result.metrics.recap.status).toBe('not_started');
    expect(result.profile).toEqual({ coreIndustry: 'Consumer', specializations: ['Food & Beverage'], additionalInterests: [] });
  });

  it('returns the last good answer for the filter when a later call fails', async () => {
    serve();
    const { metricService } = load();
    const good = await metricService.getMetricsWithFallback('core');

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('Network error'));
    const fallback = await metricService.getMetricsWithFallback('core');

    expect(fallback).toEqual(good);
    expect(fallback.profile.coreIndustry).toBe('Technology');
  });

  it('keeps the last good answer across app restarts, in localStorage', async () => {
    serve();
    const good = await load().metricService.getMetrics('core');

    const restarted = load().metricService;

    expect(restarted.getCachedMetrics('core')).toEqual(good);
    expect(restarted.getCachedMetrics('divein')).toBeNull();
  });

  it('rethrows an expired session instead of showing stale numbers', async () => {
    serve({}, PROFILE, 401);
    const { metricService, SessionExpiredError, auth } = load();

    await expect(metricService.getMetricsWithFallback()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(auth.redirectToLogin).toHaveBeenCalled();
  });
});

describe('formatMinutes', () => {
  it.each<[number, string]>([
    [0, '0m'],
    [45, '45m'],
    [59.6, '1h'],
    [60, '1h'],
    [75, '1h 15m'],
    [150, '2h 30m'],
  ])('formats %p minutes as %p', (minutes, text) => {
    expect(load().formatMinutes(minutes)).toBe(text);
  });
});
