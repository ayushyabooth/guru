import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { CatchupFeed } from '../../components/Catch-up/CatchupFeed';
import { FilterTabBar } from '../../components/Catch-up/FilterTabBar';
import { useScreenTimeTracking, useTimeTrackingContext } from '../../contexts/TimeTrackingContext';
import { userService, UserProfile } from '../../services/user-service';
import { OrganicBackground } from '../../components/ui';
import {
  Spacing,
  Typography,
  RingColors,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

export default function CatchupScreen() {
  const [selectedContext, setSelectedContext] = useState('core');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { isDark, colors } = useTheme();

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

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="catchup" />
        <View style={[styles.container, styles.centerContent]}>
          <Text style={[styles.errorText, { color: colors.error }]}>Failed to load profile</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <OrganicBackground variant="catchup" filterContext="consumer" />

      <View style={styles.filterWrapper}>
        <FilterTabBar
          selectedContext={selectedContext}
          onContextChange={setSelectedContext}
          tabs={tabs}
          accentColor={RingColors.catchup.primary}
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
  loadingText: {
    marginTop: Spacing.md,
    ...Typography.bodyMedium,
  },
  errorText: {
    ...Typography.bodyMedium,
  },
  filterWrapper: {
    paddingTop: Spacing.md,
  },
});
