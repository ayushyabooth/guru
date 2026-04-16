import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Spacing, Typography, BorderRadius, RingColors, DarkGlassMaterials, getBackdropBlur } from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import Icon from '../ui/Icon';
import GlassButton from '../ui/GlassButton';

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

          <GlassButton
            title={tier === 'full' ? 'Save & Unlock Audio' : 'Save & Complete'}
            onPress={() => canSave && onSave(text.trim())}
            accentColor="#FB923C"
            disabled={!canSave}
            size="lg"
          />
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
    ...DarkGlassMaterials.cardHeavy,
    padding: Spacing.xl,
    borderWidth: 2,
    borderColor: 'rgba(251, 146, 60, 0.35)',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
    ...getBackdropBlur(28),
    ...Platform.select({
      web: { backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)' } as any,
      default: {},
    }),
  },
  heading: {
    ...Typography.headlineMedium,
    color: DarkThemeColors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 28,
  },
  input: {
    ...DarkGlassMaterials.input,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    minHeight: 100,
    ...Typography.bodyMedium,
    color: 'rgba(255, 255, 255, 0.9)',
    borderColor: 'rgba(251, 146, 60, 0.3)',
    marginBottom: Spacing.lg,
    ...getBackdropBlur(12),
  },
});
