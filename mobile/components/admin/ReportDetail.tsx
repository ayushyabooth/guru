/**
 * One beta bug report in the Perf panel's Reports tab (admins only, GUR-242),
 * frame 13:102: what the tester said, Claude's triage hypothesis, the session's
 * context (GUR-277, frame 29:28), the rules' read of the reported turn, then
 * Open turn (the Agent view's turn detail) and Linear. A failed report, or one
 * stuck unfiled, gets Retry.
 *
 * Also exports the small pieces the admin lists and detail views share (the
 * Reports and Issues tabs, the eval case detail): the status tag, the big
 * action button, the seconds and time formats, the link opener and the budgets
 * mirrored from the server.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Icon from '../ui/Icon';
import { openExternalTab } from '../../utils/openExternalTab';
import {
  AdminApiError,
  AdminReport,
  AdminReportDetail,
  ReportClientContext,
  ReportHypothesis,
  ReportSessionContext,
  ReportSessionItem,
  getReport,
  retryReport,
  toAdminError,
} from '../../services/admin-service';
import { reportCategoryLabel } from '../../services/report-service';
import { reportScreenLabel, sentFromLabel } from '../../services/report-context';
import { AdminPalette, fmtDateTime, isNum, useAdminPalette, withAlpha } from './adminTheme';
import { StateMessage } from './AdminUI';
import { FACE, formatClock, glassSurface } from '../report/reportTheme';
import {
  Part,
  activityParts,
  callStatusLabel,
  fmtLocalTime,
  kindCounts,
  kindMeta,
  onScreenParts,
  trailStops,
} from './sessionContext';

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

/** A detail view's action button (frames 13:102 and 18:72): solid indigo for the main action, thin glass otherwise. */
export function BigButton({
  label,
  icon,
  variant,
  onPress,
  busy = false,
  hint,
  P,
}: {
  label: string;
  icon?: string;
  variant: 'primary' | 'glass';
  onPress: () => void;
  busy?: boolean;
  hint?: string;
  P: AdminPalette;
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
      style={[primary ? { backgroundColor: P.accentHex } : glassSurface('thin', P.isDark), buttonStyles.button]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={14} color={fg} weight="bold" />
      ) : null}
      <Text style={[buttonStyles.text, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const buttonStyles = StyleSheet.create({
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
  },
  text: {
    ...FACE.bold,
    fontSize: 14,
    lineHeight: 20,
  },
});

/** "3:42 PM" today, "Oct 6, 3:42 PM" before. */
export function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toDateString() === new Date().toDateString() ? formatClock(ms) : fmtDateTime(iso);
}

/** Opens an https link: a new tab on web, the browser or app on native. Anything else is ignored. */
export function openLink(url: string) {
  if (!/^https:\/\//i.test(url)) return;
  if (Platform.OS === 'web') openExternalTab(url);
  else Linking.openURL(url).catch(() => {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function canRetry(r: AdminReport): boolean {
  if (r.status === 'failed') return true;
  if (r.status !== 'saved' || !r.created_at) return false;
  const created = Date.parse(r.created_at);
  return Number.isFinite(created) && Date.now() - created > STUCK_AFTER_MS;
}

function severityColor(level: string | null | undefined, P: AdminPalette): string {
  if (level === 'high') return P.bad;
  if (level === 'medium') return P.warn;
  return P.muted;
}

/** A JSON object, or null for anything else (null, a string, an array). */
function asObject<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
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
  /** What Back says to a screen reader: the list it returns to. */
  backLabel?: string;
  onOpenTurn: (traceId: string) => void;
  /** A retry changed the report, so the list can show its new status. */
  onChanged: (report: AdminReport) => void;
}

export default function ReportDetail({
  reportId,
  reference,
  refreshSignal,
  onBack,
  backLabel = 'Back to reports',
  onOpenTurn,
  onChanged,
}: Props) {
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

  // The session's context (GUR-277). Anything that is not the expected shape counts as absent.
  const clientContext = asObject<ReportClientContext>(r?.client_context);
  const sessionContext = asObject<ReportSessionContext>(r?.session_context);
  const contextError = r?.context_error;
  const sentFrom = clientContext?.screen
    ? reportScreenLabel(clientContext.screen, clientContext.step)
    : sentFromLabel(r?.screen) || 'an unknown screen';

  return (
    <View style={s.wrap}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
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

          {/* Session context (GUR-277, frame 29:28) */}
          <SessionContextCard
            client={clientContext}
            session={sessionContext}
            contextError={typeof contextError === 'string' && contextError.trim() ? contextError.trim() : null}
            onOpenTurn={onOpenTurn}
            card={card}
            P={P}
            s={s}
          />

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
              <Text style={s.small}>No turn attached. Sent from {sentFrom}.</Text>
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

// ─── Session context (GUR-277, frame 29:28) ──────────────────────────────

/**
 * What the app sent (screens, what was on screen, failed calls) and the
 * tester's own activity before the report, which the server joins. Every part
 * is optional: an older app build sends none of it, a refused context comes
 * back as a reason, and privacy mode keeps counts and ids only.
 */
function SessionContextCard({
  client,
  session,
  contextError,
  onOpenTurn,
  card,
  P,
  s,
}: {
  client: ReportClientContext | null;
  session: ReportSessionContext | null;
  contextError: string | null;
  onOpenTurn: (traceId: string) => void;
  card: ViewStyle;
  P: AdminPalette;
  s: Styles;
}) {
  if (!client && !session && !contextError) {
    return (
      <View style={[card, s.card]}>
        <Text style={s.cardLabel}>SESSION CONTEXT</Text>
        <Text style={s.small}>No session context: this report came from an older app build.</Text>
      </View>
    );
  }

  const sections: { key: string; node: React.ReactNode }[] = [];
  if (contextError) {
    sections.push({ key: 'error', node: <Text style={s.small}>{`The app's context couldn't be read: ${contextError}`}</Text> });
  } else if (!client) {
    sections.push({ key: 'old', node: <Text style={s.small}>No screens or calls: this report came from an older app build.</Text> });
  }
  if (client) {
    sections.push({ key: 'screens', node: <ScreensSection client={client} s={s} /> });
    sections.push({ key: 'on-screen', node: <OnScreenSection client={client} s={s} /> });
    sections.push({ key: 'calls', node: <FailedCallsSection client={client} P={P} s={s} /> });
  }
  if (session) {
    const privacy = session.privacy === true;
    sections.push({ key: 'activity', node: <ActivitySection session={session} privacy={privacy} onOpenTurn={onOpenTurn} P={P} s={s} /> });
    sections.push({
      key: 'footer',
      node: (
        <Text style={s.ctxFooter}>
          {privacy
            ? 'Privacy mode: kinds, counts, times and ids only.'
            : 'Full text while pre-beta. Privacy mode keeps counts and ids only.'}
        </Text>
      ),
    });
  }

  return (
    <View style={[card, s.card, s.ctxCard]}>
      <Text style={s.cardLabel}>SESSION CONTEXT</Text>
      {sections.map((section, i) => (
        <React.Fragment key={section.key}>
          {i > 0 ? <View style={s.ctxDivider} /> : null}
          {section.node}
        </React.Fragment>
      ))}
    </View>
  );
}

/** "Recap · stage 3 (8:41 PM)  ←  Recap · stage 2  ←  Home". */
function ScreensSection({ client, s }: { client: ReportClientContext; s: Styles }) {
  const stops = trailStops(client);
  const newestAt = stops[0] ? fmtLocalTime(stops[0].at) : null;
  return (
    <View style={s.ctxSection}>
      <Text style={s.ctxLabel}>Screens, newest first</Text>
      {stops.length > 0 ? (
        <Text style={s.ctxTrail}>
          {stops.map((stop, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <Text style={s.ctxTrailFaint}>{'  ←  '}</Text> : null}
              <Text style={i === 0 ? undefined : s.ctxOlder}>{stop.label}</Text>
              {i === 0 && newestAt ? <Text style={s.ctxTrailFaint}>{` (${newestAt})`}</Text> : null}
            </React.Fragment>
          ))}
        </Text>
      ) : (
        <Text style={s.small}>None recorded.</Text>
      )}
    </View>
  );
}

/** "Recap journey 3f2a91c0  ·  article “...”". */
function OnScreenSection({ client, s }: { client: ReportClientContext; s: Styles }) {
  const parts = onScreenParts(client);
  return (
    <View style={s.ctxSection}>
      <Text style={s.ctxLabel}>On screen</Text>
      {parts.length > 0 ? (
        <PartsText parts={parts} strongStyle={s.ctxStrong} s={s} />
      ) : (
        <Text style={s.small}>No article, journey or turn.</Text>
      )}
    </View>
  );
}

/** A red status tag, the method and path, the time to the second. */
function FailedCallsSection({ client, P, s }: { client: ReportClientContext; P: AdminPalette; s: Styles }) {
  const calls = (Array.isArray(client.failed_calls) ? client.failed_calls : []).filter((c) => !!c && !!c.path);
  return (
    <View style={s.ctxCalls}>
      <Text style={s.ctxLabel}>Failed calls</Text>
      {calls.length > 0 ? (
        calls.map((call, i) => {
          const status = callStatusLabel(call.status);
          const when = fmtLocalTime(call.at, true);
          return (
            <View
              key={i}
              style={s.ctxCall}
              accessible
              accessibilityLabel={[status, `${call.method || ''} ${call.path}`.trim(), when].filter(Boolean).join(', ')}
            >
              <Tag label={status} color={P.bad} />
              <Text style={s.ctxCallText}>
                {call.method ? `${call.method} ` : ''}
                <Text style={s.ctxStrong}>{call.path}</Text>
              </Text>
              {when ? <Text style={s.ctxTime}>{when}</Text> : null}
            </View>
          );
        })
      ) : (
        <Text style={s.small}>None.</Text>
      )}
    </View>
  );
}

/** The tester's own activity: a quiet glass tag per item, the time, what happened. Agent turns open in the Agent view. */
function ActivitySection({
  session,
  privacy,
  onOpenTurn,
  P,
  s,
}: {
  session: ReportSessionContext;
  privacy: boolean;
  onOpenTurn: (traceId: string) => void;
  P: AdminPalette;
  s: Styles;
}) {
  const minutes = isNum(session.window_minutes) && session.window_minutes > 0 ? session.window_minutes : 30;
  const items = (Array.isArray(session.items) ? session.items : []).filter(
    (item): item is ReportSessionItem => !!item && typeof item === 'object',
  );
  const counts = privacy ? kindCounts(session) : [];
  return (
    <View style={s.ctxActivity}>
      <Text style={s.ctxLabel}>Activity, last {minutes} minutes, newest first</Text>
      {counts.length > 0 ? (
        <View style={s.ctxCounts}>
          {counts.map((c) => (
            <KindTag key={c.kind} kind={c.kind} count={c.count} P={P} s={s} />
          ))}
        </View>
      ) : null}
      {items.length > 0 ? (
        items.map((item, i) => {
          const when = fmtLocalTime(item.at);
          const parts = activityParts(item, privacy);
          const traceId = item.kind === 'agent_turn' && item.trace_id ? item.trace_id : null;
          return (
            <View key={i} style={s.ctxItem}>
              <View style={s.ctxItemTop}>
                <KindTag kind={item.kind} P={P} s={s} />
                {when ? <Text style={s.ctxTime}>{when}</Text> : null}
              </View>
              {parts.length > 0 ? <PartsText parts={parts} strongStyle={s.ctxSaid} s={s} /> : null}
              {traceId ? (
                <TouchableOpacity
                  onPress={() => onOpenTurn(traceId)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Open turn"
                  accessibilityHint="Opens the turn in the Agent view"
                  hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  style={[s.ctxTurnChip, { backgroundColor: withAlpha(P.accent, 0.16) }]}
                >
                  <Icon name="pulse" size={12} color={P.accent} weight="bold" />
                  <Text style={[s.ctxTurnChipText, { color: P.accent }]}>Open turn</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })
      ) : counts.length === 0 ? (
        <Text style={s.small}>Nothing in the last {minutes} minutes.</Text>
      ) : null}
    </View>
  );
}

/** The activity type tag: ultraThin glass, a 1px edge, textSecondary, so color keeps meaning status (part 26:47). */
function KindTag({ kind, count, P, s }: { kind: string; count?: number; P: AdminPalette; s: Styles }) {
  const meta = kindMeta(kind);
  return (
    <View style={[glassSurface('ultraThin', P.isDark), s.kindTag, meta.icon ? s.kindTagWithIcon : null]}>
      {meta.icon ? <Icon name={meta.icon} size={12} color={P.textSecondary} weight="bold" /> : null}
      <Text style={s.kindTagText} numberOfLines={1}>
        {count === undefined ? meta.label : `${meta.label}  ${count}`}
      </Text>
    </View>
  );
}

/**
 * A line of parts: quiet in textSecondary, strong in textPrimary (semibold for
 * ids and titles, medium for the tester's words), faint separators in textTertiary.
 */
function PartsText({ parts, strongStyle, s }: { parts: Part[]; strongStyle: TextStyle; s: Styles }) {
  return (
    <Text style={s.ctxLine}>
      {parts.map((part, i) => (
        <Text key={i} style={part.tone === 'strong' ? strongStyle : part.tone === 'faint' ? s.ctxFaint : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
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

    // Session context (GUR-277, frame 29:28)
    ctxCard: {
      gap: 10,
    },
    ctxSection: {
      gap: 4,
    },
    ctxCalls: {
      gap: 6,
    },
    ctxActivity: {
      gap: 10,
    },
    ctxLabel: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    ctxDivider: {
      height: 1,
      backgroundColor: P.divider,
    },
    // Screens: the newest in semibold textPrimary, the older ones quieter.
    ctxTrail: {
      ...FACE.semibold,
      fontSize: 12,
      lineHeight: 17,
      color: P.text,
    },
    ctxOlder: {
      ...FACE.medium,
      color: P.textSecondary,
    },
    ctxTrailFaint: {
      ...FACE.medium,
      color: P.textTertiary,
    },
    // A line of parts: quiet by default.
    ctxLine: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    // Ids, titles and paths.
    ctxStrong: {
      ...FACE.semibold,
      color: P.text,
    },
    // The tester's own words.
    ctxSaid: {
      ...FACE.medium,
      color: P.text,
    },
    ctxFaint: {
      color: P.textTertiary,
    },
    ctxCall: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    ctxCallText: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
      flex: 1,
    },
    ctxTime: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    ctxCounts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    ctxItem: {
      gap: 6,
    },
    ctxItemTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    // The Reports tab's trace chip (part 26:51): pulse and label, indigo at 0.16.
    ctxTurnChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    ctxTurnChipText: {
      ...FACE.semibold,
      fontSize: 11,
      lineHeight: 15,
    },
    ctxFooter: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    // The activity type tag (part 26:47): a 1px glass edge keeps it the tinted Tag's height.
    kindTag: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexShrink: 0,
      gap: 4,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 7,
      paddingVertical: 2,
      shadowOpacity: 0,
      elevation: 0,
    },
    kindTagWithIcon: {
      paddingLeft: 6,
    },
    kindTagText: {
      ...FACE.semibold,
      fontSize: 11,
      lineHeight: 15,
      color: P.textSecondary,
    },
  });
}
