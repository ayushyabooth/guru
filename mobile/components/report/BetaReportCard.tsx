/**
 * Home's Beta section (GUR-242), frame 13:2: a "Beta" label and one card row,
 * Report a bug. Home renders it for beta accounts only (`/me/access` is_beta);
 * the report endpoint checks beta again on the server. Opens the same sheet as
 * the agent turn's flag, with the screen name instead of a turn.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../ui/Icon';
import { Spacing } from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import ReportSheet from './ReportSheet';
import { FACE, glassSurface, withAlpha } from './reportTheme';

export default function BetaReportCard() {
  const { isDark, colors } = useTheme();
  const [open, setOpen] = useState(false);
  const indigo = isDark ? colors.interactiveHover : colors.interactive;

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: colors.textTertiary }]} accessibilityRole="header">
        Beta
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Report a bug"
        accessibilityHint="Tell us what broke. It goes straight to the team."
        style={({ pressed }) => [glassSurface('regular', isDark), styles.card, pressed && styles.pressed]}
      >
        <View style={[styles.iconBox, { backgroundColor: withAlpha(colors.interactive, 0.2) }]}>
          <Icon name="bug" size={18} color={indigo} weight="bold" />
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Report a bug</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Tell us what broke. It goes straight to the team.
          </Text>
        </View>
        <Icon name="chevron-right" size={16} color={colors.textTertiary} weight="bold" />
      </Pressable>

      <ReportSheet visible={open} onClose={() => setOpen(false)} screen="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    gap: 14,
  },
  label: {
    ...FACE.bold,
    fontSize: 12,
    lineHeight: 17,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.8,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...FACE.bold,
    fontSize: 15,
    lineHeight: 21,
  },
  subtitle: {
    ...FACE.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
