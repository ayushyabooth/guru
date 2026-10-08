/**
 * Issues tab (GUR-271): the two reads the tab and the eval case detail make, and the graded eval
 * score's words (GUR-268) on the gate card and the case view.
 * authedFetch is mocked, so no request leaves the test.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { API_BASE_URL } from '../../constants/config';
import { authedFetch } from '../../utils/authed-fetch';
import {
  EvalScore,
  asEvalScore,
  caseScoreText,
  evalScoreAreas,
  evalScoreLine,
  getIssues,
  getLatestEvalRun,
  judgeMeansText,
} from '../../services/admin-service';

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

// ─── The eval score (GUR-268) ────────────────────────────────────────────

/** gate.score the way GET /admin/issues sends it (admin_issues._score). */
const SCORE: EvalScore = {
  topline: 58.4,
  baseline: 55.2,
  delta: 3,
  weights_version: '3f2a1b9c0d4e',
  areas: [
    { key: 'quality', label: 'quality', weight: 35, score: 81.0, baseline: 80.0 },
    { key: 'safety', label: 'safety & consent', weight: 25, score: 22.0, baseline: 22.0 },
    { key: 'robustness', label: 'robustness', weight: 15, score: 40.0, baseline: 47.0 },
    { key: 'journey', label: 'journey', weight: 10, score: 66.7, baseline: 66.7 },
    { key: 'ui', label: 'generated UI', weight: 10, score: 85.0, baseline: 75.0 },
    { key: 'latency', label: 'latency', weight: 5, score: 54.0, baseline: 54.0 },
    { key: 'report', label: 'report a bug', weight: 0, score: 100.0, baseline: null },
  ],
};

describe('the eval score', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('reaches the gate card and the case view through both reads', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ...ISSUES, gate: { ...ISSUES.gate, score: SCORE } }));
    const res = await getIssues(7, 'all');
    expect(asEvalScore(res.gate.score)).toEqual(SCORE);
    fetchMock.mockResolvedValueOnce(
      reply(200, { id: 'r1', run_at: '2026-10-07T23:41:00Z', score: SCORE, cases: [{ id: 'INJ-01', score: 20 }] }),
    );
    const run = await getLatestEvalRun();
    expect(run?.score?.topline).toBe(58.4);
    expect(caseScoreText(run?.cases[0].score)).toBe('Case score 20/100');
  });

  it('reads as the frame does: the score against the baseline, then the weighted areas', () => {
    expect(evalScoreLine(SCORE)).toBe('Eval score 58/100 · +3 vs baseline');
    expect(evalScoreLine({ ...SCORE, topline: 52.6, delta: -4 })).toBe('Eval score 53/100 · -4 vs baseline');
    expect(evalScoreLine({ ...SCORE, delta: 0 })).toBe('Eval score 58/100 · +0 vs baseline');
    expect(evalScoreLine({ ...SCORE, baseline: null, delta: null })).toBe('Eval score 58/100');
    // Report a bug carries no weight, so it isn't listed; an area that didn't run isn't either.
    expect(evalScoreAreas(SCORE)).toBe(
      'quality 81 · safety & consent 22 · robustness 40 · journey 67 · generated UI 85 · latency 54',
    );
    expect(evalScoreAreas({ ...SCORE, areas: [{ ...SCORE.areas[0], score: null }] })).toBeNull();
  });

  it('keeps the null state for a run without a score, or a server older than the score', () => {
    expect(asEvalScore(null)).toBeNull();
    expect(asEvalScore(undefined)).toBeNull();
    expect(asEvalScore(58)).toBeNull(); // never a bare number
    expect(caseScoreText(undefined)).toBeNull();
    expect(caseScoreText(null)).toBeNull();
    expect(caseScoreText(66.7)).toBe('Case score 67/100');
  });

  it("shows the judge's five dimensions in its order, skipping any it didn't score", () => {
    expect(judgeMeansText({ voice: 3.0, consent: 4.0, honesty: 4.5, completeness: 5.0, faithfulness: 4.7 })).toBe(
      'Faithfulness 4.7  ·  Completeness 5.0  ·  Honesty 4.5  ·  Consent 4.0  ·  Voice 3.0',
    );
    expect(judgeMeansText({ faithfulness: null, completeness: 5, honesty: 4, consent: 4, voice: 3 })).toBe(
      'Completeness 5.0  ·  Honesty 4.0  ·  Consent 4.0  ·  Voice 3.0',
    );
    // A version 1 run: what it shares with version 2, in version 2's order. Journey is no longer a dimension.
    expect(judgeMeansText({ voice: 4.7, honesty: 5.0, journey: 4.3 })).toBe('Honesty 5.0  ·  Voice 4.7');
    expect(judgeMeansText({})).toBeNull();
    expect(judgeMeansText(null)).toBeNull();
  });
});
