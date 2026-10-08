/**
 * One eval run in the Perf panel's Eval runs view (admins only, GUR-282),
 * frame 39:274: what the run was, its score with each area against the last
 * comparable run, the judge's read on each dimension and the runs where it
 * split from the code check, then its cases grouped as regressions, red as
 * labeled and ok, each with its own dimensions. A case opens the case view for
 * this run.
 *
 * Reads GET /admin/eval-runs/{id}. The list's row draws the header, the score
 * and the judge while the cases load. Also exports the small pieces the list
 * shares: the gating shield, the dimension chips, the judge line, the delta tag
 * and the parts line.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextStyle, TouchableOpacity, View } from 'react-native';
// The gating mark is Phosphor's shield, bold, as the frames draw it. components/ui/Icon has no shield yet.
import { ShieldIcon } from 'phosphor-react-native';
import Icon from '../ui/Icon';
import {
  AdminApiError,
  EvalRunCase,
  EvalRunDetailResponse,
  EvalRunRow,
  IssueStatus,
  getEvalRun,
  toAdminError,
} from '../../services/admin-service';
import { AdminPalette, isNum, useAdminPalette, withAlpha } from './adminTheme';
import { ActionButton, StateMessage } from './AdminUI';
import { GlassTag, IssueStatusTag, spoken } from './EvalCaseDetail';
import { Tag } from './ReportDetail';
import {
  AreaRead,
  CASE_GROUPS,
  CaseGroupKey,
  DimChip as DimChipRead,
  KEEP_RUNS,
  PASS_AT,
  Part,
  areaReads,
  caseGating,
  caseMeta,
  caseStatus,
  caseTitle,
  comparedLine,
  countParts,
  deltaText,
  deltaTone,
  dimChips,
  downLine,
  gateTag,
  groupCases,
  judgeHeadline,
  meetsText,
  plural,
  runTags,
  runWhenLabel,
  scoreRead,
  showMoreLabel,
  splitGroup,
  splitSides,
  splitWhich,
  spokenDelta,
  spokenDim,
  versionsLine,
} from './evalRuns';
import { FACE, glassSurface } from '../report/reportTheme';

// ─── Shared with the list ────────────────────────────────────────────────

/** The gating mark (frame 35:43): Phosphor's shield, bold, 10px. */
export function GatingMark({ color }: { color: string }) {
  return <ShieldIcon size={10} color={color} weight="bold" />;
}

/**
 * A judge dimension as a chip (frame 35:43): the quiet glass tag when it
 * passes, tinted red under the pass mark, faint when n/a. The shield marks a
 * gating dimension.
 */
export function DimChip({ chip, P }: { chip: DimChipRead; P: AdminPalette }) {
  const below = chip.state === 'below';
  const na = chip.state === 'na';
  const nameColor = below ? P.bad : na ? P.textTertiary : P.textSecondary;
  const valueColor = below ? P.bad : na ? P.textTertiary : P.text;
  return (
    <View
      style={
        below
          ? [chipStyles.chip, chipStyles.tinted, { backgroundColor: withAlpha(P.bad, 0.18) }]
          : [glassSurface('ultraThin', P.isDark), chipStyles.chip, chipStyles.glass]
      }
    >
      {chip.gating ? <GatingMark color={below ? P.bad : P.textTertiary} /> : null}
      <Text style={[chipStyles.name, { color: nameColor }]} numberOfLines={1}>
        {chip.key}
      </Text>
      <Text style={[chipStyles.value, { color: valueColor }]} numberOfLines={1}>
        {chip.value}
      </Text>
    </View>
  );
}

/** The five dimension chips, wrapping onto a second line on a phone. Read as one line by a screen reader. */
export function DimChips({ chips, passAt, P }: { chips: DimChipRead[]; passAt: number; P: AdminPalette }) {
  return (
    <View style={chipStyles.row} accessible accessibilityLabel={chips.map((c) => spokenDim(c, passAt)).join(', ')}>
      {chips.map((c) => (
        <DimChip key={c.key} chip={c} P={P} />
      ))}
    </View>
  );
}

