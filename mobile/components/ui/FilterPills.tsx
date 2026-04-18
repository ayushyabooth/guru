/**
 * FilterPills — Layered Glass + Slide Morph Transition
 * GUR-132
 *
 * Z-ORDER MODEL (per Figma spec):
 *   Layer 1 (bottom): Pill background shapes — always present
 *   Layer 2:          ALL text at every pill — dim gray, NEVER 0 opacity
 *   Layer 3:          Glass blob — ~28% opaque, backdrop-blur(28px)
 *                     → frosts the dim text beneath (physically correct glass)
 *   Layer 4 (top):    Active text overlay — bold + accent, ABOVE the blob
 *
 * TRANSITION: Glass Slide + Morph  350ms
 *   0–60ms:    Active text (L4) fades out. Blob departs.
 *   60–200ms:  Blob slides + width stretches 15%. Dim text frosted through glass.
 *   200–290ms: Blob arrives. New active text (L4) fades in above blob.
 *   290–350ms: Spring settles.
 *
 * GLASS BLOB  7-LAYER STACK:
 *   L0: Ambient glow shadow (accent color, active only)
 *   L1: Glass surface fill @18% + backdrop-blur(28px)
 *   L2: Accent color tint @10%
 *   L3: Depth gradient (specular highlight — white 1px top edge)
 *   L4: Inner specular radial hotspot
 *   L5: Gradient border (bright top → dim bottom)
 *   L6: Inner light radial glow @SCREEN blend (web only, via mix-blend-mode)
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../contexts/ThemeContext';
import { BorderRadius } from '../../constants/liquidGlass';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h.split('').map((c) => c + c).join('') : h,
    16
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterPillItem {
  id: string;
  label: string;
  context?: string; // backward compat with FilterTabBar
  value?: string;
}

export interface FilterPillsProps {
  pills: FilterPillItem[];
  activeId: string;
  onSelect: (id: string, context?: string) => void;
  accentColor?: string; // hex color driving the glass blob tint + active text
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation constants (from Figma spec)
// ─────────────────────────────────────────────────────────────────────────────

const BLOB_SPRING = { mass: 1, stiffness: 280, damping: 24 };
const STRETCH_FACTOR = 1.15; // blob widens 15% mid-flight
const STRETCH_DURATION = 100; // ms for the stretch phase
const TEXT_OUT_DURATION = 60; // ms — active text fades out
const TEXT_IN_DELAY = 200; // ms delay before new active text appears
const TEXT_IN_DURATION = 90; // ms — active text fades in

// Pill dimensions (must match the styles below)
const PILL_HEIGHT = 36;
const PILL_V_OFFSET = 6; // top offset to center 36px blob in 48px wrapper

// ─────────────────────────────────────────────────────────────────────────────
// PillItem — owns its own active-text shared value (keeps hooks stable)
// ─────────────────────────────────────────────────────────────────────────────

interface PillItemProps {
  pill: FilterPillItem;
  isActive: boolean;
  accentColor: string;
  isDark: boolean;
  onPress: () => void;
  onLayout: (pill: FilterPillItem, x: number, y: number, width: number, height: number) => void;
}

const PillItem: React.FC<PillItemProps> = ({
  pill,
  isActive,
  accentColor,
  isDark,
  onPress,
  onLayout,
}) => {
  // Per-pill active text opacity — stable across re-renders
  const activeOpacity = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    if (isActive) {
      // Fade in after blob arrives
      activeOpacity.value = withDelay(
        TEXT_IN_DELAY,
        withTiming(1, { duration: TEXT_IN_DURATION, easing: Easing.out(Easing.cubic) })
      );
    } else {
      // Quick fade out as blob departs
      activeOpacity.value = withTiming(0, {
        duration: TEXT_OUT_DURATION,
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [isActive]);

  const activeTextAnimStyle = useAnimatedStyle(() => ({
    opacity: activeOpacity.value,
  }));

  const dimColor = isDark
    ? 'rgba(148, 163, 184, 0.80)' // slate-400 @80% — always visible
    : 'rgba(71, 85, 105, 0.70)'; // slate-600 @70%
  const activeColor = isDark ? '#FFFFFF' : accentColor;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        onLayout(pill, x, y, width, height);
      }}
      style={styles.pill}
      activeOpacity={0.75}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={pill.label}
    >
      {/* L2: Dim text — ALWAYS visible, never 0 opacity */}
      <Text style={[styles.dimText, { color: dimColor }]} numberOfLines={1}>
        {pill.label}
      </Text>

      {/* L4: Active text overlay — above blob, animated opacity */}
      <Animated.Text
        style={[
          styles.activeText,
          activeTextAnimStyle,
          {
            color: activeColor,
            fontWeight: '700',
          },
        ]}
        numberOfLines={1}
        pointerEvents="none"
      >
        {pill.label}
      </Animated.Text>
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GlassBlob — the 7-layer sliding glass indicator
// ─────────────────────────────────────────────────────────────────────────────

