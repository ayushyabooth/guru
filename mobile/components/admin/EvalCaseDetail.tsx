/**
 * One eval case in the Perf panel's Issues tab (admins only, GUR-271), frame
 * 18:72, opened from an eval row: what good looks like, what the latest run
 * did (a tag per run), why, the fix in flight, and what the report-only LLM
 * judge said. Run this case copies the command that re-runs just this case;
 * Linear opens its issue.
 *
 * Reads the case by id from GET /admin/evals/latest, or, opened from a run in
 * the Eval runs view (GUR-282), from that run (GET /admin/eval-runs/{id}).
 * Also exports the small pieces the Issues list shares: the quiet glass tag and
 * the status tag.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../ui/Icon';
import {
  AdminApiError,
  EvalCaseResult,
  EvalJudgeSummary,
  IssueStatus,
  caseScoreText,
  getEvalRun,
  getLatestEvalRun,
  judgeMeansText,
  toAdminError,
} from '../../services/admin-service';
import { AdminPalette, isNum, issueToneColor, useAdminPalette } from './adminTheme';
import { StateMessage } from './AdminUI';
import { BigButton, Tag, fmtWhen, openLink } from './ReportDetail';
import { KEEP_RUNS, asCaseResult, runCases } from './evalRuns';
import { FACE, glassSurface } from '../report/reportTheme';

// ─── Shared with the list ────────────────────────────────────────────────

/**
 * The quiet glass tag (ultraThin glass, secondary text): a row's source chip,
 * with its icon, and a neutral status. As tall as the tinted Tag.
 */
export function GlassTag({ label, icon, P }: { label: string; icon?: string; P: AdminPalette }) {
  return (
    <View style={[glassSurface('ultraThin', P.isDark), glassTagStyles.tag, icon ? glassTagStyles.withIcon : null]}>
      {icon ? <Icon name={icon} size={12} color={P.textSecondary} weight="bold" /> : null}
      <Text style={[glassTagStyles.text, { color: P.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const glassTagStyles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    gap: 4,
    borderRadius: 999,
    // A 1px glass edge keeps the tag the tinted Tag's height (21).
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    // Chips sit flat on their card.
    shadowOpacity: 0,
    elevation: 0,
  },
  withIcon: {
    paddingLeft: 6,
  },
  text: {
    ...FACE.semibold,
    fontSize: 11,
    lineHeight: 15,
  },
});

/** The server's status tag: tinted by its tone like the Reports tags, or the quiet glass tag when neutral. */
export function IssueStatusTag({ status, P }: { status: IssueStatus; P: AdminPalette }) {
  const color = issueToneColor(status.tone, P);
  return color ? <Tag label={status.text} color={color} /> : <GlassTag label={status.text} P={P} />;
}

/** "Red  ·  change 4" as a screen reader should say it: "Red, change 4". */
export function spoken(text: string): string {
  return text.replace(/\s*·\s*/g, ', ').trim();
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** How long "Copied: ..." stays under the buttons. */
const COPIED_MS = 4000;

/** Case ids are short, like STEP-07 or INJ-01C. Anything else never goes into a copied command. */
function isCaseId(id: string | null | undefined): id is string {
  return !!id && /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id);
}

/**
 * The command that re-runs just this case. A live (T2) case needs LIVE=1:
 * without it `make evals` skips every T2 case, so the command would run nothing.
 */
export function runCaseCommand(c: Pick<EvalCaseResult, 'id' | 'tier'>): string {
  return c.tier === 'T2' ? `make evals LIVE=1 CASE=${c.id}` : `make evals CASE=${c.id}`;
}

/** expo-clipboard is not installed, so copying is web only, and needs the browser's clipboard (a secure page). */
function canCopy(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  );
}

/** "RED change 4" -> "CHANGE 4", for the fix card's label. Other labels add nothing. */
function changeOf(label: string | null | undefined): string | null {
  const m = /change\s+(\d+)/i.exec(label || '');
  return m ? `CHANGE ${m[1]}` : null;
}

/** "2/3", "meets 2/3" or "2 of 3" -> "Meets 2 of 3". */
function fmtMeets(meets: string | null | undefined): string | null {
  const t = String(meets ?? '')
    .trim()
    .replace(/^meets\s*/i, '')
    .replace(/(\d+)\s*\/\s*(\d+)/, '$1 of $2');
  return t ? `Meets ${t}` : null;
}

function detailErrorText(e: AdminApiError, oneRun: boolean): string | undefined {
  if (e.kind === 'forbidden') return 'This account is not on the admin list.';
  if (e.kind === 'not_deployed') return 'The eval endpoints are not on this server yet.';
  if (e.kind === 'session') return 'Sign in again to see eval runs.';
  if (oneRun && e.kind === 'not_found') return `The server keeps the newest ${KEEP_RUNS} runs, so this one may have been removed.`;
  return oneRun ? 'Could not load this eval run.' : 'Could not load the latest eval run.';
}

/** What the view reads from a run: when it ran, and its cases. */
interface CaseRun {
  run_at: string | null;
  cases: EvalCaseResult[];
}

/** The given run's cases (GUR-282), or the latest whole live run's. Null when the server has no run yet. */
async function readRun(runId: string | null | undefined): Promise<CaseRun | null> {
  if (runId) {
    const run = await getEvalRun(runId);
    return { run_at: run?.run_at ?? null, cases: runCases(run?.cases).map(asCaseResult) };
  }
  const latest = await getLatestEvalRun();
  return latest ? { run_at: latest.run_at, cases: Array.isArray(latest.cases) ? latest.cases : [] } : null;
}

// ─── The view ────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
  /** The run to read the case from (the Eval runs view). Without one, the latest whole live run, as the Issues list opens it. */
  runId?: string | null;
  /** The row's status tag, so the case and its row say the same thing. */
  status: IssueStatus | null;
  /** The row's Linear link, for a case that carries none itself. */
  linearUrl: string | null;
  /** Bumped by the panel's Refresh button. */
  refreshSignal: number;
  onBack: () => void;
  /** What Back says to a screen reader: the view it returns to. */
  backLabel?: string;
}

