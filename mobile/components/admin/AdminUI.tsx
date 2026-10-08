/**
 * Small building blocks shared by the Perf panel tabs and the turn detail view.
 * Every color comes from the admin palette, so light and dark mode both work.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { liquidGlassPill } from '../../constants/liquidGlass';
import { AdminPalette, AdminType, withAlpha } from './adminTheme';

// ─── Chip ────────────────────────────────────────────────────────────────

export function Chip({ label, color, P, style }: { label: string; color: string; P: AdminPalette; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        ui.chip,
        { backgroundColor: withAlpha(color, P.isDark ? 0.18 : 0.12), borderColor: withAlpha(color, P.isDark ? 0.4 : 0.35) },
        style,
      ]}
    >
      <Text style={[ui.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ─── Segmented control ───────────────────────────────────────────────────

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  P,
  accessibilityLabel,
  role = 'radio',
  dense = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  P: AdminPalette;
  accessibilityLabel: string;
  /** 'tab' for the panel's tab bar, 'radio' for filters. */
  role?: 'tab' | 'radio';
  /**
   * Tighter padding, and segments that may shrink (ellipsized) rather than
   * overflow: the panel's five tabs fit one row on a phone, no scrolling.
   */
  dense?: boolean;
}) {
  return (
    <View
      style={[ui.segWrap, dense && ui.segWrapDense, { backgroundColor: P.surface, borderColor: P.border }]}
      accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            onPress={() => onChange(opt.value)}
            accessibilityRole={role}
            accessibilityState={{ selected: active, checked: role === 'radio' ? active : undefined }}
            accessibilityLabel={opt.label}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            style={[ui.seg, dense && ui.segDense, active && liquidGlassPill(P.accentHex, P.isDark)]}
          >
            <Text
              style={[ui.segText, { color: active ? P.text : P.textSecondary }, active && ui.segTextActive]}
              numberOfLines={dense ? 1 : undefined}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Section header ──────────────────────────────────────────────────────

export function SectionHeader({ title, right, P }: { title: string; right?: string; P: AdminPalette }) {
  return (
    <View style={[ui.sectionHeader, { borderTopColor: P.divider }]}>
      <Text style={[ui.sectionTitle, { color: P.text }]} accessibilityRole="header">
        {title}
      </Text>
      {right ? <Text style={[ui.sectionRight, { color: P.textTertiary }]}>{right}</Text> : null}
    </View>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────

export function ActionButton({
  label,
  onPress,
  P,
  variant = 'secondary',
  disabled = false,
  busy = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  P: AdminPalette;
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || busy;
  const palette =
    variant === 'primary'
      ? { bg: P.accentHex, border: P.accentHex, text: P.onSolid }
      : variant === 'secondary'
        ? { bg: P.accentBg, border: P.accentBorder, text: P.accent }
        : { bg: 'transparent', border: 'transparent', text: P.accent };
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[
        ui.btn,
        variant === 'quiet' && ui.btnQuiet,
        { backgroundColor: palette.bg, borderColor: palette.border },
        isDisabled && ui.btnDisabled,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={palette.text} style={ui.btnSpinner} /> : null}
      <Text style={[ui.btnText, { color: palette.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Empty / error / gated states ────────────────────────────────────────

export function StateMessage({
  title,
  detail,
  actionLabel,
  onAction,
  P,
  tone = 'muted',
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  P: AdminPalette;
  tone?: 'muted' | 'bad';
}) {
  return (
    <View style={[ui.state, { backgroundColor: P.surface, borderColor: P.border }]} accessibilityLiveRegion="polite">
      <Text style={[ui.stateTitle, { color: tone === 'bad' ? P.bad : P.text }]}>{title}</Text>
      {detail ? <Text style={[ui.stateDetail, { color: P.textSecondary }]}>{detail}</Text> : null}
      {actionLabel && onAction ? (
        <ActionButton label={actionLabel} onPress={onAction} P={P} style={ui.stateAction} />
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const ui = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    ...AdminType.label,
  },
  segWrap: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  segWrapDense: {
    maxWidth: '100%',
  },
  seg: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segDense: {
    paddingHorizontal: 9,
    flexShrink: 1,
    minWidth: 0,
  },
  segText: {
    ...AdminType.small,
  },
  segTextActive: {
    fontFamily: 'Manrope_700Bold',
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 12,
    paddingBottom: 8,
    marginTop: 4,
    borderTopWidth: 1,
  },
  sectionTitle: {
    ...AdminType.section,
  },
  sectionRight: {
    ...AdminType.small,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnQuiet: {
    paddingHorizontal: 4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnSpinner: {
    marginRight: 6,
  },
  btnText: {
    ...AdminType.bodyStrong,
  },
  state: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    marginVertical: 8,
  },
  stateTitle: {
    ...AdminType.title,
    textAlign: 'center',
  },
  stateDetail: {
    ...AdminType.body,
    textAlign: 'center',
    marginTop: 4,
  },
  stateAction: {
    alignSelf: 'center',
    marginTop: 12,
  },
});
