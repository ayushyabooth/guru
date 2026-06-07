import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, Animated, Easing } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MetricProvider, useMetrics } from '../../store/metric-context';
import { useTheme } from '../../contexts/ThemeContext';
import { PlasmaBlobRing } from '../../components/Rings/PlasmaBlobRing';
import { Triskelion } from '../../components/Rings/Triskelion';
import AnimatedTabPill from '../../components/shared/AnimatedTabPill';

const TAB_INACTIVE_OPACITY = 0.35;

/**
 * GUR-211: Shared signal so a tab screen can request the floating glass tab
 * bar be hidden (e.g. the Recap immersive journey stages, which must be
 * full-screen per BRD F.2). Ownership of the actual tabBarStyle stays in this
 * file — screens only flip a boolean, so when the bar is restored it returns
 * IDENTICAL to the original themed glass-island style (we never reconstruct it
 * from a screen).
 *
 * Implemented as a tiny external store consumed via useSyncExternalStore so any
 * screen (outside the Tabs render tree) can drive it without prop-drilling or a
 * provider wrapper.
 */
let tabBarHiddenValue = false;
const tabBarHiddenListeners = new Set<() => void>();

export function setTabBarHidden(hidden: boolean) {
  if (tabBarHiddenValue === hidden) return;
  tabBarHiddenValue = hidden;
  tabBarHiddenListeners.forEach((l) => l());
}

function subscribeTabBarHidden(listener: () => void) {
  tabBarHiddenListeners.add(listener);
  return () => {
    tabBarHiddenListeners.delete(listener);
  };
}

function useTabBarHidden() {
  return React.useSyncExternalStore(
    subscribeTabBarHidden,
    () => tabBarHiddenValue,
    () => tabBarHiddenValue,
  );
}

/**
 * Tab ring icon. The focus affordance is now the sliding glass pill rendered
 * behind all tabs (see AnimatedTabPill); this component only handles the
 * ring's opacity and breathing scale. No per-icon glow disc — that was the
 * GUR-98 halo.
 */
function TabRingIcon({ color, progress, focused, size = 26 }: {
  color: string; progress: number; focused: boolean; size?: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(focused ? 1 : TAB_INACTIVE_OPACITY)).current;

  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: focused ? 1 : TAB_INACTIVE_OPACITY,
      duration: 220,
      useNativeDriver: true,
    }).start();

    // Breathing scale loop only when focused
    if (focused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.08, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1.0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      scaleAnim.stopAnimation();
      Animated.timing(scaleAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
  }, [focused]);

  return (
    <Animated.View style={{ opacity: opacityAnim, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <PlasmaBlobRing progress={progress} color={color} size={size} stroke={2.5} minimal />
      </Animated.View>
    </Animated.View>
  );
}

/** Breathing Triskelion for the Home tab — same rules as TabRingIcon: no disc. */
function TabHomeIcon({ focused, size = 28, catchupProgress, diveinProgress, recapProgress }: {
  focused: boolean; size?: number; catchupProgress: number; diveinProgress: number; recapProgress: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(focused ? 1 : TAB_INACTIVE_OPACITY)).current;

  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: focused ? 1 : TAB_INACTIVE_OPACITY,
      duration: 220,
      useNativeDriver: true,
    }).start();

    if (focused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.08, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1.0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      scaleAnim.stopAnimation();
      Animated.timing(scaleAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
  }, [focused]);

  return (
    <Animated.View style={{ opacity: opacityAnim, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Triskelion size={size} progress={{ c: catchupProgress, d: diveinProgress, r: recapProgress }} />
      </Animated.View>
    </Animated.View>
  );
}

function TabsWithMetrics() {
  const colorScheme = useColorScheme();
  const { isDark, colors } = useTheme();
  const { state } = useMetrics();
  const m = state.metrics;
  // GUR-211: when a screen requests immersive mode, hide the bar via `display`
  // only — every other glass-island property stays exactly as built below, so
  // the bar reappears identical when `display` flips back to 'flex'.
  const tabBarHidden = useTabBarHidden();

  // Compute progress (0-1) for each ring
  const catchupProgress = Math.min(
    m.catchup.dailyProgress / Math.max(m.catchup.dailyGoal, 1), 1
  );
  const diveinProgress = Math.min(
    (m.divein.dailyProgress || m.divein.weeklyProgress) /
    Math.max(m.divein.dailyGoal || m.divein.weeklyGoal, 1), 1
  );
  const recapProgress = m.recap.status === 'completed'
    ? 1
    : m.recap.status === 'in_progress' ? 0.5 : 0;

  // Floating glass island tab bar
  const tabBarStyle: any = {
    display: tabBarHidden ? 'none' : 'flex',
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    height: 64,
    borderRadius: 24,
    backgroundColor: isDark ? 'rgba(15, 20, 35, 0.80)' : 'rgba(255, 255, 255, 0.88)',
    // Border: light strokes on dark glass, dark tint on light glass
    borderWidth: 1,
    borderTopColor: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(15, 23, 42, 0.08)',
    borderLeftColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.05)',
    borderRightColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.05)',
    borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.04)',
    // Floating shadow
    shadowColor: isDark ? '#000' : '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.5 : 0.12,
    shadowRadius: 24,
    elevation: 12,
    paddingBottom: 0,
    paddingTop: 0,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(36px) saturate(200%)',
      WebkitBackdropFilter: 'blur(36px) saturate(200%)',
      boxShadow: isDark
        ? '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)'
        : '0 4px 24px rgba(15,23,42,0.1), inset 0 1px 0 rgba(255,255,255,0.9)',
    } : {}),
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isDark ? '#F1F5F9' : '#6366F1',
        // WCAG AA: bumped from #64748B / #94A3B8 to #94A3B8 / #475569 so the
        // 11px tab labels meet 4.5:1 against the floating glass tab-bar
        // background in both themes.
        tabBarInactiveTintColor: isDark ? '#94A3B8' : '#475569',
        tabBarAccessibilityLabel: 'Main navigation',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle,
        // GUR-137: sliding glass pill behind the active tab. Rendered inside
        // tabBarBackground so it sits above the bar's base fill but under the
        // tab buttons — clicks still reach HapticTab, pill just tracks focus.
        tabBarBackground: () => <AnimatedTabPill isDark={isDark} />,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabHomeIcon focused={focused} catchupProgress={catchupProgress} diveinProgress={diveinProgress} recapProgress={recapProgress} />,
        }}
      />
      <Tabs.Screen
        name="catchup"
        options={{
          title: 'Catch-up',
          tabBarIcon: ({ color, focused }) => (
            <TabRingIcon color="#38BDF8" progress={catchupProgress} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="divein"
        options={{
          title: 'Dive-in',
          tabBarIcon: ({ color, focused }) => (
            <TabRingIcon color="#EC4899" progress={diveinProgress} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="recap"
        options={{
          title: 'Recap',
          tabBarIcon: ({ color, focused }) => (
            <TabRingIcon color="#FB923C" progress={recapProgress} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <MetricProvider enablePolling={true} pollingInterval={60000}>
      <TabsWithMetrics />
    </MetricProvider>
  );
}
