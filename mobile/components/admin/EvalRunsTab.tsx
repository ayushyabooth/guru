/**
 * The Eval runs view of the Perf panel's Issues tab (admins only, GUR-282),
 * frame 38:44: when the next scheduled run is due, then every kept run, newest
 * first, labeled as what it is (live or scripted, how it started, whole or
 * partial), with its score and six areas against the previous comparable run,
 * the gate (whole live runs only), its counts and the judge's read on each
 * dimension. A run opens its detail (EvalRunDetail, frame 39:274); a case there
 * opens the case view for that run (EvalCaseDetail).
 *
 * One read for the list. The ship gate on the Issues view still reads only the
 * newest whole live run, so no run listed here can make it look clearer.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../ui/Icon';
import {
  AdminApiError,
  EvalRunRow,
  EvalRunsResponse,
  EvalSchedule,
  IssueStatus,
  listEvalRuns,
  toAdminError,
} from '../../services/admin-service';
import { AdminPalette, isNum, useAdminPalette, withAlpha } from './adminTheme';
import { StateMessage } from './AdminUI';
import EvalCaseDetail, { GlassTag, spoken } from './EvalCaseDetail';
import EvalRunDetail, { DeltaTag, DimChips, JudgeLine, PartsLine, spokenParts } from './EvalRunDetail';
import { Tag } from './ReportDetail';
import {
  PASS_AT,
  ScoreRead,
  areaParts,
  countParts,
  dimChips,
  gateTag,
  judgeShort,
  keepLine,
  runTags,
  runWhenLabel,
  scheduleCopy,
  scoreRead,
  spokenDelta,
  spokenDim,
  versionsLine,
} from './evalRuns';
import { FACE, glassSurface } from '../report/reportTheme';

// ─── Helpers ─────────────────────────────────────────────────────────────

/** The server's answer with a list of runs, each one an object with an id. */
function normalize(res: EvalRunsResponse | null | undefined): EvalRunsResponse {
  const runs = res && Array.isArray(res.runs) ? res.runs.filter((r) => !!r && typeof r === 'object' && !!r.id) : [];
  const schedule = res?.schedule && typeof res.schedule === 'object' ? res.schedule : null;
  return { runs, total: isNum(res?.total) ? res.total : null, gate_run_id: res?.gate_run_id ?? null, schedule };
}

/** Errors that make the whole view meaningless. */
function isBlocking(e: AdminApiError | null): boolean {
  return !!e && (e.kind === 'forbidden' || e.kind === 'not_deployed' || e.kind === 'session');
}

function blockingDetail(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The eval runs endpoint is not on this server yet.';
  if (e.kind === 'session') return 'Sign in again to see eval runs.';
  return undefined;
}

// ─── The view ────────────────────────────────────────────────────────────

interface Props {
  /** Bumped by the panel's Refresh button while this view shows. */
  refreshSignal: number;
  /** Height available to the view's scroll area inside the panel. */
  maxHeight: number;
  /** Drawn at the top of the list: the Issues | Eval runs switch. */
  header?: React.ReactNode;
}

