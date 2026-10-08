/**
 * Issues tab (GUR-271): the two reads the tab and the eval case detail make.
 * authedFetch is mocked, so no request leaves the test.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';
import { authedFetch } from '../../utils/authed-fetch';
import { getIssues, getLatestEvalRun } from '../../services/admin-service';

jest.mock('../../utils/authed-fetch', () => ({
  authedFetch: jest.fn(),
}));

const fetchMock = jest.mocked(authedFetch);

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ISSUES = {
  gate: {
    state: 'blocked',
    reasons: [
      { kind: 'safety', ok: false, text: 'INJ-04 stays red' },
      { kind: 'regressions', ok: true, text: 'none' },
      { kind: 'reports', ok: false, text: '1' },
    ],
    run: { id: 'r1', run_at: '2026-10-07T23:41:00Z', live: true, build_sha: '60d8584abc', prompt_version: 'a5b232fcd913' },
    score: null,
  },
  counts: { all: 1, eval: 1, report: 0, production: 0 },
  issues: [
    {
      key: 'eval:STEP-07',
      source: 'eval',
      at: '2026-10-07T23:41:00Z',
      title: 'STEP-07  ·  "Next" hides stories',
      status: { text: 'Red  ·  change 4', tone: 'red' },
      body: 'In 1 of 3 runs every "next" hid the story just read.',
      chip: { text: 'multi-turn  ·  2 of 3', tone: 'indigo' },
      footer: null,
      ref: { case_id: 'STEP-07' },
      linear_url: null,
    },
  ],
};

describe('admin issues service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('reads the issues for the window and source', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, ISSUES));
    const res = await getIssues(7, 'all');
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/issues?days=7&source=all`, expect.any(Object));
    expect(res.gate.state).toBe('blocked');
    expect(res.issues[0].ref.case_id).toBe('STEP-07');

    fetchMock.mockResolvedValueOnce(reply(200, ISSUES));
    await getIssues(7, 'eval');
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE_URL}/admin/issues?days=7&source=eval`, expect.any(Object));
  });

  it('reads the latest eval run', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: 'r1', run_at: '2026-10-07T23:41:00Z', cases: [] }));
    const run = await getLatestEvalRun();
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/evals/latest`, expect.any(Object));
    expect(run?.id).toBe('r1');
  });

  it('treats a 404 with a reason as no eval run yet', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { detail: 'No eval run yet' }));
    await expect(getLatestEvalRun()).resolves.toBeNull();
  });

  it('still reports a bare 404 as a route that is not deployed', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { detail: 'Not Found' }));
    await expect(getLatestEvalRun()).rejects.toMatchObject({ name: 'AdminApiError', kind: 'not_deployed' });
  });

  it('never turns a 403 into "no run"', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { detail: 'Admin only' }));
    await expect(getLatestEvalRun()).rejects.toMatchObject({ name: 'AdminApiError', kind: 'forbidden' });
  });
});
