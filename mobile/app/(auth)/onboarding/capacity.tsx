/**
 * Capacity Screen - Liquid Glass Design
 *
 * Features:
 * - Weekly time commitment selection
 * - Connected to goals screen with auto-suggested defaults
 * - Liquid glass aesthetic with floating CTAs
 * - 3D glass blob backgrounds
 * - Clear explanation of what each option means
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useOnboarding, WEEKLY_CAPACITY_OPTIONS } from '@/store/user-context';
import { OrganicBackground, GlassButton } from '../../../components/ui';
import Icon from '../../../components/ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
} from '../../../constants/liquidGlass';
import DarkThemeColors from '../../../constants/darkTheme';

const { width } = Dimensions.get('window');

// Map capacity to suggested daily goals
const CAPACITY_DEFAULTS = {
  Light: { catchup: 10, divein: 15, weeklyHours: '1-2', articlesPerDay: '2-3' },
  Medium: { catchup: 20, divein: 30, weeklyHours: '3-5', articlesPerDay: '4-6' },
  Heavy: { catchup: 30, divein: 45, weeklyHours: '6+', articlesPerDay: '8+' },
};

export default function CapacityScreen() {
  const { state, setWeeklyCapacity, setCatchupGoals, nextStep, previousStep, canProceed } =
    useOnboarding();

  const handleCapacitySelect = (capacity: string) => {
    setWeeklyCapacity(capacity);

    // Auto-set suggested defaults for the goals screen
    const defaults = CAPACITY_DEFAULTS[capacity as keyof typeof CAPACITY_DEFAULTS];
    if (defaults) {
      setCatchupGoals(defaults.catchup, Math.max(defaults.catchup + 15, 45));
    }
  };

  const handleContinue = () => {
    if (canProceed()) {
      nextStep();
      router.push('/(auth)/onboarding/goals');
    }
  };

  const handleBack = () => {
    previousStep();
    router.back();
  };

  // Get current selection's defaults for preview
  const currentDefaults = state.weeklyCapacity
    ? CAPACITY_DEFAULTS[state.weeklyCapacity as keyof typeof CAPACITY_DEFAULTS]
    : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* 3D Glass Blob Background */}
      <OrganicBackground variant="onboarding" />

      {/* Header */}
      <View style={styles.headerContainer}>
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '80%' }]} />
            </View>
            <Text style={styles.progressText}>Step 4 of 5</Text>
          </View>

          <Text style={styles.title}>How much time can you dedicate weekly?</Text>
          <Text style={styles.subtitle}>
            This helps us personalize your daily reading goals in the next step.
          </Text>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.optionsContainer}>
          {WEEKLY_CAPACITY_OPTIONS.map((option) => {
            const isSelected = state.weeklyCapacity === option.value;
            const defaults = CAPACITY_DEFAULTS[option.value as keyof typeof CAPACITY_DEFAULTS];

            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                onPress={() => handleCapacitySelect(option.value)}
                activeOpacity={0.7}
              >
                <View style={styles.optionContent}>
                  <View style={styles.optionMain}>
                    <View style={styles.optionHeader}>
                      <Text style={[styles.optionTitle, isSelected && styles.optionTitleSelected]}>
                        {option.label}
                      </Text>
                      {isSelected && (
                        <View style={styles.checkmark}>
                          <Text style={styles.checkmarkText}>✓</Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.optionDescription,
                        isSelected && styles.optionDescriptionSelected,
                      ]}
                    >
                      {option.description}
                    </Text>

                    {/* Preview of what this means */}
                    <View style={[styles.previewBadges, isSelected && styles.previewBadgesSelected]}>
                      <View style={[styles.previewBadge, isSelected && styles.previewBadgeSelected]}>
                        <Text style={[styles.previewBadgeText, isSelected && styles.previewBadgeTextSelected]}>
                          ~{defaults.articlesPerDay} articles/day
                        </Text>
                      </View>
                      <View style={[styles.previewBadge, isSelected && styles.previewBadgeSelected]}>
                        <Text style={[styles.previewBadgeText, isSelected && styles.previewBadgeTextSelected]}>
                          {defaults.catchup + defaults.divein} min/day
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Connection to next screen */}
        {currentDefaults && (
          <View style={styles.connectionCard}>
            <View style={styles.connectionIcon}>
              <Icon name="target" size={20} color="#38BDF8" />
            </View>
            <View style={styles.connectionContent}>
              <Text style={styles.connectionTitle}>Your suggested daily investment</Text>
              <Text style={styles.connectionText}>
                Based on your choice, we'll suggest{' '}
                <Text style={styles.connectionHighlight}>{currentDefaults.catchup} min</Text> for
                quick catch-ups and{' '}
                <Text style={styles.connectionHighlight}>{currentDefaults.divein} min</Text> for
                deep dives daily.
              </Text>
              <Text style={styles.connectionSubtext}>
                You can customize these in the next step.
              </Text>
            </View>
          </View>
        )}

        {/* What this means section */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>What each level means:</Text>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: '#10B981' }]} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Light (1-2 hours/week)</Text>
              <Text style={styles.infoText}>
                Stay informed with quick headlines and key insights. Perfect for busy professionals
                who want to stay current without heavy time commitment.
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: '#EC4899' }]} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Medium (3-5 hours/week)</Text>
              <Text style={styles.infoText}>
                Balanced approach with daily catch-ups plus deeper weekly reads. Ideal for building
                solid industry knowledge over time.
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: '#7C3AED' }]} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Heavy (6+ hours/week)</Text>
              <Text style={styles.infoText}>
                Comprehensive coverage with in-depth analysis and expert insights. Best for those
                aiming to become industry thought leaders.
              </Text>
            </View>
          </View>
        </View>

        {/* Spacer for floating footer */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Floating Footer */}
      <View style={styles.footerContainer}>
        <View style={styles.footerButtons}>
          <GlassButton
            title="Back"
            onPress={handleBack}
            variant="secondary"
            size="md"
            fullWidth={false}
            style={styles.backButton}
          />
          <GlassButton
            title="Set Daily Goals →"
            onPress={handleContinue}
            disabled={!canProceed()}
            variant="primary"
            size="md"
            fullWidth={false}
            style={styles.continueButton}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DarkThemeColors.background,
  },
  headerContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  progressContainer: {
    marginBottom: Spacing.lg,
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderRadius: 3,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: 3,
  },
  progressText: {
    ...Typography.labelMedium,
    color: '#38BDF8',
    textAlign: 'center',
  },
  title: {
    ...Typography.displaySmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  optionsContainer: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  optionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  optionCardSelected: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: '#38BDF8',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.15,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  optionMain: {
    flex: 1,
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  optionTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
  },
  optionTitleSelected: {
    color: '#38BDF8',
  },
  optionDescription: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    marginBottom: Spacing.md,
  },
  optionDescriptionSelected: {
    color: '#0F766E',
  },
  previewBadges: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  previewBadgesSelected: {},
  previewBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  previewBadgeSelected: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  previewBadgeText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
  },
  previewBadgeTextSelected: {
    color: '#38BDF8',
  },
  checkmark: {
    width: 32,
    height: 32,
    backgroundColor: '#38BDF8',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  connectionCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
  },
  connectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  connectionContent: {
    flex: 1,
  },
  connectionTitle: {
    ...Typography.labelLarge,
    color: '#0F766E',
    marginBottom: Spacing.xs,
  },
  connectionText: {
    ...Typography.bodySmall,
    color: '#0F766E',
  },
  connectionHighlight: {
    fontWeight: '700',
    color: '#38BDF8',
  },
  connectionSubtext: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
  infoSection: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  infoTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  infoDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    marginRight: Spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    ...Typography.labelLarge,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
  },
  infoText: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
  },
  footerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    paddingTop: Spacing.md,
    backgroundColor: 'rgba(15, 20, 35, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  footerButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  backButton: {
    minWidth: 100,
  },
  continueButton: {
    minWidth: 160,
  },
});
