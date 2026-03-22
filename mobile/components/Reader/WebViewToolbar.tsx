import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';

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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <Text style={styles.source} numberOfLines={1}>
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
            color="#FFFFFF"
          />
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
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
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  progressTrack: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressFill: {
    height: 2,
    backgroundColor: '#6366F1',
  },
});
