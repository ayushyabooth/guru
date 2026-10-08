/**
 * Report a bug's session context (GUR-277): the trail of screens, a screen's
 * step and ids, the failed calls authedFetch records, and the `context` every
 * report sends. Nothing leaves the test: fetch and the auth token are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';
import {
  FAILED_CALLS_MAX,
  TRAIL_MAX,
  apiPath,
  getReportContext,
  recordFailedCall,
  recordReportScreen,
  reportScreenFromPath,
  reportScreenLabel,
  resetReportContext,
  sentFromLabel,
  setReportIds,
  setReportStep,
} from '../../services/report-context';
import { authedFetch } from '../../utils/authed-fetch';

jest.mock('../../utils/auth', () => ({
  getAuthToken: jest.fn(async () => 'tok-secret-123'),
  redirectToLogin: jest.fn(async () => undefined),
}));

const JOURNEY = '3f2a91c0-1111-4222-8333-444455556666';
const ARTICLE = '7c41e09b-aaaa-4bbb-8ccc-ddddeeeeffff';

let clock = Date.parse('2026-10-07T20:41:00.000Z');
// jest-setup.js makes fetch a mock.
const fetchMock = jest.mocked(global.fetch);

function reply(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as unknown as Response;
}

beforeEach(() => {
  resetReportContext();
  clock = Date.parse('2026-10-07T20:41:00.000Z');
  jest.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
  fetchMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the screen trail', () => {
  it('keeps the last 10 screens, newest first, each with an ISO time', () => {
    const screens = ['home', 'catchup', 'article', 'catchup', 'divein', 'article', 'divein', 'recap', 'home', 'guru', 'recap', 'other'] as const;
    screens.forEach((s) => recordReportScreen(s));

    const { trail } = getReportContext();
    expect(trail).toHaveLength(TRAIL_MAX);
    expect(trail.map((t) => t.screen)).toEqual([...screens].reverse().slice(0, TRAIL_MAX));
    trail.forEach((t) => expect(new Date(t.at).toISOString()).toBe(t.at));
    // Newest first means the times run backwards.
    expect(Date.parse(trail[0].at)).toBeGreaterThan(Date.parse(trail[1].at));
  });

  it('skips a repeat of the same screen and step, and keeps a new step on the same screen', () => {
    recordReportScreen('recap');
    recordReportScreen('recap');
    setReportStep('recap', 'stage-1');
    setReportStep('recap', 'stage-1');
    setReportStep('recap', 'stage-2');
    setReportStep('recap', 'stage-2');

    expect(getReportContext().trail.map((t) => [t.screen, t.step])).toEqual([
      ['recap', 'stage-2'],
      ['recap', 'stage-1'],
    ]);
  });

  it('gives the visit its step when the screen says it after the route (one entry, not two)', () => {
    recordReportScreen('home');
    recordReportScreen('recap');
    setReportStep('recap', 'entry');

    expect(getReportContext().trail.map((t) => [t.screen, t.step])).toEqual([
      ['recap', 'entry'],
      ['home', undefined],
    ]);
  });

  it('keeps a step the new screen set before the route reached the root layout', () => {
    recordReportScreen('home');
    // expo-router updates the pathname after the new screen's first effects run.
    setReportStep('recap', 'stage-3');
    setReportIds('recap', { recap_journey_id: JOURNEY });
    expect(getReportContext().screen).toBe('home');
    expect(getReportContext().step).toBeUndefined();

    recordReportScreen('recap');
    const context = getReportContext();
    expect(context.screen).toBe('recap');
    expect(context.step).toBe('stage-3');
    expect(context.on_screen).toEqual({ recap_journey_id: JOURNEY });
    expect(context.trail[0]).toMatchObject({ screen: 'recap', step: 'stage-3' });
  });

  it('clears the step and ids when the screen changes, and a return starts without them', () => {
    recordReportScreen('recap');
    setReportStep('recap', 'stage-2');
    setReportIds('recap', { recap_journey_id: JOURNEY });

    recordReportScreen('home');
    let context = getReportContext();
    expect(context.screen).toBe('home');
    expect(context.step).toBeUndefined();
    expect(context.on_screen).toBeUndefined();

    recordReportScreen('recap');
    context = getReportContext();
    expect(context.step).toBeUndefined();
    expect(context.on_screen).toBeUndefined();
    expect(context.trail[0]).toEqual({ screen: 'recap', at: expect.any(String) });
  });

  it('caps a step at 64 characters and ignores an empty one', () => {
    recordReportScreen('recap');
    setReportStep('recap', 'x'.repeat(80));
    expect(getReportContext().step).toBe('x'.repeat(64));
    setReportStep('recap', '   ');
    expect(getReportContext().step).toBeUndefined();
  });

  it('maps routes to screen keys', () => {
    expect(reportScreenFromPath('/')).toBe('home');
    expect(reportScreenFromPath('')).toBe('home');
    expect(reportScreenFromPath('/catchup')).toBe('catchup');
    expect(reportScreenFromPath('/divein')).toBe('divein');
    expect(reportScreenFromPath('/recap')).toBe('recap');
    expect(reportScreenFromPath('/guru')).toBe('guru');
    expect(reportScreenFromPath(`/article/${ARTICLE}`)).toBe('article');
    expect(reportScreenFromPath('/catchup?x=1')).toBe('catchup');
    expect(reportScreenFromPath('/login')).toBe('other');
    expect(reportScreenFromPath('/onboarding/step-2')).toBe('other');
  });
});

describe('ids on screen', () => {
  it('keeps only the contract ids, in the server format', () => {
    recordReportScreen('article');
    setReportIds('article', {
      article_id: ARTICLE,
      recap_journey_id: 'has spaces',
      trace_id: 'x'.repeat(65),
      // Not the app's to send: the server fills in the title.
      ...({ article_title: 'The quiet return of the chip makers', user_email: 'a@b.c' } as object),
    });
    expect(getReportContext().on_screen).toEqual({ article_id: ARTICLE });

    setReportIds('article', { article_id: 'ok_id.v2:1-a' });
    expect(getReportContext().on_screen).toEqual({ article_id: 'ok_id.v2:1-a' });

    setReportIds('article', null);
    expect(getReportContext().on_screen).toBeUndefined();
  });

  it("never reports another screen's ids", () => {
    recordReportScreen('catchup');
    setReportIds('article', { article_id: ARTICLE });
    expect(getReportContext().on_screen).toBeUndefined();
  });
});

describe('failed calls', () => {
  it('keeps the last 5, newest first', () => {
    for (let i = 1; i <= 7; i++) recordFailedCall('GET', `${API_BASE_URL}/calls/${i}`, 500);
    const calls = getReportContext().failed_calls;
    expect(calls).toHaveLength(FAILED_CALLS_MAX);
    expect(calls.map((c) => c.path)).toEqual(['/calls/7', '/calls/6', '/calls/5', '/calls/4', '/calls/3']);
  });

  it('strips the API base, the query string and the fragment, and any other host', () => {
    expect(apiPath(`${API_BASE_URL}/recap/journey/current?week=2026-10-05&token=abc#frag`)).toBe('/recap/journey/current');
    expect(apiPath(`${API_BASE_URL}/catchup-feed?filter=core&limit=5`)).toBe('/catchup-feed');
    expect(apiPath(`${API_BASE_URL}/reports#top`)).toBe('/reports');
    expect(apiPath('https://elsewhere.example.com/api/v1/me?x=1')).toBe('/api/v1/me');
    expect(apiPath('/relative/path?q=1')).toBe('/relative/path');
    expect(apiPath(API_BASE_URL)).toBe('/');
  });

  it('encodes whitespace and control characters, and caps the path at 200 characters', () => {
    expect(apiPath(`${API_BASE_URL}/search/two words\n`)).toBe('/search/two%20words%0A');
    const long = apiPath(`${API_BASE_URL}/${'a'.repeat(300)}`);
    expect(long).toHaveLength(200);
    expect(long).not.toMatch(/[?#\s]/);
  });

  it('uppercases the method, defaults to GET, skips a method the server would refuse, and clamps the status', () => {
    recordFailedCall('post', `${API_BASE_URL}/reports`, 422);
    recordFailedCall(undefined, `${API_BASE_URL}/me`, 503);
    recordFailedCall('TRACE', `${API_BASE_URL}/me`, 500);
    recordFailedCall('GET', `${API_BASE_URL}/odd`, 700);
    recordFailedCall('GET', `${API_BASE_URL}/odd`, 1.5);

    expect(getReportContext().failed_calls.map((c) => [c.method, c.path, c.status])).toEqual([
      ['GET', '/odd', 0],
      ['GET', '/odd', 0],
      ['GET', '/me', 503],
      ['POST', '/reports', 422],
    ]);
  });

  it('authedFetch records any answer outside 2xx and a call with no answer, never a body, a header or a query', async () => {
    fetchMock.mockResolvedValueOnce(reply(200));
    await authedFetch(`${API_BASE_URL}/me`);
    expect(getReportContext().failed_calls).toEqual([]);

    fetchMock.mockResolvedValueOnce(reply(500));
    const res = await authedFetch(`${API_BASE_URL}/recap/journey/current?private=my-search-words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Private-Header': 'header-value-secret' },
      body: JSON.stringify({ expected: 'my private words' }),
    });
    expect(res.status).toBe(500);

    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(
      authedFetch(`${API_BASE_URL}/articles/123/save`, { method: 'PUT', body: '{"note":"body-secret"}' }),
    ).rejects.toThrow('Network request failed');

    const calls = getReportContext().failed_calls;
    expect(calls.map((c) => [c.method, c.path, c.status])).toEqual([
      ['PUT', '/articles/123/save', 0],
      ['POST', '/recap/journey/current', 500],
    ]);
    calls.forEach((c) => expect(Object.keys(c).sort()).toEqual(['at', 'method', 'path', 'status']));

    const sent = JSON.stringify(getReportContext());
    for (const secret of ['private', 'header-value-secret', 'body-secret', 'tok-secret-123', 'Bearer', 'expected', 'http']) {
      expect(sent).not.toContain(secret);
    }
  });

  it('records a 401 before the login redirect', async () => {
    fetchMock.mockResolvedValueOnce(reply(401));
    await expect(authedFetch(`${API_BASE_URL}/me/access`)).rejects.toThrow('Unauthorized');
    expect(getReportContext().failed_calls[0]).toMatchObject({ method: 'GET', path: '/me/access', status: 401 });
  });
});

describe('getReportContext', () => {
  it('sends only the contract fields, and copies the lists', () => {
    recordReportScreen('recap');
    setReportStep('recap', 'stage-3');
    setReportIds('recap', { recap_journey_id: JOURNEY });
    recordFailedCall('GET', `${API_BASE_URL}/recap/journey/current`, 500);

    const context = getReportContext();
    expect(Object.keys(context).sort()).toEqual(['failed_calls', 'on_screen', 'screen', 'step', 'trail']);
    expect(context).toEqual({
      screen: 'recap',
      step: 'stage-3',
      on_screen: { recap_journey_id: JOURNEY },
      trail: [{ screen: 'recap', step: 'stage-3', at: expect.any(String) }],
      failed_calls: [{ method: 'GET', path: '/recap/journey/current', status: 500, at: expect.any(String) }],
    });

    context.trail.pop();
    context.failed_calls.pop();
    expect(getReportContext().trail).toHaveLength(1);
    expect(getReportContext().failed_calls).toHaveLength(1);
  });

  it('leaves out step and on_screen when there are none, and says "other" before any route', () => {
    expect(getReportContext()).toEqual({ screen: 'other', trail: [], failed_calls: [] });
    recordReportScreen('catchup');
    expect(getReportContext()).toEqual({
      screen: 'catchup',
      trail: [{ screen: 'catchup', at: expect.any(String) }],
      failed_calls: [],
    });
  });
});

describe('labels', () => {
  it('reads screens and steps the way the Session context card shows them', () => {
    expect(reportScreenLabel('recap', 'stage-3')).toBe('Recap · stage 3');
    expect(reportScreenLabel('recap', 'past-recap')).toBe('Recap · past recap');
    expect(reportScreenLabel('catchup')).toBe('Catch up');
    expect(reportScreenLabel('divein', null)).toBe('Dive in');
    expect(reportScreenLabel('article')).toBe('Reader');
    expect(reportScreenLabel('home')).toBe('Home');
    expect(reportScreenLabel('guru')).toBe('Guru');
    expect(reportScreenLabel('other')).toBe('Other');
    expect(reportScreenLabel('settings', 'step_two')).toBe('settings · step two');
    expect(reportScreenLabel(null)).toBe('Unknown screen');
  });

  it("reads a report's own screen field, mode included", () => {
    expect(sentFromLabel('guru/catch-up')).toBe('Guru · catch up');
    expect(sentFromLabel('recap')).toBe('Recap');
    expect(sentFromLabel('home')).toBe('Home');
    expect(sentFromLabel(null)).toBeNull();
  });
});
