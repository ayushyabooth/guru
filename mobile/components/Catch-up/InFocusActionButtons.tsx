import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import Icon from '../ui/Icon';

interface InFocusActionButtonsProps {
  articleId: string;
  isSaved: boolean;
  onStartReading: (articleId: string) => void;
  onSave: (articleId: string) => void;
  onNotRelevant: (storyboardId: string) => void;
  storyboardId: string;
  isDark?: boolean;
}

export const InFocusActionButtons: React.FC<InFocusActionButtonsProps> = ({
  articleId,
  isSaved,
  onStartReading,
  onSave,
  onNotRelevant,
  storyboardId,
  isDark = false
}) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.primaryButton, styles.startReadingButton]}
        onPress={() => onStartReading(articleId)}
        activeOpacity={0.8}
      >
        <Icon name="book-open-variant" size={18} color="#FFFFFF" />
        <Text style={styles.primaryButtonText}>Dive In</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.secondaryButton,
          isSaved && styles.savedButton,
          isDark && styles.secondaryButtonDark
        ]}
        onPress={() => onSave(articleId)}
        activeOpacity={0.8}
        disabled={isSaved}
      >
        <Icon name={isSaved ? 'bookmark-check' : 'bookmark-outline'} size={18} color={isSaved ? '#38BDF8' : '#6B7280'} />
        <Text style={[styles.secondaryButtonText, isDark && styles.secondaryButtonTextDark]}>
          {isSaved ? 'Saved' : 'Save'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tertiaryButton, isDark && styles.tertiaryButtonDark]}
        onPress={() => {
          Alert.alert(
            'Hide this story?',
            'This story will be removed from this feed. You can still find related articles in other filters.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Yes, Hide', style: 'destructive', onPress: () => onNotRelevant(storyboardId) },
            ]
          );
        }}
        activeOpacity={0.8}
      >
        <Icon name="close" size={18} color="#6B7280" />
        <Text style={[styles.tertiaryButtonText, isDark && styles.tertiaryButtonTextDark]}>
          Not Relevant
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  startReadingButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.30)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.35)',
    ...Platform.select({
      ios: {
        shadowColor: '#38BDF8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      web: {
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        boxShadow: '0 2px 8px rgba(56,189,248,0.20), inset 0 1px 0 rgba(255,255,255,0.10)',
      },
    }),
  },
  primaryButtonEmoji: {
    fontSize: 16,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 6,
  },
  secondaryButtonDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  savedButton: {
    backgroundColor: 'rgba(56,189,248,0.15)',
  },
  secondaryButtonEmoji: {
    fontSize: 14,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94A3B8',
  },
  secondaryButtonTextDark: {
    color: '#E5E7EB',
  },
  tertiaryButton: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 6,
  },
  tertiaryButtonDark: {
    borderColor: 'rgba(255,255,255,0.15)',
  },
  tertiaryButtonEmoji: {
    fontSize: 14,
  },
  tertiaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  tertiaryButtonTextDark: {
    color: '#9CA3AF',
  },
});
