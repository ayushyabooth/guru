import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Spacing, Typography, BorderRadius, RingColors, getBackdropBlur } from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import Icon from '../ui/Icon';

interface CommitmentScreenProps {
  onSave: (commitmentText: string) => void;
  tier: string;
}

export default function CommitmentScreen({ onSave, tier }: CommitmentScreenProps) {
  const [text, setText] = useState('');
  const canSave = text.trim().length > 5;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Dark overlay */}
      <View style={styles.darkOverlay} />

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.heading}>What's one thing you'll do differently next week?</Text>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="I will..."
            placeholderTextColor="rgba(251, 146, 60, 0.4)"
            multiline
            textAlignVertical="top"
            autoFocus
            maxLength={500}
          />

          <TouchableOpacity
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
            onPress={() => canSave && onSave(text.trim())}
            disabled={!canSave}
          >
            {tier === 'full' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.saveButtonText}>Save & Unlock Audio</Text>
                <Icon name="headphones" size={18} color="#fff" />
              </View>
            ) : (
              <Text style={styles.saveButtonText}>Save & Complete</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  card: {
    backgroundColor: 'rgba(20, 25, 40, 0.92)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 2,
    borderColor: 'rgba(251, 146, 60, 0.35)',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
    ...getBackdropBlur(24),
  },
  heading: {
    ...Typography.headlineMedium,
    color: DarkThemeColors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 28,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    minHeight: 100,
    ...Typography.bodyMedium,
    color: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.3)',
    marginBottom: Spacing.lg,
  },
  saveButton: {
    backgroundColor: RingColors.recap.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    alignItems: 'center',
    shadowColor: RingColors.recap.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: {
    ...Typography.labelLarge,
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
