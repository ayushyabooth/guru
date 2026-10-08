/**
 * Report a bug (GUR-242, GUR-277): every report carries the session's context,
 * whichever entry point sends it. authedFetch is mocked, so no request leaves
 * the test.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';
import { authedFetch } from '../../utils/authed-fetch';
import { sendReport } from '../../services/report-service';
import {
  recordFailedCall,
  recordReportScreen,
  resetReportContext,
  setReportIds,
  setReportStep,
} from '../../services/report-context';

jest.mock('../../utils/authed-fetch', () => ({
  authedFetch: jest.fn(),
}));

const fetchMock = jest.mocked(authedFetch);
const JOURNEY = '3f2a91c0-1111-4222-8333-444455556666';
const TRACE = '9d8c7b6a-1111-4222-8333-444455556666';

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** The JSON body of the last POST /reports. */
function sentBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  expect(call[0]).toBe(`${API_BASE_URL}/reports`);
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe('sendReport', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetReportContext();
    fetchMock.mockResolvedValue(reply(200, { id: 'r-1', reference: '7c41e09b', status: 'saved' }));
  });

  it("sends the session's context with a Report button's report", async () => {
    recordReportScreen('home');
    recordReportScreen('recap');
    setReportStep('recap', 'stage-3');
    setReportIds('recap', { recap_journey_id: JOURNEY });
    recordFailedCall('GET', `${API_BASE_URL}/recap/journey/current?week=1`, 500);

    const receipt = await sendReport({ category: 'broken_ui', expected: '  Stage 3 stayed blank.  ', screen: 'recap' });
    expect(receipt).toEqual({ id: 'r-1', reference: '7c41e09b', status: 'saved' });

    const body = sentBody();
    expect(body).toMatchObject({ category: 'broken_ui', expected: 'Stage 3 stayed blank.', screen: 'recap' });
    expect(body.context).toEqual({
      screen: 'recap',
      step: 'stage-3',
      on_screen: { recap_journey_id: JOURNEY },
      trail: [
        { screen: 'recap', step: 'stage-3', at: expect.any(String) },
        { screen: 'home', at: expect.any(String) },
      ],
      failed_calls: [{ method: 'GET', path: '/recap/journey/current', status: 500, at: expect.any(String) }],
    });
  });

  it("carries it on Home's card and the turn flag too, next to the turn's own trace", async () => {
    recordReportScreen('guru');
    await sendReport({ category: 'wrong_answer', expected: 'Wrong week.', screen: 'guru/catch-up', trace_id: TRACE });

    const body = sentBody();
    expect(body.trace_id).toBe(TRACE);
    expect(body.screen).toBe('guru/catch-up');
    expect(body.context).toEqual({ screen: 'guru', trail: [{ screen: 'guru', at: expect.any(String) }], failed_calls: [] });

    recordReportScreen('home');
    await sendReport({ category: 'other', expected: 'Something', screen: 'home' });
    expect((sentBody().context as { screen: string }).screen).toBe('home');
  });

  it("never sends the article's title: the server fills it in", async () => {
    recordReportScreen('article');
    setReportIds('article', { article_id: 'a-1', ...({ article_title: 'A title' } as object) });
    await sendReport({ category: 'missing', expected: 'No notes tab', screen: 'article' });

    const context = sentBody().context as { on_screen: Record<string, string> };
    expect(context.on_screen).toEqual({ article_id: 'a-1' });
    expect(JSON.stringify(sentBody())).not.toContain('A title');
  });
});
