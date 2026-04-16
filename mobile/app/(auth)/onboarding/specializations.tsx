/**
 * Specializations Screen - Liquid Glass Design
 *
 * Features:
 * - Select up to 2 specializations
 * - 3D glass blob backgrounds
 * - Glass cards with selection states
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useOnboarding } from '@/store/user-context';
import { API_BASE_URL } from '@/constants/config';
import { getAuthToken } from '@/utils/auth';
import { OrganicBackground, GlassButton } from '../../../components/ui';
import Icon from '../../../components/ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
} from '../../../constants/liquidGlass';
import DarkThemeColors from '../../../constants/darkTheme';

interface Specialization {
  id: string;
  name: string;
  description: string;
}

const MAX_SPECIALIZATIONS = 2;

export default function SpecializationsScreen() {
  const { state, setSpecializations, nextStep, previousStep } = useOnboarding();
  const [specializations, setSpecializationsList] = useState<Specialization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.coreIndustry) {
      fetchSpecializations();
    }
  }, [state.coreIndustry]);

  const fetchSpecializations = async () => {
    try {
      setLoading(true);
      const token = await getAuthToken();
      const response = await fetch(
        `${API_BASE_URL}/config/industries/${state.coreIndustry}/specializations`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load specializations');
      }

      const data = await response.json();
      setSpecializationsList(data);
      setError(null);
    } catch (err) {
      setError('Failed to load specializations. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSpecializationToggle = (specializationId: string) => {
    const currentSpecializations = [...state.specializations];
    const index = currentSpecializations.indexOf(specializationId);

    if (index > -1) {
      currentSpecializations.splice(index, 1);
    } else {
      if (currentSpecializations.length < MAX_SPECIALIZATIONS
          && !currentSpecializations.includes(specializationId)) {
        currentSpecializations.push(specializationId);
      }
    }

    setSpecializations(currentSpecializations);
  };

  const canProceed = () => {
    return state.specializations.length >= 1 && state.specializations.length <= MAX_SPECIALIZATIONS;
  };

  const handleContinue = () => {
    if (canProceed()) {
      nextStep();
      router.push('/(auth)/onboarding/interests');
    }
  };

  const handleBack = () => {
    previousStep();
    router.back();
  };

  const getIndustryName = () => {
    const industryMap: Record<string, string> = {
      consumer: 'Consumer',
      technology: 'Technology',
      finance: 'Finance',
    };
    return industryMap[state.coreIndustry || ''] || state.coreIndustry || 'your industry';
  };

  return (
    <SafeAreaView style={styles.container}>
      <OrganicBackground variant="onboarding" />

      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '40%', backgroundColor: '#0D9488' }]} />
          </View>
          <Text style={styles.progressText}>Step 2 of 5</Text>
        </View>

        <Text style={styles.title}>Choose your specializations</Text>
        <Text style={styles.subtitle}>
          Select 1-2 areas within {getIndustryName()} that you focus on most.
        </Text>
        <View style={styles.selectionBadge}>
          <Text style={styles.selectionCount}>
            {state.specializations.length}/{MAX_SPECIALIZATIONS} selected
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#38BDF8" />
          <Text style={styles.loadingText}>Loading specializations...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Icon name="alert-outline" size={48} color="#F59E0B" style={styles.errorIcon} />
          <Text style={styles.errorText}>{error}</Text>
          <GlassButton title="Try Again" onPress={fetchSpecializations} variant="primary" size="md" fullWidth={false} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.optionsContainer}>
            {specializations.map((specialization) => {
              const isSelected = state.specializations.includes(specialization.id);
              const canSelect = isSelected || state.specializations.length < MAX_SPECIALIZATIONS;
              const selectionIndex = state.specializations.indexOf(specialization.id);

              return (
                <TouchableOpacity
                  key={specialization.id}
                  style={[
                    styles.optionCard,
                    isSelected && styles.optionCardSelected,
                    !canSelect && styles.optionCardDisabled,
                  ]}
                  onPress={() => handleSpecializationToggle(specialization.id)}
                  disabled={!canSelect}
                  activeOpacity={0.7}
                >
                  <View style={styles.optionContent}>
                    <View style={styles.optionIcon}>
                      <Icon
                        name="tag-outline"
                        size={22}
                        color={isSelected ? '#0D9488' : (!canSelect ? DarkThemeColors.textTertiary : DarkThemeColors.textSecondary)}
                      />
                    </View>
                    <View style={styles.optionLeft}>
                      <Text
                        style={[
                          styles.optionText,
                          isSelected && styles.optionTextSelected,
                          !canSelect && styles.optionTextDisabled,
                        ]}
                      >
                        {specialization.name}
                      </Text>
                      <Text
                        style={[
                          styles.optionDescription,
                          isSelected && styles.optionDescriptionSelected,
                        ]}
                      >
                        {specialization.description}
                      </Text>
                    </View>
                    {isSelected && (
                      <View style={styles.checkmark}>
                        <Text style={styles.checkmarkText}>{selectionIndex + 1}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {state.specializations.length > 0 && state.specializations.length < 2 && (
            <View style={styles.tipCard}>
              <Icon name="lightbulb-outline" size={20} color="#92400E" style={styles.tipIcon} />
              <Text style={styles.tipText}>
                Selecting more specializations helps us personalize your feed better.
              </Text>
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* Footer */}
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
            title="Continue"
            onPress={handleContinue}
            disabled={!canProceed()}
            variant="primary"
            size="md"
            accentColor="#0D9488"
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
    color: '#0D9488',
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
  selectionBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(13, 148, 136, 0.1)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
  },
  selectionCount: {
    ...Typography.labelMedium,
    color: '#0D9488',
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
    borderRadius: BorderRadius.lg,
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
    backgroundColor: 'rgba(13, 148, 136, 0.18)',
    borderColor: '#0D9488',
    shadowColor: '#0D9488',
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
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(13, 148, 136, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  optionLeft: {
    flex: 1,
    marginRight: Spacing.md,
  },
  optionText: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
  },
  optionTextSelected: {
    color: '#0D9488',
  },
  optionTextDisabled: {
    color: DarkThemeColors.textTertiary,
  },
  optionDescription: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
  },
  optionDescriptionSelected: {
    color: '#0F766E',
  },
  checkmark: {
    width: 32,
    height: 32,
    backgroundColor: '#0D9488',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  checkmarkText: {
    color: '#fff',
    ...Typography.labelMedium,
    fontWeight: '700',
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
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.2)',
  },
  tipIcon: {
    marginRight: Spacing.md,
  },
  tipText: {
    flex: 1,
    ...Typography.bodySmall,
    color: '#92400E',
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
