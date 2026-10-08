/**
 * Admin service: everything the in-app Performance panel reads (admins only):
 * open issues and the latest eval run, agent traces, API and ingestion
 * metrics, and beta bug reports.
 *
 * Every call goes through authedFetch, the single 401 -> login path. A 403 means
 * "this account is not an admin" and never signs anyone out. A 404 from these
 * routes means the backend has not shipped the endpoint yet.
 *
 * Hiding the panel is a UI hint, not the security: the server checks admin on
 * every one of these endpoints.
 */
import { API_BASE_URL } from '../constants/config';
import { authedFetch } from '../utils/authed-fetch';

// ─── Errors ──────────────────────────────────────────────────────────────

export type AdminErrorKind =
  | 'forbidden' // 403: not an admin
  | 'not_deployed' // 404 on the route itself: backend does not have it yet
  | 'not_found' // 404 with a specific detail, e.g. a turn id that does not exist
  | 'session' // signed out (authedFetch already started the login redirect)
  | 'http' // any other non-2xx
  | 'network' // fetch itself failed
  | 'bad_response'; // 2xx but the body was not JSON

export class AdminApiError extends Error {
  readonly kind: AdminErrorKind;
  readonly status: number | null;

  constructor(kind: AdminErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'AdminApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Matches by name, like the app does for SessionExpiredError, so it survives transpiled `instanceof`. */
export function isAdminApiError(e: unknown): e is AdminApiError {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AdminApiError';
}

/** Normalize anything thrown into an AdminApiError with a short, user-facing message. */
export function toAdminError(e: unknown): AdminApiError {
  if (isAdminApiError(e)) return e;
  return new AdminApiError('network', 'Network error');
}

// ─── GET /me/access ──────────────────────────────────────────────────────

export interface MeAccess {
  is_admin: boolean;
  is_beta: boolean;
}

// ─── GET /admin/perf-metrics (API + ingestion tabs) ──────────────────────

export interface EndpointStats {
  count: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  avg_ms: number;
}

export interface RecentCall {
  method: string;
  path: string;
  status: number;
  ms: number;
  ago_s: number;
}

export interface SlowestEndpoint extends EndpointStats {
  path: string;
}

export interface IngestionRun {
  status: string;
  started_at: string | null;
  completed_at: string | null;
  articles_found: number;
  articles_ingested: number;
  articles_rejected: number;
  step_timings: Record<string, number> | null;
}

export interface PerfMetrics {
  api: {
    endpoints: Record<string, EndpointStats>;
    recent: RecentCall[];
    slowest: SlowestEndpoint[];
    total_requests: number;
  };
  ingestion: {
    tiers: Record<string, { step: string; ms: number; detail: string; ago_s: number }[]>;
    total_steps: number;
    last_runs: Record<string, IngestionRun>;
  };
  content: {
    total_articles: number;
    total_storyboards: number;
  };
}

// ─── Agent traces: shared enums ──────────────────────────────────────────

export type AgentTraffic = 'real' | 'synthetic';
export type AgentTrafficFilter = AgentTraffic | 'all';
export type AgentWindowDays = 1 | 7 | 30;
export type AgentOutcome = 'blocks' | 'approval' | 'max_iters' | 'error' | 'abandoned';
export type AgentInputType = 'goal' | 'message' | 'decision';
export type TurnSeverity = 'bad' | 'warn' | 'ok';
export type TakeawaySeverity = 'bad' | 'warn' | 'good' | 'info';
/**
 * Contract: bad | warn | info. The diagnosis engine as committed (trace_insights,
 * ce12a8f) ranks findings critical | high | medium | low | info, so both are accepted.
 */
export type FindingSeverity = 'bad' | 'warn' | 'info' | 'critical' | 'high' | 'medium' | 'low';
export type TimelineKind = 'phase' | 'model' | 'tool' | 'block' | 'approval';
/**
 * Contract: ok | error | abandoned. The tracer also records `running` (the trace
 * ended mid-call), `failed` (model call) and `raised` / `http_error` (tool call).
 */
export type SpanStatus = 'ok' | 'error' | 'abandoned' | 'running' | 'failed' | 'raised' | 'http_error';
export type HypothesisConfidence = 'low' | 'medium' | 'high';

/** Free-form JSON (finding evidence values). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ─── GET /admin/agent/summary ────────────────────────────────────────────

export interface AgentSummaryWindow {
  days: number;
  traffic: AgentTrafficFilter;
  since: string;
  turns: number;
}

export interface AgentTakeaway {
  severity: TakeawaySeverity;
  text: string;
  turn_ids: string[];
}

/** A latency stat measured against its budget. Any number may be null when there is no data. */
export interface AgentBudgetStat {
  p50: number | null;
  p95: number | null;
  budget: number | null;
  over: number | null;
}

export interface AgentSummaryTiles {
  turns: number | null;
  users: number | null;
  sessions: number | null;
  first_block_ms: AgentBudgetStat;
  total_ms: AgentBudgetStat;
  iterations: { p50: number | null; max: number | null; budget: number | null };
  outcomes: {
    blocks: number | null;
    approval: number | null;
    max_iters: number | null;
    error: number | null;
    abandoned: number | null;
  };
  cache_share: number | null;
  tokens_per_turn: { input_total: number | null; output: number | null };
  approvals: {
    shown: number | null;
    approved: number | null;
    declined: number | null;
    ignored: number | null;
    /** Not in the contract; the current backend also counts taps on an outdated card. */
    stale?: number | null;
  };
}

export interface AgentToolStat {
  name: string;
  calls: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  errors: number | null;
}

export interface AgentBuildStat {
  build_sha: string;
  prompt_version: string | null;
  turns: number | null;
  first_block_p50: number | null;
  error_rate: number | null;
  first_seen: string | null;
}

export interface AgentTurnRow {
  id: string;
  created_at: string;
  user_id: string;
  user_email: string | null;
  session_id: string;
  input_type: AgentInputType;
  input_preview: string | null;
  outcome: AgentOutcome;
  first_block_ms: number | null;
  total_ms: number | null;
  iterations: number | null;
  tools: string[];
  severity: TurnSeverity;
  headline: string;
  traffic: AgentTraffic;
  build_sha: string | null;
}

export interface AgentSummary {
  window: AgentSummaryWindow;
  takeaways: AgentTakeaway[];
  tiles: AgentSummaryTiles;
  tools: AgentToolStat[];
  builds: AgentBuildStat[];
  flagged: AgentTurnRow[];
}

// ─── GET /admin/agent/turns ──────────────────────────────────────────────

export interface AgentTurnsQuery {
  days: AgentWindowDays;
  traffic: AgentTrafficFilter;
  /** Empty string means any outcome. */
  outcome?: AgentOutcome | '';
  flagged_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface AgentTurnsPage {
  turns: AgentTurnRow[];
  total: number;
}

// ─── GET /admin/agent/turns/{id} ─────────────────────────────────────────

export interface AgentModelCall {
  iter: number | null;
  start_ms: number | null;
  ms: number | null;
  first_text_ms: number | null;
  stop_reason: string | null;
  status: SpanStatus;
  in: number | null;
  out: number | null;
  cache_read: number | null;
  cache_write: number | null;
  request_id: string | null;
}

export interface AgentToolCall {
  name: string;
  iter: number | null;
  start_ms: number | null;
  ms: number | null;
  chars: number | null;
  status: SpanStatus;
  error: boolean;
  error_msg: string | null;
  /** JSON string of the tool input. Null or absent for real users (privacy: only ids are kept). */
  input?: string | null;
  /** Not in the contract; sent by the current tracer: the safe scalar arguments (ids, filters). */
  args?: Record<string, string | number | boolean> | null;
  /** Not in the contract; sent by the current tracer: length of each free-text argument. */
  text_chars?: Record<string, number> | null;
  tool_use_id?: string | null;
}

export interface AgentBlock {
  type: string | null;
  variant: string | null;
  at_ms: number | null;
  iter: number | null;
  /** Null or absent for real users (privacy); show `chars` instead. */
  preview?: string | null;
  chars: number | null;
}

export interface AgentPhase {
  name: string;
  start_ms: number | null;
  ms: number | null;
}

export interface AgentTurnTrace extends AgentTurnRow {
  model: string | null;
  prompt_version: string | null;
  client: string | null;
  decision: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  error: string | null;
  approval_tool: string | null;
  model_calls: AgentModelCall[];
  tool_calls: AgentToolCall[];
  blocks: AgentBlock[];
  phases: AgentPhase[];
  context: { approval_id: string | null; history_msgs: number | null };
}

export interface AgentFinding {
  code: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: Record<string, JsonValue>;
}

export interface AgentDiagnosis {
  severity: TurnSeverity;
  headline: string;
  findings: AgentFinding[];
}

export interface AgentTimelineItem {
  kind: TimelineKind;
  label: string;
  start_ms: number | null;
  end_ms: number | null;
  status: SpanStatus;
  detail: string | null;
}

export interface AgentSessionNav {
  turn_index: number | null;
  turns_in_session: number | null;
  prev_id: string | null;
  next_id: string | null;
}

export interface AgentHypothesis {
  summary: string;
  /** The backend falls back to null when the model's answer was not valid JSON. */
  likely_cause: string | null;
  evidence: string[];
  confidence: HypothesisConfidence;
  suggested_eval?: string | null;
  model: string;
  /** Not in the contract; sent by the current backend. */
  confirm_or_refute?: string | null;
  generated_at?: string | null;
  by?: string | null;
}

export interface AgentTurnDetail {
  turn: AgentTurnTrace;
  diagnosis: AgentDiagnosis;
  timeline: AgentTimelineItem[];
  session: AgentSessionNav;
  ai_hypothesis: AgentHypothesis | null;
}

// ─── POST /admin/agent/turns/{id}/explain ────────────────────────────────

export interface AgentExplainResponse {
  hypothesis: AgentHypothesis;
}

// ─── Bug reports (Report a bug, GUR-242) ─────────────────────────────────

export type ReportStatus = 'saved' | 'filed' | 'failed';

/** One row of GET /admin/reports. */
export interface AdminReportRow {
  id: string;
  /** First 8 hex characters of the id: what the tester sees on Sent. */
  reference: string;
  created_at: string | null;
  user_email: string | null;
  /** wrong_answer | slow | broken_ui | missing | other */
  category: string;
  /** "real" or "synthetic" (persona and test accounts). */
  traffic: AgentTraffic;
  /** The first 160 characters. The detail has the full text. */
  expected: string;
  /** Where the report came from: "home", "guru", or "guru/<mode>" for a turn, e.g. "guru/catch-up". */
  screen: string | null;
  status: ReportStatus | string;
  linear_identifier: string | null;
  linear_url: string | null;
  trace_id: string | null;
  /** The rules' headline for the turn; null when the report names no turn or the turn is not the reporter's own. */
  trace_headline: string | null;
  /** The turn's first-block time; null when there is no turn, it is not the reporter's own, or nothing reached the user. */
  trace_first_block_ms: number | null;
  hypothesis_summary: string | null;
}

export interface AdminReportsPage {
  reports: AdminReportRow[];
  total: number;
}

export interface ReportsQuery {
  days?: number;
  /** Empty string means any status. */
  status?: ReportStatus | '';
  traffic?: AgentTrafficFilter;
}

export type ReportLevel = 'low' | 'medium' | 'high';

/** Claude's triage on a report, or `error` alone when the triage call failed. */
export interface ReportHypothesis {
  summary?: string | null;
  likely_cause?: string | null;
  evidence?: string[] | null;
  severity?: ReportLevel | null;
  confidence?: ReportLevel | null;
  suggested_eval?: string | null;
  model?: string | null;
  generated_at?: string | null;
  stop_reason?: string | null;
  /** Why the triage failed. When set, the fields above are absent. */
  error?: string | null;
  /** "posted" once the hypothesis is a comment on the Linear issue. */
  comment?: string | null;
  comment_error?: string | null;
}

/**
 * What the app sent with a report (GUR-277), as the server validated it, plus
 * the article's title the server looked up. Every field may be missing: an
 * older report has none of it.
 */
export interface ReportClientContext {
  /** home | catchup | divein | recap | guru | article | other */
  screen?: string | null;
  /** That screen's step, e.g. "stage-3" on Recap. */
  step?: string | null;
  on_screen?: {
    article_id?: string | null;
    recap_journey_id?: string | null;
    trace_id?: string | null;
    /** Filled in by the server; null in privacy mode. */
    article_title?: string | null;
  } | null;
  /** The last 10 screens, newest first. */
  trail?: { screen?: string | null; step?: string | null; at?: string | null }[] | null;
  /** The last 5 failed API calls, newest first. Status 0: the call got no answer. */
  failed_calls?: { method?: string | null; path?: string | null; status?: number | null; at?: string | null }[] | null;
}

export type SessionItemKind = 'recap_answer' | 'save' | 'question' | 'note' | 'highlight' | 'agent_turn';

/** One thing the reporter did before the report, joined on the server from their own data. */
export interface ReportSessionItem {
  kind: SessionItemKind | string;
  at: string | null;
  /** Clipped; null in privacy mode. */
  text: string | null;
  article_id: string | null;
  /** Null in privacy mode. */
  article_title: string | null;
  /** Agent turns only: opens the turn in the Agent view. */
  trace_id: string | null;
  /** Short, e.g. "stage 2, answer 3 of 3" or "4 blocks". */
  detail: string | null;
}

/** The reporter's own activity in the window before the report (GUR-277): at most 10 items, newest first. */
export interface ReportSessionContext {
  window_minutes?: number | null;
  /** True: counts and ids only, no text and no titles. */
  privacy?: boolean | null;
  /** Every kind, zeros included. */
  counts?: Partial<Record<SessionItemKind, number>> | null;
  items?: ReportSessionItem[] | null;
}

/** GUR-277 on a report (GET /admin/reports/{id} sends them on `report`). An older report has none of them. */
export interface ReportContextFields {
  client_context?: ReportClientContext | null;
  session_context?: ReportSessionContext | null;
  /** Why the server refused the app's context. client_context is null then. */
  context_error?: string | null;
}

export interface AdminReport extends ReportContextFields {
  id: string;
  reference: string;
  created_at: string | null;
  user_id: string;
  user_email: string | null;
  category: string;
  /** The full text. */
  expected: string;
  screen: string | null;
  client: string | null;
  trace_id: string | null;
  session_id: string | null;
  build_sha: string | null;
  prompt_version: string | null;
  traffic: AgentTraffic | null;
  status: ReportStatus | string;
  /** Filing attempts. */
  attempts: number | null;
  /** Why filing failed, or a label that could not be applied. */
  error: string | null;
  linear_identifier: string | null;
  linear_url: string | null;
  filed_at: string | null;
  hypothesis: ReportHypothesis | null;
}

/** GET /admin/reports/{id}, and the answer to a retry. */
export interface AdminReportDetail {
  report: AdminReport;
  /** The reported turn as a row of the Agent view. Null when there is no turn, or it is not the reporter's own. */
  trace: AgentTurnRow | null;
  diagnosis: AgentDiagnosis | null;
}

// ─── Issues (GUR-271): GET /admin/issues ─────────────────────────────────

export type IssueSource = 'eval' | 'report' | 'production';
export type IssueSourceFilter = IssueSource | 'all';
export type ShipGateState = 'blocked' | 'clear' | 'unknown';
export type GateReasonKind = 'safety' | 'regressions' | 'reports';
export type IssueStatusTone = 'red' | 'amber' | 'green' | 'neutral';
export type IssueChipTone = 'indigo' | 'amber';

/** One line of the ship gate. The reports line never blocks the gate by itself. */
export interface GateReason {
  kind: GateReasonKind | string;
  ok: boolean;
  text: string;
}

/** The eval run the gate was read from. */
export interface GateRun {
  id: string;
  run_at: string;
  live: boolean;
  build_sha: string | null;
  prompt_version: string | null;
}

export interface ShipGate {
  state: ShipGateState | string;
  /** In order: safety, regressions, reports. */
  reasons: GateReason[];
  /** Null when no eval run has been uploaded. */
  run: GateRun | null;
  /** The latest run's graded score, beside the gate and never part of it. Null for a run without one. */
  score: EvalScore | null;
}

/** One area of the eval score, e.g. "safety & consent". */
export interface EvalScoreArea {
  key: string;
  label: string;
  /** Its share of the topline, out of 100. Report a bug carries 0. */
  weight: number;
  /** 0-100, or null when no case in it ran. */
  score: number | null;
  baseline: number | null;
}

/**
 * The graded eval score (GUR-268, backend/evals/score.py): one number, 0-100, for how good the
 * agent's answers are, weighted toward quality. Safety is the gate beside it, never averaged in.
 */
export interface EvalScore {
  topline: number;
  /** The baseline's topline under the same weights, or null when there was none to compare. */
  baseline: number | null;
  /** topline minus baseline in whole points, as the runner prints it. Null without a baseline. */
  delta: number | null;
  /** Scores compare only under one weights version. */
  weights_version: string | null;
  areas: EvalScoreArea[];
}

export interface IssueCounts {
  all: number;
  eval: number;
  report: number;
  production: number;
}

export interface IssueStatus {
  text: string;
  tone: IssueStatusTone | string;
}

export interface IssueChip {
  text: string;
  tone: IssueChipTone | string;
}

/** What a row opens. Exactly one id is set: case_id for an eval, report_id for a report, trace_id for production. */
export interface IssueRef {
  case_id?: string;
  report_id?: string;
  trace_id?: string;
}

export interface AdminIssue {
  key: string;
  source: IssueSource | string;
  at: string;
  title: string;
  status: IssueStatus;
  body: string;
  chip: IssueChip | null;
  footer: string | null;
  ref: IssueRef;
  linear_url: string | null;
}

export interface AdminIssuesResponse {
  gate: ShipGate;
  counts: IssueCounts;
  /** Newest first. */
  issues: AdminIssue[];
}

// ─── GET /admin/evals/latest ─────────────────────────────────────────────

export type EvalVerdict = 'pass' | 'red_as_labeled' | 'regression' | 'now_green' | 'flaky' | 'crashed';

/** The judge's dimensions, in its own order (backend/evals/judge.py RUBRICS, version 2). */
export const JUDGE_DIMENSIONS = ['faithfulness', 'completeness', 'honesty', 'consent', 'voice'] as const;
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

/** The LLM judge over a case's live runs. Report-only until it is calibrated. */
export interface EvalJudgeSummary {
  /** How many judged runs met the case, e.g. "2 of 3". */
  meets: string;
  /**
   * Each dimension's mean, 1 to 5; a dimension passes at 4. Null or missing when every run scored it
   * not applicable, or the run is older than the dimension (version 1 had voice, honesty and journey).
   */
  means: Partial<Record<JudgeDimension | 'journey', number | null>>;
  reason: string | null;
}

export interface EvalCaseResult {
  id: string;
  title: string;
  /** "T1" (scripted model) or "T2" (live model). */
  tier: string;
  area: string;
  /** "GREEN", "RED change N" or "STAY RED N", from cases.yaml. */
  label: string;
  verdict: EvalVerdict | string;
  passed: boolean;
  n_runs: number;
  n_passed: number;
  expect: string;
  what_happened: string;
  why: string;
  fix: string;
  runs: { ok: boolean }[];
  judge: EvalJudgeSummary | null;
  linear_url: string | null;
  /** The case's graded score, 0-100: the mean of its runs. Missing from runs uploaded before GUR-268. */
  score?: number | null;
}

export interface EvalRun {
  id: string;
  run_at: string;
  live: boolean;
  build_sha: string | null;
  prompt_version: string | null;
  evals_version: string | null;
  judge_version: string | null;
  uploaded_by: string | null;
  /** The run's graded score, as the gate shows it. Null for a run without one. */
  score?: EvalScore | null;
  cases: EvalCaseResult[];
}

// ─── Eval runs (GUR-282): GET /admin/eval-runs, /admin/eval-runs/{id} ────
// Every uploaded run, labeled as what it is (admin_issues._header). A run uploaded before GUR-282 lacks
// most of these, so every field may be missing or null.

/** A whole run, or a partial one (a --case run). */
export type EvalRunScope = 'whole' | 'partial';
/** How a run started: the nightly schedule, by hand, or for a demo. */
export type EvalRunTrigger = 'scheduled' | 'manual' | 'demo';

/** A run's cases by verdict. ok counts every case that passed, a NOW GREEN too. */
export interface EvalRunCounts {
  ok?: number | null;
  red_as_labeled?: number | null;
  regression?: number | null;
  flaky?: number | null;
  crashed?: number | null;
}

/** The ship gate for one run's cases: its state, then its safety and regressions lines. */
export interface EvalRunGate {
  state: ShipGateState | string;
  reasons?: GateReason[] | null;
}

/** One weighted area of a run's score, with its change against the previous comparable run. */
export interface EvalRunArea {
  key: string;
  label: string;
  weight?: number | null;
  /** 0-100, or null when no case in it ran. */
  score?: number | null;
  /** In whole points. Null without a comparable run, or when either side has no score. */
  delta?: number | null;
  /** True when it fell 5 or more against the comparable run: the flag. */
  down?: boolean | null;
}

/** An area down 5 or more against the comparable run, in whole points. */
export interface EvalRunAreaDown {
  key: string;
  label: string;
  was: number;
  now: number;
  delta: number;
}

/** The previous comparable run: alike in live, scope, cases and weights, with a score. */
export interface EvalRunComparedWith {
  id: string;
  run_at: string;
  score?: number | null;
}

/** One run of a case where the judge and the code check split. */
export interface EvalJudgeDisagreement {
  case_id?: string | null;
  /** The run's number, from 1. Null on a run uploaded before each judged run was stored. */
  run?: number | null;
  /** The side that passed it, "code" or "judge". Null on older runs. */
  passed?: 'code' | 'judge' | string | null;
  /** The side that failed it, "code" or "judge". Null on older runs. */
  failed?: 'code' | 'judge' | string | null;
  /** The judge's one-line reason. */
  reason?: string | null;
}

/** The judge across one run (admin_issues._judge_read). Null when nothing in the run was judged. */
export interface EvalRunJudge {
  /** How many runs it graded. */
  judged_runs?: number | null;
  /** How many of its calls failed. Null on older runs, which never kept it. */
  errors?: number | null;
  /** How often its verdict matched the code check's. Null on older runs. */
  agreement?: { agree: number; of: number } | null;
  /** Each dimension's mean over the scores that aren't n/a, to one decimal. Null when every score was n/a. */
  means?: Partial<Record<JudgeDimension, number | null>> | null;
  /** How many runs scored each dimension n/a. Null on older runs. */
  na?: Partial<Record<JudgeDimension, number | null>> | null;
  /** The dimensions that gate a live run once the judge is calibrated. */
  gating?: string[] | null;
  /** The score a dimension passes at. */
  pass_at?: number | null;
  disagreements?: EvalJudgeDisagreement[] | null;
  /** True once the judge counts toward the gate. The server does not send it yet: until then it is report-only. */
  counted?: boolean | null;
}

/** One run as the Eval runs view lists it. */
export interface EvalRunRow {
  id: string;
  run_at?: string | null;
  live?: boolean | null;
  scope?: EvalRunScope | string | null;
  trigger?: EvalRunTrigger | string | null;
  build_sha?: string | null;
  prompt_version?: string | null;
  n_cases?: number | null;
  counts?: EvalRunCounts | null;
  /** Whole live runs only. Null otherwise: the gate never reads them. */
  gate?: EvalRunGate | null;
  /** The topline, 0-100. Null for a run uploaded without a score. */
  score?: number | null;
  weights_version?: string | null;
  /** The weighted areas in the server's order (report a bug carries no weight, so it isn't here). */
  score_areas?: EvalRunArea[] | null;
  /** The topline's change against compared_with, in whole points. */
  score_delta?: number | null;
  compared_with?: EvalRunComparedWith | null;
  areas_down?: EvalRunAreaDown[] | null;
  judge?: EvalRunJudge | null;
}

/** When the next scheduled live run is due (EVAL_SCHEDULE). Null when no schedule is set. */
export interface EvalSchedule {
  /** "Nightly live suite, 6:00 AM PT". */
  text?: string | null;
  next_run_at?: string | null;
  /** Where it runs, e.g. "the owner's Mac (runs on wake if it was asleep)". */
  runner?: string | null;
}

/** GET /admin/eval-runs */
export interface EvalRunsResponse {
  /** Newest first. */
  runs: EvalRunRow[];
  /** How many runs the server keeps. */
  total?: number | null;
  /** The run the ship gate reads: the newest whole live run. */
  gate_run_id?: string | null;
  schedule?: EvalSchedule | null;
}

/** One case of a run (admin_issues._case_row): what the case view shows for that run. It carries no Linear link. */
export interface EvalRunCase {
  id: string;
  title?: string | null;
  tier?: string | null;
  area?: string | null;
  label?: string | null;
  verdict?: EvalVerdict | string | null;
  passed?: boolean | null;
  n_runs?: number | null;
  n_passed?: number | null;
  expect?: string | null;
  what_happened?: string | null;
  why?: string | null;
  fix?: string | null;
  /** ok is null for a run that crashed. */
  runs?: { ok?: boolean | null }[] | null;
  score?: number | null;
  /** An exact case: completeness gates it too. False for a run sent before exact. */
  exact?: boolean | null;
  /**
   * Its five dimensions are always named (null: not applicable, or not judged on it), with the ones that gate
   * this case once the judge counts: completeness too when the case is exact.
   */
  judge?: (EvalJudgeSummary & { gating?: string[] | null }) | null;
}

/** A run's cases in three groups, each in the run's own order. */
export interface EvalRunCaseGroups {
  regressions?: EvalRunCase[] | null;
  red_as_labeled?: EvalRunCase[] | null;
  ok?: EvalRunCase[] | null;
}

/** GET /admin/eval-runs/{id}: the row the list shows, then the cases. */
export interface EvalRunDetailResponse extends EvalRunRow {
  cases?: EvalRunCaseGroups | null;
}

// ─── The eval score's words (GUR-268) ────────────────────────────────────
// The gate card and the case view say the score the way the runner prints it: whole points, halves up.

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** A server score, or null when it isn't one (an older server sent null, or a bare number). */
export function asEvalScore(x: unknown): EvalScore | null {
  const s = x as EvalScore | null | undefined;
  return s && typeof s === 'object' && isFiniteNumber(s.topline) ? s : null;
}

/** "Eval score 58/100 · +3 vs baseline", or just "Eval score 58/100" without a baseline to compare. */
export function evalScoreLine(score: EvalScore): string {
  const head = `Eval score ${Math.round(score.topline)}/100`;
  if (!isFiniteNumber(score.delta)) return head;
  return `${head} · ${score.delta >= 0 ? '+' : ''}${score.delta} vs baseline`;
}

/**
 * "quality 81 · safety & consent 22 · ..." in the server's order: the weighted areas that ran.
 * Report a bug carries no weight, so it isn't listed. Null when no area has a score.
 */
export function evalScoreAreas(score: EvalScore): string | null {
  const parts = (Array.isArray(score.areas) ? score.areas : [])
    .filter((a) => a && isFiniteNumber(a.weight) && a.weight > 0 && isFiniteNumber(a.score))
    .map((a) => `${a.label} ${Math.round(a.score as number)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "Case score 20/100", or null for a case uploaded without one. */
export function caseScoreText(score: number | null | undefined): string | null {
  return isFiniteNumber(score) ? `Case score ${Math.round(score)}/100` : null;
}

/** The judge's means in its own order, e.g. "Faithfulness 4.7  ·  Honesty 5.0", skipping missing and null. */
export function judgeMeansText(means: EvalJudgeSummary['means'] | null | undefined): string | null {
  const parts: string[] = [];
  for (const k of JUDGE_DIMENSIONS) {
    const v = means?.[k];
    if (isFiniteNumber(v)) parts.push(`${k[0].toUpperCase()}${k.slice(1)} ${v.toFixed(1)}`);
  }
  return parts.length ? parts.join('  ·  ') : null;
}

// ─── Transport ───────────────────────────────────────────────────────────

type QueryValue = string | number | boolean | null | undefined;

function queryString(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    // Empty filters are omitted so the server applies its own default.
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function readDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return body && typeof body.detail === 'string' ? body.detail : null;
  } catch {
    return null;
  }
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authedFetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string> | undefined) || {}),
      },
    });
  } catch (e) {
    // authedFetch throws SessionExpiredError after starting the login redirect.
    if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'SessionExpiredError') {
      throw new AdminApiError('session', 'Signed out', 401);
    }
    throw new AdminApiError('network', 'Network error');
  }

  if (res.status === 403) {
    throw new AdminApiError('forbidden', 'Admin only', 403);
  }
  if (res.status === 404) {
    // FastAPI answers an unknown route with detail "Not Found". Anything more
    // specific (e.g. "Turn not found") means the route exists but the item does not.
    const detail = await readDetail(res);
    if (detail && detail !== 'Not Found') {
      throw new AdminApiError('not_found', detail, 404);
    }
    throw new AdminApiError('not_deployed', 'Not deployed yet', 404);
  }
  if (!res.ok) {
    // Surface a short server reason when there is one (e.g. 502 "Explain failed: RateLimitError").
    const detail = await readDetail(res);
    const reason = detail && detail.length <= 160 ? `${detail} (HTTP ${res.status})` : `Request failed (HTTP ${res.status})`;
    throw new AdminApiError('http', reason, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new AdminApiError('bad_response', 'Unexpected response', res.status);
  }
}

// ─── Endpoints ───────────────────────────────────────────────────────────

/** GET /me/access. Callers treat any error as "not an admin". */
export function getMeAccess(): Promise<MeAccess> {
  return adminRequest<MeAccess>('/me/access');
}

/** GET /admin/perf-metrics: API latency, recent calls, ingestion runs. */
export function getPerfMetrics(): Promise<PerfMetrics> {
  return adminRequest<PerfMetrics>('/admin/perf-metrics');
}

/** GET /admin/agent/summary */
export function getAgentSummary(params: { days: AgentWindowDays; traffic: AgentTrafficFilter }): Promise<AgentSummary> {
  return adminRequest<AgentSummary>(
    `/admin/agent/summary${queryString({ days: params.days, traffic: params.traffic })}`,
  );
}

/** GET /admin/agent/turns (paged) */
export function listAgentTurns(params: AgentTurnsQuery): Promise<AgentTurnsPage> {
  return adminRequest<AgentTurnsPage>(
    `/admin/agent/turns${queryString({
      days: params.days,
      traffic: params.traffic,
      outcome: params.outcome || undefined,
      flagged_only: params.flagged_only ?? false,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    })}`,
  );
}

/** GET /admin/agent/turns/{id} */
export function getAgentTurn(id: string): Promise<AgentTurnDetail> {
  return adminRequest<AgentTurnDetail>(`/admin/agent/turns/${encodeURIComponent(id)}`);
}

/** POST /admin/agent/turns/{id}/explain. Costs a model call: only ever on an explicit tap. */
export function explainAgentTurn(id: string): Promise<AgentExplainResponse> {
  return adminRequest<AgentExplainResponse>(`/admin/agent/turns/${encodeURIComponent(id)}/explain`, {
    method: 'POST',
  });
}

/** GET /admin/reports: newest first, at most 500. The server defaults to real traffic over 7 days. */
export function listReports(params: ReportsQuery = {}): Promise<AdminReportsPage> {
  return adminRequest<AdminReportsPage>(
    `/admin/reports${queryString({
      days: params.days ?? 7,
      status: params.status || undefined,
      traffic: params.traffic ?? 'real',
    })}`,
  );
}

/** GET /admin/reports/{id} */
export function getReport(id: string): Promise<AdminReportDetail> {
  return adminRequest<AdminReportDetail>(`/admin/reports/${encodeURIComponent(id)}`);
}

/**
 * POST /admin/reports/{id}/retry: files a failed (or stuck) report to Linear again
 * and starts a new triage, a paid Claude call. Only ever on an explicit tap.
 * The server answers 409 for any other report.
 */
export function retryReport(id: string): Promise<AdminReportDetail> {
  return adminRequest<AdminReportDetail>(`/admin/reports/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  });
}

/**
 * GET /admin/issues: every open issue in the window, newest first (eval cases,
 * beta reports, flagged production turns), under the ship gate read from the
 * latest eval run.
 */
export function getIssues(days: number = 7, source: IssueSourceFilter = 'all'): Promise<AdminIssuesResponse> {
  return adminRequest<AdminIssuesResponse>(`/admin/issues${queryString({ days, source })}`);
}

/**
 * GET /admin/evals/latest: the latest uploaded eval run, or null when there is
 * none (the server answers 404 with a reason; a bare 404 still means the route
 * is not deployed).
 */
export async function getLatestEvalRun(): Promise<EvalRun | null> {
  try {
    return await adminRequest<EvalRun>('/admin/evals/latest');
  } catch (e) {
    if (isAdminApiError(e) && e.kind === 'not_found') return null;
    throw e;
  }
}

/** The runs the Eval runs view lists. The server keeps 50. */
export const EVAL_RUNS_LIMIT = 20;

/**
 * GET /admin/eval-runs (GUR-282): the newest runs, newest first, every kind (live or scripted, whole or
 * partial), and when the next scheduled run is due.
 */
export function listEvalRuns(limit: number = EVAL_RUNS_LIMIT): Promise<EvalRunsResponse> {
  return adminRequest<EvalRunsResponse>(`/admin/eval-runs${queryString({ limit })}`);
}

/**
 * GET /admin/eval-runs/{id} (GUR-282): one run's row, then its cases in three groups. A 404 with a reason
 * means the run is gone (the server keeps the newest 50); a bare 404 still means the route is not deployed.
 */
export function getEvalRun(id: string): Promise<EvalRunDetailResponse> {
  return adminRequest<EvalRunDetailResponse>(`/admin/eval-runs/${encodeURIComponent(id)}`);
}
