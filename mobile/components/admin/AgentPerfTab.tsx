/**
 * Agent tab of the Perf panel (admins only).
 *
 * Summary first, depth below: plain-English takeaways, then tiles, then the
 * tools and builds tables, then flagged turns and every turn (paged). Tapping a
 * turn opens the full trace (AgentTurnDetail).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import {
  AdminApiError,
  AgentBudgetStat,
  AgentBuildStat,
  AgentOutcome,
  AgentSummary,
  AgentSummaryTiles,
  AgentTakeaway,
  AgentToolStat,
  AgentTrafficFilter,
  AgentTurnRow,
  AgentWindowDays,
  getAgentSummary,
  listAgentTurns,
  toAdminError,
} from '../../services/admin-service';
import {
  AdminPalette,
  AdminType,
  MONO,
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtMs,
  fmtMsDelta,
  fmtNum,
  fmtPct,
  inputLine,
  isNum,
  outcomeColor,
  outcomeLabel,
  severityLabel,
  shortId,
  takeawayColor,
  turnSeverityColor,
  useAdminPalette,
  withAlpha,
} from './adminTheme';
import { ActionButton, Chip, SectionHeader, Segmented, SegmentOption, StateMessage } from './AdminUI';
import AgentTurnDetailModal from './AgentTurnDetail';

const PAGE_SIZE = 50;

const TRAFFIC_OPTIONS: SegmentOption<AgentTrafficFilter>[] = [
  { value: 'real', label: 'Real' },
  { value: 'synthetic', label: 'Synthetic' },
  { value: 'all', label: 'All' },
];

const WINDOW_OPTIONS: SegmentOption<AgentWindowDays>[] = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
];

const OUTCOME_FILTERS: SegmentOption<AgentOutcome | ''>[] = [
  { value: '', label: 'Any outcome' },
  ...OUTCOME_ORDER.map((o) => ({ value: o, label: OUTCOME_LABEL[o] })),
];

const TRAFFIC_LABEL: Record<AgentTrafficFilter, string> = {
  real: 'real traffic',
  synthetic: 'synthetic traffic',
  all: 'all traffic',
};

/** Errors that make the whole tab meaningless (nothing else will load either). */
function isBlocking(e: AdminApiError | null): boolean {
  return !!e && (e.kind === 'forbidden' || e.kind === 'not_deployed' || e.kind === 'session');
}

function blockingDetail(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The agent trace endpoints are not on this server yet.';
  if (e.kind === 'session') return 'Sign in again to see traces.';
  return undefined;
}

/** Merge a new page into the list without duplicates (new turns can shift offsets). */
function appendUnique(prev: AgentTurnRow[], next: AgentTurnRow[]): AgentTurnRow[] {
  const seen = new Set(prev.map((t) => t.id));
  return prev.concat(next.filter((t) => t && !seen.has(t.id)));
}

interface Props {
  /** Bumped by the panel's Refresh button. */
  refreshSignal: number;
  /** Height available to the tab's scroll area inside the panel. */
  maxHeight: number;
}

