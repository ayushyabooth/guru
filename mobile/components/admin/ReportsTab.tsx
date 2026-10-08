/**
 * Reports tab of the Perf panel (admins only): beta bug reports (Report a bug,
 * GUR-242), frame 13:32. Tiles for the week (new, filed, failed), then one row
 * per report, newest first. A row opens the report (ReportDetail, frame
 * 13:102); its trace chip opens the turn (AgentTurnDetail).
 *
 * One read: each row carries its traffic and the reported turn's first-block
 * time, and a turn report's `screen` is "guru/<mode>", which names the chip.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../ui/Icon';
import { AdminApiError, AdminReport, AdminReportRow, listReports, toAdminError } from '../../services/admin-service';
import { reportCategoryLabel } from '../../services/report-service';
import { AdminPalette, isNum, useAdminPalette, withAlpha } from './adminTheme';
import { StateMessage } from './AdminUI';
import AgentTurnDetailModal from './AgentTurnDetail';
import ReportDetail, { FIRST_BLOCK_BUDGET_MS, Tag, fmtSeconds, statusTag } from './ReportDetail';
import { FACE, glassSurface } from '../report/reportTheme';

const WINDOW_DAYS = 7;

/**
 * The mode a turn report names in its `screen`: "guru/catch-up" -> "catch-up".
 * Home reports and turn reports with an unknown mode have none. The screen is
 * sent by the app, so only a short lowercase word is shown.
 */
function modeFromScreen(screen: string | null): string | null {
  if (!screen || !screen.startsWith('guru/')) return null;
  const mode = screen.slice('guru/'.length).trim();
  return /^[a-z][a-z-]{0,23}$/.test(mode) ? mode : null;
}

