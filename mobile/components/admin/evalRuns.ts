/**
 * The words and rules of the Eval runs view (GUR-282, frames 38:44 and 39:274):
 * when a run ran, its tags, its score's areas and counts as parts the cards
 * style, the judge's dimension chips, and how a run's cases group and fold.
 * Pure, so the tests read it without rendering. EvalRunsTab and EvalRunDetail
 * draw it.
 *
 * Every field is optional: a run uploaded before GUR-282 lacks most of them.
 */
import { JUDGE_DIMENSIONS } from '../../services/admin-service';
import type {
  EvalCaseResult,
  EvalJudgeDisagreement,
  EvalJudgeSummary,
  EvalRunArea,
  EvalRunAreaDown,
  EvalRunCase,
  EvalRunCaseGroups,
  EvalRunCounts,
  EvalRunJudge,
  EvalRunRow,
  EvalSchedule,
  IssueStatus,
  JudgeDimension,
} from '../../services/admin-service';

/** A line of parts: quiet by default, flag in the failure tone, faint for what didn't run. */
export interface Part {
  text: string;
  tone?: 'flag' | 'faint';
}

/** An area this many points or more under the comparable run is flagged (admin_issues.AREA_DROP, score.py's DROP). */
export const AREA_DROP = 5;
/** A judge dimension passes at this score (evals/judge.py PASS_AT). The server sends it as pass_at. */
export const PASS_AT = 4;
/** The dimensions that gate a live run once the judge is calibrated (evals/judge.py GATING). */
export const GATING: JudgeDimension[] = ['faithfulness', 'honesty', 'consent'];
/** How many runs the server keeps (admin_issues.KEEP_RUNS). */
export const KEEP_RUNS = 50;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEP: Part = { text: '  ·  ' };

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function list<T>(x: T[] | null | undefined): T[] {
  return Array.isArray(x) ? x : [];
}

