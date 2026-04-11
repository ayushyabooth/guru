import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMetrics, MetricsData } from '../../store/metric-context';
import { CatchupService } from '../../services/article-service';
import { formatMinutes } from '../../services/metric-service';
import GuruRings from '../../components/ui/GuruRings';
import FeedTabBar from '../../components/Home/FeedTabBar';
import { removeAuthToken } from '../../utils/auth';
import GoalEditor from '../../components/Home/GoalEditor';
const DevMetricsPanel = process.env.NODE_ENV !== 'production' ? require('../../components/DevMetricsPanel').default : null;
import { OrganicBackground, GlassButton } from '../../components/ui';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getBackdropBlur,
  getDarkBackdropBlur,
  DarkGlassMaterials,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');
// Theme-aware color palette
function useHomeColors() {
  const { isDark, colors } = useTheme();
  return {
    background: colors.background,
    cardBg: isDark ? 'rgba(15, 20, 35, 0.55)' : 'rgba(255, 255, 255, 0.7)',
    cardBgGlass: isDark ? 'rgba(15, 20, 35, 0.55)' : 'rgba(255, 255, 255, 0.6)',
    accent: RingColors.catchup.primary,
    accentPurple: RingColors.divein.primary,
    accentGold: RingColors.recap.primary,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    border: isDark ? 'rgba(56, 189, 248, 0.25)' : 'rgba(56, 189, 248, 0.15)',
    borderPurple: isDark ? 'rgba(236, 72, 153, 0.25)' : 'rgba(236, 72, 153, 0.15)',
    borderGold: isDark ? 'rgba(251, 146, 60, 0.25)' : 'rgba(251, 146, 60, 0.15)',
    error: colors.error,
    errorBg: 'rgba(239, 68, 68, 0.1)',
    glassBorder: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.8)',
    progressBarBg: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.08)',
    isDark,
  };
}

// ─── Debug Panel Component ──────────────────────────────────────────
// Only visible in development mode (__DEV__)

interface SliderBarProps {
  value: number;
  onValueChange: (val: number) => void;
  color: string;
  label: string;
  displayValue: string;
}

function SliderBar({ value, onValueChange, color, label, displayValue }: SliderBarProps) {
  const handlePress = useCallback((event: any) => {
    const { locationX } = event.nativeEvent;
    const barWidth = 200;
    const newValue = Math.max(0, Math.min(1, locationX / barWidth));
    onValueChange(newValue);
  }, [onValueChange]);

  return (
    <View style={debugStyles.sliderRow}>
      <Text style={[debugStyles.sliderLabel, { color }]}>{label}</Text>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={handlePress}
        style={debugStyles.sliderTrack}
      >
        <View style={[debugStyles.sliderFill, { width: `${value * 100}%`, backgroundColor: color }]} />
        <View style={[debugStyles.sliderThumb, { left: `${value * 100}%`, borderColor: color }]} />
      </TouchableOpacity>
      <Text style={debugStyles.sliderValue}>{displayValue}</Text>
    </View>
  );
}

interface DebugPanelProps {
  metrics: MetricsData;
  onUpdateMetrics: (metrics: Partial<MetricsData>) => void;
  onReset: () => void;
}

