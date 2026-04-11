/**
 * Goals Screen - Combined daily goals selection with liquid glass sliders
 *
 * Consolidates the previous two goal screens (catchup + divein-recap) into one
 * with a modern slider UI and liquid glass aesthetic.
 *
 * Features:
 * - Single screen for all time investment goals
 * - Custom slider UI with liquid glass design
 * - Daily goals for both Catch-up and Dive-in
 * - Encouragement messaging for higher engagement
 * - Beautiful summary before completion
 * - 3D glass blob backgrounds
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  PanResponder,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useOnboarding } from '@/store/user-context';
import { getAuthToken } from '@/utils/auth';
import { API_BASE_URL } from '@/constants/config';
import { OrganicBackground, GlassButton } from '../../../components/ui';
import Icon from '../../../components/ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
} from '../../../constants/liquidGlass';
import DarkThemeColors from '../../../constants/darkTheme';

const { width } = Dimensions.get('window');

// Custom Slider Component with liquid glass design
interface LiquidSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  gradientStart: string;
  onChange: (value: number) => void;
}

function LiquidSlider({
  value,
  min,
  max,
  step,
  color,
  gradientStart,
  onChange,
}: LiquidSliderProps) {
  const sliderWidth = width - 80;
  const percentage = (value - min) / (max - min);
  const thumbPosition = percentage * sliderWidth;

  const handleTap = (event: any) => {
    const locationX = event.nativeEvent.locationX;
    const pct = Math.max(0, Math.min(1, locationX / sliderWidth));
    const rawValue = min + pct * (max - min);
    const steppedValue = Math.round(rawValue / step) * step;
    onChange(Math.max(min, Math.min(max, steppedValue)));
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: handleTap,
    onPanResponderMove: handleTap,
  });

  return (
    <View style={styles.sliderContainer} {...panResponder.panHandlers}>
      {/* Track with glass effect */}
      <View style={styles.sliderTrackOuter}>
        <View style={styles.sliderTrack}>
          {/* Filled portion */}
          <View
            style={[
              styles.sliderFilled,
              {
                width: `${percentage * 100}%`,
                backgroundColor: color,
              },
            ]}
          />
        </View>
      </View>

      {/* Thumb */}
      <View
        style={[
          styles.sliderThumb,
          {
            left: Math.max(0, thumbPosition - 20),
            backgroundColor: color,
            shadowColor: color,
          },
        ]}
      >
        <Text style={styles.thumbValue}>{value}</Text>
        <Text style={styles.thumbUnit}>min</Text>
      </View>

      {/* Scale markers */}
      <View style={styles.scaleContainer}>
        <Text style={styles.scaleText}>{min}m</Text>
        <Text style={styles.scaleText}>{Math.round((min + max) / 2)}m</Text>
        <Text style={styles.scaleText}>{max}m</Text>
      </View>
    </View>
  );
}

