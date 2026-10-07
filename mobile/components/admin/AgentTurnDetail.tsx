/**
 * Full trace for one agent turn (admins only), shown as a full-height sheet.
 *
 * Summary first, depth below: severity + headline, findings with evidence,
 * an optional Claude hypothesis, then the timeline and every model call, tool
 * call and block, and the raw JSON at the bottom (collapsed).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AdminApiError,
  AgentBlock,
  AgentDiagnosis,
  AgentFinding,
  AgentHypothesis,
  AgentModelCall,
  AgentSessionNav,
  AgentTimelineItem,
  AgentToolCall,
  AgentTurnDetail,
  AgentTurnTrace,
  TimelineKind,
  explainAgentTurn,
  getAgentTurn,
  toAdminError,
} from '../../services/admin-service';
import {
  AdminPalette,
  AdminType,
  MONO,
  confidenceColor,
  findingColor,
  fmtDateTime,
  fmtEvidence,
  fmtMs,
  fmtNum,
  inputLine,
  isNum,
  outcomeColor,
  outcomeLabel,
  severityLabel,
  shortId,
  spanStatus,
  turnSeverityColor,
  useAdminPalette,
} from './adminTheme';
import { ActionButton, Chip, SectionHeader, StateMessage } from './AdminUI';

// ─── Modal shell ─────────────────────────────────────────────────────────

interface ModalProps {
  /** Turn to show; null closes the sheet. */
  turnId: string | null;
  onClose: () => void;
  /** Previous / next turn in the same session. */
  onNavigate: (id: string) => void;
  /** Budgets from the summary, drawn on the timeline when known. */
  firstBlockBudgetMs?: number | null;
  totalBudgetMs?: number | null;
}

export default function AgentTurnDetailModal({ turnId, onClose, onNavigate, firstBlockBudgetMs, totalBudgetMs }: ModalProps) {
  // Keep the last turn on screen while the sheet slides away, so it never animates out blank.
  const [lastId, setLastId] = useState<string | null>(turnId);
  if (turnId !== null && turnId !== lastId) setLastId(turnId);
  const shownId = turnId ?? lastId;

  return (
    <Modal visible={turnId !== null} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      {shownId ? (
        <TurnDetailView
          key={shownId}
          turnId={shownId}
          onClose={onClose}
          onNavigate={onNavigate}
          firstBlockBudgetMs={firstBlockBudgetMs ?? null}
          totalBudgetMs={totalBudgetMs ?? null}
        />
      ) : null}
    </Modal>
  );
}

// ─── Detail view (remounted per turn, so every turn starts clean) ────────

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function detailErrorText(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The turn detail endpoint is not on this server yet.';
  if (e.kind === 'not_found') return 'This turn may have been removed.';
  if (e.kind === 'session') return 'Sign in again to see traces.';
  return 'Could not load this turn.';
}

