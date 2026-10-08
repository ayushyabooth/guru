/**
 * Eval runs (GUR-282): the two reads the view makes, GET /admin/eval-runs and /admin/eval-runs/{id}, and
 * how they answer a missing route, a missing run and a non-admin. authedFetch is mocked, so no request
 * leaves the test.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';
import { authedFetch } from '../../utils/authed-fetch';
import { EVAL_RUNS_LIMIT, getEvalRun, listEvalRuns } from '../../services/admin-service';

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

const RUN_ID = '6f1c0a52-9d1e-4c4b-8a3f-2b7d0e9c1a55';

/** GET /admin/eval-runs as admin_issues.list_eval_runs answers it. */
const LIST = {
  runs: [
    {
      id: RUN_ID,
      run_at: '2026-10-08T04:42:00+00:00',
      live: true,
      scope: 'whole',
      trigger: 'manual',
      build_sha: '7ddaa27',
      prompt_version: '7c19e0d2',
      n_cases: 20,
      counts: { ok: 5, red_as_labeled: 14, regression: 1, flaky: 0, crashed: 0 },
      gate: { state: 'blocked', reasons: [] },
      score: 54.2,
      weights_version: '3f2a1b9c0d4e',
      score_areas: [],
      score_delta: -1,
      compared_with: null,
      areas_down: [],
      judge: null,
    },
  ],
  total: 1,
  gate_run_id: RUN_ID,
  schedule: { text: 'Nightly live suite, 6:00 AM PT', next_run_at: '2026-10-08T13:00:00+00:00', runner: 'a Mac' },
};

describe('eval runs service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('lists the newest 20 runs and the schedule', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, LIST));
    const res = await listEvalRuns();
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/eval-runs?limit=20`, expect.any(Object));
    expect(EVAL_RUNS_LIMIT).toBe(20);
    expect(res.runs[0].id).toBe(RUN_ID);
    expect(res.schedule?.text).toBe('Nightly live suite, 6:00 AM PT');

    fetchMock.mockResolvedValueOnce(reply(200, LIST));
    await listEvalRuns(50);
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE_URL}/admin/eval-runs?limit=50`, expect.any(Object));
  });

  it('reads one run by its id, escaped', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ...LIST.runs[0], cases: { regressions: [], red_as_labeled: [], ok: [] } }));
    const run = await getEvalRun(RUN_ID);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/admin/eval-runs/${RUN_ID}`, expect.any(Object));
    expect(run.cases?.ok).toEqual([]);

    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await getEvalRun('a/b c');
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE_URL}/admin/eval-runs/a%2Fb%20c`, expect.any(Object));
  });

  it('reads a bare 404 as a route that is not deployed yet', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { detail: 'Not Found' }));
    await expect(listEvalRuns()).rejects.toMatchObject({ name: 'AdminApiError', kind: 'not_deployed', status: 404 });
    fetchMock.mockResolvedValueOnce(reply(404, {}));
    await expect(getEvalRun(RUN_ID)).rejects.toMatchObject({ name: 'AdminApiError', kind: 'not_deployed' });
  });

  it('reads a 404 with a reason as a run that is gone, never as an empty list', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { detail: 'Eval run not found' }));
    await expect(getEvalRun(RUN_ID)).rejects.toMatchObject({
      name: 'AdminApiError',
      kind: 'not_found',
      message: 'Eval run not found',
    });
  });

  it('reads a 403 as not an admin, on both reads', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { detail: 'Admin only' }));
    await expect(listEvalRuns()).rejects.toMatchObject({ name: 'AdminApiError', kind: 'forbidden', status: 403 });
    fetchMock.mockResolvedValueOnce(reply(403, { detail: 'Admin only' }));
    await expect(getEvalRun(RUN_ID)).rejects.toMatchObject({ name: 'AdminApiError', kind: 'forbidden', status: 403 });
  });
});
