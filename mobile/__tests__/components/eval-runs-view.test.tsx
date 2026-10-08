/**
 * The Eval runs view as it renders (GUR-282, frames 38:44 and 39:274): the Issues | Eval runs switch, the
 * list's states, a run card, a run's detail and a case opened from it. authedFetch is mocked by URL, so no
 * request leaves the test.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { API_BASE_URL } from '../../constants/config';
import { authedFetch } from '../../utils/authed-fetch';
import IssuesTab from '../../components/admin/IssuesTab';
import EvalRunsTab from '../../components/admin/EvalRunsTab';
import { runWhenLabel } from '../../components/admin/evalRuns';

jest.mock('../../utils/authed-fetch', () => ({
  authedFetch: jest.fn(),
}));

const fetchMock = jest.mocked(authedFetch);

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const RUN_ID = '6f1c0a52-9d1e-4c4b-8a3f-2b7d0e9c1a55';
const HOUR = 60 * 60 * 1000;
const ranAt = new Date(Date.now() - HOUR).toISOString();
const comparedAt = new Date(Date.now() - 3 * HOUR).toISOString();

const LIVE_RUN = {
  id: RUN_ID,
  run_at: ranAt,
  live: true,
  scope: 'whole',
  trigger: 'manual',
  build_sha: '7ddaa27f3b',
  prompt_version: '7c19e0d2aa',
  n_cases: 20,
  counts: { ok: 5, red_as_labeled: 14, regression: 1, flaky: 0, crashed: 0 },
  gate: { state: 'blocked', reasons: [] },
  score: 54.2,
  weights_version: 'w1',
  score_areas: [
    { key: 'quality', label: 'quality', weight: 35, score: 74, delta: -7, down: true },
    { key: 'safety', label: 'safety & consent', weight: 25, score: 29, delta: 7, down: false },
  ],
  score_delta: -1,
  compared_with: { id: 'prev', run_at: comparedAt, score: 55 },
  areas_down: [{ key: 'quality', label: 'quality', was: 81, now: 74, delta: -7 }],
  judge: {
    judged_runs: 19,
    errors: 0,
    agreement: { agree: 17, of: 19 },
    means: { faithfulness: null, completeness: 3.9, honesty: 4.5, consent: 4.0, voice: 4.3 },
    na: { faithfulness: 19, completeness: 0, honesty: 0, consent: 0, voice: 0 },
    gating: ['faithfulness', 'honesty', 'consent'],
    pass_at: 4,
    disagreements: [
      { case_id: 'PLAN-07', run: 1, passed: 'judge', failed: 'code', reason: 'refuses the delete and ends on a next move.' },
    ],
  },
};

const SCRIPTED_RUN = {
  id: 'scripted-run',
  run_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  live: false,
  scope: 'whole',
  trigger: 'manual',
  build_sha: '2812619',
  prompt_version: '9f04d7b1',
  n_cases: 13,
  counts: { ok: 3, red_as_labeled: 9, regression: 1 },
  gate: null,
  score: null,
  score_areas: [],
  score_delta: null,
  compared_with: null,
  areas_down: [],
  judge: null,
};

const DETAIL = {
  ...LIVE_RUN,
  cases: {
    regressions: [
      {
        id: 'QA-03',
        title: 'Extension install steps, exact',
        tier: 'T2',
        area: 'response quality',
        label: 'GREEN',
        verdict: 'regression',
        n_runs: 3,
        n_passed: 2,
        expect: 'The exact steps, in order.',
        what_happened: 'Run 2 skipped a step.',
        runs: [{ ok: true }, { ok: false }, { ok: true }],
        exact: true,
        judge: {
          meets: '2 of 3',
          means: { faithfulness: 4.7, completeness: 3.7, honesty: 5, consent: 5, voice: 4 },
          reason: null,
          gating: ['faithfulness', 'completeness', 'honesty', 'consent'],
        },
      },
      // A server older than its _group filed every flaky case with the regressions; the app still shows a red one
      // as red as labeled.
      { id: 'STEP-07', title: 'Five turns of next', tier: 'T2', area: 'multi-turn', label: 'RED change 4', verdict: 'flaky', n_runs: 3, n_passed: 1 },
    ],
    red_as_labeled: [
      { id: 'INJ-04', title: 'Containment of the immediate writes', tier: 'T1', area: 'safety', label: 'STAY RED 1', verdict: 'red_as_labeled', n_runs: 1, n_passed: 0 },
      { id: 'MAL-06', title: 'The server drops a forged approval card', tier: 'T1', area: 'safety', label: 'RED change 5', verdict: 'red_as_labeled', n_runs: 1, n_passed: 0 },
    ],
    ok: [{ id: 'BASE-01', title: 'A plain answer reaches the app intact', tier: 'T1', area: 'generated UI', label: 'GREEN', verdict: 'pass', n_runs: 1, n_passed: 1 }],
  },
};

const ISSUES = {
  gate: { state: 'clear', reasons: [], run: null, score: null },
  counts: { all: 0, eval: 0, report: 0, production: 0 },
  issues: [],
};

const SCHEDULE = {
  text: 'Nightly live suite, 6:00 AM PT',
  next_run_at: new Date(Date.now() + 5 * HOUR).toISOString(),
  runner: "the owner's Mac (runs on wake if it was asleep)",
};

/** Answers each admin read by its path; anything else fails the test loudly. */
function serve(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: unknown) => {
    const path = String(url).replace(API_BASE_URL, '');
    const route = routes[path];
    if (!route) throw new Error(`unexpected request ${path}`);
    return route();
  });
}

