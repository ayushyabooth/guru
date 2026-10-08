/**
 * One beta bug report in the Perf panel's Reports tab (admins only, GUR-242),
 * frame 13:102: what the tester said, Claude's triage hypothesis, the rules'
 * read of the reported turn, then Open turn (the Agent view's turn detail) and
 * Linear. A failed report, or one stuck unfiled, gets Retry.
 *
 * Also exports the small pieces the list shares: the status tag, the seconds
 * format and the budgets mirrored from the server.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../ui/Icon';
import { openExternalTab } from '../../utils/openExternalTab';
import {
  AdminApiError,
  AdminReport,
  AdminReportDetail,
  ReportHypothesis,
  getReport,
  retryReport,
  toAdminError,
} from '../../services/admin-service';
import { reportCategoryLabel } from '../../services/report-service';
import { AdminPalette, fmtDateTime, isNum, useAdminPalette, withAlpha } from './adminTheme';
import { StateMessage } from './AdminUI';
import { FACE, formatClock, glassSurface } from '../report/reportTheme';

// ─── Shared with the list ────────────────────────────────────────────────

/** Mirrors trace_insights.BUDGET_FIRST_BLOCK_MS: a first block slower than this is a warning. */
export const FIRST_BLOCK_BUDGET_MS = 4000;
/** Mirrors bug_reports.STUCK_AFTER: a report still "saved" this long lost its job and can be retried. */
const STUCK_AFTER_MS = 10 * 60 * 1000;

/** 1640 -> "1.6s", 10800 -> "10.8s". */
export function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The status tag: Filed with the Linear id (green), Saved while it files (amber),
 * Failed (red). In the list a failed tag reads "Failed  Retry": the retry itself
 * is on the report.
 */
export function statusTag(
  status: string,
  linearId: string | null,
  P: AdminPalette,
  where: 'list' | 'detail',
): { label: string; color: string; spoken: string } {
  if (status === 'filed') {
    return {
      label: linearId ? `Filed  ${linearId}` : 'Filed',
      color: P.good,
      spoken: linearId ? `Filed as ${linearId}` : 'Filed',
    };
  }
  if (status === 'failed') {
    return { label: where === 'list' ? 'Failed  Retry' : 'Failed', color: P.bad, spoken: 'Failed to file, needs a retry' };
  }
  if (status === 'saved') return { label: 'Saved, filing', color: P.warn, spoken: 'Saved, filing' };
  return { label: status || 'Unknown', color: P.muted, spoken: status || 'Unknown status' };
}