export default function AgentPerfTab({ refreshSignal, maxHeight }: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);

  const [traffic, setTraffic] = useState<AgentTrafficFilter>('real');
  const [days, setDays] = useState<AgentWindowDays>(7);
  const [outcome, setOutcome] = useState<AgentOutcome | ''>('');

  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<AdminApiError | null>(null);

  const [turns, setTurns] = useState<AgentTurnRow[]>([]);
  const [turnsTotal, setTurnsTotal] = useState<number | null>(null);
  const [turnsLoading, setTurnsLoading] = useState(false);
  const [turnsError, setTurnsError] = useState<AdminApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<AdminApiError | null>(null);

  const [pulling, setPulling] = useState(false);
  const [openTurnId, setOpenTurnId] = useState<string | null>(null);

  // Request sequencing: a slow response for old filters never overwrites a newer one.
  const summarySeq = useRef(0);
  const turnsSeq = useRef(0);

  const loadSummary = useCallback(async () => {
    const seq = ++summarySeq.current;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await getAgentSummary({ days, traffic });
      if (seq === summarySeq.current) setSummary(data ?? null);
    } catch (e) {
      if (seq === summarySeq.current) setSummaryError(toAdminError(e));
    } finally {
      if (seq === summarySeq.current) setSummaryLoading(false);
    }
  }, [days, traffic]);

  const loadTurns = useCallback(async () => {
    const seq = ++turnsSeq.current;
    setTurnsLoading(true);
    setTurnsError(null);
    setMoreError(null);
    try {
      const page = await listAgentTurns({ days, traffic, outcome, flagged_only: false, limit: PAGE_SIZE, offset: 0 });
      if (seq !== turnsSeq.current) return;
      const rows = Array.isArray(page?.turns) ? page.turns.filter(Boolean) : [];
      setTurns(rows);
      setTurnsTotal(isNum(page?.total) ? page.total : rows.length);
    } catch (e) {
      if (seq === turnsSeq.current) setTurnsError(toAdminError(e));
    } finally {
      if (seq === turnsSeq.current) setTurnsLoading(false);
    }
  }, [days, traffic, outcome]);

  const loadMore = async () => {
    if (loadingMore || turnsLoading) return;
    const seq = turnsSeq.current; // a filter change bumps this and voids the page
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listAgentTurns({
        days,
        traffic,
        outcome,
        flagged_only: false,
        limit: PAGE_SIZE,
        offset: turns.length,
      });
      if (seq !== turnsSeq.current) return;
      const rows = Array.isArray(page?.turns) ? page.turns.filter(Boolean) : [];
      setTurns((prev) => appendUnique(prev, rows));
      if (isNum(page?.total)) setTurnsTotal(page.total);
    } catch (e) {
      if (seq === turnsSeq.current) setMoreError(toAdminError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  // New window or traffic (and first open): start clean so stale numbers never
  // sit under a different filter.
  useEffect(() => {
    setSummary(null);
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setTurns([]);
    setTurnsTotal(null);
    loadTurns();
  }, [loadTurns]);

  // The panel's Refresh button: reload in place, keeping what is on screen.
  const latest = useRef({ loadSummary, loadTurns });
  useEffect(() => {
    latest.current = { loadSummary, loadTurns };
  });
  const firstSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === firstSignal.current) return;
    latest.current.loadSummary();
    latest.current.loadTurns();
  }, [refreshSignal]);

  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await Promise.all([loadSummary(), loadTurns()]);
    } finally {
      setPulling(false);
    }
  }, [loadSummary, loadTurns]);

  const openTurn = useCallback((id: string) => {
    if (id) setOpenTurnId(id);
  }, []);

  // ── Derived ──
  const windowTurns = isNum(summary?.window?.turns)
    ? summary!.window.turns
    : isNum(summary?.tiles?.turns)
      ? (summary!.tiles.turns as number)
      : null;
  const isEmpty = summary !== null && windowTurns === 0;
  const blocking = isBlocking(summaryError) && !summary ? summaryError : isBlocking(turnsError) && !summary ? turnsError : null;

  const takeaways = Array.isArray(summary?.takeaways) ? summary!.takeaways : [];
  const tools = Array.isArray(summary?.tools) ? summary!.tools : [];
  const builds = Array.isArray(summary?.builds) ? summary!.builds : [];
  const flagged = Array.isArray(summary?.flagged) ? summary!.flagged : [];

  const canLoadMore = isNum(turnsTotal) && turns.length < turnsTotal && !turnsLoading;

  return (
    <View>
      <ScrollView
        style={{ maxHeight }}
        contentContainerStyle={s.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        refreshControl={
          Platform.OS === 'web' ? undefined : (
            <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={P.accent} colors={[P.accent]} />
          )
        }
      >
        {/* Controls */}
        <View style={s.controls}>
          <Segmented
            options={TRAFFIC_OPTIONS}
            value={traffic}
            onChange={setTraffic}
            P={P}
            accessibilityLabel="Traffic"
          />
          <Segmented options={WINDOW_OPTIONS} value={days} onChange={setDays} P={P} accessibilityLabel="Time window" />
          {(summaryLoading || turnsLoading) && (summary || turns.length > 0) ? (
            <View style={s.updating} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={P.accent} />
              <Text style={s.updatingText}>Updating</Text>
            </View>
          ) : null}
        </View>

        {summary && !isEmpty ? (
          <Text style={s.windowLine}>
            {fmtNum(windowTurns)} turns{summary.window?.since ? ` since ${fmtDateTime(summary.window.since)}` : ''},{' '}
            {TRAFFIC_LABEL[traffic]}
          </Text>
        ) : null}

        {blocking ? (
          <StateMessage title={blocking.message} detail={blockingDetail(blocking)} P={P} />
        ) : !summary && summaryLoading ? (
          <ActivityIndicator color={P.accent} style={s.spinner} />
        ) : !summary && summaryError ? (
          <StateMessage
            title={summaryError.message}
            detail="Could not load the agent summary."
            actionLabel="Try again"
            onAction={loadSummary}
            P={P}
            tone="bad"
          />
        ) : isEmpty ? (
          <StateMessage
            title="No agent turns yet"
            detail="Traces appear here after the first agent turn in this window."
            P={P}
          />
        ) : summary ? (
          <>
            {summaryError ? (
              <Text style={s.inlineError}>Could not refresh: {summaryError.message}</Text>
            ) : null}

            {/* Takeaways */}
            <Text style={s.firstSectionTitle} accessibilityRole="header">
              Takeaways
            </Text>
            <Takeaways items={takeaways} onOpenTurn={openTurn} P={P} s={s} />

            {/* Tiles */}
            <SectionHeader title="At a glance" P={P} />
            <Tiles tiles={summary.tiles} P={P} s={s} />

            {/* Tools */}
            <SectionHeader title="Tools" right={tools.length ? `${tools.length}` : undefined} P={P} />
            <ToolsTable tools={tools} P={P} s={s} />

            {/* Builds */}
            <SectionHeader title="Builds" right="newest first" P={P} />
            <Builds builds={builds} P={P} s={s} />

            {/* Flagged */}
            <SectionHeader title="Flagged turns" right={`${flagged.length}`} P={P} />
            {flagged.length === 0 ? (
              <Text style={s.muted}>No flagged turns in this window.</Text>
            ) : (
              flagged.map((row, i) => <TurnRowItem key={`f-${row?.id ?? i}`} row={row} onOpen={openTurn} P={P} s={s} />)
            )}
          </>
        ) : null}

        {/* All turns (paged). Shown once the summary has answered; hidden when the tab is gated or empty. */}
        {!blocking && !isEmpty && (summary || summaryError) ? (
          <>
            <SectionHeader
              title="All turns"
              right={isNum(turnsTotal) ? `${fmtNum(turns.length)} of ${fmtNum(turnsTotal)}` : undefined}
              P={P}
            />
            <View style={s.filterRow}>
              {OUTCOME_FILTERS.map((opt) => {
                const active = opt.value === outcome;
                return (
                  <TouchableOpacity
                    key={opt.value || 'any'}
                    onPress={() => setOutcome(opt.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`Filter: ${opt.label}`}
                    hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                    style={[s.filterChip, active && s.filterChipActive]}
                  >
                    <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {turnsLoading && turns.length === 0 ? (
              <ActivityIndicator color={P.accent} style={s.spinner} />
            ) : turnsError && turns.length === 0 ? (
              <StateMessage
                title={turnsError.message}
                detail={isBlocking(turnsError) ? blockingDetail(turnsError) : 'Could not load turns.'}
                actionLabel={isBlocking(turnsError) ? undefined : 'Try again'}
                onAction={loadTurns}
                P={P}
                tone={isBlocking(turnsError) ? 'muted' : 'bad'}
              />
            ) : turns.length === 0 ? (
              <Text style={s.muted}>No turns match this filter.</Text>
            ) : (
              turns.map((row, i) => <TurnRowItem key={`t-${row?.id ?? i}`} row={row} onOpen={openTurn} P={P} s={s} />)
            )}

            {turnsError && turns.length > 0 ? (
              <Text style={s.inlineError}>Could not refresh turns: {turnsError.message}</Text>
            ) : null}
            {moreError ? <Text style={s.inlineError}>Could not load more: {moreError.message}</Text> : null}
            {canLoadMore ? (
              <ActionButton
                label={loadingMore ? 'Loading' : `Load ${Math.min(PAGE_SIZE, (turnsTotal as number) - turns.length)} more`}
                onPress={loadMore}
                busy={loadingMore}
                P={P}
                style={s.loadMore}
                accessibilityLabel="Load more turns"
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <AgentTurnDetailModal
        turnId={openTurnId}
        onClose={() => setOpenTurnId(null)}
        onNavigate={openTurn}
        firstBlockBudgetMs={summary?.tiles?.first_block_ms?.budget ?? null}
        totalBudgetMs={summary?.tiles?.total_ms?.budget ?? null}
      />
    </View>
  );
}

// ─── Takeaways ───────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

function Takeaways({
  items,
  onOpenTurn,
  P,
  s,
}: {
  items: AgentTakeaway[];
  onOpenTurn: (id: string) => void;
  P: AdminPalette;
  s: Styles;
}) {
  if (items.length === 0) {
    return <Text style={s.muted}>Nothing stands out in this window.</Text>;
  }
  return (
    <View style={s.takeaways}>
      {items.map((t, i) => {
        const color = takeawayColor(t?.severity, P);
        const ids = Array.isArray(t?.turn_ids) ? t.turn_ids.filter(Boolean) : [];
        return (
          <View
            key={`tk-${i}`}
            style={[s.takeaway, { borderLeftColor: color, backgroundColor: withAlpha(color, P.isDark ? 0.1 : 0.06) }]}
            accessible={ids.length === 0}
            accessibilityLabel={`${severityLabel(t?.severity)}: ${t?.text ?? ''}`}
          >
            <Text style={s.takeawayText}>{t?.text || 'No text'}</Text>
            {ids.length > 0 ? (
              <View style={s.takeawayLinks}>
                {ids.slice(0, 5).map((id, j) => (
                  <TouchableOpacity
                    key={id}
                    onPress={() => onOpenTurn(id)}
                    accessibilityRole="button"
                    accessibilityLabel={ids.length === 1 ? 'View turn' : `View turn ${j + 1} of ${ids.length}`}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text style={s.link}>{ids.length === 1 ? 'View turn' : `Turn ${j + 1}`}</Text>
                  </TouchableOpacity>
                ))}
                {ids.length > 5 ? <Text style={s.mutedSmall}>+{ids.length - 5} more</Text> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ─── Tiles ───────────────────────────────────────────────────────────────

/** bad when the median misses the budget, warn when only p95 does, good otherwise. */
function budgetTone(stat: AgentBudgetStat | null | undefined): 'bad' | 'warn' | 'good' | null {
  const p50 = stat?.p50;
  const p95 = stat?.p95;
  const budget = stat?.budget;
  if (!isNum(budget) || (!isNum(p50) && !isNum(p95))) return null;
  if (isNum(p50) && p50 > budget) return 'bad';
  if (isNum(p95) && p95 > budget) return 'warn';
  return 'good';
}

function Tile({
  label,
  tone,
  wide,
  children,
  P,
  s,
}: {
  label: string;
  tone?: 'bad' | 'warn' | 'good' | null;
  wide?: boolean;
  children: React.ReactNode;
  P: AdminPalette;
  s: Styles;
}) {
  return (
    <View style={[s.tile, wide && s.tileWide, tone ? { borderLeftColor: P[tone], borderLeftWidth: 3 } : null]}>
      <Text style={s.tileLabel}>{label}</Text>
      {children}
    </View>
  );
}

function BudgetTile({ label, stat, P, s }: { label: string; stat: AgentBudgetStat | null | undefined; P: AdminPalette; s: Styles }) {
  const tone = budgetTone(stat);
  const budget = stat?.budget;
  const p50Over = isNum(stat?.p50) && isNum(budget) && (stat!.p50 as number) > budget;
  const p95Over = isNum(stat?.p95) && isNum(budget) && (stat!.p95 as number) > budget;
  const over = stat?.over;
  return (
    <Tile label={label} tone={tone} P={P} s={s}>
      <View style={s.tilePair}>
        <View>
          <Text style={[s.tileNum, p50Over && { color: P.bad }]}>{fmtMs(stat?.p50)}</Text>
          <Text style={s.tileCaption}>p50</Text>
        </View>
        <View>
          <Text style={[s.tileNum, p95Over && { color: P.bad }]}>{fmtMs(stat?.p95)}</Text>
          <Text style={s.tileCaption}>p95</Text>
        </View>
      </View>
      <Text style={s.tileSub}>
        {isNum(budget) ? `Budget ${fmtMs(budget)}` : 'No budget'}
        {isNum(over) ? `, ${fmtNum(over)} over` : ''}
      </Text>
    </Tile>
  );
}

function Tiles({ tiles, P, s }: { tiles: AgentSummaryTiles | null | undefined; P: AdminPalette; s: Styles }) {
  // The server lists only outcomes that happened, so a missing key is 0. No object at all is "no data".
  const outcomeMap = tiles?.outcomes && typeof tiles.outcomes === 'object' ? tiles.outcomes : null;
  const outcomes = OUTCOME_ORDER.map((key) => {
    const raw = outcomeMap ? outcomeMap[key] : null;
    return { key, raw: isNum(raw) ? raw : outcomeMap ? 0 : null };
  });
  const outcomeTotal = outcomes.reduce((sum, o) => sum + (o.raw ?? 0), 0);

  const cache = tiles?.cache_share;
  const cachePct = isNum(cache) ? Math.max(0, Math.min(1, cache)) * 100 : null;

  const it = tiles?.iterations;
  const itersOver = isNum(it?.max) && isNum(it?.budget) && (it!.max as number) > (it!.budget as number);

  const ap = tiles?.approvals;
  const tpt = tiles?.tokens_per_turn;

  return (
    <View style={s.tiles}>
      <BudgetTile label="First block" stat={tiles?.first_block_ms} P={P} s={s} />
      <BudgetTile label="Total time" stat={tiles?.total_ms} P={P} s={s} />

      <Tile label="Turns" P={P} s={s}>
        <Text style={s.tileNum}>{fmtNum(tiles?.turns)}</Text>
        <Text style={s.tileSub}>
          {fmtNum(tiles?.users)} users, {fmtNum(tiles?.sessions)} sessions
        </Text>
        <Text style={s.tileSub}>
          Iterations p50 {fmtNum(it?.p50)}, max{' '}
          <Text style={itersOver ? { color: P.warn } : undefined}>{fmtNum(it?.max)}</Text>
          {isNum(it?.budget) ? ` (budget ${fmtNum(it?.budget)})` : ''}
        </Text>
      </Tile>

      <Tile label="Cache share" P={P} s={s}>
        <Text style={s.tileNum}>{fmtPct(cache)}</Text>
        <View style={s.meterTrack}>
          {cachePct !== null ? <View style={[s.meterFill, { width: `${cachePct}%` }]} /> : null}
        </View>
        <Text style={s.tileSub}>
          {fmtCompact(tpt?.input_total)} in, {fmtCompact(tpt?.output)} out per turn
        </Text>
      </Tile>

      <Tile label="Outcomes" wide P={P} s={s}>
        <View
          style={s.stackTrack}
          accessible
          accessibilityLabel={outcomes.map((o) => `${OUTCOME_LABEL[o.key]} ${fmtNum(o.raw)}`).join(', ')}
        >
          {outcomeTotal > 0
            ? outcomes
                .filter((o) => (o.raw ?? 0) > 0)
                .map((o) => <View key={o.key} style={{ flex: o.raw as number, backgroundColor: outcomeColor(o.key, P) }} />)
            : null}
        </View>
        <View style={s.legend}>
          {outcomes.map((o) => (
            <View key={o.key} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: outcomeColor(o.key, P) }]} />
              <Text style={s.legendText}>
                {OUTCOME_LABEL[o.key]} <Text style={s.legendNum}>{fmtNum(o.raw)}</Text>
                {outcomeTotal > 0 && o.raw !== null ? ` (${fmtPct(o.raw / outcomeTotal)})` : ''}
              </Text>
            </View>
          ))}
        </View>
      </Tile>

      <Tile label="Approvals" wide P={P} s={s}>
        <Text style={s.tileSub}>
          <Text style={s.tileInlineNum}>{fmtNum(ap?.shown)}</Text> shown
          {'   '}
          <Text style={[s.tileInlineNum, { color: P.good }]}>{fmtNum(ap?.approved)}</Text> approved
          {'   '}
          <Text style={[s.tileInlineNum, { color: P.bad }]}>{fmtNum(ap?.declined)}</Text> declined
          {'   '}
          <Text style={[s.tileInlineNum, { color: P.textSecondary }]}>{fmtNum(ap?.ignored)}</Text> ignored
          {isNum(ap?.stale) && (ap!.stale as number) > 0 ? (
            <>
              {'   '}
              <Text style={[s.tileInlineNum, { color: P.warn }]}>{fmtNum(ap?.stale)}</Text> stale
            </>
          ) : null}
        </Text>
      </Tile>
    </View>
  );
}

// ─── Tools table ─────────────────────────────────────────────────────────

function ToolsTable({ tools, P, s }: { tools: AgentToolStat[]; P: AdminPalette; s: Styles }) {
  if (tools.length === 0) return <Text style={s.muted}>No tool calls in this window.</Text>;
  return (
    <View style={s.table}>
      <View style={[s.tr, s.trHead]}>
        <Text style={[s.th, s.colName]}>Tool</Text>
        <Text style={[s.th, s.colCalls]}>Calls</Text>
        <Text style={[s.th, s.colMs]}>p50</Text>
        <Text style={[s.th, s.colMs]}>p95</Text>
        <Text style={[s.th, s.colErr]}>Errors</Text>
      </View>
      {tools.map((t, i) => {
        const errors = t?.errors;
        return (
          <View key={`${t?.name ?? 'tool'}-${i}`} style={[s.tr, i % 2 === 1 && s.trAlt]}>
            <Text style={[s.td, s.tdMono, s.colName]} numberOfLines={1}>
              {t?.name || '-'}
            </Text>
            <Text style={[s.td, s.colCalls]}>{fmtNum(t?.calls)}</Text>
            <Text style={[s.td, s.colMs]}>{fmtMs(t?.p50_ms)}</Text>
            <Text style={[s.td, s.colMs]}>{fmtMs(t?.p95_ms)}</Text>
            <Text style={[s.td, s.colErr, isNum(errors) && errors > 0 && { color: P.bad, fontFamily: 'Manrope_700Bold', fontWeight: '700' }]}>
              {fmtNum(errors)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Builds ──────────────────────────────────────────────────────────────

function Builds({ builds, P, s }: { builds: AgentBuildStat[]; P: AdminPalette; s: Styles }) {
  // Newest deploy first, so each row reads against the one it replaced.
  const sorted = useMemo(() => {
    const time = (b: AgentBuildStat) => {
      const t = b?.first_seen ? new Date(b.first_seen).getTime() : NaN;
      return Number.isNaN(t) ? -Infinity : t;
    };
    return builds.filter(Boolean).slice().sort((a, b) => time(b) - time(a));
  }, [builds]);

  if (sorted.length === 0) return <Text style={s.muted}>No builds in this window.</Text>;

  return (
    <View style={s.builds}>
      {sorted.map((b, i) => {
        const prev = sorted[i + 1];
        const delta =
          prev && isNum(b.first_block_p50) && isNum(prev.first_block_p50) ? b.first_block_p50 - prev.first_block_p50 : null;
        const err = b.error_rate;
        const errColor = isNum(err) ? (err > 0.05 ? P.bad : err > 0 ? P.warn : P.textSecondary) : P.textSecondary;
        return (
          <View key={`${b.build_sha}-${b.prompt_version}-${i}`} style={[s.buildRow, i > 0 && s.buildRowBorder]}>
            <View style={s.buildTop}>
              <Text style={s.buildSha}>{shortId(b.build_sha, 7)}</Text>
              <Text style={s.buildPrompt} numberOfLines={1}>
                prompt {shortId(b.prompt_version, 7)}
              </Text>
              <Text style={s.buildSeen}>{b.first_seen ? `since ${fmtDate(b.first_seen)}` : ''}</Text>
            </View>
            <Text style={s.buildStats}>
              {fmtNum(b.turns)} turns, first block {fmtMs(b.first_block_p50)}
              {delta !== null && delta !== 0 ? (
                <Text style={{ color: delta > 0 ? P.bad : P.good }}> ({fmtMsDelta(delta)} vs prev)</Text>
              ) : null}
              , <Text style={{ color: errColor }}>{fmtPct(err)} errors</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Turn row ────────────────────────────────────────────────────────────

function TurnRowItem({ row, onOpen, P, s }: { row: AgentTurnRow; onOpen: (id: string) => void; P: AdminPalette; s: Styles }) {
  if (!row) return null;
  const sevColor = turnSeverityColor(row.severity, P);
  const oColor = outcomeColor(row.outcome, P);
  return (
    <TouchableOpacity
      style={s.turnRow}
      onPress={() => onOpen(row.id)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${severityLabel(row.severity)} turn, ${outcomeLabel(row.outcome)}. ${row.headline ?? ''}`}
      accessibilityHint="Opens the full trace"
    >
      <View style={[s.turnSev, { backgroundColor: sevColor }]} />
      <View style={s.turnBody}>
        <View style={s.turnTop}>
          <Text style={s.turnTime}>{fmtDateTime(row.created_at)}</Text>
          <Text style={s.turnEmail} numberOfLines={1}>
            {row.user_email || shortId(row.user_id)}
          </Text>
          <Chip label={outcomeLabel(row.outcome)} color={oColor} P={P} />
        </View>
        <Text style={s.turnInput} numberOfLines={1}>
          {inputLine(row.input_type, row.input_preview)}
        </Text>
        {row.headline ? (
          <Text style={[s.turnHeadline, { color: row.severity === 'ok' ? P.textSecondary : sevColor }]} numberOfLines={1}>
            {row.headline}
          </Text>
        ) : null}
        <Text style={s.turnMetrics}>
          First block {fmtMs(row.first_block_ms)}, total {fmtMs(row.total_ms)}
          {isNum(row.iterations) ? `, ${row.iterations} iters` : ''}
          {row.traffic === 'synthetic' ? ', synthetic' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

function makeStyles(P: AdminPalette) {
  return StyleSheet.create({
    content: {
      paddingBottom: 12,
    },
    controls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    updating: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    updatingText: {
      ...AdminType.small,
      color: P.textTertiary,
    },
    windowLine: {
      ...AdminType.small,
      color: P.textTertiary,
      marginBottom: 8,
    },
    spinner: {
      marginVertical: 16,
    },
    muted: {
      ...AdminType.body,
      color: P.textTertiary,
      paddingVertical: 4,
    },
    mutedSmall: {
      ...AdminType.small,
      color: P.textTertiary,
    },
    inlineError: {
      ...AdminType.small,
      color: P.bad,
      marginVertical: 6,
    },
    link: {
      ...AdminType.bodyStrong,
      color: P.accent,
    },
    firstSectionTitle: {
      ...AdminType.section,
      color: P.text,
      paddingTop: 4,
      paddingBottom: 8,
    },

    // Takeaways
    takeaways: {
      gap: 6,
      marginBottom: 8,
    },
    takeaway: {
      borderLeftWidth: 3,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    takeawayText: {
      ...AdminType.bodyStrong,
      color: P.text,
    },
    takeawayLinks: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      marginTop: 6,
    },

    // Tiles
    tiles: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 8,
      marginBottom: 8,
    },
    tile: {
      width: '48.5%',
      backgroundColor: P.surface,
      borderColor: P.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
    },
    tileWide: {
      width: '100%',
    },
    tileLabel: {
      ...AdminType.label,
      color: P.textTertiary,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    tilePair: {
      flexDirection: 'row',
      gap: 14,
    },
    tileNum: {
      ...AdminType.number,
      color: P.text,
    },
    tileInlineNum: {
      fontFamily: 'Manrope_700Bold',
      fontWeight: '700',
      color: P.text,
    },
    tileCaption: {
      ...AdminType.label,
      color: P.textTertiary,
    },
    tileSub: {
      ...AdminType.small,
      color: P.textSecondary,
      marginTop: 4,
    },
    meterTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: P.track,
      overflow: 'hidden',
      marginTop: 4,
    },
    meterFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: P.accent,
    },
    stackTrack: {
      flexDirection: 'row',
      height: 10,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: P.track,
      marginTop: 2,
      gap: 1,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 12,
      rowGap: 4,
      marginTop: 8,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    legendText: {
      ...AdminType.small,
      color: P.textSecondary,
    },
    legendNum: {
      fontFamily: 'Manrope_700Bold',
      fontWeight: '700',
      color: P.text,
    },

    // Tables
    table: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: P.border,
      overflow: 'hidden',
      marginBottom: 8,
    },
    tr: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 8,
      gap: 6,
    },
    trHead: {
      backgroundColor: P.surfaceStrong,
    },
    trAlt: {
      backgroundColor: P.surface,
    },
    th: {
      ...AdminType.label,
      color: P.textTertiary,
      textTransform: 'uppercase',
    },
    td: {
      ...AdminType.small,
      color: P.text,
      fontVariant: ['tabular-nums'],
    },
    tdMono: {
      fontFamily: MONO,
      fontSize: 11,
    },
    colName: {
      flex: 1,
    },
    colCalls: {
      width: 40,
      textAlign: 'right',
    },
    colMs: {
      width: 50,
      textAlign: 'right',
    },
    colErr: {
      width: 44,
      textAlign: 'right',
    },

    // Builds
    builds: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: P.border,
      backgroundColor: P.surface,
      paddingHorizontal: 10,
      marginBottom: 8,
    },
    buildRow: {
      paddingVertical: 8,
    },
    buildRowBorder: {
      borderTopWidth: 1,
      borderTopColor: P.divider,
    },
    buildTop: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    buildSha: {
      ...AdminType.mono,
      color: P.text,
      fontWeight: '700',
    },
    buildPrompt: {
      ...AdminType.mono,
      color: P.textSecondary,
      flex: 1,
    },
    buildSeen: {
      ...AdminType.small,
      color: P.textTertiary,
    },
    buildStats: {
      ...AdminType.small,
      color: P.textSecondary,
      marginTop: 3,
    },

    // Outcome filter
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 8,
    },
    filterChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: P.border,
      backgroundColor: P.surface,
    },
    filterChipActive: {
      borderColor: P.accentBorder,
      backgroundColor: P.accentBg,
    },
    filterChipText: {
      ...AdminType.small,
      color: P.textSecondary,
    },
    filterChipTextActive: {
      color: P.accent,
      fontFamily: 'Manrope_700Bold',
      fontWeight: '700',
    },

    // Turn rows
    turnRow: {
      flexDirection: 'row',
      backgroundColor: P.surface,
      borderColor: P.border,
      borderWidth: 1,
      borderRadius: 10,
      marginBottom: 6,
      overflow: 'hidden',
    },
    turnSev: {
      width: 3,
    },
    turnBody: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 2,
    },
    turnTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    turnTime: {
      ...AdminType.small,
      color: P.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    turnEmail: {
      ...AdminType.small,
      color: P.textTertiary,
      flex: 1,
    },
    turnInput: {
      ...AdminType.bodyStrong,
      color: P.text,
    },
    turnHeadline: {
      ...AdminType.small,
    },
    turnMetrics: {
      ...AdminType.small,
      color: P.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    loadMore: {
      alignSelf: 'center',
      marginTop: 6,
    },
  });
}
