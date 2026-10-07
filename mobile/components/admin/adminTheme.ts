/**
 * Admin panel theme: one palette for the Perf panel in light and dark mode,
 * built from the app theme (ThemeContext) so nothing is hard-coded per mode.
 *
 * Color vocabulary (design language): indigo means Guru or an action, the
 * semantic colors mean bad / warn / good / info, and the reading-mode pillar
 * colors (catch-up blue, dive-in pink, recap orange) are NOT used here.
 */
import { useMemo } from 'react';
import { Platform, TextStyle } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type {
  AgentOutcome,
  AgentInputType,
  TimelineKind,
  TurnSeverity,
  TakeawaySeverity,
  FindingSeverity,
  HypothesisConfidence,
} from '../../services/admin-service';

// ─── Palette ─────────────────────────────────────────────────────────────

/** "#RRGGBB" or "#RGB" -> rgba() with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ThemeColorsLike {
  background: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export function buildAdminPalette(isDark: boolean, colors: ThemeColorsLike) {
  // Indigo: Guru and actions. Lighter in dark mode, deeper in light mode for contrast.
  const accent = isDark ? '#818CF8' : '#4F46E5';
  const indigo = '#6366F1';
  const orange = isDark ? '#F97316' : '#EA580C';
  const slate = isDark ? '#94A3B8' : '#64748B';
  return {
    isDark,

    // Surfaces. The panel is "thick" glass (carries dense text over a moving
    // background), so it is nearly opaque; light glass is white, dark glass navy.
    screenBg: colors.background,
    panelBg: isDark ? 'rgba(13, 17, 28, 0.94)' : 'rgba(255, 255, 255, 0.96)',
    panelBorder: withAlpha(indigo, isDark ? 0.32 : 0.22),
    surface: isDark ? 'rgba(255, 255, 255, 0.045)' : 'rgba(15, 23, 42, 0.035)',
    surfaceStrong: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
    border: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)',
    divider: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.07)',
    track: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.06)',
    shadow: isDark ? '#000000' : '#0F172A',

    // Text
    text: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    onSolid: '#FFFFFF',

    // Action / agent
    accent,
    accentHex: indigo,
    accentBg: withAlpha(indigo, isDark ? 0.2 : 0.1),
    accentBorder: withAlpha(indigo, isDark ? 0.45 : 0.35),
    toggleBg: withAlpha(indigo, 0.9),

    // Semantic (the theme already deepens these one step in light mode)
    bad: colors.error,
    warn: colors.warning,
    good: colors.success,
    info: colors.info,
    orange,
    muted: slate,

    /** Timeline bar color per span kind. */
    kind: {
      phase: slate,
      model: accent,
      tool: isDark ? '#2DD4BF' : '#0D9488',
      block: isDark ? '#34D399' : '#059669',
      approval: isDark ? '#FBBF24' : '#D97706',
    } as Record<TimelineKind, string>,

    /** Outcome chip / stacked bar color. */
    outcome: {
      blocks: colors.success,
      approval: accent,
      max_iters: colors.warning,
      error: colors.error,
      abandoned: slate,
    } as Record<AgentOutcome, string>,
  };
}

export type AdminPalette = ReturnType<typeof buildAdminPalette>;

export function useAdminPalette(): AdminPalette {
  const { isDark, colors } = useTheme();
  return useMemo(() => buildAdminPalette(isDark, colors), [isDark, colors]);
}

export function turnSeverityColor(sev: TurnSeverity | string | null | undefined, P: AdminPalette): string {
  if (sev === 'bad') return P.bad;
  if (sev === 'warn') return P.warn;
  if (sev === 'ok') return P.good;
  return P.muted;
}

export function takeawayColor(sev: TakeawaySeverity | string | null | undefined, P: AdminPalette): string {
  if (sev === 'bad') return P.bad;
  if (sev === 'warn') return P.warn;
  if (sev === 'good') return P.good;
  if (sev === 'info') return P.info;
  return P.muted;
}

/**
 * Accepts the contract's bad | warn | info and the engine's critical | high |
 * medium | low | info. Same cut as the turn severity: critical/high are bad,
 * medium is warn, low and info are FYI.
 */
export function findingColor(sev: FindingSeverity | string | null | undefined, P: AdminPalette): string {
  if (sev === 'bad' || sev === 'critical' || sev === 'high') return P.bad;
  if (sev === 'warn' || sev === 'medium') return P.warn;
  if (sev === 'low') return P.info;
  return P.muted;
}

/**
 * How to show a model call, tool call or timeline span status. Covers the
 * contract (ok | error | abandoned) and what the tracer records (running,
 * failed, raised, http_error).
 */
export function spanStatus(
  status: string | null | undefined,
  P: AdminPalette,
): { failed: boolean; tag: string | null; color: string | null; hollow: boolean } {
  if (status === 'error' || status === 'failed' || status === 'raised' || status === 'http_error') {
    return { failed: true, tag: 'Error', color: P.bad, hollow: false };
  }
  if (status === 'abandoned') return { failed: false, tag: 'Abandoned', color: P.bad, hollow: true };
  if (status === 'running') return { failed: false, tag: 'Unfinished', color: P.warn, hollow: true };
  return { failed: false, tag: null, color: null, hollow: false };
}

export function outcomeColor(outcome: string | null | undefined, P: AdminPalette): string {
  return (outcome && (P.outcome as Record<string, string>)[outcome]) || P.muted;
}

