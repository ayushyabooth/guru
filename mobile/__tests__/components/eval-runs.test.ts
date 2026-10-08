/**
 * The words and rules of the Eval runs view (GUR-282, frames 38:44 and 39:274): when a run ran, the
 * dimension chips (red below 4, never at 4.0, n/a), the 5-point area flag, how a run's cases group and
 * fold, and the lines the cards print. Pure helpers, so nothing renders. Times are built in local time,
 * so the labels hold in any time zone.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { EvalRunCase, EvalRunRow } from '../../services/admin-service';
import {
  AREA_DROP,
  Part,
  areaParts,
  areaReads,
  areasDown,
  asCaseResult,
  caseGating,
  caseGroup,
  caseMeta,
  caseStatus,
  caseTitle,
  comparedLine,
  countParts,
  deltaText,
  deltaTone,
  dimChips,
  dimRead,
  downLine,
  folds,
  gateTag,
  groupCases,
  judgeHeadline,
  judgeShort,
  keepLine,
  meetsText,
  nextRunLabel,
  runTags,
  runWhenLabel,
  scheduleCopy,
  scoreRead,
  showMoreLabel,
  splitGroup,
  splitSides,
  splitWhich,
  spokenDim,
  versionsLine,
} from '../../components/admin/evalRuns';

// The helpers import the service module for the dimension order; no request leaves the test.
jest.mock('../../utils/authed-fetch', () => ({ authedFetch: jest.fn() }));

/** Wednesday 7 October 2026, 10:00 PM local: the frames' "today". */
const NOW = new Date(2026, 9, 7, 22, 0);

function at(y: number, mo: number, d: number, h: number, mi: number): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

/** The line as it reads, flagged parts in [brackets] and faint ones in {braces}. */
function read(parts: Part[]): string {
  return parts.map((p) => (p.tone === 'flag' ? `[${p.text}]` : p.tone === 'faint' ? `{${p.text}}` : p.text)).join('');
}

/** The 9:42 PM run in frame A: live, manual, whole, blocked, quality down 7. */
const RUN: EvalRunRow = {
  id: '6f1c0a52-0000-4000-8000-000000000001',
  run_at: at(2026, 9, 7, 21, 42),
  live: true,
  scope: 'whole',
  trigger: 'manual',
  build_sha: '7ddaa27f3b1e',
  prompt_version: '7c19e0d2a1b2c3',
  n_cases: 20,
  counts: { ok: 5, red_as_labeled: 14, regression: 1, flaky: 0, crashed: 0 },
  gate: { state: 'blocked', reasons: [] },
  score: 54.2,
  weights_version: '3f2a1b9c0d4e',
  score_areas: [
    { key: 'quality', label: 'quality', weight: 35, score: 74.0, delta: -7 },
    { key: 'safety', label: 'safety & consent', weight: 25, score: 29.0, delta: 7 },
    { key: 'robustness', label: 'robustness', weight: 15, score: 31.0, delta: 0 },
    { key: 'journey', label: 'journey', weight: 10, score: 83.3, delta: 0 },
    { key: 'ui', label: 'generated UI', weight: 10, score: 50.0, delta: 0 },
    { key: 'latency', label: 'latency', weight: 5, score: 65.0, delta: 0 },
  ],
  score_delta: -1,
  compared_with: { id: 'prev', run_at: at(2026, 9, 7, 6, 0), score: 55 },
  areas_down: [{ key: 'quality', label: 'quality', was: 81, now: 74, delta: -7 }],
  judge: {
    judged_runs: 19,
    errors: 0,
    agreement: { agree: 17, of: 19 },
    means: { faithfulness: 4.5, completeness: 3.9, honesty: 4.5, consent: 3.6, voice: 4.3 },
    na: { faithfulness: 0, completeness: 0, honesty: 0, consent: 0, voice: 0 },
    gating: ['faithfulness', 'honesty', 'consent'],
    pass_at: 4,
    disagreements: [],
  },
};

function kase(over: Partial<EvalRunCase> & { id: string }): EvalRunCase {
  return { tier: 'T2', area: 'safety', label: 'RED change 4', verdict: 'red_as_labeled', n_runs: 3, n_passed: 1, ...over };
}

// ─── When ────────────────────────────────────────────────────────────────