export default function EvalCaseDetail({
  caseId,
  runId = null,
  status,
  linearUrl,
  refreshSignal,
  onBack,
  backLabel = 'Back to issues',
}: Props) {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);
  const oneRun = !!runId;

  // undefined until the first answer; null when the server has no eval run.
  const [run, setRun] = useState<CaseRun | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await readRun(runId);
      if (alive.current && mine === seq.current) setRun(data ?? null);
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

  const c = run ? (Array.isArray(run.cases) ? run.cases : []).find((x) => x?.id === caseId) ?? null : null;
  const command = c && isCaseId(c.id) && canCopy() ? runCaseCommand(c) : null;
  const linear = c?.linear_url || linearUrl || null;

  // Only copies: nothing runs from the app.
  const copy = async () => {
    if (!command) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(command);
      if (!alive.current) return;
      setCopied(command);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        if (alive.current) setCopied(null);
      }, COPIED_MS);
    } catch {
      if (!alive.current) return;
      setCopied(null);
      setCopyError(`Could not copy. Run it yourself: ${command}`);
    }
  };

  const subtitle = c ? [c.title, c.area].filter(Boolean).join('  ·  ') : '';
  const runWhen = run ? fmtWhen(run.run_at) : null;
  const change = c ? changeOf(c.label) : null;
  const runs = c && Array.isArray(c.runs) ? c.runs : [];
  const nRuns = c && isNum(c.n_runs) ? c.n_runs : runs.length;
  const nPassed = c && isNum(c.n_passed) ? c.n_passed : runs.filter((r) => r?.ok).length;
  // The mean of its runs (GUR-268), so a flaky case grades itself. Runs uploaded before it have none.
  const caseScore = c ? caseScoreText(c.score) : null;
  const runsLabel = [
    runs.length ? `${nPassed} of ${nRuns} runs passed` : null,
    caseScore ? caseScore.replace('/100', ' out of 100') : null,
  ]
    .filter(Boolean)
    .join(', ');
  const card = glassSurface('regular', P.isDark);

  return (
    <View style={s.wrap}>
      {/* Title block */}
      <View style={s.titleBlock}>
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
            {caseId}
          </Text>
          <View style={s.spacer} />
          {status?.text ? (
            <View accessible accessibilityLabel={spoken(status.text)}>
              <IssueStatusTag status={status} P={P} />
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={s.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {run === undefined && loading ? (
        <ActivityIndicator color={P.accent} style={s.spinner} />
      ) : run === undefined && error ? (
        <StateMessage
          title={error.message}
          detail={detailErrorText(error, oneRun)}
          actionLabel={error.kind === 'forbidden' || error.kind === 'session' ? undefined : 'Try again'}
          onAction={load}
          P={P}
          tone="bad"
        />
      ) : run === null ? (
        <StateMessage title="No eval run yet" detail="The latest run shows here once one is uploaded." P={P} />
      ) : run && !c ? (
        <StateMessage
          title={oneRun ? 'Not in this eval run' : 'Not in the latest eval run'}
          detail={
            oneRun
              ? `The ${runWhen ? `${runWhen} ` : ''}run has no case ${caseId}.`
              : `The ${runWhen ? `${runWhen} ` : 'latest '}run has no case ${caseId}. It may have been renamed or removed.`
          }
          P={P}
        />
      ) : c ? (
        <>
          {error ? <Text style={s.inlineError}>Could not refresh: {error.message}</Text> : null}

          {/* What good looks like */}
          <View style={[card, s.card]}>
            <Text style={s.cardLabel}>WHAT GOOD LOOKS LIKE</Text>
            {c.expect ? (
              <Text style={s.body} selectable>
                {c.expect}
              </Text>
            ) : (
              <Text style={s.small}>No expectation written for this case yet.</Text>
            )}
          </View>

          {/* What happened: a tag per run, then the story */}
          <View style={[card, s.card]}>
            <Text style={s.cardLabel}>
              {runWhen ? `WHAT HAPPENED  ·  RUN ${runWhen.toUpperCase()}` : 'WHAT HAPPENED'}
            </Text>
            {runsLabel ? (
              <View style={s.runs} accessible accessibilityLabel={runsLabel}>
                {runs.map((r, i) => (
                  <Tag key={i} label={`Run ${i + 1}  ${r?.ok ? 'pass' : 'fail'}`} color={r?.ok ? P.good : P.bad} />
                ))}
                {caseScore ? <GlassTag label={caseScore} P={P} /> : null}
              </View>
            ) : null}
            {c.what_happened ? (
              <Text style={s.body} selectable>
                {c.what_happened}
              </Text>
            ) : (
              <Text style={s.small}>No details recorded for this run.</Text>
            )}
          </View>

          {/* Why */}
          <View style={[card, s.card]}>
            <Text style={s.cardLabel}>WHY</Text>
            {c.why ? (
              <Text style={s.body} selectable>
                {c.why}
              </Text>
            ) : (
              <Text style={s.small}>No why written for this case yet.</Text>
            )}
          </View>

          {/* The fix */}
          <View style={[card, s.card]}>
            <Text style={s.cardLabel}>{change ? `THE FIX  ·  ${change}` : 'THE FIX'}</Text>
            {c.fix ? (
              <Text style={s.body} selectable>
                {c.fix}
              </Text>
            ) : (
              <Text style={s.small}>No fix written for this case yet.</Text>
            )}
          </View>

          {/* The judge: only when the run was judged */}
          {c.judge ? <JudgeCard judge={c.judge} P={P} s={s} /> : null}

          {/* Actions */}
          {command || linear ? (
            <View style={s.actions}>
              {command ? (
                <BigButton
                  label="Run this case"
                  icon="play"
                  variant="primary"
                  onPress={copy}
                  hint="Copies the command that re-runs just this case"
                  P={P}
                />
              ) : null}
              {linear ? (
                <BigButton
                  label="Linear"
                  icon="open-in-new"
                  variant="glass"
                  onPress={() => openLink(linear)}
                  hint="Opens the issue in Linear"
                  P={P}
                />
              ) : null}
            </View>
          ) : null}
          {copied ? (
            <View style={s.copiedRow} accessibilityLiveRegion="polite">
              <Icon name="check" size={12} color={P.good} weight="bold" />
              <Text style={s.copied} selectable>
                Copied: {copied}
              </Text>
            </View>
          ) : null}
          {copyError ? (
            <Text style={s.inlineError} accessibilityLiveRegion="polite" selectable>
              {copyError}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

/**
 * The judge's read: how many runs met the case, then its five dimensions in its own order (version 2),
 * skipping any it didn't score. An older run shows only the dimensions it shares with version 2.
 */
function JudgeCard({ judge, P, s }: { judge: EvalJudgeSummary; P: AdminPalette; s: Styles }) {
  const meets = fmtMeets(judge.meets);
  const means = judgeMeansText(judge.means);
  return (
    <View style={[glassSurface('regular', P.isDark), s.card]}>
      <View style={s.cardHead}>
        <Icon name="sparkle" size={13} color={P.accent} weight="bold" />
        <Text style={s.cardLabel}>THE JUDGE  ·  REPORT-ONLY</Text>
      </View>
      {meets ? <Text style={s.judgeMeets}>{meets}</Text> : null}
      {means ? <Text style={s.judgeMeans}>{means}</Text> : null}
      {judge.reason ? (
        <Text style={s.body} selectable>
          {judge.reason}
        </Text>
      ) : null}
      {!meets && !means && !judge.reason ? <Text style={s.small}>The judge sent back no read.</Text> : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

function makeStyles(P: AdminPalette) {
  return StyleSheet.create({
    wrap: {
      gap: 14,
      paddingBottom: 12,
    },
    titleBlock: {
      gap: 2,
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
    // Lines up under the title: the chevron (18) plus the gap (8).
    subtitle: {
      ...FACE.medium,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
      paddingLeft: 26,
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
    body: {
      ...FACE.medium,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
    small: {
      ...FACE.regular,
      fontSize: 12,
      lineHeight: 17,
      color: P.textSecondary,
    },
    runs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    judgeMeets: {
      ...FACE.bold,
      fontSize: 13,
      lineHeight: 18,
      color: P.text,
    },
    judgeMeans: {
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
    copiedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    copied: {
      ...FACE.medium,
      fontSize: 11,
      lineHeight: 15,
      color: P.textSecondary,
      flexShrink: 1,
    },
  });
}