export function confidenceColor(c: HypothesisConfidence | string | null | undefined, P: AdminPalette): string {
  if (c === 'high') return P.good;
  if (c === 'medium') return P.warn;
  return P.muted;
}

// ─── Type ────────────────────────────────────────────────────────────────

/** Monospace stack for ids, JSON and numbers that must line up. */
export const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}) as string;

type AdminTypeKey = 'title' | 'section' | 'body' | 'bodyStrong' | 'small' | 'label' | 'number' | 'headline' | 'mono';

/** Manrope at the panel's compact sizes (family and weight paired as in liquidGlass Typography). */
export const AdminType: Record<AdminTypeKey, TextStyle> = {
  title: { fontFamily: 'Manrope_700Bold', fontWeight: '700', fontSize: 14, lineHeight: 18, letterSpacing: 0.2 },
  section: { fontFamily: 'Manrope_700Bold', fontWeight: '700', fontSize: 12, lineHeight: 16, letterSpacing: 0.3 },
  body: { fontFamily: 'Manrope_400Regular', fontWeight: '400', fontSize: 12, lineHeight: 17 },
  bodyStrong: { fontFamily: 'Manrope_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 17 },
  small: { fontFamily: 'Manrope_500Medium', fontWeight: '500', fontSize: 11, lineHeight: 15 },
  label: { fontFamily: 'Manrope_600SemiBold', fontWeight: '600', fontSize: 10, lineHeight: 13, letterSpacing: 0.4 },
  number: { fontFamily: 'Manrope_700Bold', fontWeight: '700', fontSize: 17, lineHeight: 22, fontVariant: ['tabular-nums'] },
  headline: { fontFamily: 'Manrope_700Bold', fontWeight: '700', fontSize: 15, lineHeight: 21 },
  mono: { fontFamily: MONO, fontSize: 11, lineHeight: 15 },
};

// ─── Formatting (all null-safe) ──────────────────────────────────────────

export function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 850 -> "850ms", 2140 -> "2.1s", 21000 -> "21s". Missing -> "-". */
export function fmtMs(ms: number | null | undefined): string {
  if (!isNum(ms)) return '-';
  const a = Math.abs(ms);
  if (a < 1000) return `${Math.round(ms)}ms`;
  if (a < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/** Signed duration for deltas: "+300ms", "-1.2s". */
export function fmtMsDelta(ms: number): string {
  return `${ms > 0 ? '+' : ms < 0 ? '-' : ''}${fmtMs(Math.abs(ms))}`;
}

/** 14200 -> "14,200". Missing -> "-". */
export function fmtNum(n: number | null | undefined): string {
  if (!isNum(n)) return '-';
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 14200 -> "14.2k", 1250000 -> "1.3M". Missing -> "-". */
export function fmtCompact(n: number | null | undefined): string {
  if (!isNum(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (a >= 10000) return `${Math.round(n / 1000)}k`;
  if (a >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** 0.78 -> "78%", 0.004 -> "<1%". Missing -> "-". */
export function fmtPct(x: number | null | undefined): string {
  if (!isNum(x)) return '-';
  const pct = x * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local time: "Oct 6, 3:12 PM" (or "Oct 6, 3:12:05 PM" with seconds). */
export function fmtDateTime(iso: string | null | undefined, withSeconds = false): string {
  const d = parseDate(iso);
  if (!d) return iso || '-';
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = withSeconds ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hour12}:${mm}${ss} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Local date: "Oct 6". */
export function fmtDate(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return iso || '-';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** First n characters of an id or sha. Missing -> "-". */
export function shortId(id: string | null | undefined, n = 8): string {
  if (!id) return '-';
  return id.length > n ? id.slice(0, n) : id;
}

// ─── Labels (plain, short) ───────────────────────────────────────────────

export const OUTCOME_ORDER: AgentOutcome[] = ['blocks', 'approval', 'max_iters', 'error', 'abandoned'];

export const OUTCOME_LABEL: Record<AgentOutcome, string> = {
  blocks: 'Blocks',
  approval: 'Approval',
  max_iters: 'Max iters',
  error: 'Error',
  abandoned: 'Abandoned',
};

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return '-';
  return (OUTCOME_LABEL as Record<string, string>)[outcome] ?? outcome;
}

export const SEVERITY_LABEL: Record<string, string> = {
  bad: 'Bad',
  warn: 'Warn',
  ok: 'OK',
  good: 'Good',
  info: 'Info',
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function severityLabel(sev: string | null | undefined): string {
  if (!sev) return '-';
  return SEVERITY_LABEL[sev] ?? sev;
}

const INPUT_TYPE_LABEL: Record<AgentInputType, string> = {
  goal: 'Goal',
  message: 'Message',
  decision: 'Decision',
};

/** "Message: what's new in chips" or "Message, text not kept" (real users keep ids only). */
export function inputLine(inputType: string | null | undefined, preview: string | null | undefined): string {
  const label = (inputType && (INPUT_TYPE_LABEL as Record<string, string>)[inputType]) || inputType || 'Input';
  const text = (preview || '').replace(/\s+/g, ' ').trim();
  return text ? `${label}: ${text}` : `${label}, text not kept`;
}

/** Evidence value as text. Numbers keyed *_ms also get a readable duration. */
export function fmtEvidence(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    return /_ms$/.test(key) && isNum(value) ? `${value} (${fmtMs(value)})` : String(value);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