export default function EvalRunsTab({ refreshSignal, maxHeight, header }: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);

  const [data, setData] = useState<EvalRunsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [pulling, setPulling] = useState(false);
  const [openRun, setOpenRun] = useState<EvalRunRow | null>(null);
  const [openCase, setOpenCase] = useState<{ runId: string; caseId: string; status: IssueStatus } | null>(null);

  // A slow response never overwrites a newer one.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await listEvalRuns();
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

  const closeRun = useCallback(() => {
    setOpenCase(null);
    setOpenRun(null);
  }, []);

  const blocking = isBlocking(error) && !data ? error : null;

  return (
    <View>
      {/* The list stays mounted under an open run, and the run under an open case, so Back returns to the same place. */}
      <ScrollView
        style={[{ maxHeight }, openRun ? s.hidden : null]}
        contentContainerStyle={s.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        refreshControl={
          Platform.OS === 'web' ? undefined : (
            <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={P.accent} colors={[P.accent]} />
          )
        }
      >
        {header}
        {blocking ? (
          <StateMessage title={blocking.message} detail={blockingDetail(blocking)} P={P} />
        ) : !data && loading ? (
          <ActivityIndicator color={P.accent} style={s.spinner} />
        ) : !data && error ? (
          <StateMessage
            title="Could not load eval runs"
            detail={error.message}
            actionLabel="Try again"
            onAction={load}
            P={P}
            tone="bad"
          />
        ) : data ? (
          <>
            {error ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

            {data.schedule ? <ScheduleCard schedule={data.schedule} P={P} s={s} /> : null}

            {data.runs.length === 0 ? (
              <StateMessage title="No eval runs yet" detail="Each run shows here once the runner uploads it." P={P} />
            ) : (
              <>
                {data.runs.map((run) => (
                  <RunCard key={run.id} run={run} onOpen={() => setOpenRun(run)} P={P} s={s} />
                ))}
                <Text style={s.keep}>{keepLine(data.runs.length, data.total)}</Text>
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      {openRun ? (
        <ScrollView
          style={[{ maxHeight }, openCase ? s.hidden : null]}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <EvalRunDetail
            key={openRun.id}
            runId={openRun.id}
            initial={openRun}
            refreshSignal={refreshSignal}
            onBack={closeRun}
            onOpenCase={(caseId, status) => setOpenCase({ runId: openRun.id, caseId, status })}
          />
        </ScrollView>
      ) : null}

      {openCase ? (
        <ScrollView style={{ maxHeight }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <EvalCaseDetail
            key={`${openCase.runId}:${openCase.caseId}`}
            caseId={openCase.caseId}
            runId={openCase.runId}
            status={openCase.status}
            linearUrl={null}
            refreshSignal={refreshSignal}
            backLabel="Back to the run"
            onBack={() => setOpenCase(null)}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

/** When the next scheduled run is due, the schedule, and where it runs: dashed, since it hasn't happened yet. */
function ScheduleCard({ schedule, P, s }: { schedule: EvalSchedule; P: AdminPalette; s: Styles }) {
  const copy = scheduleCopy(schedule);
  return (
    <View style={s.schedule} accessible accessibilityLabel={[copy.title, copy.text, copy.runner].filter(Boolean).join('. ')}>
      <View style={[s.scheduleBadge, { backgroundColor: P.surfaceStrong }]}>
        <Icon name="calendar" size={16} color={P.textSecondary} weight="bold" />
      </View>
      <View style={s.scheduleText}>
        <Text style={s.scheduleTitle}>{copy.title}</Text>
        {copy.text ? <Text style={s.scheduleSub}>{copy.text}</Text> : null}
        <Text style={s.scheduleRunner}>{copy.runner}</Text>
      </View>
    </View>
  );
}

/** The score out of 100 with its change as a tag, "not compared" beside a partial run's, or "Not scored". */
function ScoreCluster({ score, P, s }: { score: ScoreRead; P: AdminPalette; s: Styles }) {
  if (score.value === null) {
    return (
      <View style={s.notScored}>
        <Text style={s.notScoredText}>Not scored</Text>
      </View>
    );
  }
  return (
    <View style={s.scoreCluster}>
      <View style={s.topline}>
        <Text style={[s.score, score.notCompared ? { color: P.textSecondary } : null]}>{score.value}</Text>
        <Text style={s.of}>/100</Text>
      </View>
      {score.delta !== null ? (
        <DeltaTag delta={score.delta} P={P} />
      ) : score.notCompared ? (
        <Text style={s.notCompared}>not compared</Text>
      ) : null}
    </View>
  );
}

/**
 * One run (part 35:44): when it ran and its score, what it was and the gate,
 * the six areas, the counts, then the judge's agreement and five dimensions,
 * and the build and prompt. Opens the run.
 */
function RunCard({ run, onOpen, P, s }: { run: EvalRunRow; onOpen: () => void; P: AdminPalette; s: Styles }) {
  const when = runWhenLabel(run.run_at) ?? 'Eval run';
  const score = scoreRead(run);
  const tags = runTags(run);
  const gate = gateTag(run);
  const areas = areaParts(run);
  const counts = countParts(run.counts);
  const versions = versionsLine(run);
  const scripted = run.live === false;
  const judge = run.judge ?? null;
  const passAt = isNum(judge?.pass_at) ? judge.pass_at : PASS_AT;
  const judgeText = judge ? judgeShort(judge) : null;
  const chips = judge && !scripted ? dimChips(judge.means, { gating: judge.gating, passAt }) : null;
  const noJudge = scripted ? 'No judge on a scripted run' : judge ? null : 'No judge on this run';

  const label = [
    when,
    score.value === null
      ? 'Not scored'
      : `Score ${score.value} out of 100${
          score.delta !== null ? `, ${spokenDelta(score.delta)}` : score.notCompared ? ', not compared' : ''
        }`,
    tags.join(', '),
    gate ? `Ship gate ${gate.label.toLowerCase()}` : null,
    areas.length ? spokenParts(areas) : null,
    counts.length ? spokenParts(counts) : null,
    noJudge ?? (judgeText ? `Judge ${judgeText}` : null),
    chips ? chips.map((c) => spokenDim(c, passAt)).join(', ') : null,
    versions ? spoken(versions) : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${label}.`}
      accessibilityHint="Opens the run"
      style={[glassSurface('regular', P.isDark), s.run]}
    >
      <View style={s.runHead}>
        <Text style={s.runWhen} numberOfLines={1}>
          {when}
        </Text>
        <ScoreCluster score={score} P={P} s={s} />
      </View>

      {tags.length || gate ? (
        <View style={s.runTags}>
          <View style={s.tagGroup}>
            {tags.map((t) => (
              <GlassTag key={t} label={t} P={P} />
            ))}
          </View>
          {gate ? <Tag label={gate.label} color={gate.tone === 'bad' ? P.bad : P.good} /> : null}
        </View>
      ) : null}

      {areas.length ? <PartsLine parts={areas} base={s.areas} flag={s.areasFlag} P={P} /> : null}
      {counts.length ? <PartsLine parts={counts} base={s.counts} flag={s.countsFlag} P={P} /> : null}

      <View style={s.divider} />

      {noJudge ? (
        <Text style={s.quiet}>{noJudge}</Text>
      ) : (
        <>
          {judgeText ? <JudgeLine text={judgeText} P={P} /> : null}
          {chips ? <DimChips chips={chips} passAt={passAt} P={P} /> : null}
        </>
      )}

      {versions ? <Text style={s.quiet}>{versions}</Text> : null}
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
    keep: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      textAlign: 'center',
    },

    // The schedule: dashed like the gate card's empty score slot.
    schedule: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: withAlpha(P.muted, 0.45),
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    scheduleBadge: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scheduleText: {
      flex: 1,
      gap: 2,
    },
    scheduleTitle: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
    scheduleSub: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    scheduleRunner: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },

    // A run (the Issues tab's row card)
    run: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    runHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    runWhen: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
      flexShrink: 1,
    },
    scoreCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    topline: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 1,
    },
    score: {
      ...FACE.bold,
      fontSize: 17,
      lineHeight: 22,
      color: P.text,
      fontVariant: ['tabular-nums'],
    },
    of: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textTertiary,
    },
    notCompared: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    notScored: {
      borderRadius: 999,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: withAlpha(P.muted, 0.45),
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    notScoredText: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    runTags: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    tagGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      flexShrink: 1,
    },
    // The six areas: one line that wraps, a flagged area bold in red.
    areas: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    areasFlag: {
      ...FACE.bold,
    },
    counts: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    countsFlag: {
      ...FACE.semibold,
    },
    divider: {
      height: 1,
      backgroundColor: P.divider,
    },
    quiet: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
  });
}
