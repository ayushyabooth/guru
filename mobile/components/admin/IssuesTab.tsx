/**
 * Issues tab of the Perf panel (admins only, GUR-271), frame 18:3: every open
 * issue in one list, newest first, whatever found it (an eval case, a beta
 * report, a flagged production turn), under the ship gate read from the
 * latest eval run. A row opens its detail: an eval case (EvalCaseDetail,
 * frame 18:72), a report (ReportDetail) or a turn (AgentTurnDetail), the same
 * views the Reports and Agent tabs open.
 *
 * One read for the window; the source chips filter it here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../ui/Icon';
import { liquidGlassPill } from '../../constants/liquidGlass';
import {
  AdminApiError,
  AdminIssue,
  AdminIssuesResponse,
  GateReason,
  IssueCounts,
  IssueSourceFilter,
  IssueStatus,
  ShipGate,
  getIssues,
  toAdminError,
} from '../../services/admin-service';
import { AdminPalette, fmtAgo, isNum, issueToneColor, shortId, useAdminPalette, withAlpha } from './adminTheme';
import { StateMessage } from './AdminUI';
import AgentTurnDetailModal from './AgentTurnDetail';
import ReportDetail, { FIRST_BLOCK_BUDGET_MS, fmtWhen } from './ReportDetail';
import EvalCaseDetail, { GlassTag, IssueStatusTag, spoken } from './EvalCaseDetail';
import { FACE, glassSurface } from '../report/reportTheme';

const WINDOW_DAYS = 7;

/** A row's source chip: a quiet glass chip, so color still means status. */
const SOURCES: Record<string, { label: string; icon: string; hint: string }> = {
  eval: { label: 'Eval', icon: 'flask', hint: 'Opens the case' },
  report: { label: 'Report', icon: 'flag', hint: 'Opens the report' },
  production: { label: 'Production', icon: 'gauge', hint: 'Opens the turn' },
};

const FILTERS: { value: IssueSourceFilter; label: string; empty: string }[] = [
  { value: 'all', label: 'All', empty: `No open issues in the last ${WINDOW_DAYS} days` },
  { value: 'eval', label: 'Evals', empty: `No open eval issues in the last ${WINDOW_DAYS} days` },
  { value: 'report', label: 'Reports', empty: `No open reports in the last ${WINDOW_DAYS} days` },
  { value: 'production', label: 'Production', empty: `No open production issues in the last ${WINDOW_DAYS} days` },
];

// ─── The ship gate ───────────────────────────────────────────────────────

const REASON_LABEL: Record<string, string> = {
  safety: 'Safety',
  regressions: 'Regressions',
  reports: 'Open beta reports',
};

/** Labels the server may already have put at the start of a line. The label is drawn here, so they are dropped. */
const REASON_PREFIXES: Record<string, string[]> = {
  safety: ['safety'],
  regressions: ['regressions', 'regression'],
  reports: ['open beta reports', 'open reports', 'beta reports', 'reports'],
};

