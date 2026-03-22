import React from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import Icon from '../ui/Icon';

interface GuruFABProps {
  annotationCount: number;
  onPress: () => void;
  visible: boolean;
}

export default function GuruFAB({ annotationCount, onPress, visible }: GuruFABProps) {
  if (!visible) return null;

  return (
    <TouchableOpacity
      style={styles.fab}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={`Open Guru panel, ${annotationCount} annotations`}
      accessibilityRole="button"
    >
      <Icon name="auto-fix" size={26} color="#FFFFFF" />
      {annotationCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {annotationCount > 9 ? '9+' : annotationCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
    zIndex: 100,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