/** The sparkle, JUDGE, then what it read: "agrees with code 17 of 19" on a run, "meets 2 of 3" on a case. */
export function JudgeLine({ text, P }: { text: string; P: AdminPalette }) {
  return (
    <View style={chipStyles.judgeLine}>
      <Icon name="sparkle" size={12} color={P.accent} weight="bold" />
      <Text style={[chipStyles.judgeWord, { color: P.textTertiary }]}>JUDGE</Text>
      <Text style={[chipStyles.judgeText, { color: P.textSecondary }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** A change against the comparable run: green up, red down, slate for no change. */
export function DeltaTag({ delta, P }: { delta: number; P: AdminPalette }) {
  const tone = deltaTone(delta);
  return <Tag label={deltaText(delta)} color={tone === 'good' ? P.good : tone === 'bad' ? P.bad : P.muted} />;
}

/** A line of parts in one base style: a flag in the failure tone (its own weight), faint parts in textTertiary. */
export function PartsLine({ parts, base, flag, P }: { parts: Part[]; base: TextStyle; flag: TextStyle; P: AdminPalette }) {
  return (
    <Text style={base}>
      {parts.map((p, i) => (
        <Text
          key={i}
          style={p.tone === 'flag' ? [flag, { color: P.bad }] : p.tone === 'faint' ? { color: P.textTertiary } : undefined}
        >
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

/** A line of parts as a screen reader should say it. */
export function spokenParts(parts: Part[]): string {
  return spoken(parts.map((p) => p.text).join(''));
}

const chipStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    gap: 4,
    borderRadius: 999,
  },
  // The quiet glass tag: a 1px glass edge keeps it the tinted chip's height (21). Chips sit flat on their card.
  glass: {
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    shadowOpacity: 0,
    elevation: 0,
  },
  tinted: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  name: {
    ...FACE.medium,
    fontSize: 11,
    lineHeight: 15,
  },
  value: {
    ...FACE.bold,
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  judgeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  judgeWord: {
    ...FACE.bold,
    fontSize: 10,
    lineHeight: 14,
  },
  judgeText: {
    ...FACE.medium,
    fontSize: 11,
    lineHeight: 15,
    flexShrink: 1,
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────

/** 0-1 of the bar. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function detailErrorText(e: AdminApiError): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The eval runs endpoints are not on this server yet.';
  if (e.kind === 'not_found') return `The server keeps the newest ${KEEP_RUNS} runs, so this one may have been removed.`;
  if (e.kind === 'session') return 'Sign in again to see eval runs.';
  return 'Could not load this run.';
}

// ─── The view ────────────────────────────────────────────────────────────

interface Props {
  runId: string;
  /** The list's row: the header, the score and the judge draw from it while the run loads. */
  initial: EvalRunRow | null;
  /** Bumped by the panel's Refresh button. */
  refreshSignal: number;
  onBack: () => void;
  /** Opens the case view for this run, with the tag its row shows. */
  onOpenCase: (caseId: string, status: IssueStatus) => void;
}

const NONE_UNFOLDED: Record<CaseGroupKey, boolean> = { regressions: false, red_as_labeled: false, ok: false };

export default function EvalRunDetail({ runId, initial, refreshSignal, onBack, onOpenCase }: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);

  const [detail, setDetail] = useState<EvalRunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  // Which groups show their scripted cases.
  const [unfolded, setUnfolded] = useState<Record<CaseGroupKey, boolean>>(NONE_UNFOLDED);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A slow response never overwrites a newer one.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getEvalRun(runId);
      if (alive.current && mine === seq.current) setDetail(data && typeof data === 'object' ? data : null);
    } catch (e) {
      if (alive.current && mine === seq.current) setError(toAdminError(e));
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
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

  const run: EvalRunRow | null = detail ?? initial;
  const groups = useMemo(() => (detail ? groupCases(detail.cases) : null), [detail]);
  const when = run ? runWhenLabel(run.run_at) : null;
  const gate = run ? gateTag(run) : null;
  const tags = run ? runTags(run) : [];
  const versions = run ? versionsLine(run, true) : null;
  const counts = run ? countParts(run.counts) : [];
  // A case's chips mark the gating dimensions the run's judge names.
  const gating = run?.judge?.gating ?? null;
  const passAt = isNum(run?.judge?.pass_at) ? run.judge.pass_at : PASS_AT;
  const anyCases = !!groups && CASE_GROUPS.some((g) => groups[g.key].length > 0);

  return (
    <View style={s.wrap}>
      {/* Title block: back, when it ran, the gate; then what it was, its versions and its counts */}
      <View style={s.titleBlock}>
        <View style={s.header}>
          <TouchableOpacity
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to eval runs"
            hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
          >
            <Icon name="chevron-left" size={18} color={P.textSecondary} weight="bold" />
          </TouchableOpacity>
          <Text style={s.title} accessibilityRole="header" numberOfLines={1}>
            {when ?? 'Eval run'}
          </Text>
          <View style={s.spacer} />
          {gate ? (
            <View accessible accessibilityLabel={`Ship gate ${gate.label.toLowerCase()}`}>
              <Tag label={gate.label} color={gate.tone === 'bad' ? P.bad : P.good} />
            </View>
          ) : null}
        </View>
        {tags.length || versions || counts.length ? (
          <View style={s.facts}>
            {tags.length ? (
              <View style={s.tags} accessible accessibilityLabel={tags.join(', ')}>
                {tags.map((t) => (
                  <GlassTag key={t} label={t} P={P} />
                ))}
              </View>
            ) : null}
            {versions ? <Text style={s.versions}>{versions}</Text> : null}
            {counts.length ? (
              <View accessible accessibilityLabel={spokenParts(counts)}>
                <PartsLine parts={counts} base={s.counts} flag={s.countsFlag} P={P} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {error && detail ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

      {run ? <ScoreCard run={run} P={P} s={s} /> : null}
      {run ? <JudgeCard run={run} passAt={passAt} P={P} s={s} /> : null}

      {/* The cases, grouped */}
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
      ) : groups && !anyCases ? (
        <StateMessage title="No cases on this run" P={P} />
      ) : groups ? (
        CASE_GROUPS.map((g) =>
          groups[g.key].length ? (
            <CaseGroup
              key={g.key}
              group={g.key}
              title={g.title}
              cases={groups[g.key]}
              unfolded={unfolded[g.key]}
              onToggle={() => setUnfolded((u) => ({ ...u, [g.key]: !u[g.key] }))}
              gating={gating}
              passAt={passAt}
              onOpenCase={onOpenCase}
              P={P}
              s={s}
            />
          ) : null,
        )
      ) : null}
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

/** GURU EVAL SCORE: the topline against the comparable run, the six areas as bars, and what fell 5 or more. */
function ScoreCard({ run, P, s }: { run: EvalRunRow; P: AdminPalette; s: Styles }) {
  const score = scoreRead(run);
  const areas = areaReads(run);
  const ran = areas.filter((a) => a.score !== null);
  const notRun = areas.filter((a) => a.score === null);
  const down = downLine(run);
  const compared = score.value === null ? null : comparedLine(run);
  const toplineLabel =
    score.value === null
      ? 'Not scored'
      : [
          `Eval score ${score.value} out of 100`,
          score.delta !== null ? spokenDelta(score.delta) : null,
          compared,
        ]
          .filter(Boolean)
          .join(', ');

  return (
    <View style={[glassSurface('regular', P.isDark), s.card]}>
      <View style={s.scoreHead}>
        <Text style={s.cardLabel}>GURU EVAL SCORE</Text>
        {compared ? (
          <Text style={s.compared} numberOfLines={2}>
            {compared}
          </Text>
        ) : null}
      </View>

      <View style={s.topline} accessible accessibilityLabel={toplineLabel}>
        {score.value === null ? (
          <View style={s.notScored}>
            <Text style={s.notScoredText}>Not scored</Text>
          </View>
        ) : (
          <>
            <View style={s.number}>
              <Text style={[s.big, score.notCompared ? { color: P.textSecondary } : null]}>{score.value}</Text>
              <Text style={s.of}>/100</Text>
            </View>
            {score.delta !== null ? <DeltaTag delta={score.delta} P={P} /> : null}
          </>
        )}
      </View>

      {score.value === null && !areas.length ? (
        <Text style={s.small}>This run was uploaded without a score.</Text>
      ) : null}

      {ran.length ? (
        <View style={s.bars}>
          {ran.map((a) => (
            <AreaBar key={a.key || a.label} area={a} P={P} s={s} />
          ))}
        </View>
      ) : null}
      {notRun.length ? <Text style={s.faint}>Not run: {notRun.map((a) => a.label).join(', ')}.</Text> : null}
      {down ? <Text style={s.down}>{down}</Text> : null}
    </View>
  );
}

/** One area: its name, a 0-100 bar, its score and its change. Flagged (down 5 or more) in red on a red wash. */
function AreaBar({ area, P, s }: { area: AreaRead; P: AdminPalette; s: Styles }) {
  const flagged = area.flagged;
  const delta = area.delta;
  const deltaStyle =
    delta === null
      ? null
      : flagged
        ? [s.deltaBold, { color: P.bad }]
        : delta > 0
          ? [s.deltaUp, { color: P.good }]
          : null;
  const label = [`${area.label} ${area.score}`, delta !== null ? spokenDelta(delta) : null, flagged ? 'flagged' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <View
      style={[s.barRow, flagged ? { backgroundColor: withAlpha(P.bad, 0.1) } : null]}
      accessible
      accessibilityLabel={label}
    >
      <Text style={[s.barName, flagged ? [s.barNameFlag, { color: P.bad }] : null]} numberOfLines={1}>
        {area.label}
      </Text>
      <View style={[s.track, s.areaTrack]}>
        <View
          style={[
            s.fill,
            {
              width: `${clamp01((area.score ?? 0) / 100) * 100}%`,
              backgroundColor: flagged ? P.bad : withAlpha(P.muted, 0.6),
            },
          ]}
        />
      </View>
      <Text style={[s.barValue, flagged ? { color: P.bad } : null]}>{area.score}</Text>
      <Text style={[s.barDelta, deltaStyle]}>{delta === null ? '' : deltaText(delta)}</Text>
    </View>
  );
}

/**
 * THE JUDGE: report-only until it is calibrated. How often it agreed with the
 * code check, each dimension on a 1 to 5 bar with the pass mark as a tick, then
 * where the two split, run by run, with both sides.
 */
function JudgeCard({ run, passAt, P, s }: { run: EvalRunRow; passAt: number; P: AdminPalette; s: Styles }) {
  const judge = run.judge ?? null;
  if (!judge) {
    return (
      <View style={[glassSurface('regular', P.isDark), s.card]}>
        <View style={s.cardHead}>
          <Icon name="sparkle" size={13} color={P.accent} weight="bold" />
          <Text style={s.cardLabel}>THE JUDGE</Text>
        </View>
        <Text style={s.small}>{run.live === false ? 'No judge on a scripted run.' : 'No judge on this run.'}</Text>
      </View>
    );
  }
  const counted = judge.counted === true;
  const chips = dimChips(judge.means, { gating: judge.gating, passAt });
  const headline = judgeHeadline(judge);
  const errors = isNum(judge.errors) && judge.errors > 0 ? judge.errors : 0;
  const splits = (Array.isArray(judge.disagreements) ? judge.disagreements : []).filter(
    (d) => !!d && typeof d === 'object',
  );
  // Agreement is kept per run since GUR-282: only then does "none" mean they never split.
  const perRun = !!judge.agreement;
  const gates = counted ? 'Gates a live run.' : 'Gates a live run once the judge is calibrated.';

  return (
    <View style={[glassSurface('regular', P.isDark), s.card]}>
      <View style={s.cardHead}>
        <Icon name="sparkle" size={13} color={P.accent} weight="bold" />
        <Text style={s.cardLabel}>{counted ? 'THE JUDGE  ·  COUNTED' : 'THE JUDGE  ·  REPORT-ONLY'}</Text>
      </View>
      {headline ? <Text style={s.headline}>{headline}</Text> : null}
      {errors ? <Text style={s.small}>{`${plural(errors, 'judge call')} failed.`}</Text> : null}

      <View style={s.bars}>
        {chips.map((c) => (
          <DimBar key={c.key} chip={c} passAt={passAt} P={P} s={s} />
        ))}
      </View>

      <View style={s.legend}>
        <View style={s.legendMark}>
          <GatingMark color={P.textTertiary} />
        </View>
        <Text style={s.legendText}>{`${gates} The tick is the pass mark, ${passAt}.`}</Text>
      </View>

      {splits.length || perRun ? (
        <>
          <View style={s.divider} />
          <Text style={s.cardLabel}>WHERE THE JUDGE AND THE CODE DISAGREED</Text>
          {splits.length ? (
            <View style={s.splits}>
              {splits.map((d, i) => {
                const which = splitWhich(d);
                const sides = splitSides(d);
                const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
                const said = [spoken(which), sides, reason ? `Judge: ${reason}` : null].filter(Boolean).join('. ');
                return (
                  <View key={`${d.case_id ?? 'case'}-${d.run ?? i}-${i}`} style={s.split} accessible accessibilityLabel={said}>
                    <View style={s.splitHead}>
                      <Text style={s.splitWhich}>{which}</Text>
                      {sides ? <Text style={s.splitSides}>{sides}</Text> : null}
                    </View>
                    {reason ? (
                      <Text style={s.splitText} selectable>
                        Judge: {reason}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={s.small}>Nowhere: they agreed on every run.</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

/** One judge dimension: the shield when it gates, its name, a 1 to 5 bar with the pass mark's tick, its mean. */
function DimBar({ chip, passAt, P, s }: { chip: DimChipRead; passAt: number; P: AdminPalette; s: Styles }) {
  const below = chip.state === 'below';
  const na = chip.state === 'na';
  const value = na ? null : Number(chip.value);
  return (
    <View style={s.barRow} accessible accessibilityLabel={spokenDim(chip, passAt)}>
      <View style={s.dimName}>
        <View style={s.markSlot}>{chip.gating ? <GatingMark color={below ? P.bad : P.textTertiary} /> : null}</View>
        <Text
          style={[s.dimNameText, below ? [s.barNameFlag, { color: P.bad }] : na ? { color: P.textTertiary } : null]}
          numberOfLines={1}
        >
          {chip.key}
        </Text>
      </View>
      <View style={s.track}>
        {value !== null ? (
          <View
            style={[
              s.fill,
              {
                width: `${clamp01((value - 1) / 4) * 100}%`,
                backgroundColor: below ? P.bad : withAlpha(P.muted, 0.6),
              },
            ]}
          />
        ) : null}
        <View style={[s.tick, { left: `${clamp01((passAt - 1) / 4) * 100}%`, backgroundColor: withAlpha(P.text, 0.45) }]} />
      </View>
      <Text style={[s.barValue, below ? { color: P.bad } : na ? { color: P.textTertiary } : null]}>{chip.value}</Text>
    </View>
  );
}

/**
 * A group of cases under its header. The scripted cases the judge never read
 * fold behind "Show N more, all scripted", except a STAY RED one; a regression
 * never folds.
 */
function CaseGroup({
  group,
  title,
  cases,
  unfolded,
  onToggle,
  gating,
  passAt,
  onOpenCase,
  P,
  s,
}: {
  group: CaseGroupKey;
  title: string;
  cases: EvalRunCase[];
  unfolded: boolean;
  onToggle: () => void;
  gating: string[] | null;
  passAt: number;
  onOpenCase: (caseId: string, status: IssueStatus) => void;
  P: AdminPalette;
  s: Styles;
}) {
  const { shown, folded } = splitGroup(cases, group);
  const rows = unfolded ? [...shown, ...folded] : shown;
  return (
    <View style={s.group}>
      <View style={s.groupHead}>
        <View style={s.divider} />
        <View style={s.groupTitleRow}>
          <Text style={s.groupTitle} accessibilityRole="header">
            {title}
          </Text>
          <Text style={s.groupCount}>{plural(cases.length, 'case')}</Text>
        </View>
      </View>
      {rows.map((c) => (
        <CaseRow key={c.id} c={c} gating={gating} passAt={passAt} onOpenCase={onOpenCase} P={P} s={s} />
      ))}
      {folded.length ? (
        <ActionButton
          label={unfolded ? 'Show fewer' : showMoreLabel(folded.length, shown.length > 0)}
          onPress={onToggle}
          P={P}
          variant="quiet"
          accessibilityHint={unfolded ? 'Folds the scripted cases away' : 'Shows the scripted cases the judge does not read'}
        />
      ) : null}
    </View>
  );
}

/** A case of this run (part 35:98): its tag, area and passes, its title, and the judge's read with its five dimensions. */
function CaseRow({
  c,
  gating,
  passAt,
  onOpenCase,
  P,
  s,
}: {
  c: EvalRunCase;
  gating: string[] | null;
  passAt: number;
  onOpenCase: (caseId: string, status: IssueStatus) => void;
  P: AdminPalette;
  s: Styles;
}) {
  const status = caseStatus(c);
  const meta = caseMeta(c);
  const title = caseTitle(c);
  const judge = c.judge ?? null;
  const meets = judge ? meetsText(judge.meets) : null;
  // The case's own gating dimensions: completeness gates an exact case too.
  const chips = judge ? dimChips(judge.means, { gating: caseGating(c, gating), passAt }) : null;
  const label = [
    [spoken(status.text), meta ? spoken(meta) : null].filter(Boolean).join(', '),
    spoken(title),
    meets ? `Judge ${meets}` : null,
    chips ? chips.map((x) => spokenDim(x, passAt)).join(', ') : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <TouchableOpacity
      onPress={() => onOpenCase(c.id, status)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${label}.`}
      accessibilityHint="Opens the case for this run"
      style={[glassSurface('regular', P.isDark), s.caseRow]}
    >
      <View style={s.caseTop}>
        <IssueStatusTag status={status} P={P} />
        {meta ? (
          <Text style={s.caseMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text style={s.caseTitle} numberOfLines={3}>
        {title}
      </Text>
      {judge ? (
        <>
          {meets ? <JudgeLine text={meets} P={P} /> : null}
          {chips ? <DimChips chips={chips} passAt={passAt} P={P} /> : null}
        </>
      ) : null}
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
    divider: {
      height: 1,
      backgroundColor: P.divider,
    },
    small: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    faint: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },

    // Title block
    titleBlock: {
      gap: 6,
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
    // Lines up under the title: the chevron (18) plus the gap (8).
    facts: {
      paddingLeft: 26,
      gap: 6,
    },
    tags: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    versions: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
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

    // Cards
    card: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 10,
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
    headline: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },

    // The score
    scoreHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    compared: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      flexShrink: 1,
      textAlign: 'right',
    },
    topline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    number: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 1,
    },
    big: {
      ...FACE.extrabold,
      fontSize: 22,
      lineHeight: 28,
      color: P.text,
      fontVariant: ['tabular-nums'],
    },
    of: {
      ...FACE.medium,
      fontSize: 13,
      lineHeight: 18,
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
    down: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.bad,
    },

    // Bars: an area (0-100) or a judge dimension (1 to 5)
    bars: {
      gap: 2,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    barName: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
      width: 104,
    },
    barNameFlag: {
      ...FACE.semibold,
    },
    dimName: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      width: 104,
    },
    markSlot: {
      width: 10,
      height: 10,
    },
    dimNameText: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
      flexShrink: 1,
    },
    track: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: P.track,
    },
    areaTrack: {
      overflow: 'hidden',
    },
    fill: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: 4,
      borderRadius: 2,
    },
    // The pass mark: a thin tick over the bar.
    tick: {
      position: 'absolute',
      top: -3,
      width: 1.5,
      height: 10,
    },
    barValue: {
      ...FACE.bold,
      fontSize: 12,
      lineHeight: 17,
      color: P.text,
      width: 26,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    barDelta: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      width: 30,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    deltaBold: {
      ...FACE.bold,
    },
    deltaUp: {
      ...FACE.semibold,
    },

    // The judge's legend and its splits
    legend: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    // Centers the 10px shield on the first line (15).
    legendMark: {
      paddingTop: 2,
    },
    legendText: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      flex: 1,
    },
    splits: {
      gap: 10,
    },
    split: {
      gap: 2,
    },
    splitHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    splitWhich: {
      ...FACE.bold,
      fontSize: 12,
      lineHeight: 17,
      color: P.text,
      flexShrink: 1,
    },
    splitSides: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    splitText: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },

    // Groups of cases
    group: {
      gap: 10,
    },
    groupHead: {
      gap: 12,
    },
    groupTitleRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
    },
    groupTitle: {
      ...FACE.bold,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.3,
      color: P.text,
    },
    groupCount: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
    },
    caseRow: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    caseTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    caseMeta: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textTertiary,
      flexShrink: 1,
    },
    caseTitle: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
  });
}