function clean(text: string | null | undefined): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/** "1 case", "14 cases". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "demo_run" -> "Demo run": a value this build doesn't know, said plainly. */
function words(value: string | null | undefined): string {
  const t = clean(String(value ?? '').replace(/[_-]+/g, ' '));
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** The first n characters of a sha or version. */
function short(id: string, n: number): string {
  return id.length > n ? id.slice(0, n) : id;
}

// ─── When ────────────────────────────────────────────────────────────────

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Local time as "9:42 PM". */
function clock(d: Date): string {
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Calendar days from one local day to another: 1 when `to` is the next day. Rounded, so a DST day still counts as one. */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function dated(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock(d)}`;
}

/**
 * When a run ran, in local time: "Today 9:42 PM", "Yesterday 6:00 AM", the
 * weekday within the past week ("Mon 3:20 PM"), else the date ("Sep 28, 3:20 PM").
 * Null without a readable time.
 */
export function runWhenLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const d = parse(iso);
  if (!d) return null;
  const ago = daysBetween(d, now);
  if (ago === 0) return `Today ${clock(d)}`;
  if (ago === 1) return `Yesterday ${clock(d)}`;
  if (ago > 1 && ago < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`;
  return dated(d);
}

/**
 * When the next scheduled run is due, in local time: "Today 6:00 AM", the
 * weekday within the week ahead ("Thu 6:00 AM", tomorrow included, as the
 * frame says it), else the date. Null without a readable time.
 */
export function nextRunLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const d = parse(iso);
  if (!d) return null;
  const ahead = daysBetween(now, d);
  if (ahead === 0) return `Today ${clock(d)}`;
  if (ahead > 0 && ahead < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`;
  return dated(d);
}

// ─── The schedule card ───────────────────────────────────────────────────

export interface ScheduleCopy {
  title: string;
  text: string | null;
  runner: string;
}

/** "Next scheduled run: Thu 6:00 AM", the schedule as the server words it, and where it runs. */
export function scheduleCopy(schedule: EvalSchedule, now: Date = new Date()): ScheduleCopy {
  const when = nextRunLabel(schedule.next_run_at, now);
  const runner = clean(schedule.runner);
  return {
    title: when ? `Next scheduled run: ${when}` : 'Next scheduled run',
    text: clean(schedule.text) || null,
    runner: runner ? `Runs on ${runner}, not on the server.` : 'Runs on a schedule, not on the server.',
  };
}

/** The list's last line. Says how many show when the server keeps more than the list asked for. */
export function keepLine(shown: number, total: number | null | undefined): string {
  const keeps = `The server keeps the newest ${KEEP_RUNS} runs.`;
  return isNum(total) && total > shown ? `Showing the newest ${shown} of ${total}. ${keeps}` : keeps;
}

// ─── A run's tags ────────────────────────────────────────────────────────

const TRIGGERS: Record<string, string> = { scheduled: 'Scheduled', manual: 'Manual', demo: 'Demo' };

/** What the run is, in the frame's order: Live or Scripted, how it started, then Whole run or "Partial: 3 cases". */
export function runTags(run: EvalRunRow): string[] {
  const tags: string[] = [];
  if (run.live === true) tags.push('Live');
  else if (run.live === false) tags.push('Scripted');
  if (run.trigger) tags.push(TRIGGERS[run.trigger] ?? words(run.trigger));
  if (run.scope === 'whole') tags.push('Whole run');
  else if (run.scope === 'partial') tags.push(isNum(run.n_cases) ? `Partial: ${plural(run.n_cases, 'case')}` : 'Partial');
  else if (run.scope) tags.push(words(run.scope));
  return tags.filter(Boolean);
}

/** The gate tag, Blocked or Clear. The server sends a gate for a whole live run only, so other runs have none. */
export function gateTag(run: EvalRunRow): { label: string; tone: 'bad' | 'good' } | null {
  const state = run.gate?.state;
  if (state === 'blocked') return { label: 'Blocked', tone: 'bad' };
  if (state === 'clear') return { label: 'Clear', tone: 'good' };
  return null;
}

/** "20 cases  ·  build 7ddaa27  ·  prompt 7c19e0d2", leaving out what the run doesn't have. */
export function versionsLine(run: EvalRunRow, withCases = false): string | null {
  const parts = [
    withCases && isNum(run.n_cases) ? plural(run.n_cases, 'case') : null,
    run.build_sha ? `build ${short(run.build_sha, 7)}` : null,
    run.prompt_version ? `prompt ${short(run.prompt_version, 8)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join('  ·  ') : null;
}

// ─── The score ───────────────────────────────────────────────────────────

export interface ScoreRead {
  /** Out of 100 in whole points, or null: not scored. */
  value: number | null;
  /** Against the previous comparable run, in whole points. */
  delta: number | null;
  /** A partial run with nothing to compare against: the number reads quiet, beside "not compared". */
  notCompared: boolean;
}

export function scoreRead(run: EvalRunRow): ScoreRead {
  const value = isNum(run.score) ? Math.round(run.score) : null;
  const delta = value !== null && isNum(run.score_delta) ? Math.round(run.score_delta) : null;
  return { value, delta, notCompared: value !== null && delta === null && run.scope === 'partial' };
}

/** "+3", "-1", "0". */
export function deltaText(delta: number): string {
  const d = Math.round(delta);
  return d > 0 ? `+${d}` : String(d);
}

/** Up is good, down is bad, no change is muted. */
export function deltaTone(delta: number): 'good' | 'bad' | 'muted' {
  const d = Math.round(delta);
  return d > 0 ? 'good' : d < 0 ? 'bad' : 'muted';
}

/** "down 1", "up 3", "no change": a change as a screen reader should say it. */
export function spokenDelta(delta: number): string {
  const d = Math.round(delta);
  return d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : 'no change';
}

/** The weighted areas, in the server's order. An area with no weight (report a bug) is never listed. */
function weightedAreas(run: EvalRunRow): EvalRunArea[] {
  return list(run.score_areas).filter(
    (a): a is EvalRunArea => !!a && !!clean(a.label) && (!isNum(a.weight) || a.weight > 0),
  );
}

/** The areas down AREA_DROP or more, as the server names them, else from each area's change. */
export function areasDown(run: EvalRunRow): EvalRunAreaDown[] {
  const named = list(run.areas_down).filter(
    (a): a is EvalRunAreaDown => !!a && !!clean(a.label) && isNum(a.was) && isNum(a.now),
  );
  if (named.length) return named;
  return weightedAreas(run)
    .filter((a) => isNum(a.score) && isNum(a.delta) && Math.round(a.delta) <= -AREA_DROP)
    .map((a) => {
      const now = Math.round(a.score as number);
      const delta = Math.round(a.delta as number);
      return { key: a.key, label: a.label, was: now - delta, now, delta };
    });
}

/** True when the area fell AREA_DROP or more against the comparable run: the server's flag, else from its change. */
export function areaFlagged(area: EvalRunArea, run: EvalRunRow): boolean {
  if (typeof area.down === 'boolean') return area.down;
  if (isNum(area.delta)) return Math.round(area.delta) <= -AREA_DROP;
  return areasDown(run).some((d) => d.key === area.key);
}

/** An area's change, from the area or, failing that, from the server's list of areas down. */
function areaDelta(area: EvalRunArea, run: EvalRunRow): number | null {
  if (isNum(area.delta)) return Math.round(area.delta);
  const down = areasDown(run).find((d) => d.key === area.key);
  return down ? Math.round(down.delta) : null;
}

export interface AreaRead {
  key: string;
  label: string;
  /** 0-100 in whole points; null when no case in it ran. */
  score: number | null;
  delta: number | null;
  flagged: boolean;
}

/** Each weighted area with its score, its change and whether it is flagged: the detail's bars. */
export function areaReads(run: EvalRunRow): AreaRead[] {
  return weightedAreas(run).map((a) => ({
    key: a.key,
    label: clean(a.label),
    score: isNum(a.score) ? Math.round(a.score) : null,
    delta: areaDelta(a, run),
    flagged: areaFlagged(a, run),
  }));
}

/**
 * The six areas on one wrapped line: "quality 74 (-7) · safety & consent 29 · ...",
 * a flagged area with its change in the failure tone, then the areas a partial
 * run didn't reach, faint: "not run: robustness, journey". Empty with no areas.
 */
export function areaParts(run: EvalRunRow): Part[] {
  const reads = areaReads(run);
  const ran = reads.filter((a) => a.score !== null);
  const notRun = reads.filter((a) => a.score === null);
  const parts: Part[] = [];
  ran.forEach((a, i) => {
    if (i > 0) parts.push({ text: ' · ' });
    const text = `${a.label} ${a.score}`;
    parts.push(a.flagged && a.delta !== null ? { text: `${text} (${deltaText(a.delta)})`, tone: 'flag' } : { text });
  });
  if (notRun.length) {
    if (parts.length) parts.push({ text: ' · ' });
    parts.push({ text: `not run: ${notRun.map((a) => a.label).join(', ')}`, tone: 'faint' });
  }
  return parts;
}

/** "Down 5 or more since Today 6:00 AM: quality, 81 to 74." Null when no area fell that far. */
export function downLine(run: EvalRunRow, now: Date = new Date()): string | null {
  const down = areasDown(run);
  if (!down.length) return null;
  const since = runWhenLabel(run.compared_with?.run_at, now);
  const which = down.map((a) => `${clean(a.label)}, ${Math.round(a.was)} to ${Math.round(a.now)}`).join('; ');
  return `Down ${AREA_DROP} or more${since ? ` since ${since}` : ''}: ${which}.`;
}

/**
 * What the score is compared with: "vs Today 6:00 AM, the last whole live run".
 * The server compares like with like (live or scripted, whole or partial, the
 * same cases and weights). "not compared" when there is no such run.
 */
export function comparedLine(run: EvalRunRow, now: Date = new Date()): string {
  const when = runWhenLabel(run.compared_with?.run_at, now);
  if (!when) return 'not compared';
  const kind = run.live === false ? 'scripted' : 'live';
  if (run.scope === 'partial') return `vs ${when}, the last ${kind} run of the same cases`;
  return `vs ${when}, the last whole ${kind} run`;
}

// ─── The counts ──────────────────────────────────────────────────────────

function count(x: unknown): number {
  return isNum(x) && x > 0 ? Math.round(x) : 0;
}

/**
 * "5 ok  ·  14 red as labeled  ·  1 regression", a regression and a crash in
 * the failure tone. By the grouping rules a flaky case (only ever one labeled
 * RED) is red as labeled. ok always shows; the rest only when there are any.
 * Empty when the run sent no counts.
 */
export function countParts(counts: EvalRunCounts | null | undefined): Part[] {
  if (!counts) return [];
  const parts: Part[] = [{ text: `${count(counts.ok)} ok` }];
  const red = count(counts.red_as_labeled) + count(counts.flaky);
  const regressions = count(counts.regression);
  const crashed = count(counts.crashed);
  if (red) parts.push(SEP, { text: `${red} red as labeled` });
  if (regressions) parts.push(SEP, { text: plural(regressions, 'regression'), tone: 'flag' });
  if (crashed) parts.push(SEP, { text: `${crashed} crashed`, tone: 'flag' });
  return parts;
}

// ─── The judge ───────────────────────────────────────────────────────────

export type DimState = 'pass' | 'below' | 'na';

export interface DimChip {
  key: JudgeDimension;
  /** "4.5", or "n/a". */
  value: string;
  state: DimState;
  /** Marked with the shield: it gates a live run once the judge is calibrated. */
  gating: boolean;
}

/**
 * A judge mean as a chip shows it: one decimal, in the failure tone when that
 * shown value is under the pass mark, so 4.0 is never red, even from a 3.96.
 * n/a when there is no number: every run scored it not applicable, or the run
 * is older than the dimension.
 */
export function dimRead(value: unknown, passAt: number = PASS_AT): { value: string; state: DimState } {
  if (!isNum(value)) return { value: 'n/a', state: 'na' };
  const shown = value.toFixed(1);
  return { value: shown, state: Number(shown) < passAt ? 'below' : 'pass' };
}

/** The five dimensions in the judge's own order, each with its shown value, its state and whether it gates. */
export function dimChips(
  means: Partial<Record<string, number | null>> | null | undefined,
  opts: { gating?: string[] | null; passAt?: number | null } = {},
): DimChip[] {
  const gating = new Set<string>(Array.isArray(opts.gating) && opts.gating.length ? opts.gating : GATING);
  const passAt = isNum(opts.passAt) ? opts.passAt : PASS_AT;
  return JUDGE_DIMENSIONS.map((key) => ({ key, ...dimRead(means?.[key], passAt), gating: gating.has(key) }));
}

/** "faithfulness 4.5, gating" or "completeness 3.9, below 4": a chip as a screen reader should say it. */
export function spokenDim(chip: DimChip, passAt: number = PASS_AT): string {
  const state = chip.state === 'na' ? 'not applicable' : chip.state === 'below' ? `below ${passAt}` : null;
  return [`${chip.key} ${chip.state === 'na' ? '' : chip.value}`.trim(), state, chip.gating ? 'gating' : null]
    .filter(Boolean)
    .join(', ');
}

type JudgeTally = Pick<EvalRunJudge, 'judged_runs' | 'agreement'> | null | undefined;

/** A run card's judge line: "agrees with code 17 of 19", or "graded 19 runs" on an older run. */
export function judgeShort(judge: JudgeTally): string | null {
  const a = judge?.agreement;
  if (a && isNum(a.agree) && isNum(a.of) && a.of > 0) return `agrees with code ${a.agree} of ${a.of}`;
  if (isNum(judge?.judged_runs) && judge.judged_runs > 0) return `graded ${plural(judge.judged_runs, 'run')}`;
  return null;
}

/** The judge card's headline: "Agrees with the code check on 17 of 19 runs", or "Graded 19 runs" on an older run. */
export function judgeHeadline(judge: JudgeTally): string | null {
  const a = judge?.agreement;
  if (a && isNum(a.agree) && isNum(a.of) && a.of > 0) return `Agrees with the code check on ${a.agree} of ${plural(a.of, 'run')}`;
  if (isNum(judge?.judged_runs) && judge.judged_runs > 0) return `Graded ${plural(judge.judged_runs, 'run')}`;
  return null;
}

/** Both sides of a split: "code fail, judge pass" or "code pass, judge fail". Null on an older run, which never kept them. */
export function splitSides(split: Pick<EvalJudgeDisagreement, 'passed' | 'failed'>): string | null {
  if (split.failed === 'code' || (!split.failed && split.passed === 'judge')) return 'code fail, judge pass';
  if (split.failed === 'judge' || (!split.failed && split.passed === 'code')) return 'code pass, judge fail';
  return null;
}

/** "PLAN-07  ·  run 1", or the case alone on an older run. */
export function splitWhich(split: EvalJudgeDisagreement): string {
  const id = clean(split.case_id) || 'A case';
  return isNum(split.run) ? `${id}  ·  run ${split.run}` : id;
}

/** "2 of 3", "2/3" or "meets 2 of 3" -> "meets 2 of 3". Null when the judge sent none. */
export function meetsText(meets: EvalJudgeSummary['meets'] | null | undefined): string | null {
  const t = clean(String(meets ?? ''))
    .replace(/^meets\s*/i, '')
    .replace(/(\d+)\s*\/\s*(\d+)/, '$1 of $2');
  return t ? `meets ${t}` : null;
}

// ─── A run's cases ───────────────────────────────────────────────────────

export type CaseGroupKey = 'regressions' | 'red_as_labeled' | 'ok';

export const CASE_GROUPS: { key: CaseGroupKey; title: string }[] = [
  { key: 'regressions', title: 'Regressions' },
  { key: 'red_as_labeled', title: 'Red as labeled' },
  { key: 'ok', title: 'OK' },
];

function labelOf(c: EvalRunCase): string {
  return clean(c.label).toUpperCase();
}

/** A T1 case: the scripted model. The judge only reads live (T2) runs. */
export function isScripted(c: EvalRunCase): boolean {
  return c.tier === 'T1';
}

/**
 * Where a case goes, as the server files it (admin_issues._group): a
 * regression or a crash under Regressions; red as labeled, and a flaky case
 * not labeled GREEN (only a red case is flaky: the runner calls a GREEN one
 * that passes some runs a regression), under Red as labeled; a pass or a NOW
 * GREEN under OK. A verdict this build doesn't know goes with the regressions.
 */
export function caseGroup(c: EvalRunCase): CaseGroupKey {
  const v = c.verdict;
  if (v === 'pass' || v === 'now_green') return 'ok';
  if (v === 'red_as_labeled' || (v === 'flaky' && labelOf(c) !== 'GREEN')) return 'red_as_labeled';
  return 'regressions';
}

/** The dimensions that gate this case: its own list (completeness too on an exact case), else the run's. */
export function caseGating(c: EvalRunCase, runGating: string[] | null | undefined): string[] | null {
  const own = c.judge?.gating;
  if (Array.isArray(own) && own.length) return own;
  return Array.isArray(runGating) && runGating.length ? runGating : null;
}

/** Every case of a run, in the server's group order. */
export function runCases(groups: EvalRunCaseGroups | null | undefined): EvalRunCase[] {
  return [...list(groups?.regressions), ...list(groups?.red_as_labeled), ...list(groups?.ok)].filter(
    (c): c is EvalRunCase => !!c && typeof c === 'object' && !!c.id,
  );
}

/** The server's three groups, regrouped by caseGroup. Each keeps the order it came in. */
export function groupCases(groups: EvalRunCaseGroups | null | undefined): Record<CaseGroupKey, EvalRunCase[]> {
  const out: Record<CaseGroupKey, EvalRunCase[]> = { regressions: [], red_as_labeled: [], ok: [] };
  for (const c of runCases(groups)) out[caseGroup(c)].push(c);
  return out;
}

/**
 * Whether a case folds behind "Show N more, all scripted": a scripted case
 * the judge never read, in Red as labeled or OK. A STAY RED case stays in view
 * (it waits on a product decision, not a patch), and so does every regression.
 */
export function folds(c: EvalRunCase, group: CaseGroupKey): boolean {
  return group !== 'regressions' && isScripted(c) && !c.judge && !labelOf(c).startsWith('STAY RED');
}

/** A group's cases in view order (judged first, then live, then scripted), split into shown and folded. */
export function splitGroup(cases: EvalRunCase[], group: CaseGroupKey): { shown: EvalRunCase[]; folded: EvalRunCase[] } {
  const rank = (c: EvalRunCase) => (c.judge ? 0 : isScripted(c) ? 2 : 1);
  const ordered = cases.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  return {
    shown: ordered.filter((x) => !folds(x.c, group)).map((x) => x.c),
    folded: ordered.filter((x) => folds(x.c, group)).map((x) => x.c),
  };
}

/** The fold's button: "Show 8 more, all scripted", or "Show 4 scripted cases" when nothing above it shows. */
export function showMoreLabel(n: number, anyShown: boolean): string {
  if (!anyShown) return n === 1 ? 'Show 1 scripted case' : `Show ${n} scripted cases`;
  return n === 1 ? 'Show 1 more, scripted' : `Show ${n} more, all scripted`;
}

/**
 * A case's verdict tag, worded as the Issues tab words an eval row
 * (admin_issues._eval_status), plus the ones that passed: Crashed and
 * Regression; Pass and Now green; else from its label, "Stays red" (with
 * "safety" for a safety case) or "Red  ·  change 4".
 */
export function caseStatus(c: EvalRunCase): IssueStatus {
  const v = c.verdict;
  const label = labelOf(c);
  if (v === 'crashed') return { text: 'Crashed', tone: 'red' };
  if (v === 'regression') return { text: 'Regression', tone: 'red' };
  if (v === 'pass') return { text: 'Pass', tone: 'green' };
  if (v === 'now_green') return { text: 'Now green', tone: 'green' };
  if (label.startsWith('STAY RED')) return { text: c.area === 'safety' ? 'Stays red  ·  safety' : 'Stays red', tone: 'red' };
  if (label.startsWith('RED')) {
    const change = clean(c.label).slice(3).trim().toLowerCase();
    return { text: change ? `Red  ·  ${change}` : 'Red', tone: 'red' };
  }
  return { text: words(v) || clean(c.label) || 'Unknown', tone: 'neutral' };
}

/** A case row's right side: "multi-turn  ·  2 of 3 passed" for a live case, "scripted" for a scripted one. */
export function caseMeta(c: EvalRunCase): string {
  if (isScripted(c)) return 'scripted';
  const runs = list(c.runs);
  const n = isNum(c.n_runs) ? c.n_runs : runs.length;
  const passed = isNum(c.n_passed) ? c.n_passed : runs.filter((r) => r?.ok === true).length;
  return [clean(c.area) || null, n > 0 ? `${passed} of ${n} passed` : null].filter(Boolean).join('  ·  ');
}

/** "QA-03  ·  Extension install steps, exact". */
export function caseTitle(c: EvalRunCase): string {
  const title = clean(c.title);
  return title ? `${c.id}  ·  ${title}` : c.id;
}

/** A run's case in the shape the case view reads. A run's detail carries no Linear link; a crashed run reads as a fail. */
export function asCaseResult(c: EvalRunCase): EvalCaseResult {
  const runs = list(c.runs).map((r) => ({ ok: r?.ok === true }));
  return {
    id: c.id,
    title: c.title ?? '',
    tier: c.tier ?? '',
    area: c.area ?? '',
    label: c.label ?? '',
    verdict: c.verdict ?? '',
    passed: c.passed === true,
    n_runs: isNum(c.n_runs) ? c.n_runs : runs.length,
    n_passed: isNum(c.n_passed) ? c.n_passed : runs.filter((r) => r.ok).length,
    expect: c.expect ?? '',
    what_happened: c.what_happened ?? '',
    why: c.why ?? '',
    fix: c.fix ?? '',
    runs,
    judge: c.judge ?? null,
    linear_url: null,
    score: isNum(c.score) ? c.score : null,
  };
}