interface GlassBlobProps {
  blobX: Animated.SharedValue<number>;
  blobWidth: Animated.SharedValue<number>;
  accentColor: string;
  isDark: boolean;
}

const GlassBlob: React.FC<GlassBlobProps> = ({ blobX, blobWidth, accentColor, isDark }) => {
  const blobAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: blobX.value }],
    width: blobWidth.value,
  }));

  // L0: Ambient glow (native shadow / web box-shadow)
  const glowStyle =
    Platform.OS === 'web'
      ? ({
          boxShadow: [
            `0 0 20px ${hexToRgba(accentColor, isDark ? 0.30 : 0.18)}`,
            `0 4px 12px rgba(0,0,0,${isDark ? '0.35' : '0.10'})`,
            `inset 0 1px 0 rgba(255,255,255,${isDark ? '0.22' : '0.88'})`,
            `inset 0 -1px 0 rgba(0,0,0,${isDark ? '0.20' : '0.06'})`, // L5 bottom border dim
          ].join(', '),
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
          transition: 'box-shadow 200ms ease',
        } as any)
      : {
          shadowColor: accentColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: isDark ? 0.32 : 0.18,
          shadowRadius: 12,
          elevation: 4,
        };

  // L1: Glass surface — 18% opacity
  const glassFill = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.78)';

  // L2: Accent color tint — 10% opacity
  const tintColor = hexToRgba(accentColor, 0.10);

  // L5: Border — gradient via two border colors (simplified: bright top border)
  const borderColor = isDark
    ? `rgba(255,255,255,0.28)`
    : hexToRgba(accentColor, 0.40);

  return (
    <Animated.View
      style={[
        styles.blob,
        glowStyle,
        {
          backgroundColor: glassFill,
          borderColor,
        },
        blobAnimStyle,
      ]}
      pointerEvents="none"
    >
      {/* L2: Color tint layer */}
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: tintColor, borderRadius: BorderRadius.pill },
        ]}
      />

      {/* L3: Depth gradient specular — bright 1px top edge */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 10,
          right: 10,
          height: 1,
          borderRadius: 1,
          backgroundColor: `rgba(255,255,255,${isDark ? 0.24 : 0.92})`,
        }}
      />

      {/* L4: Specular radial hotspot (top-center glow) */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: '20%' as any,
          right: '20%' as any,
          height: 8,
          borderRadius: 4,
          backgroundColor: `rgba(255,255,255,${isDark ? 0.12 : 0.50})`,
          opacity: 0.7,
        }}
      />

      {/* L6: Inner light radial accent glow (web SCREEN blend) */}
      {Platform.OS === 'web' && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: BorderRadius.pill,
              backgroundColor: hexToRgba(accentColor, 0.08),
              // @ts-ignore web only
              mixBlendMode: 'screen',
            } as any,
          ]}
        />
      )}
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FilterPills — main component
// ─────────────────────────────────────────────────────────────────────────────

