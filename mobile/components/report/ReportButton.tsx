/**
 * The Report button on every screen (beta, GUR-277): frame 27:7, part 26:4.
 * A 36pt thin-glass circle in a 44pt target, the bold flag at 16 in
 * textSecondary. Pressed, it turns indigo like the turn flag, and it stays
 * indigo while the sheet it opened is up. Keyboard focus draws the app's 2px
 * indigo ring 2pt from the circle, kept round (keepFocusRingRound below).
 *
 * Screens render it for beta accounts only, with the same isBeta as Home's
 * card, and name their screen. It opens the same ReportSheet as Home's card
 * with that screen; sendReport adds the session's context to every report.
 *
 * The sheet lives in ReportSheetHost, mounted once in the root layout, not in
 * the button: a Recap stage change, or Stage 4 finishing loading, swaps the
 * button for another one, and an open sheet with the tester's words in it has
 * to survive that.
 */
import React, { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Icon from '../ui/Icon';
import { useTheme } from '../../contexts/ThemeContext';
import ReportSheet from './ReportSheet';
import { glassSurface, withAlpha } from './reportTheme';

// ─── The open sheet: a tiny external store, like setTabBarHidden ─────────

interface OpenSheet {
  /** Sent as the report's `screen`. */
  screen: string;
  /** The button that opened it, so only that one shows the open state. */
  opener: string;
}

let openSheet: OpenSheet | null = null;
const listeners = new Set<() => void>();

function setOpenSheet(next: OpenSheet | null) {
  openSheet = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useOpenSheet(): OpenSheet | null {
  return useSyncExternalStore(subscribe, () => openSheet, () => openSheet);
}

/**
 * The one sheet every Report button opens. The root layout mounts it once. It
 * renders nothing until a button first asks for it, so an account that never
 * sees a Report button never mounts a sheet.
 */
export function ReportSheetHost() {
  const open = useOpenSheet();
  // The last screen asked for: it stays on the sheet while the sheet fades out after closing.
  const [lastScreen, setLastScreen] = useState<string | null>(null);
  useEffect(() => {
    if (open) setLastScreen(open.screen);
  }, [open]);
  if (!open && lastScreen === null) return null;
  return <ReportSheet visible={!!open} onClose={() => setOpenSheet(null)} screen={open?.screen ?? lastScreen ?? 'other'} />;
}

// ─── The button ──────────────────────────────────────────────────────────

/**
 * Web: the app's global :focus-visible rule (app/_layout.tsx) squares every
 * focused element to a 6px radius and draws the ring 2px outside it. A rule
 * scoped to this button's data attribute keeps the ring round and on the
 * target's edge, 2pt from the glass (part 26:4). Nothing else changes.
 */
const FOCUS_DATA_SET = { reportButton: 'flag' };
const FOCUS_STYLE_ID = 'guru-report-button-focus';
function keepFocusRingRound() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById(FOCUS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FOCUS_STYLE_ID;
  style.textContent =
    '[data-report-button]:focus-visible { border-radius: 22px !important; outline-offset: -2px !important; }';
  document.head.appendChild(style);
}

interface Props {
  /** Where the report comes from, sent as `screen`: "catchup", "divein", "recap" or "article". */
  screen: string;
  /** Placement only, e.g. margins that seat the 44pt target on a shorter title line. */
  style?: StyleProp<ViewStyle>;
}

export default function ReportButton({ screen, style }: Props) {
  const { isDark, colors } = useTheme();
  const me = useId();
  const open = useOpenSheet();
  const sheetIsOpen = open?.opener === me;
  // Indigo means Guru or an action: the deeper one on light glass.
  const indigo = isDark ? colors.interactiveHover : colors.interactive;

  useEffect(() => {
    keepFocusRingRound();
  }, []);

  return (
    <Pressable
      onPress={() => setOpenSheet({ screen, opener: me })}
      accessibilityRole="button"
      accessibilityLabel="Report a bug on this screen"
      accessibilityHint="Tell us what broke. It goes straight to the team."
      // RN-web renders it as data-report-button (see keepFocusRingRound).
      {...(Platform.OS === 'web' ? ({ dataSet: FOCUS_DATA_SET } as object) : {})}
      style={[styles.target, style]}
    >
      {({ pressed }) => {
        const on = pressed || sheetIsOpen;
        return (
          <View
            style={[
              glassSurface('thin', isDark),
              styles.circle,
              on && { borderColor: withAlpha(colors.interactive, 0.45) },
            ]}
          >
            {on ? <View style={[styles.tint, { backgroundColor: withAlpha(colors.interactive, 0.2) }]} /> : null}
            <Icon name="flag" size={16} color={on ? indigo : colors.textSecondary} weight="bold" />
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pressed: indigo over the glass, so the circle keeps its depth.
  tint: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    pointerEvents: 'none',
  },
});
