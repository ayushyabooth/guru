import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import { useTheme } from '../../contexts/ThemeContext';

interface WebViewToolbarProps {
  onBack: () => void;
  progress: number; // 0-1
  source: string;
  isSaved: boolean;
  onSave: () => void;
  onUnsave: () => void;
}

export default function WebViewToolbar({
  onBack,
  progress,
  source,
  isSaved,
  onSave,
  onUnsave,
}: WebViewToolbarProps) {
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();

  const containerBg = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(248, 250, 252, 0.92)';
  const iconColor = isDark ? '#FFFFFF' : colors.textPrimary;
  const sourceColor = isDark ? '#FFFFFF' : colors.textPrimary;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: containerBg }]}>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="arrow-left" size={22} color={iconColor} />
        </TouchableOpacity>

        <Text style={[styles.source, { color: sourceColor }]} numberOfLines={1}>
          {source}
        </Text>

        <TouchableOpacity
          onPress={isSaved ? onUnsave : onSave}
          style={styles.iconButton}
          accessibilityLabel={isSaved ? 'Unsave article' : 'Save article'}
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={22}
            color={isSaved ? '#F59E0B' : iconColor}
          />
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(15, 23, 42, 0.12)' }]}>
        <View
          style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 44,
  },
  iconButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  source: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  progressTrack: {
    height: 2,
  },
  progressFill: {
    height: 2,
    backgroundColor: '#6366F1',
  },
});
