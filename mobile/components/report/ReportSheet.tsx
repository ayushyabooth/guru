/**
 * Report a bug sheet (beta, GUR-242): frames 12:27 (the form) and 12:78 (Sent).
 *
 * Two entry points share it:
 * - the Report flag under an agent turn: "Report this turn", with the turn's
 *   trace attached and the attached-turn row;
 * - the Beta card on Home (frame 13:2): "Report a bug", the screen name only.
 *
 * Thick glass over a scrim. Closes on the X, a scrim tap, Escape (web) and back
 * (Android); on web the Modal also traps focus and hands it back on close.
 *
 * The category and "What did you expect?" are both required, but Send stays
 * enabled: a tap with something missing shows a hint under the field instead
 * (design rule: avoid disabled buttons). Send shows Sent at once with the short
 * reference from the response. A failure keeps the text and offers Try again.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import LightTheme from '../../constants/lightTheme';
import { useTheme } from '../../contexts/ThemeContext';
import {
  EXPECTED_MAX_CHARS,
  REPORT_CATEGORIES,
  ReportApiError,
  ReportCategory,
  sendReport,
  toReportError,
} from '../../services/report-service';
import { FACE, formatClock, glassSurface, useReducedMotion, withAlpha } from './reportTheme';

/** The turn a report is about, as the user knows it. */
export interface AttachedTurn {
  /** The journey mode, e.g. "catch-up". */
  mode: string;
  /** When the turn finished, epoch ms. */
  finishedAt: number;
}

export interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Where the report comes from, sent as `screen`: "home", or "guru/<mode>" for a turn (e.g. "guru/catch-up"). */
  screen: string;
  /** The agent turn the report is about. With it the sheet reads "Report this turn". */
  traceId?: string | null;
  sessionId?: string | null;
  /** Shown in the attached-turn row: "This turn is attached · catch-up, 3:42 PM". */
  attached?: AttachedTurn | null;
}

const COPY = {
  turn: {
    title: 'Report this turn',
    subtitle: "We'll attach what Guru did on this turn, so the team sees exactly what you saw.",
    footnote: 'Beta testers only. Your words and this turn go to the Guru team.',
    sent: "It's with the team, with this turn attached. You don't need to do anything else.",
  },
  // Home (frame 13:2 names the title; the footnote and Sent line drop the turn). From Home the
  // screen is always "home", so the subtitle asks instead of promising to attach it (decided 10/7).
  screen: {
    title: 'Report a bug',
    subtitle: 'Tell us which screen it was on.',
    footnote: 'Beta testers only. Your words go to the Guru team.',
    sent: "It's with the team. You don't need to do anything else.",
  },
  // A Guru turn that failed before its trace reached the app: no turn to attach.
  failedTurn: {
    title: 'Report a bug',
    subtitle: "This turn didn't finish, so tell us what you asked.",
    footnote: 'Beta testers only. Your words go to the Guru team.',
    sent: "It's with the team. You don't need to do anything else.",
  },
};

/** Text on the solid indigo button: white in both modes (the light theme's inverse text). */
const ON_INTERACTIVE = LightTheme.textInverse;

/** What to say under the field when Send is tapped with something missing. */
function missingHint(hasCategory: boolean, hasText: boolean): string | null {
  if (hasCategory && hasText) return null;
  if (!hasCategory && !hasText) return 'Pick what went wrong and say what you expected.';
  if (!hasCategory) return 'Pick what went wrong above.';
  return 'Say what you expected, in a few words.';
}

/** One line for a failed send, and whether trying again can help. */
function failureLine(e: ReportApiError): { text: string; canRetry: boolean } {
  if (e.kind === 'network') return { text: "Couldn't send. Check your connection.", canRetry: true };
  if (e.kind === 'session') return { text: 'Your session ended. Sign in and try again.', canRetry: false };
  if (e.kind === 'forbidden') return { text: 'Reports are open to beta testers only.', canRetry: false };
  // The server rejected the report (422) or has no report route (404): sending it again cannot help.
  if (e.kind === 'invalid' || e.kind === 'not_deployed') return { text: "Couldn't send that report.", canRetry: false };
  return { text: "Couldn't send that report.", canRetry: true };
}

