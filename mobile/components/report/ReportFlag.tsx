/**
 * The quiet Report flag at the end of a finished agent turn (beta, GUR-242),
 * frame 12:3: flag icon and "Report" in the tertiary text color, right-aligned
 * under the turn's pills. guru.tsx renders it after the turn's last block and
 * opens ReportSheet with that turn attached. It is not a block type: the
 * BlockRenderer draws only the model's blocks.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../ui/Icon';
import { useTheme } from '../../contexts/ThemeContext';
import { FACE } from './reportTheme';

interface Props {
  onPress: () => void;
  /** Web only: guru.tsx's tap dedupe also binds the raw DOM click (see `tapProps` there). */
  onClick?: () => void;
}

export default function ReportFlag({ onPress, onClick }: Props) {
  const { colors } = useTheme();
  // RN-web forwards onClick to the DOM node; it is not in the native Pressable types.
  const webClick = (onClick ? { onClick } : {}) as object;
  return (
    <View style={styles.footer}>
      <Pressable
        onPress={onPress}
        {...webClick}
        accessibilityRole="button"
        accessibilityLabel="Report this turn"
        accessibilityHint="Tell the Guru team what went wrong in this turn"
        hitSlop={10}
        style={({ pressed }) => [styles.flag, pressed && styles.pressed]}
      >
        <Icon name="flag" size={13} color={colors.textTertiary} weight="bold" />
        <Text style={[styles.label, { color: colors.textTertiary }]}>Report</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // Pills end with 20px under them (8 per pill + 12 per block); the frame keeps the flag closer.
    marginTop: -8,
    marginBottom: 12,
  },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  label: {
    ...FACE.semibold,
    fontSize: 12,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.6,
  },
});