function TurnDetailView({
  turnId,
  onClose,
  onNavigate,
  firstBlockBudgetMs,
  totalBudgetMs,
}: {
  turnId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
  firstBlockBudgetMs: number | null;
  totalBudgetMs: number | null;
}) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<AgentTurnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [freshHypothesis, setFreshHypothesis] = useState<AgentHypothesis | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<AdminApiError | null>(null);
  const explainBusy = useRef(false);

  const [showRaw, setShowRaw] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    getAgentTurn(turnId)
      .then((d) => {
        if (current) setDetail(d ?? null);
      })
      .catch((e) => {
        if (current) setError(toAdminError(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [turnId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Paid model call: only on an explicit tap, never twice at once.
  const runExplain = useCallback(async () => {
    if (explainBusy.current) return;
    explainBusy.current = true;
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await explainAgentTurn(turnId);
      if (!alive.current) return;
      if (res && res.hypothesis) setFreshHypothesis(res.hypothesis);
      else setExplainError(new AdminApiError('bad_response', 'Unexpected response'));
    } catch (e) {
      if (alive.current) setExplainError(toAdminError(e));
    } finally {
      explainBusy.current = false;
      if (alive.current) setExplaining(false);
    }
  }, [turnId]);

  const turn = detail?.turn ?? null;
  const hypothesis = freshHypothesis ?? detail?.ai_hypothesis ?? null;
  const rawJson = useMemo(() => (showRaw && detail ? safeJson(detail) : ''), [showRaw, detail]);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.column}>
        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back"
            accessibilityHint="Returns to the turn list"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={s.topBtn}
          >
            <Text style={s.backText}>{'‹'} Back</Text>
          </TouchableOpacity>
          <Text style={s.topTitle} accessibilityRole="header">
            Agent turn
          </Text>
          <TouchableOpacity
            onPress={reload}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Refresh this turn"
            accessibilityState={{ disabled: loading, busy: loading }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[s.topBtn, s.topBtnRight]}
          >
            {loading && detail ? (
              <ActivityIndicator size="small" color={P.accent} />
            ) : (
              <Text style={[s.topAction, loading && { opacity: 0.5 }]}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Session navigation */}
        <SessionNav session={detail?.session ?? null} onNavigate={onNavigate} P={P} s={s} />

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingBottom: 32 + insets.bottom }]}
          showsVerticalScrollIndicator
        >
          {loading && !detail ? (
            <ActivityIndicator color={P.accent} style={s.spinner} />
          ) : error && !detail ? (
            <StateMessage
              title={error.message}
              detail={detailErrorText(error)}
              actionLabel={error.kind === 'http' || error.kind === 'network' || error.kind === 'bad_response' ? 'Try again' : undefined}
              onAction={reload}
              P={P}
              tone={error.kind === 'http' || error.kind === 'network' ? 'bad' : 'muted'}
            />
          ) : turn && detail ? (
            <>
              {error ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

              <HeaderCard turn={turn} diagnosis={detail.diagnosis} P={P} s={s} />

              <Findings findings={detail.diagnosis?.findings} P={P} s={s} />

              <SectionHeader title="Hypothesis" P={P} />
              {hypothesis ? (
                <HypothesisCard h={hypothesis} P={P} s={s} />
              ) : (
                <Text style={s.muted}>Ask Claude for a likely cause. Each run is a paid model call.</Text>
              )}
              <ActionButton
                label={explaining ? 'Explaining' : hypothesis ? 'Explain again' : 'Explain with Claude'}
                variant={hypothesis ? 'secondary' : 'primary'}
                onPress={runExplain}
                busy={explaining}
                disabled={explaining}
                P={P}
                style={s.explainBtn}
                accessibilityHint="Runs a paid model call to explain this turn"
              />
              {explainError ? <Text style={s.inlineError}>{explainError.message}</Text> : null}

              <SectionHeader title="Timeline" right={`0 to ${fmtMs(turn.total_ms)}`} P={P} />
              <Timeline
                items={detail.timeline}
                turn={turn}
                firstBlockBudgetMs={firstBlockBudgetMs}
                totalBudgetMs={totalBudgetMs}
                P={P}
                s={s}
              />

              <SectionHeader
                title="Model calls"
                right={Array.isArray(turn.model_calls) ? `${turn.model_calls.length}` : undefined}
                P={P}
              />
              <ModelCalls calls={turn.model_calls} P={P} s={s} />

              <SectionHeader
                title="Tool calls"
                right={Array.isArray(turn.tool_calls) ? `${turn.tool_calls.length}` : undefined}
                P={P}
              />
              <ToolCalls calls={turn.tool_calls} P={P} s={s} />

              <SectionHeader title="Blocks" right={Array.isArray(turn.blocks) ? `${turn.blocks.length}` : undefined} P={P} />
              <Blocks blocks={turn.blocks} P={P} s={s} />

              <SectionHeader title="Raw trace" P={P} />
              <TouchableOpacity
                onPress={() => setShowRaw((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showRaw }}
                accessibilityLabel={showRaw ? 'Hide raw trace' : 'Show raw trace'}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={s.rawToggle}
              >
                <Text style={s.link}>{showRaw ? 'Hide raw trace' : 'Show raw trace'}</Text>
              </TouchableOpacity>
              {showRaw ? (
                <View style={s.raw}>
                  <Text style={s.rawText} selectable>
                    {rawJson}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// ─── Session navigation ──────────────────────────────────────────────────

function SessionNav({
  session,
  onNavigate,
  P,
  s,
}: {
  session: AgentSessionNav | null;
  onNavigate: (id: string) => void;
  P: AdminPalette;
  s: Styles;
}) {
  const prevId = session?.prev_id || null;
  const nextId = session?.next_id || null;
  const idx = session?.turn_index;
  const total = session?.turns_in_session;
  const position = isNum(idx) && isNum(total) ? `Turn ${idx} of ${total}` : isNum(idx) ? `Turn ${idx}` : 'Session';
  return (
    <View style={s.sessionNav}>
      <ActionButton
        label="Previous turn"
        onPress={() => {
          if (prevId) onNavigate(prevId);
        }}
        disabled={!prevId}
        P={P}
        accessibilityHint="Opens the previous turn in this session"
      />
      <Text style={s.sessionText} accessibilityLiveRegion="polite">
        {position}
      </Text>
      <ActionButton
        label="Next turn"
        onPress={() => {
          if (nextId) onNavigate(nextId);
        }}
        disabled={!nextId}
        P={P}
        accessibilityHint="Opens the next turn in this session"
      />
    </View>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────

function Meta({ k, v, mono, color, s }: { k: string; v: string; mono?: boolean; color?: string; s: Styles }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaKey}>{k}</Text>
      <Text style={[s.metaVal, mono && s.metaMono, color ? { color } : null]} selectable>
        {v}
      </Text>
    </View>
  );
}

function HeaderCard({
  turn,
  diagnosis,
  P,
  s,
}: {
  turn: AgentTurnTrace;
  diagnosis: AgentDiagnosis | null | undefined;
  P: AdminPalette;
  s: Styles;
}) {
  const sev = diagnosis?.severity ?? turn.severity;
  const sevColor = turnSeverityColor(sev, P);
  const headline = diagnosis?.headline || turn.headline || 'No headline for this turn.';
  const ctx = turn.context;
  return (
    <View style={[s.card, { borderLeftColor: sevColor, borderLeftWidth: 3 }]}>
      <View style={s.chipRow}>
        <Chip label={severityLabel(sev)} color={sevColor} P={P} />
        <Chip label={outcomeLabel(turn.outcome)} color={outcomeColor(turn.outcome, P)} P={P} />
        {turn.traffic === 'synthetic' ? <Chip label="Synthetic" color={P.muted} P={P} /> : null}
      </View>
      <Text style={s.headline} selectable>
        {headline}
      </Text>
      <View style={s.meta}>
        <Meta k="Time" v={fmtDateTime(turn.created_at, true)} s={s} />
        <Meta k="User" v={turn.user_email || shortId(turn.user_id)} s={s} />
        <Meta k="Session" v={shortId(turn.session_id)} mono s={s} />
        <Meta k="Outcome" v={outcomeLabel(turn.outcome)} s={s} />
        <Meta k="Traffic" v={turn.traffic || '-'} s={s} />
        <Meta k="Build" v={shortId(turn.build_sha, 12)} mono s={s} />
        <Meta k="Prompt" v={shortId(turn.prompt_version, 12)} mono s={s} />
        <Meta k="Client" v={turn.client || '-'} s={s} />
        <Meta k="Model" v={turn.model || '-'} mono s={s} />
        <Meta k="Input" v={inputLine(turn.input_type, turn.input_preview)} s={s} />
        <Meta
          k="Timing"
          v={`First block ${fmtMs(turn.first_block_ms)}, total ${fmtMs(turn.total_ms)}, ${fmtNum(turn.iterations)} iterations`}
          s={s}
        />
        <Meta
          k="Tokens"
          v={`${fmtNum(turn.tokens_in)} in, ${fmtNum(turn.tokens_out)} out, ${fmtNum(turn.cache_read_tokens)} cache read, ${fmtNum(turn.cache_write_tokens)} cache write`}
          s={s}
        />
        {turn.decision ? <Meta k="Decision" v={turn.decision} s={s} /> : null}
        {turn.approval_tool ? <Meta k="Approval" v={turn.approval_tool} mono s={s} /> : null}
        {ctx?.approval_id ? <Meta k="Approval id" v={shortId(ctx.approval_id)} mono s={s} /> : null}
        {isNum(ctx?.history_msgs) ? <Meta k="History" v={`${ctx!.history_msgs} messages`} s={s} /> : null}
        {turn.error ? <Meta k="Error" v={turn.error} color={P.bad} s={s} /> : null}
      </View>
    </View>
  );
}

// ─── Findings ────────────────────────────────────────────────────────────

function Findings({ findings, P, s }: { findings: AgentFinding[] | null | undefined; P: AdminPalette; s: Styles }) {
  const list = Array.isArray(findings) ? findings.filter(Boolean) : [];
  return (
    <>
      <SectionHeader title="Findings" right={`${list.length}`} P={P} />
      {list.length === 0 ? (
        <Text style={s.muted}>No findings for this turn.</Text>
      ) : (
        list.map((f, i) => {
          const color = findingColor(f.severity, P);
          const evidence =
            f.evidence && typeof f.evidence === 'object' && !Array.isArray(f.evidence) ? Object.entries(f.evidence) : [];
          return (
            <View key={`${f.code}-${i}`} style={[s.finding, { borderLeftColor: color }]}>
              <View style={s.findingTop}>
                <Chip label={severityLabel(f.severity)} color={color} P={P} />
                <Text style={s.findingTitle}>{f.title || f.code || 'Finding'}</Text>
              </View>
              {f.detail ? <Text style={s.findingDetail}>{f.detail}</Text> : null}
              {evidence.length > 0 ? (
                <View style={s.evidence}>
                  {evidence.map(([key, value]) => (
                    <View key={key} style={s.evRow}>
                      <Text style={s.evKey}>{key}</Text>
                      <Text style={s.evVal} selectable>
                        {fmtEvidence(key, value)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {f.code ? <Text style={s.findingCode}>{f.code}</Text> : null}
            </View>
          );
        })
      )}
    </>
  );
}

// ─── Claude hypothesis ───────────────────────────────────────────────────

function HypothesisCard({ h, P, s }: { h: AgentHypothesis; P: AdminPalette; s: Styles }) {
  const cColor = confidenceColor(h.confidence, P);
  const evidence = Array.isArray(h.evidence) ? h.evidence.filter((e) => typeof e === 'string' && e.trim()) : [];
  const confidence = h.confidence ? `${h.confidence.charAt(0).toUpperCase()}${h.confidence.slice(1)} confidence` : 'Confidence unknown';
  return (
    <View style={[s.card, s.hypo]}>
      <View style={s.chipRow}>
        <Chip label={confidence} color={cColor} P={P} />
        {h.model ? <Text style={s.hypoModel}>{h.model}</Text> : null}
      </View>
      {h.summary ? (
        <Text style={s.hypoSummary} selectable>
          {h.summary}
        </Text>
      ) : null}
      {h.likely_cause ? (
        <>
          <Text style={s.hypoLabel}>Likely cause</Text>
          <Text style={s.hypoText} selectable>
            {h.likely_cause}
          </Text>
        </>
      ) : null}
      {evidence.length > 0 ? (
        <>
          <Text style={s.hypoLabel}>Evidence</Text>
          {evidence.map((e, i) => (
            <View key={i} style={s.bulletRow}>
              <Text style={s.bullet}>{'•'}</Text>
              <Text style={[s.hypoText, s.bulletText]} selectable>
                {e}
              </Text>
            </View>
          ))}
        </>
      ) : null}
      {h.confirm_or_refute ? (
        <>
          <Text style={s.hypoLabel}>Confirm or refute</Text>
          <Text style={s.hypoText} selectable>
            {h.confirm_or_refute}
          </Text>
        </>
      ) : null}
      {h.suggested_eval ? (
        <>
          <Text style={s.hypoLabel}>Suggested eval</Text>
          <Text style={s.hypoText} selectable>
            {h.suggested_eval}
          </Text>
        </>
      ) : null}
      {h.by || h.generated_at ? (
        <Text style={s.hypoFoot}>
          {[h.by ? `Asked by ${h.by}` : null, h.generated_at ? fmtDateTime(h.generated_at) : null].filter(Boolean).join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────

const KIND_ORDER: TimelineKind[] = ['phase', 'model', 'tool', 'block', 'approval'];
const KIND_LABEL: Record<TimelineKind, string> = {
  phase: 'Phase',
  model: 'Model',
  tool: 'Tool',
  block: 'Block',
  approval: 'Approval',
};
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const MIN_BAR_PCT = 0.8;

function Timeline({
  items,
  turn,
  firstBlockBudgetMs,
  totalBudgetMs,
  P,
  s,
}: {
  items: AgentTimelineItem[] | null | undefined;
  turn: AgentTurnTrace;
  firstBlockBudgetMs: number | null;
  totalBudgetMs: number | null;
  P: AdminPalette;
  s: Styles;
}) {
  const rows = useMemo(() => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const start = (r: AgentTimelineItem) => (isNum(r.start_ms) ? r.start_ms : Number.MAX_SAFE_INTEGER);
    return list
      .map((r, i) => ({ r, i }))
      .sort((a, b) => start(a.r) - start(b.r) || a.i - b.i)
      .map((x) => x.r);
  }, [items]);

  if (rows.length === 0) return <Text style={s.muted}>No timeline recorded for this turn.</Text>;

  // Shared axis: 0 to total_ms (stretched only if a span runs past it).
  const maxSeen = rows.reduce(
    (m, r) => Math.max(m, isNum(r.end_ms) ? r.end_ms : 0, isNum(r.start_ms) ? r.start_ms : 0),
    0,
  );
  const axis = Math.max(isNum(turn.total_ms) ? turn.total_ms : 0, maxSeen, 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / axis) * 100));
  const firstBlock = isNum(turn.first_block_ms) ? turn.first_block_ms : null;
  const budget = isNum(firstBlockBudgetMs) && firstBlockBudgetMs <= axis ? firstBlockBudgetMs : null;

  return (
    <View style={s.timeline}>
      <View style={s.axis}>
        {TICKS.map((t, i) => {
          const pos =
            i === 0
              ? { left: 0 }
              : i === TICKS.length - 1
                ? { right: 0, textAlign: 'right' as const }
                : { left: `${t * 100}%` as const, marginLeft: -24, width: 48, textAlign: 'center' as const };
          return (
            <Text key={t} style={[s.axisLabel, pos]}>
              {t === 0 ? '0' : fmtMs(axis * t)}
            </Text>
          );
        })}
      </View>

      {rows.map((item, i) => (
        <TimelineRow key={i} item={item} axis={axis} pct={pct} firstBlock={firstBlock} budget={budget} P={P} s={s} />
      ))}

      <View style={s.tlLegend}>
        {KIND_ORDER.map((k) => (
          <View key={k} style={s.tlLegendItem}>
            <View style={[s.tlLegendSwatch, { backgroundColor: P.kind[k] }]} />
            <Text style={s.tlLegendText}>{KIND_LABEL[k]}</Text>
          </View>
        ))}
        {firstBlock !== null ? (
          <View style={s.tlLegendItem}>
            <View style={[s.tlLegendLine, { backgroundColor: P.good }]} />
            <Text style={s.tlLegendText}>First block {fmtMs(firstBlock)}</Text>
          </View>
        ) : null}
        {budget !== null ? (
          <View style={s.tlLegendItem}>
            <View style={[s.tlLegendLine, { backgroundColor: P.bad }]} />
            <Text style={s.tlLegendText}>Budget {fmtMs(budget)}</Text>
          </View>
        ) : null}
      </View>
      {isNum(totalBudgetMs) ? (
        <Text style={s.tlFoot}>
          Total {fmtMs(turn.total_ms)} against a {fmtMs(totalBudgetMs)} budget.
        </Text>
      ) : null}
    </View>
  );
}

function TimelineRow({
  item,
  axis,
  pct,
  firstBlock,
  budget,
  P,
  s,
}: {
  item: AgentTimelineItem;
  axis: number;
  pct: (v: number) => number;
  firstBlock: number | null;
  budget: number | null;
  P: AdminPalette;
  s: Styles;
}) {
  const kindColor = (P.kind as Record<string, string>)[item.kind] ?? P.muted;
  const st = spanStatus(item.status, P);
  const start = isNum(item.start_ms) ? item.start_ms : null;
  // An abandoned or unfinished span with no end ran until the turn stopped.
  const end = isNum(item.end_ms) ? item.end_ms : st.hollow && start !== null ? axis : start;
  const instant = item.kind === 'block' || start === null || end === null || end <= start;
  const duration = !instant && start !== null && end !== null ? end - start : null;

  const left = start !== null ? pct(start) : 0;
  const width = !instant && end !== null ? Math.max(pct(end) - left, MIN_BAR_PCT) : 0;
  const barLeft = Math.max(0, Math.min(left, 100 - width));
  const fill = st.failed ? P.bad : kindColor;
  const timing = start === null ? '-' : instant ? `at ${fmtMs(start)}` : fmtMs(duration);

  return (
    <View
      style={s.tlRow}
      accessible
      accessibilityLabel={`${KIND_LABEL[item.kind] ?? item.kind}: ${item.label}, ${timing}${st.tag ? `, ${st.tag}` : ''}`}
    >
      <View style={s.tlLabelRow}>
        <View style={[s.tlKindDot, { backgroundColor: kindColor }]} />
        <Text style={[s.tlLabel, st.color ? { color: st.color } : null]} numberOfLines={1}>
          {item.label || item.kind}
        </Text>
        {st.tag && st.color ? <Chip label={st.tag} color={st.color} P={P} /> : null}
        <Text style={s.tlMs}>{timing}</Text>
      </View>
      <View style={s.tlTrack}>
        {[25, 50, 75].map((g) => (
          <View key={g} style={[s.tlGrid, { left: `${g}%` }]} />
        ))}
        {budget !== null ? <View style={[s.tlMarkLine, { left: `${pct(budget)}%`, backgroundColor: P.bad }]} /> : null}
        {firstBlock !== null ? (
          <View style={[s.tlMarkLine, { left: `${pct(firstBlock)}%`, backgroundColor: P.good }]} />
        ) : null}
        {start === null ? null : instant ? (
          <View
            style={[
              s.tlMarker,
              { left: `${left}%` },
              st.hollow
                ? { backgroundColor: 'transparent', borderColor: st.color ?? P.bad }
                : { backgroundColor: fill, borderColor: fill },
            ]}
          />
        ) : (
          <View
            style={[
              s.tlBar,
              { left: `${barLeft}%`, width: `${width}%` },
              st.hollow
                ? { backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: st.color ?? P.bad }
                : { backgroundColor: fill },
            ]}
          />
        )}
      </View>
      {item.detail ? (
        <Text style={s.tlDetail} numberOfLines={2}>
          {item.detail}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Model calls ─────────────────────────────────────────────────────────

function ModelCalls({ calls, P, s }: { calls: AgentModelCall[] | null | undefined; P: AdminPalette; s: Styles }) {
  const list = Array.isArray(calls) ? calls.filter(Boolean) : [];
  if (list.length === 0) return <Text style={s.muted}>No model calls recorded.</Text>;
  return (
    <View style={s.table}>
      <View style={[s.tr, s.trHead]}>
        <Text style={[s.th, s.cIter]}>Iter</Text>
        <Text style={[s.th, s.cMs]}>Time</Text>
        <Text style={[s.th, s.cMs]}>1st text</Text>
        <Text style={[s.th, s.cTok]}>In</Text>
        <Text style={[s.th, s.cTok]}>Out</Text>
        <Text style={[s.th, s.cTok]}>Cache rd</Text>
      </View>
      {list.map((c, i) => {
        const st = spanStatus(c.status, P);
        return (
          <View key={i} style={[s.trBlock, i % 2 === 1 && s.trAlt]}>
            <View style={s.tr}>
              <Text style={[s.td, s.cIter]}>{fmtNum(c.iter)}</Text>
              <Text style={[s.td, s.cMs, st.color ? { color: st.color } : null]}>{fmtMs(c.ms)}</Text>
              <Text style={[s.td, s.cMs]}>{fmtMs(c.first_text_ms)}</Text>
              <Text style={[s.td, s.cTok]}>{fmtNum(c.in)}</Text>
              <Text style={[s.td, s.cTok]}>{fmtNum(c.out)}</Text>
              <Text style={[s.td, s.cTok]}>{fmtNum(c.cache_read)}</Text>
            </View>
            <Text style={s.subLine} selectable>
              {st.tag && st.color ? <Text style={{ color: st.color }}>{st.tag} · </Text> : null}
              stop {c.stop_reason || '-'} · starts {fmtMs(c.start_ms)} · cache write {fmtNum(c.cache_write)}
            </Text>
            <Text style={s.subLineMono} selectable numberOfLines={1}>
              {c.request_id || 'no request id'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Tool calls ──────────────────────────────────────────────────────────

/** What we know about a tool's input: the full JSON (synthetic traffic) or the safe args and text sizes. */
function toolInputText(t: AgentToolCall): string {
  if (t.input) return `input ${t.input}`;
  const parts: string[] = [];
  if (t.args && typeof t.args === 'object' && Object.keys(t.args).length > 0) {
    try {
      parts.push(`args ${JSON.stringify(t.args)}`);
    } catch {
      // unprintable args: skip
    }
  }
  if (t.text_chars && typeof t.text_chars === 'object') {
    const sizes = Object.entries(t.text_chars)
      .filter(([, n]) => isNum(n))
      .map(([k, n]) => `${k} ${fmtNum(n)} chars`);
    if (sizes.length) parts.push(`text not kept (${sizes.join(', ')})`);
  }
  return parts.length ? parts.join(' · ') : 'input not kept';
}

function ToolCalls({ calls, P, s }: { calls: AgentToolCall[] | null | undefined; P: AdminPalette; s: Styles }) {
  const list = Array.isArray(calls) ? calls.filter(Boolean) : [];
  if (list.length === 0) return <Text style={s.muted}>No tool calls in this turn.</Text>;
  return (
    <View style={s.table}>
      <View style={[s.tr, s.trHead]}>
        <Text style={[s.th, s.cName]}>Tool</Text>
        <Text style={[s.th, s.cIter]}>Iter</Text>
        <Text style={[s.th, s.cMs]}>Time</Text>
        <Text style={[s.th, s.cTok]}>Chars</Text>
      </View>
      {list.map((t, i) => {
        const st = spanStatus(t.status, P);
        const failed = t.error === true || st.failed;
        const tag = failed ? 'Error' : st.tag;
        const tagColor = failed ? P.bad : st.color;
        return (
          <View key={i} style={[s.trBlock, i % 2 === 1 && s.trAlt]}>
            <View style={s.tr}>
              <View style={[s.cName, s.nameCell]}>
                <Text style={[s.td, s.tdMono, s.nameText, failed && { color: P.bad }]} numberOfLines={1}>
                  {t.name || '-'}
                </Text>
                {tag && tagColor ? <Chip label={tag} color={tagColor} P={P} /> : null}
              </View>
              <Text style={[s.td, s.cIter]}>{fmtNum(t.iter)}</Text>
              <Text style={[s.td, s.cMs]}>{fmtMs(t.ms)}</Text>
              <Text style={[s.td, s.cTok]}>{fmtNum(t.chars)}</Text>
            </View>
            {t.error_msg ? (
              <Text style={[s.subLine, s.subLineBad]} selectable>
                {t.error_msg}
              </Text>
            ) : null}
            <Text style={s.subLineMono} selectable numberOfLines={3}>
              {toolInputText(t)}
              {isNum(t.start_ms) ? `  (starts ${fmtMs(t.start_ms)})` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Blocks ──────────────────────────────────────────────────────────────

function Blocks({ blocks, P, s }: { blocks: AgentBlock[] | null | undefined; P: AdminPalette; s: Styles }) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (list.length === 0) return <Text style={s.muted}>No blocks were shown in this turn.</Text>;
  return (
    <View style={s.table}>
      {list.map((b, i) => (
        <View key={i} style={[s.trBlock, i % 2 === 1 && s.trAlt, i > 0 && s.trDivider]}>
          <View style={s.blockTop}>
            <View style={[s.blockDot, { backgroundColor: P.kind.block }]} />
            <Text style={s.blockType} numberOfLines={1}>
              {b.type || 'unknown'}
              {b.variant ? <Text style={s.blockVariant}> · {b.variant}</Text> : null}
            </Text>
            <Text style={s.blockMeta}>
              {isNum(b.iter) ? `iter ${b.iter} · ` : ''}at {fmtMs(b.at_ms)}
            </Text>
          </View>
          <Text style={b.preview ? s.blockPreview : s.blockChars} numberOfLines={2} selectable>
            {b.preview ? b.preview : isNum(b.chars) ? `${fmtNum(b.chars)} chars, preview not kept` : 'Preview not kept'}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

function makeStyles(P: AdminPalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: P.screenBg,
    },
    column: {
      flex: 1,
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: P.divider,
    },
    topBtn: {
      minWidth: 72,
      minHeight: 32,
      justifyContent: 'center',
    },
    topBtnRight: {
      alignItems: 'flex-end',
    },
    backText: {
      ...AdminType.title,
      color: P.accent,
    },
    topTitle: {
      ...AdminType.title,
      color: P.text,
    },
    topAction: {
      ...AdminType.bodyStrong,
      color: P.accent,
    },
    sessionNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: P.divider,
    },
    sessionText: {
      ...AdminType.small,
      color: P.textSecondary,
      fontVariant: ['tabular-nums'],
      flexShrink: 1,
      textAlign: 'center',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
    },
    spinner: {
      marginVertical: 32,
    },
    muted: {
      ...AdminType.body,
      color: P.textTertiary,
      paddingVertical: 4,
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

    // Cards
    card: {
      backgroundColor: P.surface,
      borderColor: P.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    headline: {
      ...AdminType.headline,
      color: P.text,
      marginTop: 8,
    },
    meta: {
      marginTop: 10,
      gap: 3,
    },
    metaRow: {
      flexDirection: 'row',
      gap: 8,
    },
    metaKey: {
      ...AdminType.small,
      color: P.textTertiary,
      width: 84,
    },
    metaVal: {
      ...AdminType.small,
      color: P.text,
      flex: 1,
    },
    metaMono: {
      fontFamily: MONO,
    },

    // Findings
    finding: {
      backgroundColor: P.surface,
      borderColor: P.border,
      borderWidth: 1,
      borderLeftWidth: 3,
      borderRadius: 10,
      padding: 10,
      marginBottom: 6,
    },
    findingTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    findingTitle: {
      ...AdminType.bodyStrong,
      color: P.text,
      flex: 1,
    },
    findingDetail: {
      ...AdminType.body,
      color: P.textSecondary,
      marginTop: 4,
    },
    evidence: {
      marginTop: 6,
      padding: 8,
      borderRadius: 8,
      backgroundColor: P.surfaceStrong,
      gap: 2,
    },
    evRow: {
      flexDirection: 'row',
      gap: 8,
    },
    evKey: {
      ...AdminType.mono,
      color: P.textTertiary,
      width: 132,
    },
    evVal: {
      ...AdminType.mono,
      color: P.text,
      flex: 1,
    },
    findingCode: {
      ...AdminType.mono,
      fontSize: 10,
      color: P.textTertiary,
      marginTop: 6,
    },

    // Hypothesis
    hypo: {
      borderColor: P.accentBorder,
      backgroundColor: P.accentBg,
    },
    hypoModel: {
      ...AdminType.mono,
      fontSize: 10,
      color: P.textTertiary,
    },
    hypoSummary: {
      ...AdminType.bodyStrong,
      fontSize: 13,
      lineHeight: 19,
      color: P.text,
      marginTop: 8,
    },
    hypoLabel: {
      ...AdminType.label,
      color: P.textTertiary,
      textTransform: 'uppercase',
      marginTop: 10,
      marginBottom: 2,
    },
    hypoText: {
      ...AdminType.body,
      color: P.text,
    },
    bulletRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 2,
    },
    bullet: {
      ...AdminType.body,
      color: P.accent,
    },
    bulletText: {
      flex: 1,
    },
    hypoFoot: {
      ...AdminType.small,
      color: P.textTertiary,
      marginTop: 10,
    },
    explainBtn: {
      marginTop: 4,
      marginBottom: 4,
    },

    // Timeline
    timeline: {
      marginBottom: 8,
    },
    axis: {
      height: 16,
      marginBottom: 4,
    },
    axisLabel: {
      ...AdminType.label,
      color: P.textTertiary,
      position: 'absolute',
      top: 0,
      fontVariant: ['tabular-nums'],
    },
    tlRow: {
      paddingVertical: 4,
    },
    tlLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 3,
    },
    tlKindDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    tlLabel: {
      ...AdminType.small,
      color: P.text,
      flex: 1,
    },
    tlMs: {
      ...AdminType.small,
      color: P.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    tlTrack: {
      height: 12,
      borderRadius: 3,
      backgroundColor: P.track,
    },
    tlGrid: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: P.divider,
    },
    tlMarkLine: {
      position: 'absolute',
      top: -2,
      bottom: -2,
      width: 2,
      marginLeft: -1,
      opacity: 0.75,
    },
    tlBar: {
      position: 'absolute',
      top: 1,
      bottom: 1,
      borderRadius: 3,
    },
    tlMarker: {
      position: 'absolute',
      top: 2,
      width: 8,
      height: 8,
      marginLeft: -4,
      borderWidth: 1.5,
      transform: [{ rotate: '45deg' }],
    },
    tlDetail: {
      ...AdminType.small,
      color: P.textTertiary,
      marginTop: 3,
    },
    tlLegend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 12,
      rowGap: 4,
      marginTop: 8,
    },
    tlLegendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    tlLegendSwatch: {
      width: 10,
      height: 6,
      borderRadius: 2,
    },
    tlLegendLine: {
      width: 2,
      height: 10,
    },
    tlLegendText: {
      ...AdminType.small,
      color: P.textSecondary,
    },
    tlFoot: {
      ...AdminType.small,
      color: P.textTertiary,
      marginTop: 4,
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
      paddingVertical: 5,
      paddingHorizontal: 8,
      gap: 4,
    },
    trHead: {
      backgroundColor: P.surfaceStrong,
    },
    trBlock: {
      paddingBottom: 6,
    },
    trAlt: {
      backgroundColor: P.surface,
    },
    trDivider: {
      borderTopWidth: 1,
      borderTopColor: P.divider,
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
    },
    cIter: {
      width: 30,
      textAlign: 'right',
    },
    cMs: {
      width: 54,
      textAlign: 'right',
    },
    cTok: {
      flex: 1,
      textAlign: 'right',
    },
    cName: {
      flex: 2,
    },
    nameCell: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    nameText: {
      flexShrink: 1,
    },
    subLine: {
      ...AdminType.small,
      color: P.textSecondary,
      paddingHorizontal: 8,
    },
    subLineBad: {
      color: P.bad,
    },
    subLineMono: {
      ...AdminType.mono,
      fontSize: 10,
      color: P.textTertiary,
      paddingHorizontal: 8,
      marginTop: 2,
    },

    // Blocks
    blockTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingTop: 6,
    },
    blockDot: {
      width: 7,
      height: 7,
      transform: [{ rotate: '45deg' }],
    },
    blockType: {
      ...AdminType.mono,
      color: P.text,
      flex: 1,
    },
    blockVariant: {
      color: P.textSecondary,
    },
    blockMeta: {
      ...AdminType.small,
      color: P.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    blockPreview: {
      ...AdminType.body,
      color: P.text,
      paddingHorizontal: 8,
      marginTop: 2,
    },
    blockChars: {
      ...AdminType.small,
      color: P.textTertiary,
      paddingHorizontal: 8,
      marginTop: 2,
    },

    // Raw
    rawToggle: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    raw: {
      marginTop: 6,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: P.border,
      backgroundColor: P.surfaceStrong,
    },
    rawText: {
      ...AdminType.mono,
      fontSize: 10,
      lineHeight: 14,
      color: P.text,
    },
  });
}
