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
  Dimensions,
  Platform,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Circle, Rect, G } from 'react-native-svg';
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

const { width: screenWidth } = Dimensions.get('window');
// Constrain to max 480px (matches the webShell max-width) for proper grid sizing
const width = Math.min(screenWidth, 480);
const GAP = 12;
const PADDING = 24;
const COLUMNS = 3;
const CARD_SIZE = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

interface Industry {
  id: string;
  name: string;
  emoji: string;
  color_primary: string;
  color_secondary: string;
  description: string;
}

const INDUSTRIES_CACHE_KEY = configCacheKey('industries');

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
      case 'manufacturing':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="mfgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#A5B4FC" />
                <Stop offset="100%" stopColor="#6366F1" />
              </LinearGradient>
            </Defs>
            <Path d="M8 40V20L18 26V20L28 26V20L38 26V40H8Z" stroke="url(#mfgGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            <Path d="M14 40V34H20V40M28 40V34H34V40" stroke="url(#mfgGrad)" strokeWidth="2" fill="none" />
          </Svg>
        );
      case 'real estate':
      case 'real_estate':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="reGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#FCD34D" />
                <Stop offset="100%" stopColor="#F59E0B" />
              </LinearGradient>
            </Defs>
            <Path d="M12 40V12L28 6V40" stroke="url(#reGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            <Path d="M28 40V18H38V40" stroke="url(#reGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            <Path d="M17 16H22M17 22H22M17 28H22M33 24H34M33 30H34" stroke="url(#reGrad)" strokeWidth="2" strokeLinecap="round" />
          </Svg>
        );
      case 'education':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="eduGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#67E8F9" />
                <Stop offset="100%" stopColor="#06B6D4" />
              </LinearGradient>
            </Defs>
            <Path d="M24 12L6 20L24 28L42 20L24 12Z" stroke="url(#eduGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            <Path d="M14 24V32C14 32 18 36 24 36C30 36 34 32 34 32V24" stroke="url(#eduGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            <Path d="M42 20V28" stroke="url(#eduGrad)" strokeWidth="2" strokeLinecap="round" />
          </Svg>
        );
      case 'government':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="govGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#7DD3FC" />
                <Stop offset="100%" stopColor="#0EA5E9" />
              </LinearGradient>
            </Defs>
            <Path d="M24 8L40 18H8L24 8Z" stroke="url(#govGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
            <Path d="M12 18V36M20 18V36M28 18V36M36 18V36" stroke="url(#govGrad)" strokeWidth="2.5" strokeLinecap="round" />
            <Path d="M8 40H40" stroke="url(#govGrad)" strokeWidth="2.5" strokeLinecap="round" />
          </Svg>
        );
      case 'non-profit':
      case 'non profit':
      case 'nonprofit':
      case 'non_profit':
        return (
          <Svg width={size} height={size} viewBox="0 0 48 48">
            <Defs>
              <LinearGradient id="npGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#6EE7B7" />
                <Stop offset="100%" stopColor="#10B981" />
              </LinearGradient>
            </Defs>
            <Path d="M24 40C24 40 10 31 10 20C10 15 14 11 18.5 11C21 11 23 12.5 24 14.5C25 12.5 27 11 29.5 11C34 11 38 15 38 20C38 31 24 40 24 40Z" stroke="url(#npGrad)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
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
  const { isDark, colors } = useTheme();

  const cardBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.80)';
  const cardBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.07)';
  const footerBg = isDark ? 'rgba(15, 20, 35, 0.85)' : 'rgba(248, 250, 252, 0.92)';
  const footerBorder = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';

  // Config changes rarely but pays the full cold-start penalty (~1.1s) on a
  // new user's very first screen. Stale-while-revalidate: render the cached
  // industry list instantly, refresh silently in the background.
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
      // A failed background refresh must not replace already-rendered
      // cached content with an error screen.
      if (!background) setError('Failed to load industries. Please try again.');
    } finally {
      if (!background) setLoading(false);
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Organic blob backgrounds */}
      <OrganicBackground variant="onboarding" />

      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '20%' }]} />
          </View>
          <Text style={styles.progressText}>Step 1 of 5</Text>
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>Choose Your Industry</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Select the industry that best fits your role
        </Text>
      </View>

      {loading ? (
        // First load with nothing cached: grid skeleton matching the industry
        // card layout instead of a centered spinner (theme-aware).
        <View style={styles.content} accessibilityLabel="Loading industries">
          <View style={[styles.scrollContent]}>
            <View style={styles.gridContainer}>
              {Array.from({ length: 9 }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.gridCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
                >
                  <View style={[
                    styles.iconBackground,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)' },
                  ]} />
                  <View style={{
                    width: '70%',
                    height: 12,
                    borderRadius: 4,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
                  }} />
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Icon name="alert-outline" size={48} color="#F59E0B" style={styles.errorIcon} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchIndustries()}>
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
                    { backgroundColor: cardBg, borderColor: cardBorder },
                    isSelected && styles.gridCardSelected,
                    isSelected && Platform.OS === 'web' ? {
                      boxShadow: `0 0 16px ${industry.color_primary || '#38BDF8'}40`,
                      borderColor: industry.color_primary || '#38BDF8',
                      backgroundColor: `${industry.color_primary || '#38BDF8'}2E`,
                    } as any : {},
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
                    { color: colors.textPrimary },
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
      <View style={[styles.footerContainer, { backgroundColor: footerBg, borderTopColor: footerBorder }]}>
        <GlassButton
          title="Continue"
          onPress={handleContinue}
          disabled={!canProceed()}
          variant="primary"
          size="lg"
          accentColor="#38BDF8"
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
    paddingBottom: 100,
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
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
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