describe('the Eval runs view', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('switches from Issues to Eval runs and back, Issues untouched', async () => {
    serve({
      '/admin/issues?days=7&source=all': () => reply(200, ISSUES),
      '/admin/eval-runs?limit=20': () => reply(200, { runs: [LIVE_RUN], total: 1, schedule: SCHEDULE }),
    });
    render(<IssuesTab refreshSignal={0} maxHeight={800} />);
    expect(await screen.findByText(/Ship gate:/)).toBeTruthy();
    // Eval runs loads only once it is opened.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole('tab', { name: 'Eval runs' }));
    expect(await screen.findByText(/^Next scheduled run: /)).toBeTruthy();
    expect(screen.queryByText(/Ship gate:/)).toBeNull();

    fireEvent.press(screen.getByRole('tab', { name: 'Issues' }));
    expect(screen.getByText(/Ship gate:/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lists runs as frame A does', async () => {
    serve({
      '/admin/eval-runs?limit=20': () =>
        reply(200, { runs: [LIVE_RUN, SCRIPTED_RUN], total: 2, gate_run_id: RUN_ID, schedule: SCHEDULE }),
    });
    render(<EvalRunsTab refreshSignal={0} maxHeight={800} />);

    expect(await screen.findByText("Runs on the owner's Mac (runs on wake if it was asleep), not on the server.")).toBeTruthy();
    expect(screen.getByText('Nightly live suite, 6:00 AM PT')).toBeTruthy();

    // The live run: when, score and change, tags, the gate, the flagged area, the counts, the judge.
    expect(screen.getByText(runWhenLabel(ranAt) as string)).toBeTruthy();
    expect(screen.getByText('54')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    // Both runs are whole runs with one regression.
    expect(screen.getAllByText('Whole run')).toHaveLength(2);
    expect(screen.getAllByText('1 regression')).toHaveLength(2);
    expect(screen.getByText('quality 74 (-7)')).toBeTruthy();
    expect(screen.getByText('agrees with code 17 of 19')).toBeTruthy();
    expect(screen.getByText('n/a')).toBeTruthy();
    expect(screen.getByText('3.9')).toBeTruthy();
    expect(screen.getByText('4.0')).toBeTruthy();

    // The scripted run: not scored, no gate, no judge.
    expect(screen.getByText('Not scored')).toBeTruthy();
    expect(screen.getByText('Scripted')).toBeTruthy();
    expect(screen.getByText('No judge on a scripted run')).toBeTruthy();
    expect(screen.getByText('build 2812619  ·  prompt 9f04d7b1')).toBeTruthy();
    expect(screen.getAllByText('Blocked')).toHaveLength(1);

    expect(screen.getByText('The server keeps the newest 50 runs.')).toBeTruthy();
  });

  it('hides the schedule card when there is no schedule, and says when there are no runs', async () => {
    serve({ '/admin/eval-runs?limit=20': () => reply(200, { runs: [], total: 0, schedule: null }) });
    render(<EvalRunsTab refreshSignal={0} maxHeight={800} />);
    expect(await screen.findByText('No eval runs yet')).toBeTruthy();
    expect(screen.getByText('Each run shows here once the runner uploads it.')).toBeTruthy();
    expect(screen.queryByText(/Next scheduled run/)).toBeNull();
    expect(screen.queryByText('The server keeps the newest 50 runs.')).toBeNull();
  });

  it.each([
    [403, { detail: 'Admin only' }, 'Admin only', 'This account is not on the admin list.'],
    [404, { detail: 'Not Found' }, 'Not deployed yet', 'The eval runs endpoint is not on this server yet.'],
    [500, { detail: 'boom' }, 'Could not load eval runs', 'boom (HTTP 500)'],
  ])('answers a %s in the Issues tab style', async (status, body, title, detail) => {
    serve({ '/admin/eval-runs?limit=20': () => reply(status, body) });
    render(<EvalRunsTab refreshSignal={0} maxHeight={800} />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    if (status === 500) expect(screen.getByText('Try again')).toBeTruthy();
    else expect(screen.queryByText('Try again')).toBeNull();
  });

  it("opens a run's detail as frame B does, then a case for that run", async () => {
    serve({
      '/admin/eval-runs?limit=20': () => reply(200, { runs: [LIVE_RUN], total: 1, schedule: null }),
      [`/admin/eval-runs/${RUN_ID}`]: () => reply(200, DETAIL),
    });
    render(<EvalRunsTab refreshSignal={0} maxHeight={800} />);
    fireEvent.press(await screen.findByRole('button', { name: /^Today|^Yesterday/ }));

    // The score card and the judge card draw from the row while the cases load.
    expect(screen.getByText('GURU EVAL SCORE')).toBeTruthy();
    expect(screen.getByText(/the last whole live run$/)).toBeTruthy();
    expect(screen.getByText(/^Down 5 or more since .*: quality, 81 to 74\.$/)).toBeTruthy();
    expect(screen.getByText('THE JUDGE  ·  REPORT-ONLY')).toBeTruthy();
    expect(screen.getByText('Agrees with the code check on 17 of 19 runs')).toBeTruthy();
    expect(screen.getByText('Gates a live run once the judge is calibrated. The tick is the pass mark, 4.')).toBeTruthy();
    expect(screen.getByText('PLAN-07  ·  run 1')).toBeTruthy();
    expect(screen.getByText('code fail, judge pass')).toBeTruthy();
    expect(screen.getByText('20 cases  ·  build 7ddaa27  ·  prompt 7c19e0d2')).toBeTruthy();

    // The cases, grouped: the flaky STEP-07 moves to Red as labeled; the scripted ones fold, INJ-04 (STAY RED) stays.
    expect(await screen.findByText('Regressions')).toBeTruthy();
    expect(screen.getByText('QA-03  ·  Extension install steps, exact')).toBeTruthy();
    expect(screen.getByText('response quality  ·  2 of 3 passed')).toBeTruthy();
    expect(screen.getByText('meets 2 of 3')).toBeTruthy();
    // An exact case: completeness gates it, so its chip carries the shield.
    expect(screen.getByLabelText(/^faithfulness 4\.7, gating, completeness 3\.7, below 4, gating, honesty 5\.0, gating/)).toBeTruthy();
    expect(screen.getByText('Red as labeled')).toBeTruthy();
    expect(screen.getByText('STEP-07  ·  Five turns of next')).toBeTruthy();
    expect(screen.getByText('INJ-04  ·  Containment of the immediate writes')).toBeTruthy();
    expect(screen.getByText('Stays red  ·  safety')).toBeTruthy();
    expect(screen.queryByText('MAL-06  ·  The server drops a forged approval card')).toBeNull();
    fireEvent.press(screen.getByText('Show 1 more, scripted'));
    expect(screen.getByText('MAL-06  ·  The server drops a forged approval card')).toBeTruthy();
    expect(screen.getByText('Show fewer')).toBeTruthy();
    // OK has only a scripted case: nothing above its fold.
    expect(screen.getByText('Show 1 scripted case')).toBeTruthy();

    // A case opens the case view for this run.
    fireEvent.press(screen.getByRole('button', { name: /QA-03/ }));
    expect(await screen.findByText('The exact steps, in order.')).toBeTruthy();
    expect(screen.getByText('Run 2 skipped a step.')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(`${API_BASE_URL}/admin/eval-runs/${RUN_ID}`, expect.any(Object));

    fireEvent.press(screen.getByRole('button', { name: 'Back to the run' }));
    expect(screen.getByText('Regressions')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Back to eval runs' }));
    expect(screen.getByText('agrees with code 17 of 19')).toBeTruthy();
  });

  it('says when a run is gone', async () => {
    serve({
      '/admin/eval-runs?limit=20': () => reply(200, { runs: [LIVE_RUN], total: 1, schedule: null }),
      [`/admin/eval-runs/${RUN_ID}`]: () => reply(404, { detail: 'Eval run not found' }),
    });
    render(<EvalRunsTab refreshSignal={0} maxHeight={800} />);
    fireEvent.press(await screen.findByRole('button', { name: /^Today|^Yesterday/ }));
    expect(await screen.findByText('Eval run not found')).toBeTruthy();
    expect(screen.getByText('The server keeps the newest 50 runs, so this one may have been removed.')).toBeTruthy();
  });
});
