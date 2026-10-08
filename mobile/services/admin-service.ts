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

export interface AdminReport {
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
  /** Null until the eval score ships (GUR-268). */
  score: number | null;
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

/** The LLM judge over a case's live runs. Report-only until it is calibrated. */
export interface EvalJudgeSummary {
  /** How many judged runs met the case, e.g. "2/3". */
  meets: string;
  /** Rubric means, 1 to 5. A rubric passes at 4. */
  means: { voice: number | null; honesty: number | null; journey: number | null };
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
  cases: EvalCaseResult[];
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