export default function GoalsScreen() {
  const {
    state,
    setCatchupGoals,
    setWeeklyGoals,
    previousStep,
    completeOnboarding,
    getProfileData,
  } = useOnboarding();

  // Map capacity to suggested defaults
  const CAPACITY_DEFAULTS: Record<string, { catchup: number; divein: number }> = {
    Light: { catchup: 10, divein: 15 },
    Medium: { catchup: 20, divein: 30 },
    Heavy: { catchup: 30, divein: 45 },
  };

  // Use defaults from capacity selection, or fallback to Medium
  const capacityDefaults = state.weeklyCapacity
    ? CAPACITY_DEFAULTS[state.weeklyCapacity]
    : CAPACITY_DEFAULTS.Medium;

  // Daily goals in minutes - use state if set, otherwise use capacity defaults
  const [catchupDaily, setCatchupDaily] = useState(
    state.catchupDailyGoal || capacityDefaults.catchup
  );
  const [diveinDaily, setDiveinDaily] = useState(
    state.diveinWeeklyGoal ? Math.round(state.diveinWeeklyGoal / 7) : capacityDefaults.divein
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Calculate weekly equivalents
  const catchupWeekly = catchupDaily * 7;
  const diveinWeekly = diveinDaily * 7;
  const recapWeekly = 60; // Default recap goal

  const handleCatchupChange = (value: number) => {
    setCatchupDaily(value);
    setCatchupGoals(value, Math.max(value + 15, 45)); // Auto-set daily max
  };

  const handleDiveinChange = (value: number) => {
    setDiveinDaily(value);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Update state with final values
      setCatchupGoals(catchupDaily, Math.max(catchupDaily + 15, 45));
      setWeeklyGoals(diveinWeekly, recapWeekly);

      // Get token using the centralized auth utility (handles web/native correctly)
      const token = await getAuthToken();

      if (!token) {
        console.error('[Goals] No auth token found');
        setSubmitError('Authentication token not found. Please log in again.');
        router.replace('/(auth)/login');
        return;
      }

      // Prepare profile data
      const profileData = {
        ...getProfileData(),
        catchup_daily_goal_minutes: catchupDaily,
        catchup_daily_max_minutes: Math.max(catchupDaily + 15, 45),
        divein_weekly_goal_minutes: diveinWeekly,
        recap_weekly_goal_minutes: recapWeekly,
      };

      const response = await fetch(
        `${API_BASE_URL}/me`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(profileData),
        }
      );

      if (response.ok) {
        completeOnboarding();
        router.replace('/(tabs)');
      } else {
        const errorData = await response.json().catch(() => ({}));
        let message: string;
        if (Array.isArray(errorData.detail)) {
          // Pydantic validation errors come as an array of {msg, loc, ...}
          message = errorData.detail.map((e: any) => e.msg || String(e)).join('; ');
        } else if (typeof errorData.detail === 'string') {
          message = errorData.detail;
        } else {
          message = `Failed to save your profile (HTTP ${response.status}).`;
        }
        console.error('[Goals] Submit failed:', message, errorData);
        setSubmitError(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save your profile. Please check your connection.';
      console.error('[Goals] Submit error:', error);
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    previousStep();
    router.back();
  };

  // Encouragement messages
  const getTotalEncouragement = () => {
    const total = catchupDaily + diveinDaily;
    if (total >= 60) return { icon: 'rocket-launch-outline', text: "Power user! You'll gain expert-level insights." };
    if (total >= 45) return { icon: 'star-shooting', text: 'Great commitment to staying informed!' };
    if (total >= 30) return { icon: 'auto-awesome', iconLibrary: 'mi' as const, text: 'Solid foundation for industry awareness.' };
    return { icon: 'lightbulb-outline', text: 'A great start to your learning journey.' };
  };

  const encouragement = getTotalEncouragement();

  return (
    <SafeAreaView style={styles.container}>
      {/* 3D Glass Blob Background */}
      <OrganicBackground variant="onboarding" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header with glass effect */}
        <View style={styles.headerGlass}>
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '100%' }]} />
            </View>
            <Text style={styles.progressText}>Final Step</Text>
          </View>

          <Text style={styles.title}>Set your daily investment</Text>
          <Text style={styles.subtitle}>
            Customize your reading goals based on your{' '}
            <Text style={styles.capacityHighlight}>{state.weeklyCapacity || 'Medium'}</Text> schedule.
          </Text>
        </View>

        {/* Catch-up Goal Card */}
        <View style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <View style={[styles.goalIndicator, { backgroundColor: '#38BDF8' }]} />
            <View style={styles.goalInfo}>
              <Text style={styles.goalTitle}>Daily Catch-up</Text>
              <Text style={styles.goalDescription}>Quick insights to stay informed</Text>
            </View>
            <View style={styles.goalValueBox}>
              <Text style={[styles.goalValue, { color: '#38BDF8' }]}>{catchupDaily}</Text>
              <Text style={styles.goalUnit}>min/day</Text>
            </View>
          </View>

          <LiquidSlider
            value={catchupDaily}
            min={10}
            max={45}
            step={5}
            color="#38BDF8"
            gradientStart="#0EA5E9"
            onChange={handleCatchupChange}
          />

          {/* Quick select buttons */}
          <View style={styles.quickSelect}>
            {[10, 15, 20, 30, 45].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.quickButton,
                  catchupDaily === val && { backgroundColor: 'rgba(56, 189, 248, 0.15)' },
                ]}
                onPress={() => handleCatchupChange(val)}
              >
                <Text
                  style={[
                    styles.quickButtonText,
                    catchupDaily === val && { color: '#38BDF8', fontWeight: '700' },
                  ]}
                >
                  {val}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Dive-in Goal Card */}
        <View style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <View style={[styles.goalIndicator, { backgroundColor: '#EC4899' }]} />
            <View style={styles.goalInfo}>
              <Text style={styles.goalTitle}>Weekly Dive-in</Text>
              <Text style={styles.goalDescription}>Deep reading for real expertise</Text>
            </View>
            <View style={styles.goalValueBox}>
              <Text style={[styles.goalValue, { color: '#EC4899' }]}>{diveinDaily}</Text>
              <Text style={styles.goalUnit}>min/week</Text>
            </View>
          </View>

          <LiquidSlider
            value={diveinDaily}
            min={15}
            max={60}
            step={5}
            color="#EC4899"
            gradientStart="#22D3EE"
            onChange={handleDiveinChange}
          />

          {/* Quick select buttons */}
          <View style={styles.quickSelect}>
            {[15, 20, 30, 45, 60].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.quickButton,
                  diveinDaily === val && { backgroundColor: 'rgba(8, 145, 178, 0.15)' },
                ]}
                onPress={() => handleDiveinChange(val)}
              >
                <Text
                  style={[
                    styles.quickButtonText,
                    diveinDaily === val && { color: '#EC4899', fontWeight: '700' },
                  ]}
                >
                  {val}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Encouragement for dive-in */}
          {diveinDaily >= 30 && (
            <View style={styles.encouragementBadge}>
              <View style={styles.encouragementRow}>
                <Icon name="arm-flex-outline" size={16} color="#EC4899" />
                <Text style={styles.encouragementText}> More dive-in = deeper expertise</Text>
              </View>
            </View>
          )}
        </View>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <Icon name={encouragement.icon} size={36} color="#38BDF8" library={'iconLibrary' in encouragement ? encouragement.iconLibrary : 'mci'} style={styles.summaryEmoji} />
          <Text style={styles.summaryTotal}>{catchupDaily + diveinDaily} min/day</Text>
          <Text style={styles.summaryBreakdown}>
            {catchupDaily}m catch-up + {diveinDaily}m dive-in
          </Text>
          <Text style={styles.summaryMessage}>{encouragement.text}</Text>

          {/* Weekly equivalent */}
          <View style={styles.weeklyPreview}>
            <Text style={styles.weeklyLabel}>That's about</Text>
            <Text style={styles.weeklyValue}>
              {Math.round((catchupDaily + diveinDaily) * 7 / 60)}h/week
            </Text>
          </View>
        </View>

        {/* Setup summary */}
        <View style={styles.setupSummary}>
          <Text style={styles.setupTitle}>Your Guru Setup</Text>
          <View style={styles.setupRow}>
            <Text style={styles.setupLabel}>Industry</Text>
            <Text style={styles.setupValue}>{state.coreIndustry}</Text>
          </View>
          <View style={styles.setupRow}>
            <Text style={styles.setupLabel}>Focus</Text>
            <Text style={styles.setupValue}>{state.specializations.join(', ')}</Text>
          </View>
          {state.additionalInterests.length > 0 && (
            <View style={styles.setupRow}>
              <Text style={styles.setupLabel}>Also interested in</Text>
              <Text style={styles.setupValue}>{state.additionalInterests.join(', ')}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Error banner */}
      {submitError && (
        <View style={styles.errorBanner}>
          <Icon name="alert-circle-outline" size={18} color="#EF4444" />
          <Text style={styles.errorBannerText}>{submitError}</Text>
        </View>
      )}

      {/* Floating Footer with glass effect */}
      <View style={styles.footerContainer}>
        <View style={styles.footerButtons}>
          <GlassButton
            title="Back"
            onPress={handleBack}
            variant="secondary"
            size="md"
            fullWidth={false}
            disabled={isSubmitting}
            style={styles.backButton}
          />
          <GlassButton
            title={isSubmitting ? "Saving..." : "Get Started"}
            onPress={handleSubmit}
            disabled={isSubmitting}
            loading={isSubmitting}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: 120,
  },
  headerGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
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
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
  },
  capacityHighlight: {
    color: '#38BDF8',
    fontWeight: '600',
  },
  goalCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  goalIndicator: {
    width: 4,
    height: 50,
    borderRadius: 2,
    marginRight: Spacing.md,
  },
  goalInfo: {
    flex: 1,
  },
  goalTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
  },
  goalDescription: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
  },
  goalValueBox: {
    alignItems: 'flex-end',
  },
  goalValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  goalUnit: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textTertiary,
    marginTop: -2,
  },
  sliderContainer: {
    height: 80,
    marginBottom: 12,
  },
  sliderTrackOuter: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    padding: 2,
  },
  sliderTrack: {
    height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  sliderFilled: {
    height: '100%',
    borderRadius: 5,
  },
  sliderThumb: {
    position: 'absolute',
    top: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  thumbValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  thumbUnit: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 8,
    marginTop: -2,
  },
  scaleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  scaleText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  quickSelect: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  quickButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
  },
  quickButtonText: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textSecondary,
  },
  encouragementBadge: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
    backgroundColor: 'rgba(8, 145, 178, 0.08)',
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  encouragementRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  encouragementText: {
    ...Typography.labelMedium,
    color: '#EC4899',
  },
  summaryCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  summaryEmoji: {
    marginBottom: Spacing.sm,
  },
  summaryTotal: {
    ...Typography.displayMedium,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
  },
  summaryBreakdown: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    marginBottom: Spacing.sm,
  },
  summaryMessage: {
    ...Typography.labelLarge,
    color: '#38BDF8',
    textAlign: 'center',
  },
  weeklyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    gap: Spacing.sm,
  },
  weeklyLabel: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textTertiary,
  },
  weeklyValue: {
    ...Typography.labelLarge,
    color: DarkThemeColors.textPrimary,
  },
  setupSummary: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  setupTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.md,
  },
  setupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  setupLabel: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
  },
  setupValue: {
    ...Typography.bodyMedium,
    fontWeight: '500',
    color: DarkThemeColors.textPrimary,
    flex: 1,
    textAlign: 'right',
    marginLeft: Spacing.md,
  },
  errorBanner: {
    position: 'absolute',
    bottom: 90,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    zIndex: 10,
  },
  errorBannerText: {
    ...Typography.bodySmall,
    color: '#FCA5A5',
    flex: 1,
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