function DebugPanel({ metrics, onUpdateMetrics, onReset }: DebugPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const catchupProgress = metrics.catchup.dailyProgress / Math.max(metrics.catchup.dailyGoal, 1);
  const diveinProgress = (metrics.divein.dailyProgress || metrics.divein.weeklyProgress) /
    Math.max(metrics.divein.dailyGoal || metrics.divein.weeklyGoal, 1);
  const recapProgress = metrics.recap.status === 'completed' ? 1 : metrics.recap.status === 'in_progress' ? 0.5 : 0;

  const handleCatchupChange = useCallback((val: number) => {
    onUpdateMetrics({
      catchup: {
        ...metrics.catchup,
        dailyProgress: Math.round(val * metrics.catchup.dailyGoal),
      },
    });
  }, [metrics.catchup, onUpdateMetrics]);

  const handleDiveinChange = useCallback((val: number) => {
    const goal = metrics.divein.dailyGoal || metrics.divein.weeklyGoal;
    onUpdateMetrics({
      divein: {
        ...metrics.divein,
        dailyProgress: Math.round(val * goal),
        weeklyProgress: Math.round(val * metrics.divein.weeklyGoal),
      },
    });
  }, [metrics.divein, onUpdateMetrics]);

  const handleRecapChange = useCallback((val: number) => {
    let status: 'not_started' | 'in_progress' | 'completed';
    if (val < 0.25) status = 'not_started';
    else if (val < 0.75) status = 'in_progress';
    else status = 'completed';
    onUpdateMetrics({
      recap: {
        ...metrics.recap,
        status,
        weeklyProgress: Math.round(val * metrics.recap.weeklyGoal),
      },
    });
  }, [metrics.recap, onUpdateMetrics]);

  const setAllProgress = useCallback((val: number) => {
    handleCatchupChange(val);
    handleDiveinChange(val);
    handleRecapChange(val);
  }, [handleCatchupChange, handleDiveinChange, handleRecapChange]);

  if (!isExpanded) {
    return (
      <TouchableOpacity
        style={debugStyles.toggleButton}
        onPress={() => setIsExpanded(true)}
      >
        <Text style={debugStyles.toggleText}>Debug</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={debugStyles.panel}>
      <View style={debugStyles.panelHeader}>
        <Text style={debugStyles.panelTitle}>Debug Progress</Text>
        <TouchableOpacity onPress={() => setIsExpanded(false)}>
          <Text style={debugStyles.closeBtn}>X</Text>
        </TouchableOpacity>
      </View>

      <SliderBar
        value={Math.min(catchupProgress, 1)}
        onValueChange={handleCatchupChange}
        color="#38BDF8"
        label="Catch-up"
        displayValue={`${formatMinutes(metrics.catchup.dailyProgress)}/${formatMinutes(metrics.catchup.dailyGoal)}`}
      />

      <SliderBar
        value={Math.min(diveinProgress, 1)}
        onValueChange={handleDiveinChange}
        color="#EC4899"
        label="Dive-in"
        displayValue={`${formatMinutes(metrics.divein.dailyProgress || metrics.divein.weeklyProgress)}/${formatMinutes(metrics.divein.dailyGoal || metrics.divein.weeklyGoal)}`}
      />

      <SliderBar
        value={recapProgress}
        onValueChange={handleRecapChange}
        color="#FB923C"
        label="Recap"
        displayValue={metrics.recap.status.replace('_', ' ')}
      />

      {/* Quick preset buttons */}
      <View style={debugStyles.presetRow}>
        <TouchableOpacity style={debugStyles.presetBtn} onPress={() => setAllProgress(0)}>
          <Text style={debugStyles.presetText}>0%</Text>
        </TouchableOpacity>
        <TouchableOpacity style={debugStyles.presetBtn} onPress={() => setAllProgress(0.25)}>
          <Text style={debugStyles.presetText}>25%</Text>
        </TouchableOpacity>
        <TouchableOpacity style={debugStyles.presetBtn} onPress={() => setAllProgress(0.5)}>
          <Text style={debugStyles.presetText}>50%</Text>
        </TouchableOpacity>
        <TouchableOpacity style={debugStyles.presetBtn} onPress={() => setAllProgress(0.75)}>
          <Text style={debugStyles.presetText}>75%</Text>
        </TouchableOpacity>
        <TouchableOpacity style={debugStyles.presetBtn} onPress={() => setAllProgress(1)}>
          <Text style={debugStyles.presetText}>100%</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={debugStyles.resetBtn} onPress={onReset}>
        <Text style={debugStyles.resetText}>Reset to API Data</Text>
      </TouchableOpacity>
    </View>
  );
}

const debugStyles = StyleSheet.create({
  toggleButton: {
    position: 'absolute',
    top: 62,
    right: 20,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  toggleText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  panel: {
    position: 'absolute',
    top: 56,
    right: 12,
    left: 12,
    zIndex: 100,
    backgroundColor: 'rgba(15, 15, 20, 0.92)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 20,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  panelTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  closeBtn: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '700',
    padding: 4,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  sliderLabel: {
    fontSize: 11,
    fontWeight: '700',
    width: 60,
  },
  sliderTrack: {
    flex: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    overflow: 'visible',
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 10,
    opacity: 0.7,
  },
  sliderThumb: {
    position: 'absolute',
    top: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    marginLeft: -12,
    borderWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderValue: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '600',
    width: 56,
    textAlign: 'right',
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 8,
    gap: 6,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  resetBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  resetText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
});

// ─── Home Content ──────────────────────────────────────────────────

function HomeContent() {
  const { state, fetchMetrics, setActiveFilter, getFilterTabs, updateMetrics } = useMetrics();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [debugMetrics, setDebugMetrics] = useState<MetricsData | null>(null);
  const COLORS = useHomeColors();
  const { toggleTheme, isDark } = useTheme();
  const blurStyle = COLORS.isDark ? getDarkBackdropBlur(24) : getBackdropBlur(24);
  const blurStyle16 = COLORS.isDark ? getDarkBackdropBlur(16) : getBackdropBlur(16);

  // Prefetch catchup feed in the background so it's ready when user clicks the tab.
  // This fires once on mount — by the time the user navigates to Catch-up, data is cached.
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['catchup-feed', 'core'],
      queryFn: () => CatchupService.getCatchupFeed('core', 5, 0),
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);

  // Use debug metrics if set, otherwise use API metrics
  const displayMetrics = debugMetrics || state.metrics;

  const handleRefresh = async () => {
    await fetchMetrics();
  };

  const handleTabPress = (tabId: string, filter: string) => {
    setActiveFilter(filter);
  };

  const handleRingPress = (section: 'catchup' | 'divein' | 'recap') => {
  };

  const handleLogout = async () => {
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm('Are you sure you want to logout?')
        : true;

    if (!confirmed) {
      return;
    }

    try {
      await removeAuthToken();
      router.replace('/(auth)/login');
    } catch (error) {
      if (typeof window !== 'undefined') {
        window.alert('Failed to logout. Please try again.');
      }
    }
  };

  const handleChangeGoals = () => {
    setShowGoalEditor(true);
  };

  const handleGoalsSaved = () => {
    setShowGoalEditor(false);
    fetchMetrics();
  };

  const handleDebugUpdate = useCallback((metricsUpdate: Partial<MetricsData>) => {
    setDebugMetrics(prev => {
      const base = prev || state.metrics;
      return { ...base, ...metricsUpdate } as MetricsData;
    });
    updateMetrics(metricsUpdate);
  }, [state.metrics, updateMetrics]);

  const handleDebugReset = useCallback(() => {
    setDebugMetrics(null);
    fetchMetrics();
  }, [fetchMetrics]);

  const filterTabs = getFilterTabs();

  if (state.loading && !displayMetrics.lastUpdated) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: COLORS.background }]}>
        <OrganicBackground variant="home" />
        <View style={styles.loadingPulse}>
          <Text style={styles.loadingEmoji}>...</Text>
        </View>
        <Text style={[styles.loadingText, { color: COLORS.textSecondary }]}>Loading your progress...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: COLORS.background }]}>
      {/* 3D Glass Blob Background */}
      <OrganicBackground variant="home" />

      {/* Debug panel - only in development mode */}
      {process.env.NODE_ENV !== 'production' && (
        <DebugPanel
          metrics={displayMetrics}
          onUpdateMetrics={handleDebugUpdate}
          onReset={handleDebugReset}
        />
      )}

      {/* Dev Metrics Panel - performance monitoring */}
      {process.env.NODE_ENV !== 'production' && DevMetricsPanel && <DevMetricsPanel />}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={state.loading}
            onRefresh={handleRefresh}
            tintColor={COLORS.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header with logo + glass effect */}
        <View style={styles.header}>
          <View style={[styles.headerGlass, { backgroundColor: COLORS.cardBgGlass, borderColor: COLORS.glassBorder }, blurStyle]}>
            <View style={styles.headerTop}>
              <View style={styles.headerBrandRow}>
                <GuruRings size="logo" dimensions={36} />
                <Text style={[styles.headerBrandName, { color: COLORS.textPrimary }]}>GURU</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={styles.themeToggle} onPress={toggleTheme}>
                  <Text style={styles.themeToggleText}>{isDark ? '☀️' : '🌙'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                  <Text style={styles.logoutText}>Logout</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={[styles.greeting, { color: COLORS.textSecondary }]}>Welcome back</Text>
            <Text style={[styles.title, { color: COLORS.textPrimary }]}>Your Progress</Text>
            {state.error && <Text style={styles.errorText}>{state.error}</Text>}
          </View>
        </View>

        {/* GuruRings — hero display with liquid fill + glow */}
        <GuruRings
          size="hero"
          metrics={displayMetrics}
          onRingPress={handleRingPress}
          showChangeGoals={true}
          onChangeGoals={handleChangeGoals}
        />

        {/* Feed Tab Bar */}
        {filterTabs.length > 0 && (
          <View style={[styles.feedSection, { backgroundColor: COLORS.cardBgGlass, borderColor: COLORS.glassBorder }, blurStyle16]}>
            <Text style={[styles.feedTitle, { color: COLORS.textPrimary }]}>Content Filters</Text>
            <FeedTabBar
              tabs={filterTabs}
              activeTabId={state.activeFilter}
              onTabPress={handleTabPress}
            />
          </View>
        )}

        {/* Weekly Goals Progress (migrated from Recap) */}
        <View style={styles.goalsSection}>
          <Text style={[styles.sectionTitle, { color: COLORS.textPrimary }]}>Your Week</Text>
          <View style={[styles.goalsCard, { backgroundColor: COLORS.cardBgGlass, borderColor: COLORS.glassBorder }, blurStyle16]}>
            {(() => {
              const catchupGoal = displayMetrics.catchup.dailyGoal * 7;
              const catchupExceeded = displayMetrics.catchup.weeklyTotal > catchupGoal && catchupGoal > 0;
              return (
                <View style={styles.goalItem}>
                  <View style={styles.goalHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: catchupExceeded ? DarkThemeColors.success : '#38BDF8' }} />
                      <Text style={[styles.goalLabel, { color: COLORS.textPrimary }]}>Catch-up</Text>
                      {catchupExceeded && <Text style={{ fontSize: 14 }}>{'✓'}</Text>}
                    </View>
                    <Text style={[styles.goalValue, { color: catchupExceeded ? DarkThemeColors.success : COLORS.textSecondary }]}>
                      {displayMetrics.catchup.weeklyTotal}m / {catchupGoal}m
                    </Text>
                  </View>
                  <View style={[styles.goalProgressBar, { backgroundColor: COLORS.progressBarBg }]}>
                    <View style={[
                      styles.goalProgressFill,
                      { backgroundColor: catchupExceeded ? DarkThemeColors.success : RingColors.catchup.primary },
                      { width: `${Math.min(100, (displayMetrics.catchup.weeklyTotal / Math.max(catchupGoal, 1)) * 100)}%` }
                    ]} />
                  </View>
                </View>
              );
            })()}
            {(() => {
              const diveinExceeded = displayMetrics.divein.weeklyProgress > displayMetrics.divein.weeklyGoal && displayMetrics.divein.weeklyGoal > 0;
              return (
                <View style={styles.goalItem}>
                  <View style={styles.goalHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: diveinExceeded ? DarkThemeColors.success : '#EC4899' }} />
                      <Text style={[styles.goalLabel, { color: COLORS.textPrimary }]}>Dive-in</Text>
                      {diveinExceeded && <Text style={{ fontSize: 14 }}>{'✓'}</Text>}
                    </View>
                    <Text style={[styles.goalValue, { color: diveinExceeded ? DarkThemeColors.success : COLORS.textSecondary }]}>
                      {displayMetrics.divein.weeklyProgress}m / {displayMetrics.divein.weeklyGoal}m
                    </Text>
                  </View>
                  <View style={[styles.goalProgressBar, { backgroundColor: COLORS.progressBarBg }]}>
                    <View style={[
                      styles.goalProgressFill,
                      { backgroundColor: diveinExceeded ? DarkThemeColors.success : RingColors.divein.primary },
                      { width: `${Math.min(100, (displayMetrics.divein.weeklyProgress / Math.max(displayMetrics.divein.weeklyGoal, 1)) * 100)}%` }
                    ]} />
                  </View>
                </View>
              );
            })()}
            <View style={styles.goalItem}>
              <View style={styles.goalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: displayMetrics.recap.status === 'completed' ? DarkThemeColors.success : '#FB923C' }} />
                  <Text style={[styles.goalLabel, { color: COLORS.textPrimary }]}>Recap</Text>
                  {displayMetrics.recap.status === 'completed' && <Text style={{ fontSize: 14 }}>{'✓'}</Text>}
                </View>
                <Text style={[styles.goalValue, { color: displayMetrics.recap.status === 'completed' ? DarkThemeColors.success : COLORS.textSecondary }]}>
                  {displayMetrics.recap.status === 'completed' ? 'Done' : displayMetrics.recap.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                </Text>
              </View>
              <View style={[styles.goalProgressBar, { backgroundColor: COLORS.progressBarBg }]}>
                <View style={[
                  styles.goalProgressFill,
                  { backgroundColor: displayMetrics.recap.status === 'completed' ? DarkThemeColors.success : RingColors.recap.primary },
                  { width: displayMetrics.recap.status === 'completed' ? '100%' : displayMetrics.recap.status === 'in_progress' ? '50%' : '0%' }
                ]} />
              </View>
            </View>
          </View>
        </View>

        {/* TODO: Commitment Reminder Card — shows last week's commitment (Step 8) */}

        {/* Last Updated */}
        {displayMetrics.lastUpdated && (
          <View style={styles.footer}>
            <Text style={[styles.lastUpdated, { color: COLORS.textTertiary }]}>
              Updated {(() => { const d = Math.round((Date.now() - new Date(displayMetrics.lastUpdated).getTime()) / 60000); return d < 1 ? 'just now' : d < 60 ? `${d}m ago` : `${Math.floor(d/60)}h ago`; })()}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Goal Editor Modal */}
      <Modal
        visible={showGoalEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowGoalEditor(false)}
      >
        <GoalEditor
          onClose={() => setShowGoalEditor(false)}
          onSave={handleGoalsSaved}
          currentGoals={{
            catchupDailyGoal: displayMetrics.catchup.dailyGoal,
            diveinDailyGoal: displayMetrics.divein.dailyGoal,
          }}
        />
      </Modal>
    </View>
  );
}

