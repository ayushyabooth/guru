/**
 * Industry Screen - Liquid Glass Design
 *
 * Features:
 * - Industry selection with liquid glass grid cards
 * - Organic blob backgrounds
 * - Gradient icons for each industry
 * - Glossy Continue button
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
  Dimensions,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Circle, Rect, G } from 'react-native-svg';
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

const { width } = Dimensions.get('window');
// Calculate card size based on screen width for responsive grid
// Mobile: 3 columns with smaller cards
const GAP = 12;
const PADDING = 24;
const COLUMNS = width < 500 ? 3 : 3;
const CARD_SIZE = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

interface Industry {
  id: string;
  name: string;
  emoji: string;
  color_primary: string;
  color_secondary: string;
  description: string;
}

// Industry Icons with gradients
const IndustryIcon = ({ type, size = 48 }: { type: string; size?: number }) => {
  const getIcon = () => {
    switch (type.toLowerCase()) {
      case 'consumer':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="consumerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#5DE0E0" />
                <Stop offset="100%" stopColor="#38BDF8" />
              </LinearGradient>
            </Defs>
            <Path
              d="M24 8C22.9 8 22 8.9 22 10V12H14C12.9 12 12 12.9 12 14V36C12 37.1 12.9 38 14 38H34C35.1 38 36 37.1 36 36V14C36 12.9 35.1 12 34 12H26V10C26 8.9 25.1 8 24 8ZM14 14H34V36H14V14Z"
              fill="url(#consumerGrad)"
            />
            <Path
              d="M20 20H28V22H20V20ZM20 26H28V28H20V26Z"
              fill="url(#consumerGrad)"
            />
          </Svg>
        );
      case 'technology':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="techGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#D4A8FF" />
                <Stop offset="100%" stopColor="#7C3AED" />
              </LinearGradient>
            </Defs>
            <Circle cx="24" cy="24" r="6" stroke="url(#techGrad)" strokeWidth="2" fill="none" />
            <Circle cx="24" cy="10" r="4" fill="url(#techGrad)" />
            <Circle cx="24" cy="38" r="4" fill="url(#techGrad)" />
            <Circle cx="10" cy="24" r="4" fill="url(#techGrad)" />
            <Circle cx="38" cy="24" r="4" fill="url(#techGrad)" />
            <Path d="M24 14V18M24 30V34M14 24H18M30 24H34" stroke="url(#techGrad)" strokeWidth="2" />
          </Svg>
        );
      case 'finance':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="financeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor="#60A5FA" />
                <Stop offset="100%" stopColor="#3B82F6" />
              </LinearGradient>
            </Defs>
            <Rect x="10" y="28" width="6" height="12" rx="1" fill="url(#financeGrad)" />
            <Rect x="21" y="20" width="6" height="20" rx="1" fill="url(#financeGrad)" />
            <Rect x="32" y="12" width="6" height="28" rx="1" fill="url(#financeGrad)" />
            <Path d="M8 16L20 12L32 8L40 4" stroke="url(#financeGrad)" strokeWidth="2" strokeLinecap="round" />
            <Path d="M36 4L40 4L40 8" stroke="url(#financeGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        );
      case 'healthcare':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="healthGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#FDA4AF" />
                <Stop offset="100%" stopColor="#EC4899" />
              </LinearGradient>
            </Defs>
            <Path
              d="M24 42C24 42 8 30 8 20C8 14.477 12.477 10 18 10C20.899 10 23.463 11.358 25 13.5C26.537 11.358 29.101 10 32 10C37.523 10 42 14.477 42 20C42 30 24 42 24 42Z"
              stroke="url(#healthGrad)"
              strokeWidth="2.5"
              fill="none"
            />
          </Svg>
        );
      case 'energy':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="energyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#FCD34D" />
                <Stop offset="100%" stopColor="#D97706" />
              </LinearGradient>
            </Defs>
            <Path
              d="M28 6L14 26H22L20 42L34 22H26L28 6Z"
              fill="url(#energyGrad)"
              stroke="url(#energyGrad)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </Svg>
        );
      case 'food & beverage':
      case 'f&b':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="fbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#6EE7B7" />
                <Stop offset="100%" stopColor="#10B981" />
              </LinearGradient>
            </Defs>
            <Path
              d="M32 8V16C32 20.418 28.418 24 24 24C19.582 24 16 20.418 16 16V8"
              stroke="url(#fbGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
            />
            <Path d="M24 24V40" stroke="url(#fbGrad)" strokeWidth="2.5" strokeLinecap="round" />
            <Path d="M18 40H30" stroke="url(#fbGrad)" strokeWidth="2.5" strokeLinecap="round" />
            <Path d="M20 8V14" stroke="url(#fbGrad)" strokeWidth="2" strokeLinecap="round" />
            <Path d="M24 8V14" stroke="url(#fbGrad)" strokeWidth="2" strokeLinecap="round" />
            <Path d="M28 8V14" stroke="url(#fbGrad)" strokeWidth="2" strokeLinecap="round" />
          </Svg>
        );
      default:
        // Default icon for any other industry
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="defaultGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#94A3B8" />
                <Stop offset="100%" stopColor="#64748B" />
              </LinearGradient>
            </Defs>
            <Circle cx="24" cy="24" r="14" stroke="url(#defaultGrad)" strokeWidth="2" fill="none" />
            <Circle cx="24" cy="24" r="6" fill="url(#defaultGrad)" />
          </Svg>
        );
    }
  };

  return <View style={{ width: size, height: size }}>{getIcon()}</View>;
};

export default function IndustryScreen() {
  const { state, setCoreIndustry, nextStep, canProceed } = useOnboarding();
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIndustries();
  }, []);

  const fetchIndustries = async () => {
    try {
      setLoading(true);
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
      setError(null);
    } catch (err) {
      setError('Failed to load industries. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleIndustrySelect = (industryId: string) => {
    setCoreIndustry(industryId);
  };

  const handleContinue = () => {
    if (canProceed()) {
      nextStep();
      router.push('/(auth)/onboarding/specializations');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Organic blob backgrounds */}
      <OrganicBackground variant="onboarding" />

      {/* Header */}
      <View style={styles.headerContainer}>
        <Text style={styles.title}>Choose Your Industry</Text>
        <Text style={styles.subtitle}>
          Select the industry that best fits your role
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#38BDF8" />
          <Text style={styles.loadingText}>Loading industries...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Icon name="alert-outline" size={48} color="#F59E0B" style={styles.errorIcon} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchIndustries}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.gridContainer}>
            {industries.map((industry) => {
              const isSelected = state.coreIndustry === industry.id;

              return (
                <TouchableOpacity
                  key={industry.id}
                  style={[
                    styles.gridCard,
                    isSelected && styles.gridCardSelected,
                  ]}
                  onPress={() => handleIndustrySelect(industry.id)}
                  activeOpacity={0.7}
                >
                  {/* Gradient background circle */}
                  <View style={[
                    styles.iconBackground,
                    { backgroundColor: `${industry.color_primary}20` }
                  ]}>
                    <IndustryIcon type={industry.name} size={48} />
                  </View>
                  <Text style={[
                    styles.cardLabel,
                    isSelected && styles.cardLabelSelected
                  ]}>
                    {industry.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Page indicator */}
          <View style={styles.pageIndicator}>
            <View style={[styles.dot, styles.dotInactive]} />
            <View style={[styles.dot, styles.dotActive]} />
            <View style={[styles.dot, styles.dotInactive]} />
          </View>

          {/* Spacer for button */}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* Fixed Continue Button */}
      <View style={styles.footerContainer}>
        <GlassButton
          title="Continue"
          onPress={handleContinue}
          disabled={!canProceed()}
          variant="primary"
          size="lg"
          fullWidth
        />
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
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
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
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingTop: Spacing.md,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: GAP,
  },
  gridCard: {
    width: CARD_SIZE,
    aspectRatio: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  gridCardSelected: {
    borderColor: '#38BDF8',
    borderWidth: 2,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  iconBackground: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  cardLabel: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textPrimary,
    textAlign: 'center',
  },
  cardLabelSelected: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  pageIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotActive: {
    backgroundColor: '#38BDF8',
  },
  dotInactive: {
    backgroundColor: '#CBD5E1',
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
  retryButton: {
    backgroundColor: '#38BDF8',
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  retryButtonText: {
    color: '#fff',
    ...Typography.labelLarge,
    fontWeight: '600',
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
});