describe('when a run ran', () => {
  it('reads Today, Yesterday, the weekday within the week, then the date', () => {
    expect(runWhenLabel(at(2026, 9, 7, 21, 42), NOW)).toBe('Today 9:42 PM');
    expect(runWhenLabel(at(2026, 9, 7, 0, 5), NOW)).toBe('Today 12:05 AM');
    expect(runWhenLabel(at(2026, 9, 7, 12, 0), NOW)).toBe('Today 12:00 PM');
    expect(runWhenLabel(at(2026, 9, 6, 6, 0), NOW)).toBe('Yesterday 6:00 AM');
    expect(runWhenLabel(at(2026, 9, 5, 15, 20), NOW)).toBe('Mon 3:20 PM');
    expect(runWhenLabel(at(2026, 9, 1, 9, 0), NOW)).toBe('Thu 9:00 AM');
    // A week back the weekday would be ambiguous: the date instead.
    expect(runWhenLabel(at(2026, 8, 30, 9, 0), NOW)).toBe('Sep 30, 9:00 AM');
    expect(runWhenLabel(at(2025, 9, 7, 9, 0), NOW)).toBe('Oct 7, 9:00 AM');
  });

  it('counts calendar days, not 24-hour spans', () => {
    // 11:50 PM yesterday is under a day before 12:10 AM today, and still yesterday.
    expect(runWhenLabel(at(2026, 9, 6, 23, 50), new Date(2026, 9, 7, 0, 10))).toBe('Yesterday 11:50 PM');
  });

  it('has no label without a readable time', () => {
    expect(runWhenLabel(null, NOW)).toBeNull();
    expect(runWhenLabel(undefined, NOW)).toBeNull();
    expect(runWhenLabel('', NOW)).toBeNull();
    expect(runWhenLabel('not a time', NOW)).toBeNull();
  });

  it('says the next scheduled run by its weekday, as frame A does, or Today', () => {
    expect(nextRunLabel(at(2026, 9, 8, 6, 0), NOW)).toBe('Thu 6:00 AM');
    expect(nextRunLabel(at(2026, 9, 7, 23, 0), NOW)).toBe('Today 11:00 PM');
    expect(nextRunLabel(at(2026, 9, 20, 6, 0), NOW)).toBe('Oct 20, 6:00 AM');
    expect(nextRunLabel(null, NOW)).toBeNull();
  });
});

describe('the schedule card', () => {
  it('reads the next run, the schedule and where it runs', () => {
    const copy = scheduleCopy(
      {
        text: 'Nightly live suite, 6:00 AM PT',
        next_run_at: at(2026, 9, 8, 6, 0),
        runner: "the owner's Mac (runs on wake if it was asleep)",
      },
      NOW,
    );
    expect(copy).toEqual({
      title: 'Next scheduled run: Thu 6:00 AM',
      text: 'Nightly live suite, 6:00 AM PT',
      runner: "Runs on the owner's Mac (runs on wake if it was asleep), not on the server.",
    });
  });

  it('still reads without a time or a runner', () => {
    expect(scheduleCopy({ text: 'Nightly live suite' }, NOW)).toEqual({
      title: 'Next scheduled run',
      text: 'Nightly live suite',
      runner: 'Runs on a schedule, not on the server.',
    });
  });

  it('says how many show when the server keeps more than the list asked for', () => {
    expect(keepLine(5, 5)).toBe('The server keeps the newest 50 runs.');
    expect(keepLine(5, null)).toBe('The server keeps the newest 50 runs.');
    expect(keepLine(20, 35)).toBe('Showing the newest 20 of 35. The server keeps the newest 50 runs.');
  });
});

// ─── A run card ──────────────────────────────────────────────────────────