export const FilterPills: React.FC<FilterPillsProps> = ({
  pills,
  activeId,
  onSelect,
  accentColor = '#38BDF8',
}) => {
  const { isDark } = useTheme();

  // Pill layout cache — populated by onLayout callbacks
  const layoutsRef = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({});

  // Glass blob shared values
  const blobX = useSharedValue(-999); // off-screen until first layout
  const blobWidth = useSharedValue(80);

  // Initialized flag — so first layout sets blob without spring
  const initializedRef = useRef(false);

  const handlePillLayout = useCallback(
    (pill: FilterPillItem, x: number, y: number, width: number, height: number) => {
      layoutsRef.current[pill.id] = { x, y, width, height };

      // On first layout of the active pill, teleport blob (no animation)
      if (!initializedRef.current && (pill.id === activeId || pill.context === activeId)) {
        blobX.value = x;
        blobWidth.value = width;
        initializedRef.current = true;
      }
    },
    [activeId]
  );

  const handlePillPress = useCallback(
    (pill: FilterPillItem) => {
      const layout = layoutsRef.current[pill.id];
      if (layout) {
        // Slide blob: spring to target x
        blobX.value = withSpring(layout.x, BLOB_SPRING);

        // Width: stretch 15% mid-flight, then spring to target
        blobWidth.value = withSequence(
          withTiming(layout.width * STRETCH_FACTOR, {
            duration: STRETCH_DURATION,
            easing: Easing.out(Easing.cubic),
          }),
          withSpring(layout.width, BLOB_SPRING)
        );
      }
      onSelect(pill.id, pill.context ?? pill.value);
    },
    [onSelect]
  );

  // Handle externally-driven activeId change (e.g., deep link / state restore)
  useEffect(() => {
    if (!initializedRef.current) return;
    const layout = layoutsRef.current[activeId];
    if (layout) {
      blobX.value = withSpring(layout.x, BLOB_SPRING);
      blobWidth.value = withSpring(layout.width, BLOB_SPRING);
    }
  }, [activeId]);

  return (
    <View style={styles.wrapper} accessibilityRole="tablist" accessibilityLabel="Content filters">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        {/*
         * L3 — Glass blob: rendered FIRST so it sits below pill text in z-order.
         * Absolutely positioned within the ScrollView content container.
         */}
        <GlassBlob
          blobX={blobX}
          blobWidth={blobWidth}
          accentColor={accentColor}
          isDark={isDark}
        />

        {/*
         * L2 + L4 — Pill items: dim text always visible, active text animated.
         * Each PillItem owns its own useSharedValue to keep hooks stable.
         */}
        {pills.map((pill) => (
          <PillItem
            key={pill.id}
            pill={pill}
            isActive={pill.id === activeId || pill.context === activeId}
            accentColor={accentColor}
            isDark={isDark}
            onPress={() => handlePillPress(pill)}
            onLayout={handlePillLayout}
          />
        ))}
      </ScrollView>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible FilterTabBar wrapper (re-uses FilterPills internally)
// ─────────────────────────────────────────────────────────────────────────────

export const FilterTabBar: React.FC<{
  tabs: Array<{ label: string; context: string }>;
  selectedContext: string;
  onContextChange: (context: string) => void;
  accentColor?: string;
}> = ({ tabs, selectedContext, onContextChange, accentColor }) => {
  const mappedPills: FilterPillItem[] = tabs.map((t) => ({
    id: t.context,
    label: t.label,
    context: t.context,
  }));

  return (
    <FilterPills
      pills={mappedPills}
      activeId={selectedContext}
      onSelect={(_, context) => context && onContextChange(context)}
      accentColor={accentColor}
    />
  );
};

export default FilterPills;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    height: 48,
    maxHeight: 48,
    flexDirection: 'row',
  },
  scrollView: {
    backgroundColor: 'transparent',
    flexGrow: 0,
    flexShrink: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingVertical: PILL_V_OFFSET,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexDirection: 'row',
  },
  // Glass blob — absolutely positioned, behind pill text
  blob: {
    position: 'absolute',
    top: PILL_V_OFFSET,
    left: 0,
    height: PILL_HEIGHT,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // Individual pill hit-area (no background — blob provides the glass bg)
  pill: {
    height: PILL_HEIGHT,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  // L2: Dim text — always rendered
  dimText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  // L4: Active text — absolutely on top of dim text, same geometry
  activeText: {
    position: 'absolute',
    fontSize: 12,
    letterSpacing: 0.2,
    textAlign: 'center',
    // Matches pill padding so text aligns exactly
    paddingHorizontal: 0,
  },
});