export default function HomeScreen() {
  return <HomeContent />;
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
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: DarkThemeColors.background,
  },
  loadingPulse: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
  },
  loadingEmoji: {
    fontSize: 32,
  },
  loadingText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    fontWeight: '500',
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 60,
    paddingBottom: Spacing.sm,
  },
  headerGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    ...getBackdropBlur(24),
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerBrandName: {
    fontFamily: 'Orbitron_700Bold',
    fontSize: 20,
    color: DarkThemeColors.textPrimary,
    letterSpacing: 6,
  },
  greeting: {
    ...Typography.bodyMedium,
    fontSize: 16,
    color: DarkThemeColors.textSecondary,
    marginBottom: Spacing.xs,
  },
  title: {
    ...Typography.displaySmall,
    color: DarkThemeColors.textPrimary,
  },
  themeToggle: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  themeToggleText: {
    fontSize: 16,
  },
  logoutButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  logoutText: {
    color: '#94A3B8',
    ...Typography.labelSmall,
    fontWeight: '600',
  },
  errorText: {
    ...Typography.bodySmall,
    color: '#EF4444',
    marginTop: Spacing.md,
    textAlign: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  feedSection: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    ...getBackdropBlur(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
  },
  feedTitle: {
    ...Typography.labelLarge,
    color: DarkThemeColors.textPrimary,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.md,
  },
  // Weekly Goals styles (migrated from Recap)
  goalsSection: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  goalsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
    ...getBackdropBlur(16),
  },
  goalItem: {
    marginBottom: Spacing.md,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  goalLabel: {
    ...Typography.labelLarge,
    color: DarkThemeColors.textPrimary,
  },
  goalValue: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
  },
  goalProgressBar: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  footer: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  lastUpdated: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textTertiary,
  },
});