/**
 * Web: the field draws its own indigo focus border (frame 12:27), but the app's
 * global a11y CSS (app/_layout.tsx) adds an !important outline to every focused
 * textarea, and an inline style cannot beat !important. A rule scoped to this
 * field's data attribute can, so the field shows one indigo ring, not two.
 */
const FIELD_DATA_SET = { reportField: 'expected' };
const FIELD_STYLE_ID = 'guru-report-field-focus';
function allowFieldFocusBorderOnly() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById(FIELD_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FIELD_STYLE_ID;
  style.textContent =
    'textarea[data-report-field]:focus, textarea[data-report-field]:focus-visible { outline: none !important; }';
  document.head.appendChild(style);
}

export default function ReportSheet({ visible, onClose, screen, traceId, sessionId, attached }: ReportSheetProps) {
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const isTurn = !!traceId;
  const copy = isTurn ? COPY.turn : screen === 'home' ? COPY.screen : COPY.failedTurn;

  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [expected, setExpected] = useState('');
  const [triedSend, setTriedSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<ReportApiError | null>(null);
  const [sent, setSent] = useState(false);
  /** The short reference from the receipt; null when the server saved the report but its answer was unreadable. */
  const [reference, setReference] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // A response for a report this sheet has since moved on from is dropped.
  const sendSeq = useRef(0);
  // The double-submit guard: a ref, so two taps in one frame cannot both send.
  const sendingRef = useRef(false);
  // Whether the tester has seen Sent. A send that completes while the sheet is
  // closed (a scrim tap or Escape during "Sending") must show Sent on the next
  // open: a fresh form would invite a re-send, a duplicate Linear issue and a
  // second paid triage.
  const sentShown = useRef(false);

  // Start clean for a different turn or screen, or once the tester has seen
  // Sent. Reopening the same report keeps the draft (a stray scrim tap should
  // not cost the user their words) or the Sent they have not seen yet. A layout
  // effect, so a reopened sheet never paints one frame of the last report.
  const contextKey = `${screen}|${traceId ?? ''}`;
  const draftKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!visible) return;
    allowFieldFocusBorderOnly();
    if (draftKey.current === contextKey && (!sent || !sentShown.current)) return;
    draftKey.current = contextKey;
    sentShown.current = false;
    sendingRef.current = false;
    sendSeq.current += 1;
    setCategory(null);
    setExpected('');
    setTriedSend(false);
    setSending(false);
    setFailure(null);
    setSent(false);
    setReference(null);
    setFocused(false);
    // `sent` is read only at open time on purpose: Sent must stay on screen until the sheet closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contextKey]);

  // Sent replaces the form, and the focused Send button with it: put focus on
  // Done (web) or announce it (native) so nobody is left on a removed control.
  // Runs after paint, so it also records that Sent was on screen.
  const doneRef = useRef<View>(null);
  useEffect(() => {
    if (!visible || !sent) return;
    sentShown.current = true;
    if (Platform.OS === 'web') {
      const t = setTimeout(() => {
        (doneRef.current as unknown as { focus?: () => void } | null)?.focus?.();
      }, 0);
      return () => clearTimeout(t);
    }
    AccessibilityInfo.announceForAccessibility('Sent. Thanks.');
    return undefined;
  }, [visible, sent]);

  const hasCategory = category !== null;
  const hasText = expected.trim().length > 0;
  const hint = triedSend ? missingHint(hasCategory, hasText) : null;

  const send = async () => {
    if (sendingRef.current) return;
    if (!category || !expected.trim()) {
      setTriedSend(true);
      return;
    }
    sendingRef.current = true;
    const seq = ++sendSeq.current;
    setSending(true);
    setFailure(null);
    try {
      const receipt = await sendReport({ category, expected, screen, trace_id: traceId, session_id: sessionId });
      if (seq === sendSeq.current) {
        setReference(receipt.reference);
        setSent(true);
      }
    } catch (e) {
      if (seq === sendSeq.current) {
        const err = toReportError(e);
        if (err.kind === 'bad_response') {
          // A 2xx the app could not read: the report was saved, only the reference is missing.
          setReference(null);
          setSent(true);
        } else {
          setFailure(err);
        }
      }
    } finally {
      if (seq === sendSeq.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  // Indigo means Guru is asking: the missing-field hint and Try again.
  const askColor = isDark ? colors.interactiveHover : colors.interactive;
  const chipGlass = glassSurface('ultraThin', isDark);
  const line = failure ? failureLine(failure) : null;
  const attachedText = attached
    ? `This turn is attached  ·  ${attached.mode}, ${formatClock(attached.finishedAt)}`
    : 'This turn is attached';

  return (
    <Modal
      visible={visible}
      transparent
      // The still frame for reduced motion: the sheet just appears.
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* The sheet comes before the scrim in the tree, so the web focus trap starts inside the sheet. */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <View
            style={[glassSurface('thick', isDark), styles.sheet, { paddingBottom: 24 + insets.bottom }]}
            accessibilityViewIsModal
          >
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: withAlpha(colors.textPrimary, 0.25) }]} />
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {sent ? (
                // ── Sent (frame 12:78) ──
                <>
                  <View style={styles.sentRow}>
                    <View style={[styles.badge, { backgroundColor: withAlpha(colors.success, 0.18) }]}>
                      <Icon name="check" size={20} color={colors.success} weight="bold" />
                    </View>
                    <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
                      Sent. Thanks.
                    </Text>
                  </View>
                  <Text style={[styles.sentBody, { color: colors.textSecondary }]}>{copy.sent}</Text>
                  {reference ? (
                    <Text style={[styles.reference, { color: colors.textTertiary }]} selectable>
                      Reference {reference}
                    </Text>
                  ) : null}
                  <Pressable
                    ref={doneRef}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Done"
                    style={({ pressed }) => [glassSurface('thin', isDark), styles.done, pressed && styles.pressed]}
                  >
                    <Text style={[styles.doneText, { color: colors.textPrimary }]}>Done</Text>
                  </Pressable>
                </>
              ) : (
                // ── The form (frame 12:27) ──
                <>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
                      {copy.title}
                    </Text>
                    <Pressable
                      onPress={onClose}
                      accessibilityRole="button"
                      accessibilityLabel="Close"
                      hitSlop={13}
                      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                    >
                      <Icon name="close" size={18} color={colors.textTertiary} weight="bold" />
                    </Pressable>
                  </View>

                  <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{copy.subtitle}</Text>

                  <Text style={[styles.label, { color: colors.textTertiary }]}>What went wrong?</Text>
                  <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="What went wrong?">
                    {REPORT_CATEGORIES.map((c) => {
                      const selected = c.value === category;
                      return (
                        <Pressable
                          key={c.value}
                          onPress={() => setCategory(c.value)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={c.label}
                          style={({ pressed }) => [
                            chipGlass,
                            styles.chip,
                            selected && {
                              backgroundColor: withAlpha(colors.interactive, 0.22),
                              borderColor: withAlpha(colors.interactiveHover, 0.9),
                            },
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              selected && styles.chipTextSelected,
                              { color: selected ? colors.textPrimary : colors.textSecondary },
                            ]}
                          >
                            {c.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.label, { color: colors.textTertiary }]}>What did you expect?</Text>
                  <View style={styles.fieldBlock}>
                    <TextInput
                      value={expected}
                      onChangeText={setExpected}
                      multiline
                      maxLength={EXPECTED_MAX_CHARS}
                      textAlignVertical="top"
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      accessibilityLabel="What did you expect?"
                      // RN-web renders it as data-report-field (see allowFieldFocusBorderOnly).
                      {...(Platform.OS === 'web' ? ({ dataSet: FIELD_DATA_SET } as object) : {})}
                      style={[
                        // The glass recipe is typed as a ViewStyle; every key in it is valid on a TextInput.
                        glassSurface('regular', isDark) as TextStyle,
                        styles.field,
                        { color: colors.textPrimary },
                        focused && { borderColor: withAlpha(colors.interactiveHover, 0.7) },
                        WEB_NO_OUTLINE,
                      ]}
                    />
                    {hint ? (
                      <Text style={[styles.hint, { color: askColor }]} accessibilityLiveRegion="polite">
                        {hint}
                      </Text>
                    ) : null}
                  </View>

                  {isTurn ? (
                    <View
                      style={[chipGlass, styles.attached]}
                      accessible
                      accessibilityLabel={attachedText.replace('  ·  ', ', ')}
                    >
                      <Icon name="paperclip" size={14} color={colors.textSecondary} weight="bold" />
                      <Text style={[styles.attachedText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {attachedText}
                      </Text>
                    </View>
                  ) : null}

                  {line ? (
                    // Not in a frame: a failed send. One line, the text stays in the field.
                    <View style={styles.failureRow} accessibilityLiveRegion="polite">
                      <Text style={[styles.failureText, { color: colors.error }]} numberOfLines={1}>
                        {line.text}
                      </Text>
                      {line.canRetry ? (
                        <Pressable
                          onPress={send}
                          accessibilityRole="button"
                          accessibilityLabel="Try again"
                          hitSlop={10}
                          style={({ pressed }) => pressed && styles.pressed}
                        >
                          <Text style={[styles.tryAgain, { color: askColor }]}>Try again</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  <Pressable
                    onPress={send}
                    accessibilityRole="button"
                    accessibilityLabel="Send report"
                    accessibilityState={{ busy: sending }}
                    style={({ pressed }) => [
                      styles.primary,
                      { backgroundColor: pressed ? colors.interactivePressed : colors.interactive },
                    ]}
                  >
                    <Text style={[styles.primaryText, { color: ON_INTERACTIVE }]}>
                      {sending ? 'Sending' : 'Send report'}
                    </Text>
                  </Pressable>

                  <Text style={[styles.footnote, { color: colors.textTertiary }]}>{copy.footnote}</Text>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>

        <Pressable
          style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: colors.shadowHeavy }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          // Out of the tab order: keyboard users have Escape and the X.
          focusable={false}
        />
      </View>
    </Modal>
  );
}

/** The field draws its own focus border (indigo), so the browser's default outline goes. The app's global !important ring needs the scoped rule above. */
const WEB_NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as TextStyle | null;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // Fills the screen and lets taps through to the scrim; with the iOS keyboard
  // up it pads from below, and the sheet's percentage max height shrinks with it.
  kav: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 1,
    pointerEvents: 'box-none',
  },
  scrim: {
    zIndex: 0,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    borderRadius: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  handleRow: {
    alignItems: 'center',
    marginBottom: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  scroll: {
    flexGrow: 0,
  },
  body: {
    gap: 14,
  },
  pressed: {
    opacity: 0.7,
  },

  // Title
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    ...FACE.extrabold,
    fontSize: 18,
    lineHeight: 25,
    flexShrink: 1,
  },
  close: {
    padding: 0,
  },
  subtitle: {
    ...FACE.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    ...FACE.bold,
    fontSize: 12,
    lineHeight: 17,
  },

  // Categories
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    ...FACE.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  chipTextSelected: {
    ...FACE.semibold,
  },

  // What did you expect?
  fieldBlock: {
    gap: 6,
  },
  field: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 84,
    maxHeight: 160,
    ...FACE.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  hint: {
    ...FACE.medium,
    fontSize: 12,
    lineHeight: 17,
  },

  // This turn is attached
  attached: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 7,
  },
  attachedText: {
    ...FACE.medium,
    fontSize: 12,
    lineHeight: 17,
    flexShrink: 1,
  },

  // A failed send (not in a frame)
  failureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  failureText: {
    ...FACE.medium,
    fontSize: 12,
    lineHeight: 17,
    flexShrink: 1,
  },
  tryAgain: {
    ...FACE.semibold,
    fontSize: 12,
    lineHeight: 17,
  },

  // Send report
  primary: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    ...FACE.bold,
    fontSize: 15,
    lineHeight: 21,
  },
  footnote: {
    ...FACE.regular,
    fontSize: 11,
    lineHeight: 15,
  },

  // Sent
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentBody: {
    ...FACE.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  reference: {
    ...FACE.semibold,
    fontSize: 12,
    lineHeight: 17,
  },
  done: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    ...FACE.bold,
    fontSize: 15,
    lineHeight: 21,
  },
});