/** A small tinted tag (frame 13:32 and 13:102). */
export function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={[tagStyles.tag, { backgroundColor: withAlpha(color, 0.18) }]}>
      <Text style={[tagStyles.text, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const tagStyles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    ...FACE.semibold,
    fontSize: 11,
    lineHeight: 15,
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function canRetry(r: AdminReport): boolean {
  if (r.status === 'failed') return true;
  if (r.status !== 'saved' || !r.created_at) return false;
  const created = Date.parse(r.created_at);
  return Number.isFinite(created) && Date.now() - created > STUCK_AFTER_MS;
}

/** "3:42 PM" today, "Oct 6, 3:42 PM" before. */
function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toDateString() === new Date().toDateString() ? formatClock(ms) : fmtDateTime(iso);
}

function severityColor(level: string | null | undefined, P: AdminPalette): string {
  if (level === 'high') return P.bad;
  if (level === 'medium') return P.warn;
  return P.muted;
}

function openLink(url: string) {
  if (!/^https:\/\//i.test(url)) return;
  if (Platform.OS === 'web') openExternalTab(url);
  else Linking.openURL(url).catch(() => {});
}

function detailErrorText(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The report endpoints are not on this server yet.';
  if (e.kind === 'not_found') return 'This report may have been removed.';
  if (e.kind === 'session') return 'Sign in again to see reports.';
  return 'Could not load this report.';
}

// ─── The view ────────────────────────────────────────────────────────────

interface Props {
  reportId: string;
  /** The row's reference, for the header while the report loads. */
  reference: string;
  /** Bumped by the panel's Refresh button. */
  refreshSignal: number;
  onBack: () => void;
  onOpenTurn: (traceId: string) => void;
  /** A retry changed the report, so the list can show its new status. */
  onChanged: (report: AdminReport) => void;
}

export default function ReportDetail({ reportId, reference, refreshSignal, onBack, onOpenTurn, onChanged }: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);

  const [detail, setDetail] = useState<AdminReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<AdminApiError | null>(null);
  const retryBusy = useRef(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getReport(reportId);
      if (alive.current && mine === seq.current) setDetail(data ?? null);
    } catch (e) {
      if (alive.current && mine === seq.current) setError(toAdminError(e));
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    setDetail(null);
    setRetryError(null);
    load();
  }, [load]);

  // The panel's Refresh button: reload in place.
  const firstSignal = useRef(refreshSignal);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    if (refreshSignal === firstSignal.current) return;
    latestLoad.current();
  }, [refreshSignal]);

  // Files to Linear again and spends a Claude call: only on an explicit tap, never twice at once.
  const retry = async () => {
    if (retryBusy.current || !detail) return;
    retryBusy.current = true;
    setRetrying(true);
    setRetryError(null);
    try {
      const data = await retryReport(detail.report.id);
      if (!alive.current) return;
      setDetail(data);
      if (data?.report) onChanged(data.report);
    } catch (e) {
      if (alive.current) {
        const err = toAdminError(e);
        setRetryError(err);
        // 409: no longer retryable (it filed meanwhile, or is not stuck yet). Reload so the card shows where it stands.
        if (err.status === 409) load();
      }
    } finally {
      retryBusy.current = false;
      if (alive.current) setRetrying(false);
    }
  };

  const r = detail?.report ?? null;
  const tag = r ? statusTag(r.status, r.linear_identifier, P, 'detail') : null;
  const card = glassSurface('regular', P.isDark);

  return (
    <View style={s.wrap}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to reports"
          hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
        >
          <Icon name="chevron-left" size={18} color={P.textSecondary} weight="bold" />
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>
          Report {r?.reference || reference}
        </Text>
        <View style={s.spacer} />
        {tag ? (
          <View accessible accessibilityLabel={tag.spoken}>
            <Tag label={tag.label} color={tag.color} />
          </View>
        ) : null}
      </View>

      {!detail && loading ? (
        <ActivityIndicator color={P.accent} style={s.spinner} />
      ) : !detail && error ? (
        <StateMessage
          title={error.message}
          detail={detailErrorText(error)}
          actionLabel={error.kind === 'forbidden' || error.kind === 'session' ? undefined : 'Try again'}
          onAction={load}
          P={P}
          tone="bad"
        />
      ) : r && detail ? (
        <>
          {error ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

          {/* What they said */}
          <View style={[card, s.card]}>
            <Text style={s.cardLabel}>WHAT THEY SAID</Text>
            <Tag label={reportCategoryLabel(r.category)} color={P.accent} />
            <Text style={s.said} selectable>
              {r.expected}
            </Text>
            <Text style={s.meta}>
              {[
                r.user_email || 'beta tester',
                r.traffic === 'synthetic' ? 'synthetic' : null,
                r.client,
                fmtWhen(r.created_at),
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          </View>

          {/* Triage hypothesis */}
          <View style={[card, s.card]}>
            <View style={s.cardHead}>
              <Icon name="sparkle" size={13} color={P.accent} weight="bold" />
              <Text style={s.cardLabel}>TRIAGE HYPOTHESIS  ·  CLAUDE</Text>
            </View>
            <Hypothesis h={r.hypothesis} status={r.status} P={P} s={s} />
          </View>

          {/* The turn, as the rules read it */}
          <View style={[card, s.card]}>
            <Text style={s.cardLabel}>THE TURN  ·  RULES</Text>
            {detail.trace ? (
              <>
                <Text style={s.turnHeadline}>
                  {detail.diagnosis?.headline || detail.trace.headline || 'No rule findings'}
                </Text>
                <Text style={s.turnMetrics}>{turnMetrics(detail)}</Text>
              </>
            ) : r.trace_id ? (
              <Text style={s.small}>No trace for this turn on the server.</Text>
            ) : (
              <Text style={s.small}>No turn attached. Sent from {r.screen || 'an unknown screen'}.</Text>
            )}
          </View>

          {/* Why filing failed */}
          {r.status === 'failed' && r.error ? (
            <Text style={s.inlineError}>
              Filing failed{isNum(r.attempts) && r.attempts > 1 ? ` after ${r.attempts} tries` : ''}: {r.error}
            </Text>
          ) : null}

          {/* Actions */}
          <View style={s.actions}>
            {detail.trace ? (
              <BigButton
                label="Open turn"
                icon="pulse"
                variant="primary"
                onPress={() => onOpenTurn(detail.trace!.id)}
                hint="Opens the turn in the Agent view"
                P={P}
                s={s}
              />
            ) : null}
            {r.linear_url ? (
              <BigButton
                label="Linear"
                icon="open-in-new"
                variant="glass"
                onPress={() => openLink(r.linear_url!)}
                hint="Opens the issue in Linear"
                P={P}
                s={s}
              />
            ) : null}
            {canRetry(r) ? (
              <BigButton
                label={retrying ? 'Retrying' : 'Retry'}
                variant="glass"
                onPress={retry}
                busy={retrying}
                hint="Files the report to Linear again and runs a new triage"
                P={P}
                s={s}
              />
            ) : null}
          </View>
          {retryError ? <Text style={s.inlineError}>Could not retry: {retryError.message}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

/** "First block 1.6s  ·  total 10.8s  ·  2 model calls", skipping what the trace does not have. */
function turnMetrics(d: AdminReportDetail): string {
  const t = d.trace;
  if (!t) return '';
  const parts: string[] = [];
  if (isNum(t.first_block_ms)) parts.push(`first block ${fmtSeconds(t.first_block_ms)}`);
  if (isNum(t.total_ms)) parts.push(`total ${fmtSeconds(t.total_ms)}`);
  if (isNum(t.iterations)) parts.push(`${t.iterations} model call${t.iterations === 1 ? '' : 's'}`);
  const line = parts.join('  ·  ');
  return line ? line[0].toUpperCase() + line.slice(1) : 'No timings recorded';
}

function Hypothesis({ h, status, P, s }: { h: ReportHypothesis | null; status: string; P: AdminPalette; s: Styles }) {
  if (h?.error) {
    return <Text style={[s.hypothesis, { color: P.bad }]}>Triage failed: {h.error}</Text>;
  }
  if (h) {
    const text = [h.summary, h.likely_cause].filter(Boolean).join(' ');
    const hasTags = !!h.severity || !!h.confidence;
    if (!text && !hasTags && !h.suggested_eval) {
      return <Text style={s.small}>Claude sent back no hypothesis.</Text>;
    }
    return (
      <>
        {text ? <Text style={s.hypothesis}>{text}</Text> : null}
        {hasTags ? (
          <View style={s.tagRow}>
            {h.severity ? <Tag label={`Severity ${h.severity}`} color={severityColor(h.severity, P)} /> : null}
            {h.confidence ? <Tag label={`Confidence ${h.confidence}`} color={P.muted} /> : null}
          </View>
        ) : null}
        {h.suggested_eval ? <Text style={s.small}>Suggested eval: {h.suggested_eval}</Text> : null}
      </>
    );
  }
  // Triage runs only after the report files.
  if (status === 'failed') return <Text style={s.small}>Triage runs once the report files.</Text>;
  return <Text style={s.arriving}>Arriving...</Text>;
}

function BigButton({
  label,
  icon,
  variant,
  onPress,
  busy = false,
  hint,
  P,
  s,
}: {
  label: string;
  icon?: string;
  variant: 'primary' | 'glass';
  onPress: () => void;
  busy?: boolean;
  hint?: string;
  P: AdminPalette;
  s: Styles;
}) {
  const primary = variant === 'primary';
  const fg = primary ? P.onSolid : P.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy }}
      style={[primary ? { backgroundColor: P.accentHex } : glassSurface('thin', P.isDark), s.bigButton]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={14} color={fg} weight="bold" />
      ) : null}
      <Text style={[s.bigButtonText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

function makeStyles(P: AdminPalette) {
  return StyleSheet.create({
    wrap: {
      gap: 14,
      paddingBottom: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      ...FACE.extrabold,
      fontSize: 18,
      lineHeight: 25,
      color: P.text,
      flexShrink: 1,
    },
    spacer: {
      flex: 1,
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
    card: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 8,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    cardLabel: {
      ...FACE.bold,
      fontSize: 10,
      lineHeight: 14,
      color: P.textTertiary,
    },
    said: {
      ...FACE.medium,
      fontSize: 14,
      lineHeight: 20,
      color: P.text,
    },
    meta: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    hypothesis: {
      ...FACE.medium,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
    tagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    small: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    arriving: {
      ...FACE.medium,
      fontSize: 13,
      lineHeight: 18,
      color: P.textSecondary,
    },
    turnHeadline: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
    turnMetrics: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
    },
    bigButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 14,
      paddingVertical: 12,
    },
    bigButtonText: {
      ...FACE.bold,
      fontSize: 14,
      lineHeight: 20,
    },
  });
}
