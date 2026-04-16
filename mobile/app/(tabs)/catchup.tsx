import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Alert, Platform, Animated } from 'react-native';
import { CatchupFeed } from '../../components/Catch-up/CatchupFeed';
import { FilterTabBar } from '../../components/Catch-up/FilterTabBar';
import { useScreenTimeTracking, useTimeTrackingContext } from '../../contexts/TimeTrackingContext';
import { userService, UserProfile } from '../../services/user-service';
import { OrganicBackground } from '../../components/ui';
import {
  Spacing,
  Typography,
  BorderRadius,
  DarkGlassMaterials,
  GlassMaterials,
  RingColors,
  getDarkBackdropBlur,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

const ACCENT_COLOR = '#38BDF8';

export default function CatchupScreen() {
  const [selectedContext, setSelectedContext] = useState('core');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { isDark, colors } = useTheme();

  // Staggered header entrance
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(headerTranslateY, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Use the new time tracking context
  const { recordInteraction, updateContext } = useTimeTrackingContext();

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const profile = await userService.getUserProfile();
      setUserProfile(profile);
    } catch (error) {
      Alert.alert('Error', 'Failed to load your profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Start tracking when profile is loaded (with industry context)
  useScreenTimeTracking('catchup', {
    activityType: 'storyboard',
    industry: userProfile?.core_industry,
    specialization: userProfile?.specializations?.[0],
    autoStart: !!userProfile,
  });

  // Update tracking context when selected context changes
  useEffect(() => {
    if (selectedContext.startsWith('specialization:')) {
      const spec = selectedContext.replace('specialization:', '');
      updateContext({ specialization: spec });
    } else if (selectedContext.startsWith('interest:')) {
      const interest = selectedContext.replace('interest:', '');
      updateContext({ industry: interest });
    }
  }, [selectedContext]);

  // Build tab list from user profile - use _display fields for labels, keep original values for API context
  const tabs = (() => {
    if (!userProfile) return [];
    const rawTabs = [
      { label: userProfile.core_industry_display || userProfile.core_industry, context: 'core' },
      ...userProfile.specializations.map((s: string, i: number) => ({
        label: userProfile.specializations_display?.[i] || s,
        context: `specialization:${s}`,
      })),
      ...userProfile.additional_interest_industries.map((ind: string, i: number) => ({
        label: userProfile.additional_interest_industries_display?.[i] || ind,
        context: `interest:${ind}`,
      })),
    ];
    // Deduplicate by label to prevent duplicate tabs
    const seen = new Set<string>();
    return rawTabs.filter(tab => {
      if (seen.has(tab.label)) return false;
      seen.add(tab.label);
      return true;
    });
  })();

  const handleArticleSave = (articleId: string) => {
    recordInteraction(); // Record user engagement
  };

  const handleNotRelevant = (storyboardId: string) => {
    recordInteraction(); // Record user engagement
  };

  const handleCardInteraction = () => {
    recordInteraction(); // Record any card interaction
  };

  // Format today's date for subtitle
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  // In light mode, let AppBackground show through instead of a solid fill
  const containerBg = isDark ? colors.background : 'transparent';

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        <OrganicBackground variant="catchup" />
        <CatchupFeed
          context="core"
          onArticleSave={() => {}}
          onNotRelevant={() => {}}
        />
      </SafeAreaView>
    );
  }

  if (!userProfile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        <OrganicBackground variant="catchup" />
        <View style={[styles.container, styles.centerContent]}>
          <Text style={[styles.errorText, { color: colors.error }]}>Failed to load profile</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
      <OrganicBackground variant="catchup" filterContext="consumer" />

      {/* Glass header */}
      <Animated.View
        style={[
          styles.headerContainer,
          Platform.OS === 'web' && (isDark ? styles.headerGlassWebDark : styles.headerGlassWebLight),
          { opacity: headerOpacity, transform: [{ translateY: headerTranslateY }] },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Catch-up</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{todayLabel}</Text>
      </Animated.View>

      <View style={styles.filterWrapper}>
        <FilterTabBar
          selectedContext={selectedContext}
          onContextChange={setSelectedContext}
          tabs={tabs}
          accentColor={ACCENT_COLOR}
        />
      </View>

      <CatchupFeed
        context={selectedContext}
        onArticleSave={handleArticleSave}
        onNotRelevant={handleNotRelevant}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerGlassWebDark: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    ...DarkGlassMaterials.card,
    ...getDarkBackdropBlur(20),
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  } as any,
  headerGlassWebLight: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    ...GlassMaterials.card,
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  } as any,
  headerTitle: {
    ...Typography.displaySmall,
    fontWeight: '700',
  },
  headerSubtitle: {
    ...Typography.bodyMedium,
    marginTop: 2,
  },
  loadingText: {
    marginTop: Spacing.md,
    ...Typography.bodyMedium,
  },
  errorText: {
    ...Typography.bodyMedium,
  },
  filterWrapper: {
    paddingTop: Spacing.sm,
  },
});