/** "12m", "2h", "3d". */
function fmtAgo(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The list shows the name part of the email; the report shows all of it. */
function emailName(email: string | null): string {
  if (!email) return 'beta tester';
  return email.split('@')[0] || email;
}

/** Errors that make the whole tab meaningless. */
function isBlocking(e: AdminApiError | null): boolean {
  return !!e && (e.kind === 'forbidden' || e.kind === 'not_deployed' || e.kind === 'session');
}

function blockingDetail(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The report endpoints are not on this server yet.';
  if (e.kind === 'session') return 'Sign in again to see reports.';
  return undefined;
}

interface Props {
  /** Bumped by the panel's Refresh button. */
  refreshSignal: number;
  /** Height available to the tab's scroll area inside the panel. */
  maxHeight: number;
}

export default function ReportsTab({ refreshSignal, maxHeight }: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);

  const [rows, setRows] = useState<AdminReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [pulling, setPulling] = useState(false);
  const [openReport, setOpenReport] = useState<{ id: string; reference: string } | null>(null);
  const [openTurnId, setOpenTurnId] = useState<string | null>(null);

  // A slow response never overwrites a newer one.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listReports({ days: WINDOW_DAYS, traffic: 'all' });
      if (mine !== seq.current) return;
      setRows(Array.isArray(page?.reports) ? page.reports.filter(Boolean) : []);
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

  // A retry on the report shows up in its row.
  const onChanged = useCallback((r: AdminReport) => {
    setRows((prev) =>
      prev
        ? prev.map((row) =>
            row.id === r.id
              ? { ...row, status: r.status, linear_identifier: r.linear_identifier, linear_url: r.linear_url }
              : row,
          )
        : prev,
    );
  }, []);

  const blocking = isBlocking(error) && !rows ? error : null;
  const filed = rows ? rows.filter((r) => r.status === 'filed').length : 0;
  const failed = rows ? rows.filter((r) => r.status === 'failed').length : 0;

  return (
    <View>
      {/* The list stays mounted under an open report, so Back returns to the same place. */}
      <ScrollView
        style={[{ maxHeight }, openReport ? s.hidden : null]}
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
        ) : !rows && loading ? (
          <ActivityIndicator color={P.accent} style={s.spinner} />
        ) : !rows && error ? (
          <StateMessage
            title={error.message}
            detail="Could not load reports."
            actionLabel="Try again"
            onAction={load}
            P={P}
            tone="bad"
          />
        ) : rows ? (
          <>
            {error ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

            <View style={s.tiles}>
              <Tile value={rows.length} label="new this week" color={P.text} P={P} s={s} />
              <Tile value={filed} label="filed" color={P.good} P={P} s={s} />
              <Tile value={failed} label="failed, retry" color={P.bad} P={P} s={s} />
            </View>

            {rows.length === 0 ? (
              <StateMessage title="No reports this week" detail="Reports from beta testers land here." P={P} />
            ) : (
              rows.map((r) => (
                <ReportRow
                  key={r.id}
                  report={r}
                  onOpen={() => setOpenReport({ id: r.id, reference: r.reference })}
                  onOpenTurn={setOpenTurnId}
                  P={P}
                  s={s}
                />
              ))
            )}
          </>
        ) : null}
      </ScrollView>

      {openReport ? (
        <ScrollView style={{ maxHeight }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <ReportDetail
            key={openReport.id}
            reportId={openReport.id}
            reference={openReport.reference}
            refreshSignal={refreshSignal}
            onBack={() => setOpenReport(null)}
            onOpenTurn={setOpenTurnId}
            onChanged={onChanged}
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

function Tile({ value, label, color, P, s }: { value: number; label: string; color: string; P: AdminPalette; s: Styles }) {
  return (
    <View style={[glassSurface('regular', P.isDark), s.tile]} accessible accessibilityLabel={`${value} ${label}`}>
      {/* A zero is not news: only a count above zero takes the tile's color. */}
      <Text style={[s.tileNum, { color: value > 0 ? color : P.text }]}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

function ReportRow({
  report: r,
  onOpen,
  onOpenTurn,
  P,
  s,
}: {
  report: AdminReportRow;
  onOpen: () => void;
  onOpenTurn: (traceId: string) => void;
  P: AdminPalette;
  s: Styles;
}) {
  const tag = statusTag(r.status, r.linear_identifier, P, 'list');
  const category = reportCategoryLabel(r.category);
  const synthetic = r.traffic === 'synthetic';
  const ago = fmtAgo(r.created_at);
  const agoSpoken = ago === 'now' ? ', just now' : ago ? `, ${ago} ago` : '';
  const who = [emailName(r.user_email), synthetic ? 'synthetic' : null].filter(Boolean).join('  ·  ');
  const whoSpoken = `${emailName(r.user_email)}${synthetic ? ', synthetic' : ''}`;

  // The trace chip, only for a turn the server vouched for as the reporter's own:
  // the mode from the screen and the first-block time, amber over the budget.
  const traceId = r.trace_id && r.trace_headline ? r.trace_id : null;
  const firstBlock = isNum(r.trace_first_block_ms) ? r.trace_first_block_ms : null;
  const mode = modeFromScreen(r.screen);
  const chipColor = firstBlock !== null && firstBlock > FIRST_BLOCK_BUDGET_MS ? P.warn : P.accent;
  const chipLabel = [mode, firstBlock !== null ? fmtSeconds(firstBlock) : null].filter(Boolean).join('  ') || 'turn';

  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${tag.spoken}. ${category}${agoSpoken}. ${r.expected}. From ${whoSpoken}.`}
      accessibilityHint="Opens the report"
      style={[glassSurface('regular', P.isDark), s.row]}
    >
      <View style={s.rowTop}>
        <Tag label={tag.label} color={tag.color} />
        <Text style={s.rowCategory} numberOfLines={1}>
          {category}
        </Text>
        <View style={s.spacer} />
        <Text style={s.rowAgo}>{ago}</Text>
      </View>
      <Text style={s.rowExpected} numberOfLines={2}>
        {r.expected}
      </Text>
      <View style={s.rowBottom}>
        <Text style={s.rowWho} numberOfLines={1}>
          {who}
        </Text>
        {traceId ? (
          <TouchableOpacity
            onPress={() => onOpenTurn(traceId)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Open turn${mode ? `, ${mode}` : ''}${firstBlock !== null ? `, first block ${fmtSeconds(firstBlock)}` : ''}`}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            style={[s.chip, { backgroundColor: withAlpha(chipColor, 0.16) }]}
          >
            <Icon name="pulse" size={12} color={chipColor} weight="bold" />
            <Text style={[s.chipText, { color: chipColor }]}>{chipLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
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

    // Tiles
    tiles: {
      flexDirection: 'row',
      gap: 8,
    },
    tile: {
      flex: 1,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 2,
    },
    tileNum: {
      ...FACE.extrabold,
      fontSize: 22,
      lineHeight: 31,
      fontVariant: ['tabular-nums'],
    },
    tileLabel: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textSecondary,
    },

    // Rows
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
    rowCategory: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
      flexShrink: 1,
    },
    rowAgo: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    rowExpected: {
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
    rowWho: {
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