describe('a run card', () => {
  it('tags what the run is, in the frame order', () => {
    expect(runTags(RUN)).toEqual(['Live', 'Manual', 'Whole run']);
    expect(runTags({ id: 'b', live: true, trigger: 'demo', scope: 'partial', n_cases: 3 })).toEqual([
      'Live',
      'Demo',
      'Partial: 3 cases',
    ]);
    expect(runTags({ id: 'c', live: false, trigger: 'scheduled', scope: 'partial', n_cases: 1 })).toEqual([
      'Scripted',
      'Scheduled',
      'Partial: 1 case',
    ]);
    // An older run: what it has, nothing invented. A value this build doesn't know reads plainly.
    expect(runTags({ id: 'd' })).toEqual([]);
    expect(runTags({ id: 'e', trigger: 'ci_nightly' })).toEqual(['Ci nightly']);
  });

  it('shows the gate only when the server sends one: whole live runs', () => {
    expect(gateTag(RUN)).toEqual({ label: 'Blocked', tone: 'bad' });
    expect(gateTag({ ...RUN, gate: { state: 'clear' } })).toEqual({ label: 'Clear', tone: 'good' });
    expect(gateTag({ ...RUN, gate: null })).toBeNull();
    expect(gateTag({ id: 'old' })).toBeNull();
  });

  it('reads the score with its change, "not compared" on a partial run, or not scored', () => {
    expect(scoreRead(RUN)).toEqual({ value: 54, delta: -1, notCompared: false });
    expect(scoreRead({ ...RUN, scope: 'partial', score: 80, score_delta: null })).toEqual({
      value: 80,
      delta: null,
      notCompared: true,
    });
    // A whole run with nothing to compare (frame A's Yesterday 6:00 AM): no tag, no "not compared".
    expect(scoreRead({ ...RUN, score: 52, score_delta: null })).toEqual({ value: 52, delta: null, notCompared: false });
    expect(scoreRead({ id: 'scripted', score: null })).toEqual({ value: null, delta: null, notCompared: false });
    expect([deltaText(3), deltaText(-1), deltaText(0)]).toEqual(['+3', '-1', '0']);
    expect([deltaTone(3), deltaTone(-1), deltaTone(0)]).toEqual(['good', 'bad', 'muted']);
  });

  it('flags an area that fell 5 or more, with its change, and no other', () => {
    expect(read(areaParts(RUN))).toBe(
      '[quality 74 (-7)] · safety & consent 29 · robustness 31 · journey 83 · generated UI 50 · latency 65',
    );
    const reads = areaReads({
      id: 'x',
      score_areas: [
        { key: 'a', label: 'a', score: 60, delta: -AREA_DROP },
        { key: 'b', label: 'b', score: 60, delta: -4 },
        { key: 'c', label: 'c', score: 60, delta: null },
        { key: 'd', label: 'd', score: 60, delta: 9 },
      ],
    });
    expect(reads.map((a) => [a.key, a.flagged])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', false],
    ]);
  });

  it('lists the areas a partial run did not reach, faint, and never a weightless one', () => {
    const partial: EvalRunRow = {
      id: 'p',
      score_areas: [
        { key: 'quality', label: 'quality', weight: 35, score: 80, delta: null },
        { key: 'safety', label: 'safety & consent', weight: 25, score: 80, delta: null },
        { key: 'robustness', label: 'robustness', weight: 15, score: null },
        { key: 'journey', label: 'journey', weight: 10, score: null },
        { key: 'report', label: 'report a bug', weight: 0, score: 100 },
      ],
    };
    expect(read(areaParts(partial))).toBe('quality 80 · safety & consent 80 · {not run: robustness, journey}');
    expect(areaParts({ id: 'none' })).toEqual([]);
  });

  it("takes the server's own flag on an area over its change", () => {
    const reads = areaReads({
      id: 'f',
      score_areas: [
        { key: 'a', label: 'a', score: 60, delta: -4, down: true },
        { key: 'b', label: 'b', score: 60, delta: -9, down: false },
      ],
    });
    expect(reads.map((a) => [a.key, a.flagged])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('reads an area as flagged from the server list when the area itself has no change', () => {
    const run: EvalRunRow = {
      id: 'y',
      score_areas: [{ key: 'journey', label: 'journey', score: 67 }],
      areas_down: [{ key: 'journey', label: 'journey', was: 83, now: 67, delta: -16 }],
    };
    expect(read(areaParts(run))).toBe('[journey 67 (-16)]');
  });

  it('counts by the grouping rules, a regression and a crash in red, ok always', () => {
    expect(read(countParts(RUN.counts))).toBe('5 ok  ·  14 red as labeled  ·  [1 regression]');
    expect(read(countParts({ ok: 6, red_as_labeled: 14 }))).toBe('6 ok  ·  14 red as labeled');
    // A flaky case is red as labeled; a crash counts on its own, in red.
    expect(read(countParts({ ok: 3, red_as_labeled: 8, flaky: 1, regression: 2, crashed: 1 }))).toBe(
      '3 ok  ·  9 red as labeled  ·  [2 regressions]  ·  [1 crashed]',
    );
    expect(read(countParts({}))).toBe('0 ok');
    expect(countParts(null)).toEqual([]);
  });

  it('reads the judge line, and the build and prompt', () => {
    expect(judgeShort(RUN.judge)).toBe('agrees with code 17 of 19');
    // An older run kept no agreement: how many runs it graded.
    expect(judgeShort({ judged_runs: 19, agreement: null })).toBe('graded 19 runs');
    expect(judgeShort({ judged_runs: 0 })).toBeNull();
    expect(judgeShort(null)).toBeNull();
    expect(judgeHeadline(RUN.judge)).toBe('Agrees with the code check on 17 of 19 runs');
    expect(judgeHeadline({ judged_runs: 1 })).toBe('Graded 1 run');
    expect(versionsLine(RUN)).toBe('build 7ddaa27  ·  prompt 7c19e0d2');
    expect(versionsLine(RUN, true)).toBe('20 cases  ·  build 7ddaa27  ·  prompt 7c19e0d2');
    expect(versionsLine({ id: 'z' })).toBeNull();
  });
});

// ─── The judge's chips ───────────────────────────────────────────────────

describe("the judge's dimension chips", () => {
  it('turns red only when the one-decimal value shown is under 4, so 4.0 is never red', () => {
    expect(dimRead(4)).toEqual({ value: '4.0', state: 'pass' });
    expect(dimRead(4.0)).toEqual({ value: '4.0', state: 'pass' });
    expect(dimRead(3.96)).toEqual({ value: '4.0', state: 'pass' });
    expect(dimRead(3.94)).toEqual({ value: '3.9', state: 'below' });
    expect(dimRead(3.6)).toEqual({ value: '3.6', state: 'below' });
    expect(dimRead(5)).toEqual({ value: '5.0', state: 'pass' });
    expect(dimRead(1)).toEqual({ value: '1.0', state: 'below' });
  });

  it('shows n/a where there is no number', () => {
    for (const v of [null, undefined, Number.NaN, '4.5']) {
      expect(dimRead(v)).toEqual({ value: 'n/a', state: 'na' });
    }
  });

  it('gives all five in the judge order, the gating three marked', () => {
    const chips = dimChips(RUN.judge?.means, { gating: RUN.judge?.gating, passAt: RUN.judge?.pass_at });
    expect(chips).toEqual([
      { key: 'faithfulness', value: '4.5', state: 'pass', gating: true },
      { key: 'completeness', value: '3.9', state: 'below', gating: false },
      { key: 'honesty', value: '4.5', state: 'pass', gating: true },
      { key: 'consent', value: '3.6', state: 'below', gating: true },
      { key: 'voice', value: '4.3', state: 'pass', gating: false },
    ]);
  });

  it("marks n/a per dimension, and falls back to the judge's own gating and pass mark", () => {
    // Frame B's PLAN-07: faithfulness n/a, completeness 3.7, consent at exactly 4.0.
    const chips = dimChips({ faithfulness: null, completeness: 3.7, honesty: 4.7, consent: 4.0, voice: 4.3 });
    expect(chips.map((c) => `${c.key} ${c.value} ${c.state}${c.gating ? ' gating' : ''}`)).toEqual([
      'faithfulness n/a na gating',
      'completeness 3.7 below',
      'honesty 4.7 pass gating',
      'consent 4.0 pass gating',
      'voice 4.3 pass',
    ]);
    // An older case summary: what it never scored is n/a.
    expect(dimChips({ voice: 4.7, honesty: 5.0, journey: 4.3 }).map((c) => c.value)).toEqual([
      'n/a',
      'n/a',
      '5.0',
      'n/a',
      '4.7',
    ]);
    expect(dimChips(null).every((c) => c.state === 'na')).toBe(true);
  });

  it('says each chip plainly to a screen reader', () => {
    const [faith, complete] = dimChips(RUN.judge?.means);
    expect(spokenDim(faith)).toBe('faithfulness 4.5, gating');
    expect(spokenDim(complete)).toBe('completeness 3.9, below 4');
    expect(spokenDim(dimChips({ faithfulness: null })[0])).toBe('faithfulness, not applicable, gating');
  });

  it('reads where the judge and the code split, with both sides', () => {
    expect(splitSides({ passed: 'judge', failed: 'code' })).toBe('code fail, judge pass');
    expect(splitSides({ passed: 'code', failed: 'judge' })).toBe('code pass, judge fail');
    // Either side alone is enough; an older run kept neither.
    expect(splitSides({ failed: 'code' })).toBe('code fail, judge pass');
    expect(splitSides({ passed: 'code' })).toBe('code pass, judge fail');
    expect(splitSides({ passed: null, failed: null })).toBeNull();
    expect(splitWhich({ case_id: 'PLAN-07', run: 1 })).toBe('PLAN-07  ·  run 1');
    expect(splitWhich({ case_id: 'INJ-01', run: null })).toBe('INJ-01');
    expect(meetsText('2 of 3')).toBe('meets 2 of 3');
    expect(meetsText('2/3')).toBe('meets 2 of 3');
    expect(meetsText('')).toBeNull();
  });
});

// ─── The score card in the detail ────────────────────────────────────────

describe("a run's score card", () => {
  it('names the run it is compared with, by kind', () => {
    expect(comparedLine(RUN, NOW)).toBe('vs Today 6:00 AM, the last whole live run');
    expect(comparedLine({ ...RUN, live: false }, NOW)).toBe('vs Today 6:00 AM, the last whole scripted run');
    expect(comparedLine({ ...RUN, scope: 'partial' }, NOW)).toBe('vs Today 6:00 AM, the last live run of the same cases');
    expect(comparedLine({ ...RUN, compared_with: null }, NOW)).toBe('not compared');
  });

  it('says what fell 5 or more since the comparable run', () => {
    expect(downLine(RUN, NOW)).toBe('Down 5 or more since Today 6:00 AM: quality, 81 to 74.');
    expect(downLine({ ...RUN, areas_down: [] , score_areas: [] }, NOW)).toBeNull();
    // Without the server's list, from the areas' own changes.
    const derived = { ...RUN, areas_down: null };
    expect(areasDown(derived)).toEqual([{ key: 'quality', label: 'quality', was: 81, now: 74, delta: -7 }]);
    expect(downLine({ ...derived, compared_with: null }, NOW)).toBe('Down 5 or more: quality, 81 to 74.');
  });
});

// ─── A run's cases ───────────────────────────────────────────────────────

describe("grouping a run's cases", () => {
  it('puts a flaky case labeled RED under Red as labeled, a crash under Regressions, a NOW GREEN under OK', () => {
    expect(caseGroup(kase({ id: 'F', verdict: 'flaky', label: 'RED change 4' }))).toBe('red_as_labeled');
    expect(caseGroup(kase({ id: 'S', verdict: 'flaky', label: 'STAY RED 1' }))).toBe('red_as_labeled');
    expect(caseGroup(kase({ id: 'C', verdict: 'crashed', label: 'GREEN' }))).toBe('regressions');
    expect(caseGroup(kase({ id: 'N', verdict: 'now_green', label: 'RED change 3' }))).toBe('ok');
    expect(caseGroup(kase({ id: 'R', verdict: 'regression', label: 'GREEN' }))).toBe('regressions');
    expect(caseGroup(kase({ id: 'P', verdict: 'pass', label: 'GREEN' }))).toBe('ok');
    expect(caseGroup(kase({ id: 'L', verdict: 'red_as_labeled', label: 'STAY RED 2' }))).toBe('red_as_labeled');
    // As the server files it (admin_issues._group): flaky and not GREEN is red as labeled; a flaky GREEN case
    // (which the runner calls a regression) and anything unknown go with the regressions.
    expect(caseGroup(kase({ id: 'O', verdict: 'flaky', label: null }))).toBe('red_as_labeled');
    expect(caseGroup(kase({ id: 'G', verdict: 'flaky', label: 'GREEN' }))).toBe('regressions');
    expect(caseGroup(kase({ id: 'U', verdict: 'something_new' }))).toBe('regressions');
  });

  it("regroups the server's groups, keeping each group's order", () => {
    // A server older than its _group filed every flaky case with the regressions; the rule moves the red one.
    const groups = groupCases({
      regressions: [
        kase({ id: 'QA-03', verdict: 'regression', label: 'GREEN' }),
        kase({ id: 'STEP-07', verdict: 'flaky', label: 'RED change 4' }),
        kase({ id: 'ERR-05', verdict: 'crashed', label: 'RED change 3' }),
      ],
      red_as_labeled: [kase({ id: 'PLAN-07' }), kase({ id: 'INJ-01' })],
      ok: [kase({ id: 'PERF-01', verdict: 'pass', label: 'GREEN' }), kase({ id: 'UI-11', verdict: 'now_green' })],
    });
    expect(groups.regressions.map((c) => c.id)).toEqual(['QA-03', 'ERR-05']);
    expect(groups.red_as_labeled.map((c) => c.id)).toEqual(['STEP-07', 'PLAN-07', 'INJ-01']);
    expect(groups.ok.map((c) => c.id)).toEqual(['PERF-01', 'UI-11']);
  });

  it('survives a missing or broken group', () => {
    expect(groupCases(null)).toEqual({ regressions: [], red_as_labeled: [], ok: [] });
    const groups = groupCases({ regressions: null, red_as_labeled: [null as unknown as EvalRunCase, kase({ id: 'A' })] });
    expect(groups.red_as_labeled.map((c) => c.id)).toEqual(['A']);
  });
});

describe('folding the scripted cases', () => {
  // Frame B's 9:42 PM run: Red as labeled has 14 cases, 6 in view and 8 folded.
  const red: EvalRunCase[] = [
    kase({ id: 'INJ-04', tier: 'T1', label: 'STAY RED 1', n_runs: 1, n_passed: 0 }),
    kase({ id: 'PERF-03', tier: 'T2', area: 'latency', label: 'STAY RED 2', n_runs: 5, n_passed: 0 }),
    ...['UI-11', 'APR-06', 'APR-07', 'MAL-03', 'ERR-05', 'MAL-05', 'MAL-06', 'ERR-03'].map((id) =>
      kase({ id, tier: 'T1', label: 'RED change 3', n_runs: 1, n_passed: 0 }),
    ),
    kase({ id: 'PLAN-07', area: 'tool use', label: 'RED change 3', judge: { meets: '2 of 3', means: {}, reason: null } }),
    kase({ id: 'STEP-07', area: 'multi-turn', label: 'RED change 4', judge: { meets: '2 of 3', means: {}, reason: null } }),
    kase({ id: 'INJ-01', n_runs: 5, n_passed: 4, judge: { meets: '3 of 5', means: {}, reason: null } }),
    kase({ id: 'INJ-01C', n_runs: 5, n_passed: 3, judge: { meets: '3 of 5', means: {}, reason: null } }),
  ];

  it('folds the scripted cases the judge never read, keeping a STAY RED one in view', () => {
    const { shown, folded } = splitGroup(red, 'red_as_labeled');
    // Judged first, then live, then scripted, each in the run's own order.
    expect(shown.map((c) => c.id)).toEqual(['PLAN-07', 'STEP-07', 'INJ-01', 'INJ-01C', 'PERF-03', 'INJ-04']);
    expect(folded).toHaveLength(8);
    expect(showMoreLabel(folded.length, shown.length > 0)).toBe('Show 8 more, all scripted');
  });

  it('never folds a regression, a live case, or a scripted case the judge read', () => {
    const scripted = kase({ id: 'HIST-01', tier: 'T1', verdict: 'regression', label: 'GREEN' });
    expect(folds(scripted, 'regressions')).toBe(false);
    expect(folds(kase({ id: 'QA-03', tier: 'T2' }), 'ok')).toBe(false);
    expect(folds(kase({ id: 'X', tier: 'T1', judge: { meets: '1 of 1', means: {}, reason: null } }), 'ok')).toBe(false);
    expect(folds(kase({ id: 'BASE-01', tier: 'T1', verdict: 'pass', label: 'GREEN' }), 'ok')).toBe(true);
  });

  it('words the fold for one case, and for a group with nothing above it', () => {
    expect(showMoreLabel(1, true)).toBe('Show 1 more, scripted');
    expect(showMoreLabel(4, false)).toBe('Show 4 scripted cases');
    expect(showMoreLabel(1, false)).toBe('Show 1 scripted case');
  });
});

describe('a case row', () => {
  it('words the tag as the Issues tab does, plus the cases that passed', () => {
    expect(caseStatus(kase({ id: 'QA-03', verdict: 'regression', label: 'GREEN' }))).toEqual({
      text: 'Regression',
      tone: 'red',
    });
    expect(caseStatus(kase({ id: 'X', verdict: 'crashed' }))).toEqual({ text: 'Crashed', tone: 'red' });
    expect(caseStatus(kase({ id: 'STEP-07', label: 'RED change 4' }))).toEqual({ text: 'Red  ·  change 4', tone: 'red' });
    expect(caseStatus(kase({ id: 'INJ-04', tier: 'T1', label: 'STAY RED 1' }))).toEqual({
      text: 'Stays red  ·  safety',
      tone: 'red',
    });
    expect(caseStatus(kase({ id: 'PERF-03', area: 'latency', label: 'STAY RED 2' }))).toEqual({
      text: 'Stays red',
      tone: 'red',
    });
    // A flaky case labeled RED reads by its label, as on the Issues tab.
    expect(caseStatus(kase({ id: 'F', verdict: 'flaky', label: 'RED change 4' })).text).toBe('Red  ·  change 4');
    expect(caseStatus(kase({ id: 'PERF-01', verdict: 'pass', label: 'GREEN' }))).toEqual({ text: 'Pass', tone: 'green' });
    expect(caseStatus(kase({ id: 'N', verdict: 'now_green', label: 'RED change 3' }))).toEqual({
      text: 'Now green',
      tone: 'green',
    });
  });

  it('shows the area and passes for a live case, "scripted" for a scripted one', () => {
    expect(caseMeta(kase({ id: 'QA-03', area: 'response quality', n_runs: 3, n_passed: 2 }))).toBe(
      'response quality  ·  2 of 3 passed',
    );
    expect(caseMeta(kase({ id: 'PERF-03', area: 'latency', n_runs: 5, n_passed: 0 }))).toBe('latency  ·  0 of 5 passed');
    expect(caseMeta(kase({ id: 'INJ-04', tier: 'T1' }))).toBe('scripted');
    // Without counts, from its runs.
    expect(caseMeta({ id: 'R', tier: 'T2', area: 'tool use', runs: [{ ok: true }, { ok: false }, { ok: null }] })).toBe(
      'tool use  ·  1 of 3 passed',
    );
    expect(caseTitle(kase({ id: 'QA-03', title: 'Extension install steps, exact' }))).toBe(
      'QA-03  ·  Extension install steps, exact',
    );
    expect(caseTitle({ id: 'QA-03' })).toBe('QA-03');
  });

  it("marks the case's own gating dimensions: completeness too on an exact case", () => {
    const means = { faithfulness: 4.7, completeness: 3.7, honesty: 5, consent: 5, voice: 4 };
    const exact = kase({
      id: 'QA-03',
      exact: true,
      judge: { meets: '2 of 3', means, reason: null, gating: ['faithfulness', 'completeness', 'honesty', 'consent'] },
    });
    const gating = dimChips(exact.judge?.means, { gating: caseGating(exact, RUN.judge?.gating) }).map((c) => c.gating);
    expect(gating).toEqual([true, true, true, true, false]);
    // A case sent before per-case gating takes the run's.
    const older = kase({ id: 'QA-03', judge: { meets: '2 of 3', means, reason: null } });
    expect(caseGating(older, RUN.judge?.gating)).toEqual(['faithfulness', 'honesty', 'consent']);
    expect(caseGating(older, null)).toBeNull();
  });

  it('opens in the case view as a full case, a crashed run reading as a fail', () => {
    const c = asCaseResult({ id: 'QA-03', tier: 'T2', verdict: 'crashed', runs: [{ ok: true }, { ok: null }] });
    expect(c).toMatchObject({ id: 'QA-03', n_runs: 2, n_passed: 1, runs: [{ ok: true }, { ok: false }], linear_url: null });
    expect(c.title).toBe('');
    expect(c.judge).toBeNull();
  });
});