function reasonParts(r: GateReason): { label: string; text: string } {
  const kind = String(r?.kind || '');
  const label = REASON_LABEL[kind] || (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Check');
  let text = String(r?.text || '').trim();
  for (const prefix of REASON_PREFIXES[kind] || [kind.toLowerCase()]) {
    if (prefix && text.toLowerCase().startsWith(`${prefix}:`)) {
      text = text.slice(prefix.length + 1).trim();
      break;
    }
  }
  return { label, text };
}

/** Green when ok. Not ok is red, except the reports line: amber, since reports never block the gate by themselves. */
function reasonColor(r: GateReason, P: AdminPalette): string {
  if (r.ok) return P.good;
  return r.kind === 'reports' ? P.warn : P.bad;
}

function gateLook(state: string | null | undefined, P: AdminPalette) {
  if (state === 'blocked') return { color: P.bad, icon: 'x-circle', word: 'blocked', toned: true };
  if (state === 'clear') return { color: P.good, icon: 'check-circle', word: 'clear', toned: true };
  return { color: P.muted, icon: 'circle-dashed', word: 'no eval run yet', toned: false };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** The server's answer, with every list and count present. */
function normalize(res: AdminIssuesResponse | null | undefined): AdminIssuesResponse {
  const issues = res && Array.isArray(res.issues) ? res.issues.filter(Boolean) : [];
  const c: Partial<IssueCounts> = res?.counts ?? {};
  const count = (x: unknown, source: string) =>
    isNum(x) ? x : issues.filter((i) => source === 'all' || i.source === source).length;
  const gate: ShipGate = res?.gate ?? { state: 'unknown', reasons: [], run: null, score: null };
  return {
    gate,
    counts: {
      all: count(c.all, 'all'),
      eval: count(c.eval, 'eval'),
      report: count(c.report, 'report'),
      production: count(c.production, 'production'),
    },
    issues,
  };
}

/** What a row opens, from its source and ref. Null when the ref is missing its id. */
type OpenTarget =
  | { kind: 'case'; caseId: string }
  | { kind: 'report'; reportId: string }
  | { kind: 'turn'; traceId: string };

function targetOf(issue: AdminIssue): OpenTarget | null {
  const ref = issue.ref || {};
  if (issue.source === 'eval' && ref.case_id) return { kind: 'case', caseId: ref.case_id };
  if (issue.source === 'report' && ref.report_id) return { kind: 'report', reportId: ref.report_id };
  if (issue.source === 'production' && ref.trace_id) return { kind: 'turn', traceId: ref.trace_id };
  return null;
}

/** Mirrors bug_reports.reference: the first 8 hex characters of the report id, for the header while it loads. */
function reportReference(id: string): string {
  return id.replace(/-/g, '').toLowerCase().slice(0, 8);
}

/** Errors that make the whole tab meaningless. */
function isBlocking(e: AdminApiError | null): boolean {
  return !!e && (e.kind === 'forbidden' || e.kind === 'not_deployed' || e.kind === 'session');
}

function blockingDetail(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The issues endpoint is not on this server yet.';
  if (e.kind === 'session') return 'Sign in again to see issues.';
  return undefined;
}

// ─── The tab ─────────────────────────────────────────────────────────────

interface Props {
  /** Bumped by the panel's Refresh button. */
  refreshSignal: number;
  /** Height available to the tab's scroll area inside the panel. */
  maxHeight: number;
}

export default function IssuesTab({ refreshSignal, maxHeight }: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);

  const [data, setData] = useState<AdminIssuesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [pulling, setPulling] = useState(false);
  const [filter, setFilter] = useState<IssueSourceFilter>('all');
  const [openCase, setOpenCase] = useState<{ caseId: string; status: IssueStatus | null; linearUrl: string | null } | null>(
    null,
  );
  const [openReport, setOpenReport] = useState<{ id: string; reference: string } | null>(null);
  const [openTurnId, setOpenTurnId] = useState<string | null>(null);

  // A slow response never overwrites a newer one.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getIssues(WINDOW_DAYS, 'all');
      if (mine !== seq.current) return;
      setData(normalize(res));
    } catch (e) {
      if (mine === seq.current) setError(toAdminError(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The panel's Refresh button: reload in place, keeping what is on screen.
  const firstSignal = useRef(refreshSignal);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    if (refreshSignal === firstSignal.current) return;
    latestLoad.current();
  }, [refreshSignal]);

  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await load();
    } finally {
      setPulling(false);
    }
  }, [load]);

  // A retry on an open report can change its row: reload the list behind it.
  const onReportChanged = useCallback(() => {
    latestLoad.current();
  }, []);

  const open = (issue: AdminIssue, target: OpenTarget) => {
    if (target.kind === 'case') {
      setOpenCase({ caseId: target.caseId, status: issue.status?.text ? issue.status : null, linearUrl: issue.linear_url || null });
    } else if (target.kind === 'report') {
      setOpenReport({ id: target.reportId, reference: reportReference(target.reportId) });
    } else {
      setOpenTurnId(target.traceId);
    }
  };

  // An open case follows its row through a refresh: the header tag and Linear link stay current.
  const caseRow =
    openCase && data ? data.issues.find((i) => i.source === 'eval' && i.ref?.case_id === openCase.caseId) ?? null : null;
  const caseStatus = caseRow?.status?.text ? caseRow.status : openCase?.status ?? null;
  const caseLinear = caseRow?.linear_url || openCase?.linearUrl || null;

  const blocking = isBlocking(error) && !data ? error : null;
  const shown = data ? (filter === 'all' ? data.issues : data.issues.filter((i) => i.source === filter)) : [];
  const anyIssues = !!data && (data.issues.length > 0 || data.counts.all > 0);
  const emptyCopy = (anyIssues ? FILTERS.find((f) => f.value === filter) : FILTERS[0])?.empty ?? FILTERS[0].empty;
  const detailOpen = !!openCase || !!openReport;

  return (
    <View>
      {/* The list stays mounted under an open case or report, so Back returns to the same place. */}
      <ScrollView
        style={[{ maxHeight }, detailOpen ? s.hidden : null]}
        contentContainerStyle={s.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        refreshControl={
          Platform.OS === 'web' ? undefined : (
            <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={P.accent} colors={[P.accent]} />
          )
        }
      >
        {blocking ? (
          <StateMessage title={blocking.message} detail={blockingDetail(blocking)} P={P} />
        ) : !data && loading ? (
          <ActivityIndicator color={P.accent} style={s.spinner} />
        ) : !data && error ? (
          <StateMessage
            title="Could not load issues"
            detail={error.message}
            actionLabel="Try again"
            onAction={load}
            P={P}
            tone="bad"
          />
        ) : data ? (
          <>
            {error ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

            <ShipGateCard gate={data.gate} P={P} s={s} />

            {anyIssues ? <SourceFilters counts={data.counts} value={filter} onChange={setFilter} P={P} s={s} /> : null}

            {shown.length === 0 ? (
              <StateMessage
                title={emptyCopy}
                detail={anyIssues ? undefined : 'Red eval cases, beta reports and flagged turns land here.'}
                P={P}
              />
            ) : (
              shown.map((issue, i) => {
                const target = targetOf(issue);
                return (
                  <IssueRow
                    key={issue.key || `${issue.source}-${i}`}
                    issue={issue}
                    onOpen={target ? () => open(issue, target) : null}
                    P={P}
                    s={s}
                  />
                );
              })
            )}
          </>
        ) : null}
      </ScrollView>

      {openCase ? (
        <ScrollView style={{ maxHeight }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <EvalCaseDetail
            key={openCase.caseId}
            caseId={openCase.caseId}
            status={caseStatus}
            linearUrl={caseLinear}
            refreshSignal={refreshSignal}
            onBack={() => setOpenCase(null)}
          />
        </ScrollView>
      ) : null}

      {openReport ? (
        <ScrollView style={{ maxHeight }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <ReportDetail
            key={openReport.id}
            reportId={openReport.id}
            reference={openReport.reference}
            refreshSignal={refreshSignal}
            onBack={() => setOpenReport(null)}
            backLabel="Back to issues"
            onOpenTurn={setOpenTurnId}
            onChanged={onReportChanged}
          />
        </ScrollView>
      ) : null}

      <AgentTurnDetailModal
        turnId={openTurnId}
        onClose={() => setOpenTurnId(null)}
        onNavigate={setOpenTurnId}
        firstBlockBudgetMs={FIRST_BLOCK_BUDGET_MS}
      />
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

function ShipGateCard({ gate, P, s }: { gate: ShipGate; P: AdminPalette; s: Styles }) {
  const look = gateLook(gate?.state, P);
  const reasons = Array.isArray(gate?.reasons) ? gate.reasons.filter(Boolean) : [];
  const run = gate?.run ?? null;
  const score = isNum(gate?.score) ? gate.score : null;
  const scoreText = score !== null ? `Eval score: ${score}` : 'Eval score: coming with GUR-268';
  const runWhen = run ? fmtWhen(run.run_at) : null;
  const meta = run
    ? [
        runWhen ? `Eval run ${runWhen}` : 'Eval run',
        run.build_sha ? `build ${shortId(run.build_sha, 7)}` : null,
        run.prompt_version ? `prompt ${shortId(run.prompt_version, 8)}` : null,
      ]
        .filter(Boolean)
        .join('  ·  ')
    : null;
  const lines = reasons.map(reasonParts);
  const summary = [
    `Ship gate: ${look.word}`,
    ...lines.map((l) => (l.text ? `${l.label}: ${l.text}` : l.label)),
    scoreText,
    meta ? spoken(meta) : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View
      style={[glassSurface('regular', P.isDark), s.gate, look.toned ? { borderColor: withAlpha(look.color, 0.45) } : null]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={summary}
    >
      {/* The state's wash over the glass: red when blocked, green when clear. */}
      {look.toned ? (
        <View style={[s.gateTint, { backgroundColor: withAlpha(look.color, 0.07) }]} />
      ) : null}

      <View style={s.gateHead}>
        <View style={[s.gateBadge, { backgroundColor: withAlpha(look.color, 0.18) }]}>
          <Icon name={look.icon} size={18} color={look.color} weight="bold" />
        </View>
        <Text style={s.gateTitle}>
          Ship gate: <Text style={{ color: look.toned ? look.color : P.textSecondary }}>{look.word}</Text>
        </Text>
      </View>

      {lines.length ? (
        <View style={s.reasons}>
          {lines.map((l, i) => (
            <View key={`${reasons[i].kind}-${i}`} style={s.reason}>
              <View style={[s.dot, { backgroundColor: reasonColor(reasons[i], P) }]} />
              <Text style={s.reasonText}>
                <Text style={s.reasonLabel}>{l.label}:</Text>
                {l.text ? ` ${l.text}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* The eval score's slot, dashed until GUR-268 fills it. */}
      <View style={[s.scoreSlot, score === null ? s.scoreSlotEmpty : null]}>
        <Text style={s.gateSmall}>{scoreText}</Text>
      </View>

      {meta ? <Text style={s.gateSmall}>{meta}</Text> : null}
    </View>
  );
}

function SourceFilters({
  counts,
  value,
  onChange,
  P,
  s,
}: {
  counts: IssueCounts;
  value: IssueSourceFilter;
  onChange: (v: IssueSourceFilter) => void;
  P: AdminPalette;
  s: Styles;
}) {
  return (
    <View style={s.filters} accessibilityRole="radiogroup" accessibilityLabel="Issue source">
      {FILTERS.map((f) => {
        const active = f.value === value;
        const n = counts[f.value];
        return (
          <TouchableOpacity
            key={f.value}
            onPress={() => onChange(f.value)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, selected: active }}
            accessibilityLabel={`${f.label}, ${n}`}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={[
              active ? liquidGlassPill(P.accentHex, P.isDark) : glassSurface('thin', P.isDark),
              s.filter,
              active ? null : s.flat,
            ]}
          >
            <Text style={[s.filterText, active ? s.filterTextActive : null]} numberOfLines={1}>
              {f.label}
              {'  '}
              <Text style={{ color: active ? P.accent : P.textTertiary }}>{n}</Text>
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function IssueRow({
  issue,
  onOpen,
  P,
  s,
}: {
  issue: AdminIssue;
  onOpen: (() => void) | null;
  P: AdminPalette;
  s: Styles;
}) {
  const source = SOURCES[issue.source] ?? null;
  const status = issue.status?.text ? issue.status : null;
  const chip = issue.chip?.text ? issue.chip : null;
  const chipColor = (chip && issueToneColor(chip.tone, P)) || P.accent;
  const footer = issue.footer || null;
  const ago = fmtAgo(issue.at);

  const label = [
    [source?.label, status ? spoken(status.text) : null, ago ? (ago === 'now' ? 'just now' : `${ago} ago`) : null]
      .filter(Boolean)
      .join(', '),
    issue.title,
    issue.body,
    footer ? spoken(footer) : null,
    chip ? spoken(chip.text) : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <TouchableOpacity
      onPress={onOpen ?? undefined}
      disabled={!onOpen}
      activeOpacity={0.8}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={`${label}.`}
      accessibilityHint={onOpen ? source?.hint : undefined}
      style={[glassSurface('regular', P.isDark), s.row]}
    >
      <View style={s.rowTop}>
        {source ? <GlassTag label={source.label} icon={source.icon} P={P} /> : null}
        {status ? (
          <View style={s.rowStatus}>
            <IssueStatusTag status={status} P={P} />
          </View>
        ) : null}
        <View style={s.spacer} />
        {ago ? <Text style={s.rowAgo}>{ago}</Text> : null}
      </View>
      <Text style={s.rowTitle} numberOfLines={2}>
        {issue.title}
      </Text>
      {issue.body ? (
        <Text style={s.rowBody} numberOfLines={2}>
          {issue.body}
        </Text>
      ) : null}
      {footer || chip ? (
        <View style={s.rowBottom}>
          <Text style={s.rowFooter} numberOfLines={1}>
            {footer ?? ''}
          </Text>
          {chip ? (
            <View style={[s.chip, { backgroundColor: withAlpha(chipColor, 0.16) }]}>
              <Icon name="pulse" size={12} color={chipColor} weight="bold" />
              <Text style={[s.chipText, { color: chipColor }]} numberOfLines={1}>
                {chip.text}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

function makeStyles(P: AdminPalette) {
  return StyleSheet.create({
    hidden: {
      display: 'none',
    },
    content: {
      gap: 14,
      paddingBottom: 12,
    },
    spinner: {
      marginVertical: 16,
    },
    inlineError: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.bad,
    },
    spacer: {
      flex: 1,
    },

    // Ship gate
    gate: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 10,
    },
    gateTint: {
      ...StyleSheet.absoluteFillObject,
      // Inside the glass edge (1.5).
      borderRadius: 16.5,
      pointerEvents: 'none',
    },
    gateHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    gateBadge: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gateTitle: {
      ...FACE.bold,
      fontSize: 15,
      lineHeight: 21,
      color: P.text,
      flexShrink: 1,
    },
    reasons: {
      gap: 6,
    },
    reason: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    // Centered on the first line (17).
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginTop: 5.5,
    },
    reasonText: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
      flex: 1,
    },
    reasonLabel: {
      ...FACE.semibold,
      color: P.text,
    },
    scoreSlot: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: P.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    scoreSlotEmpty: {
      borderStyle: 'dashed',
      borderColor: withAlpha(P.muted, 0.45),
    },
    gateSmall: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },

    // Source filters: wrap rather than scroll when the counts outgrow a narrow phone.
    filters: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    filter: {
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    flat: {
      shadowOpacity: 0,
      elevation: 0,
    },
    filterText: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    filterTextActive: {
      ...FACE.semibold,
      color: P.text,
    },

    // Rows (the Reports tab's card)
    row: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rowStatus: {
      flexShrink: 1,
      minWidth: 0,
    },
    rowAgo: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    rowTitle: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
    rowBody: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rowFooter: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      flex: 1,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    chipText: {
      ...FACE.semibold,
      fontSize: 11,
      lineHeight: 15,
    },
  });
}
