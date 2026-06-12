/**
 * Interests Screen - Liquid Glass Design
 *
 * Features:
 * - Additional industry interests selection
 * - 3D glass blob backgrounds
 * - Optional step with skip functionality
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { useOnboarding } from '@/store/user-context';
import { API_BASE_URL } from '@/constants/config';
import { getAuthToken } from '@/utils/auth';
import { readCache, writeCache, configCacheKey } from '@/utils/local-cache';
import { OrganicBackground, GlassButton } from '../../../components/ui';
import Icon from '../../../components/ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
} from '../../../constants/liquidGlass';
import DarkThemeColors from '../../../constants/darkTheme';
import { useTheme } from '../../../contexts/ThemeContext';

interface Industry {
  id: string;
  name: string;
  emoji: string;
  color_primary: string;
  color_secondary: string;
  description: string;
}

// Shared with the Step 1 industry screen — both fetch /config/industries.
const INDUSTRIES_CACHE_KEY = configCacheKey('industries');

export default function InterestsScreen() {
  const { state, setAdditionalInterests, previousStep, nextStep } = useOnboarding();
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isDark, colors } = useTheme();

  const cardBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.80)';
  const cardBorder = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.07)';
  const footerBg = isDark ? 'rgba(15, 20, 35, 0.85)' : 'rgba(248, 250, 252, 0.92)';
  const footerBorder = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';

  // Stale-while-revalidate: the industry config rarely changes and is usually
  // already cached by the Step 1 (industry) screen — render instantly from
  // cache and refresh silently in the background.
  useEffect(() => {
    const cached = readCache<Industry[]>(INDUSTRIES_CACHE_KEY);
    if (cached) {
      setIndustries(cached.data);
      setLoading(false);
      fetchIndustries(true); // silent background refresh
    } else {
      fetchIndustries();
    }
  }, []);

  const fetchIndustries = async (background = false) => {
    try {
      if (!background) setLoading(true);
      const token = await getAuthToken();
      const response = await fetch(`${API_BASE_URL}/config/industries`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load industries');
      }

      const data = await response.json();
      setIndustries(data);
      writeCache(INDUSTRIES_CACHE_KEY, data);
      setError(null);
    } catch (err) {
      // Never replace cached content already on screen with an error state.
      if (!background) setError('Failed to load industries. Please try again.');
    } finally {
      if (!background) setLoading(false);
    }
  };

  const availableInterests = industries.filter((industry) => industry.id !== state.coreIndustry);

  const handleInterestToggle = (interestId: string) => {
    const currentInterests = [...state.additionalInterests];
    const index = currentInterests.indexOf(interestId);

    if (index > -1) {
      currentInterests.splice(index, 1);
    } else {
      if (currentInterests.length < 2
          && !currentInterests.includes(interestId)) {
        currentInterests.push(interestId);
      }
    }

    setAdditionalInterests(currentInterests);
  };

  const handleContinue = () => {
    nextStep();
    router.push('/(auth)/onboarding/capacity');
  };

  const handleBack = () => {
    previousStep();
    router.back();
  };

  const getCoreIndustryName = () => {
    const coreIndustry = industries.find((i) => i.id === state.coreIndustry);
    return coreIndustry?.name || state.coreIndustry || 'your industry';
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <OrganicBackground variant="onboarding" />

      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '60%', backgroundColor: '#EC4899' }]} />
          </View>
          <Text style={styles.progressText}>Step 3 of 5</Text>
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>Any additional interests?</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Beyond {getCoreIndustryName()}, select up to 2 other industries you'd like to explore.
        </Text>
        <View style={styles.badgeContainer}>
          <View style={styles.selectionBadge}>
            <Text style={styles.selectionCount}>{state.additionalInterests.length}/2 selected</Text>
          </View>
          <View style={styles.optionalBadge}>
            <Text style={styles.optionalText}>Optional</Text>
          </View>
        </View>
      </View>

      {loading ? (
        // First load with nothing cached: row skeletons matching the option
        // card layout instead of a centered spinner (theme-aware).
        <View style={[styles.content, styles.scrollContent]} accessibilityLabel="Loading industries">
          <View style={styles.optionsContainer}>
            {Array.from({ length: 5 }).map((_, i) => {
              const placeholderBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
              return (
                <View key={i} style={[styles.optionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                  <View style={styles.optionContent}>
                    <View style={styles.optionLeft}>
                      <View style={[styles.emojiContainer, { backgroundColor: placeholderBg }]} />
                      <View style={styles.optionInfo}>
                        <View style={{ width: 140, height: 15, borderRadius: 4, backgroundColor: placeholderBg, marginBottom: 8 }} />
                        <View style={{ width: 200, height: 12, borderRadius: 4, backgroundColor: placeholderBg }} />
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Icon name="alert-outline" size={48} color="#F59E0B" style={styles.errorIcon} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          <GlassButton title="Try Again" onPress={() => fetchIndustries()} variant="primary" size="md" fullWidth={false} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.optionsContainer}>
            {availableInterests.map((interest) => {
              const isSelected = state.additionalInterests.includes(interest.id);
              const canSelect = isSelected || state.additionalInterests.length < 2;

              return (
                <TouchableOpacity
                  key={interest.id}
                  style={[
                    styles.optionCard,
                    { backgroundColor: cardBg, borderColor: cardBorder },
                    isSelected && styles.optionCardSelected,
                    !canSelect && styles.optionCardDisabled,
                  ]}
                  onPress={() => handleInterestToggle(interest.id)}
                  disabled={!canSelect || saving}
                  activeOpacity={0.7}
                >
                  <View style={styles.optionContent}>
                    <View style={styles.optionLeft}>
                      <View
                        style={[
                          styles.emojiContainer,
                          isSelected && { backgroundColor: `${interest.color_primary}20` },
                        ]}
                      >
                        <Text style={styles.optionEmoji}>{interest.emoji}</Text>
                      </View>
                      <View style={styles.optionInfo}>
                        <Text
                          style={[
                            styles.optionText,
                            { color: colors.textPrimary },
                            isSelected && styles.optionTextSelected,
                            !canSelect && styles.optionTextDisabled,
                          ]}
                        >
                          {interest.name}
                        </Text>
                        <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>{interest.description}</Text>
                      </View>
                    </View>
                    {isSelected && (
                      <View style={styles.checkmark}>
                        <Text style={styles.checkmarkText}>✓</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {state.additionalInterests.length === 0 && (
            <View style={styles.tipCard}>
              <Icon name="lightbulb-outline" size={20} color="#0E7490" style={styles.tipIcon} />
              <Text style={styles.tipText}>
                Adding interests helps us surface cross-industry insights and trends that matter to you.
              </Text>
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* Footer */}
      <View style={[styles.footerContainer, { backgroundColor: footerBg, borderTopColor: footerBorder }]}>
        <View style={styles.footerButtons}>
          <GlassButton
            title="Back"
            onPress={handleBack}
            variant="secondary"
            size="md"
            fullWidth={false}
            disabled={saving}
            style={styles.backButton}
          />
          <GlassButton
            title={state.additionalInterests.length === 0 ? 'Skip' : 'Continue'}
            onPress={handleContinue}
            variant="primary"
            size="md"
            accentColor="#EC4899"
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
    color: '#EC4899',
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
  badgeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  selectionBadge: {
    backgroundColor: 'rgba(236, 72, 153, 0.1)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.pill,
  },
  selectionCount: {
    ...Typography.labelMedium,
    color: '#EC4899',
  },
  optionalBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  optionalText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textTertiary,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: 100,
  },
  optionsContainer: {
    gap: Spacing.md,
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
    backgroundColor: 'rgba(236, 72, 153, 0.18)',
    borderColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  optionCardDisabled: {
    backgroundColor: 'rgba(248, 250, 252, 0.5)',
    opacity: 0.5,
  },
  optionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  emojiContainer: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionEmoji: {
    fontSize: 26,
  },
  optionInfo: {
    flex: 1,
  },
  optionText: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
  },
  optionTextSelected: {
    color: '#EC4899',
  },
  optionTextDisabled: {
    color: DarkThemeColors.textTertiary,
  },
  optionDescription: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
  },
  checkmark: {
    width: 32,
    height: 32,
    backgroundColor: '#EC4899',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#EC4899',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  loadingText: {
    marginTop: Spacing.md,
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  errorIcon: {
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 145, 178, 0.1)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(8, 145, 178, 0.2)',
  },
  tipIcon: {
    marginRight: Spacing.md,
  },
  tipText: {
    flex: 1,
    ...Typography.bodySmall,
    color: '#0E7490',
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
    minWidth: 140,
  },
});
